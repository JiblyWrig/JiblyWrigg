"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { SMILEY_EMOJIS } from "@/lib/emojis";

/**
 * Emoji picker with Mac-dock / Apple-Watch style magnification.
 * The emoji closest to the cursor (in true 2D radius) is biggest, and
 * surrounding ones shrink the further they are — a radial falloff, not a
 * column. Button centers are precomputed once; mousemove only writes
 * transforms via requestAnimationFrame for smooth 60fps with no React renders.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const centers = React.useRef<{ x: number; y: number }[]>([]);
  const raf = React.useRef<number | null>(null);
  const mouse = React.useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const MAX_BOOST = 0.9; // extra scale at peak (peak scale = 1.9)
  const SIGMA = 34; // radius (px) — 2D gaussian falloff
  const LIFT = 9; // px upward lift at peak

  const measure = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const origin = wrap.getBoundingClientRect();
    centers.current = btnRefs.current.map((b) => {
      if (!b) return { x: 0, y: 0 };
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2 - origin.left, y: r.top + r.height / 2 - origin.top };
    });
  };

  const recompute = () => {
    const active = mouse.current.active;
    const mx = mouse.current.x;
    const my = mouse.current.y;
    const btns = btnRefs.current;
    const cs = centers.current;
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      if (!btn) continue;
      if (!active) {
        if (btn.style.transform !== "") btn.style.transform = "";
        continue;
      }
      const c = cs[i];
      if (!c) continue;
      const dx = mx - c.x;
      const dy = my - c.y;
      const dist2 = dx * dx + dy * dy;
      const g = Math.exp(-dist2 / (2 * SIGMA * SIGMA));
      const scale = 1 + MAX_BOOST * g;
      const lift = -LIFT * g;
      btn.style.transform = `translateY(${lift}px) scale(${scale})`;
    }
  };

  React.useEffect(() => {
    // measure after layout (fonts/emojis may shift sizes)
    const id = window.setTimeout(measure, 0);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);

    const onMove = (e: MouseEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
      mouse.current.active = true;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(recompute);
    };
    const onLeave = () => {
      mouse.current.active = false;
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(recompute);
    };
    // When the grid scrolls, button positions change — recompute centers
    // and re-run magnification so the effect follows the cursor anywhere.
    const onScroll = () => {
      measure();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(recompute);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    const wrap = wrapRef.current;
    wrap?.addEventListener("mouseleave", onLeave);
    wrap?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      wrap?.removeEventListener("mouseleave", onLeave);
      wrap?.removeEventListener("scroll", onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="flex h-72 w-72 flex-col overflow-hidden rounded-3xl border border-border/60 bg-popover shadow-2xl shadow-primary/20 sm:w-80"
    >
      <div ref={wrapRef} className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-7 gap-1 sm:grid-cols-8">
          {SMILEY_EMOJIS.map((e, i) => (
            <button
              key={e + i}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              onClick={() => onPick(e)}
              style={{
                transform: "",
                transformOrigin: "bottom center",
                transition: "transform 80ms ease-out",
              }}
              className="grid h-9 w-9 place-items-center rounded-xl text-xl hover:bg-primary/10"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
