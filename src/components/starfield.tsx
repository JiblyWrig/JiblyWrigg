"use client";

import * as React from "react";

/**
 * Heartfield background — a "starfield" of tiny 💜 hearts.
 *
 * Replaces both the old starfield and the floating hearts. Many small purple
 * hearts scattered across the screen in 3 parallax layers, each twinkling
 * slowly and drifting opposite to the cursor for depth. Low alpha so it's
 * subtle/transparent, not distracting.
 *
 * Smoothness: each distinct heart size is pre-rendered ONCE to an offscreen
 * canvas, then blitted via drawImage every frame (drawImage is ~10x faster
 * than fillText, which was the stutter source). rAF, pauses when tab hidden.
 */

interface Heart {
  x: number; // 0..1 normalized
  y: number;
  size: number; // font px
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  layer: 0 | 1 | 2;
  sprite: HTMLCanvasElement; // pre-rendered heart
}

const LAYER_PARALLAX = [6, 14, 26]; // px drift amplitude per layer
const LAYER_ALPHA = [0.126, 0.196, 0.294]; // 30% more transparent than before
const HEART_COUNT = 90;

/** Pre-render a single 💜 at a given pixel size onto a tiny canvas. */
function makeHeartSprite(size: number): HTMLCanvasElement {
  const pad = Math.ceil(size * 0.3);
  const dim = Math.ceil(size) + pad * 2;
  const c = document.createElement("canvas");
  c.width = dim;
  c.height = dim;
  const cx = c.getContext("2d")!;
  cx.font = `${size}px serif`;
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText("💜", dim / 2, dim / 2);
  return c;
}

function makeHearts(): Heart[] {
  // cache sprites per rounded size to avoid making 90 canvases
  const spriteCache = new Map<number, HTMLCanvasElement>();
  const getSprite = (size: number) => {
    const key = Math.round(size);
    let s = spriteCache.get(key);
    if (!s) {
      s = makeHeartSprite(key);
      spriteCache.set(key, s);
    }
    return s;
  };

  const hearts: Heart[] = [];
  for (let i = 0; i < HEART_COUNT; i++) {
    const layer = (i % 3) as 0 | 1 | 2;
    const size = layer === 2 ? 9 + Math.random() * 7 : 5 + Math.random() * 4;
    hearts.push({
      x: Math.random(),
      y: Math.random(),
      size,
      baseAlpha: LAYER_ALPHA[layer] * (0.6 + Math.random() * 0.4),
      twinkleSpeed: 0.3 + Math.random() * 1.0,
      twinklePhase: Math.random() * Math.PI * 2,
      layer,
      sprite: getSprite(size),
    });
  }
  return hearts;
}

export function Starfield() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    const hearts = makeHearts();

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // cursor target (normalized -1..1 from center) + eased current
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const onMove = (e: MouseEvent) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onTouch = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      target.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
      target.y = (e.touches[0].clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    let raf = 0;
    let running = true;
    const onVis = () => {
      running = document.visibilityState === "visible";
      if (running) loop();
    };
    document.addEventListener("visibilitychange", onVis);

    const loop = () => {
      if (!running) return;

      // ease current toward target (higher factor = snappier but still smooth)
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;

      ctx.clearRect(0, 0, W, H);

      const now = performance.now();
      for (const h of hearts) {
        const twinkle =
          0.65 + 0.35 * Math.sin((now / 1000) * h.twinkleSpeed + h.twinklePhase);
        const alpha = Math.min(1, h.baseAlpha * twinkle);

        const amp = LAYER_PARALLAX[h.layer];
        const dx = -current.x * amp;
        const dy = -current.y * amp;

        const px = h.x * W + dx;
        const py = h.y * H + dy;

        const s = h.sprite;
        ctx.globalAlpha = alpha;
        // drawImage is much faster than fillText — no per-frame text shaping
        ctx.drawImage(s, px - s.width / 2, py - s.height / 2);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ display: "block" }}
    />
  );
}
