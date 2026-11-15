"use client";
import { useEffect, useRef } from "react";

/** Sparse warm starlight specks, faint corona rings and 3% film grain behind the whole app. Pauses when hidden; static for reduced motion. */
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1, ph: Math.random() * 6.28, sp: 0.0005 + Math.random() * 0.0015, gold: Math.random() < 0.4 }));
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      [220, 340, 480, 640, 820].forEach((k, i) => { ctx.strokeStyle = `rgba(${i % 2 ? "217,56,30" : "255,158,27"},${0.07 - i * 0.01})`; ctx.beginPath(); ctx.arc(-40, h * 0.05, k, 0, 6.283); ctx.stroke(); });
      for (const s of S) {
        const a = reduce ? 0.6 : 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.fillStyle = s.gold ? `rgba(255,210,122,${a * 0.7})` : `rgba(255,248,231,${a * 0.55})`;
        ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.283); ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    const vis = () => { running = !document.hidden; if (running) raf = requestAnimationFrame(draw); else cancelAnimationFrame(raf); };
    resize(); raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize); document.addEventListener("visibilitychange", vis);
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return (
    <>
      <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10" />
      <div className="grain" aria-hidden />
    </>
  );
}
