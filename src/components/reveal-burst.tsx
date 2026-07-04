"use client";

import * as React from "react";

/**
 * Thanos-snap style dissolve.
 *
 * Captures the target element as an image (via SVG foreignObject → canvas),
 * slices it into a grid of shards, then animates each shard flying outward
 * with rotation, gravity, and a feathered alpha dissolve — so the UI visibly
 * "breaks apart" into pieces that drift away and vanish, exactly like the
 * Thanos snap. A shockwave + bloom accompany the break for extra punch.
 *
 * Canvas-based for 60fps. Calls onDone when all shards have dissolved.
 */

const COLORS = [
  "rgba(196, 181, 253, 1)",
  "rgba(167, 139, 250, 1)",
  "rgba(232, 121, 249, 1)",
  "rgba(244, 114, 182, 1)",
  "rgba(216, 180, 254, 1)",
  "rgba(233, 213, 255, 1)",
];

interface Shard {
  sx: number; // source x in captured image
  sy: number;
  sw: number;
  sh: number;
  x: number; // current pos (screen space)
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  maxLife: number;
  size: number;
  delay: number;
}

async function captureElement(
  el: Element,
  rect: DOMRect
): Promise<HTMLCanvasElement | null> {
  // Serialize the element + its computed styles into an SVG foreignObject,
  // draw onto a canvas, and return it. This captures the visual appearance
  // including background, borders, text, and emoji.
  const W = Math.max(1, Math.floor(rect.width));
  const H = Math.max(1, Math.floor(rect.height));
  const clone = el.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

  // Inline computed styles so the serialized clone renders correctly.
  inlineStyles(el as HTMLElement, clone);

  const outer = document.createElement("div");
  outer.appendChild(clone);
  const serialized = new XMLSerializer().serializeToString(clone);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<foreignObject width="100%" height="100%" x="0" y="0">${serialized}</foreignObject>` +
    `</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function inlineStyles(src: HTMLElement, dst: HTMLElement) {
  const cs = window.getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    css += `${prop}: ${cs.getPropertyValue(prop)}; `;
  }
  dst.setAttribute("style", css);
  let s = src.firstElementChild as HTMLElement | null;
  let d = dst.firstElementChild as HTMLElement | null;
  while (s && d) {
    inlineStyles(s, d);
    s = s.nextElementSibling as HTMLElement | null;
    d = d.nextElementSibling as HTMLElement | null;
  }
}

export function RevealBurst({
  rect,
  targetRef,
  onCaptured,
  onDone,
}: {
  rect: DOMRect;
  targetRef: React.RefObject<HTMLElement | null>;
  onCaptured?: () => void;
  onDone: () => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    let raf = 0;
    let completed = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const run = async () => {
      // Try to capture the actual card for a true shatter.
      const snap =
        (targetRef.current && (await captureElement(targetRef.current, rect))) ||
        null;
      // Now that we have the snapshot, hide the real card so only the
      // flying shards are visible (no intact card underneath).
      if (!cancelled) onCaptured?.();

      // Grid of shards covering the card.
      const cols = 14;
      const rows = 18;
      const sw = rect.width / cols;
      const sh = rect.height / rows;
      const shards: Shard[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // slight per-shard randomization for organic break
          const jx = (Math.random() - 0.5) * sw * 0.3;
          const jy = (Math.random() - 0.5) * sh * 0.3;
          const px = rect.left + c * sw + sw / 2 + jx;
          const py = rect.top + r * sh + sh / 2 + jy;
          // outward from center
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const speed = 120 + Math.random() * 380 + dist * 1.1;
          const swirl = (Math.random() - 0.5) * 0.5;
          const vx = (dx / dist) * speed + -dy * swirl;
          const vy = (dy / dist) * speed + dx * swirl - 60;
          const maxLife = 0.85 + Math.random() * 0.75;
          shards.push({
            sx: c * sw,
            sy: r * sh,
            sw,
            sh,
            x: px,
            y: py,
            vx,
            vy,
            rot: 0,
            vrot: (Math.random() - 0.5) * 7,
            life: maxLife,
            maxLife,
            size: 0.85 + Math.random() * 0.35,
            delay: Math.random() * 0.28,
          });
        }
      }

      // accent particles (purple hearts + dots) for richness
      const accentCount = 70;
      interface Accent {
        x: number; y: number; vx: number; vy: number;
        life: number; maxLife: number; size: number;
        color: string; isHeart: boolean; rot: number; vrot: number;
      }
      const accents: Accent[] = [];
      for (let i = 0; i < accentCount; i++) {
        const px = rect.left + Math.random() * rect.width;
        const py = rect.top + Math.random() * rect.height;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const speed = 180 + Math.random() * 520;
        const vx = (dx / dist) * speed;
        const vy = (dy / dist) * speed - 80;
        const maxLife = 0.7 + Math.random() * 0.8;
        accents.push({
          x: px, y: py, vx, vy,
          life: maxLife, maxLife,
          size: 1.5 + Math.random() * 5,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          isHeart: Math.random() < 0.2,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 8,
        });
      }

      let shockRadius = 0;
      let shockAlpha = 0.6;
      let last = performance.now();
      let elapsed = 0;
      const gravity = 360;
      const drag = 0.97;

      const frame = (now: number) => {
        if (cancelled) return;
        const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
        last = now;
        elapsed += dt;
        ctx.clearRect(0, 0, W, H);

        // shockwave
        if (shockAlpha > 0.01) {
          shockRadius += 820 * dt;
          shockAlpha = Math.max(0, shockAlpha - dt * 1.25);
          const r1 = Math.max(0, shockRadius);
          if (r1 > 0) {
            ctx.beginPath();
            ctx.arc(cx, cy, r1, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(216, 180, 254, ${shockAlpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            const r2 = Math.max(0, shockRadius * 0.7);
            if (r2 > 0) {
              ctx.beginPath();
              ctx.arc(cx, cy, r2, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(232, 121, 249, ${shockAlpha * 0.5})`;
              ctx.lineWidth = 8;
              ctx.stroke();
            }
          }
        }

        // central bloom (first 0.4s)
        const bloom = Math.max(0, 1 - elapsed / 0.4);
        if (bloom > 0) {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 240);
          grad.addColorStop(0, `rgba(233, 213, 255, ${0.5 * bloom})`);
          grad.addColorStop(0.5, `rgba(196, 181, 253, ${0.22 * bloom})`);
          grad.addColorStop(1, "rgba(196, 181, 253, 0)");
          ctx.fillStyle = grad;
          ctx.fillRect(cx - 260, cy - 260, 520, 520);
        }

        // shards — the actual UI breaking apart
        let aliveShards = 0;
        for (const s of shards) {
          if (s.delay > elapsed) continue;
          s.life -= dt;
          if (s.life <= 0) continue;
          aliveShards++;
          s.vy += gravity * dt;
          s.vx *= drag;
          s.vy *= drag;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.rot += s.vrot * dt;
          const t = s.life / s.maxLife;
          const alpha = t * t;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(s.x, s.y);
          ctx.rotate(s.rot);
          ctx.scale(s.size, s.size);
          if (snap) {
            // draw the captured shard of the actual UI
            ctx.drawImage(
              snap,
              s.sx, s.sy, s.sw, s.sh,
              -s.sw / 2, -s.sh / 2, s.sw, s.sh
            );
          } else {
            // fallback: solid lilac shard
            ctx.fillStyle = "rgba(196, 181, 253, 0.9)";
            ctx.fillRect(-s.sw / 2, -s.sh / 2, s.sw, s.sh);
          }
          // feather edges as life fades for the dissolve look
          if (t < 0.5) {
            ctx.globalAlpha = alpha * 0.5;
            ctx.fillStyle = "rgba(233, 213, 255, 0.5)";
            ctx.fillRect(-s.sw / 2, -s.sh / 2, s.sw, s.sh);
          }
          ctx.restore();
        }

        // accents
        let aliveAccents = 0;
        for (const p of accents) {
          p.life -= dt;
          if (p.life <= 0) continue;
          aliveAccents++;
          p.vy += gravity * dt;
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vrot * dt;
          const t = p.life / p.maxLife;
          const alpha = t * t;
          if (p.isHeart) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = alpha;
            ctx.font = `${10 + p.size * 2}px serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("💜", 0, 0);
            ctx.restore();
          } else {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            const r = Math.max(0, p.size);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = alpha * 0.35;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0, p.size * 2.2), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;

        if (
          aliveShards > 0 ||
          aliveAccents > 0 ||
          shockAlpha > 0.01 ||
          bloom > 0
        ) {
          raf = requestAnimationFrame(frame);
        } else {
          completed = true;
          if (!cancelled) onDone();
        }
      };
      raf = requestAnimationFrame(frame);
    };
    run();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // Safety: if the component unmounts mid-animation, still reveal the chat
      // so the user is never stuck on a blank screen.
      if (!completed) {
        onCaptured?.();
        onDone();
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[120]"
      style={{ display: "block" }}
    />
  );
}
