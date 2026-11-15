"use client";
import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

/* Thermal spectrum shared by the backdrop, dividers and sigils: white-gold core -> amber -> crimson -> plum ember. */
const THERMAL = ["#FFF3C4", "#FFD27A", "#FF9E1B", "#D9381E", "#B81D24", "#4A0E1C"];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function thermal(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (THERMAL.length - 1);
  const i = Math.min(THERMAL.length - 2, Math.floor(x)), f = x - i;
  const a = hex(THERMAL[i]), b = hex(THERMAL[i + 1]);
  return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("");
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Marbled solar-corona plate. Concentric thermal rings are warped by fractal turbulence
 * (feDisplacementMap), which produces the Ebru-style plasma eddies without any image asset; the result
 * is masked to fade into obsidian space and dusted with warm starlight.
 */
export function MarbledCoronaBackdrop({ className, seed = 4, cx = 800, cy = 320 }: { className?: string; seed?: number; cx?: number; cy?: number }) {
  const id = useId().replace(/:/g, "");
  const rings = useMemo(() => Array.from({ length: 34 }, (_, i) => ({ r: 46 + i * 15, t: Math.min(1, i / 30), w: 11 + ((i * 7) % 5) * 5 })), []);
  const stars = useMemo(() => {
    const r = rng(seed * 13 + 5);
    return Array.from({ length: 70 }, () => ({ x: r() * 900, y: r() * 340, s: 0.4 + r() * 0.9, o: 0.25 + r() * 0.65, gold: r() < 0.35 }));
  }, [seed]);
  return (
    <svg viewBox="0 0 900 340" preserveAspectRatio="xMaxYMid slice" className={cn("h-full w-full", className)} aria-hidden>
      <defs>
        <filter id={`f${id}`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0032 0.0105" numOctaves="3" seed={seed} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="170" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.6" />
        </filter>
        <radialGradient id={`m${id}`} cx={cx} cy={cy} r="470" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" /><stop offset="0.5" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.82" stopColor="#fff" stopOpacity="0.25" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`k${id}`}><rect width="900" height="340" fill={`url(#m${id})`} /></mask>
        <radialGradient id={`g${id}`} cx={cx} cy={cy} r="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFB24A" stopOpacity="0.5" /><stop offset="0.45" stopColor="#D9381E" stopOpacity="0.18" /><stop offset="1" stopColor="#4A0E1C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="900" height="340" fill={`url(#g${id})`} />
      <g mask={`url(#k${id})`}>
        <g filter={`url(#f${id})`}>
          <circle cx={cx} cy={cy} r="640" fill="#4A0E1C" fillOpacity="0.55" />
          {rings.slice().reverse().map((r, i) => <circle key={i} cx={cx} cy={cy} r={r.r} fill="none" stroke={thermal(r.t)} strokeWidth={r.w} strokeOpacity={0.95 - r.t * 0.35} />)}
          <circle cx={cx} cy={cy} r="52" fill="#FFF3C4" />
        </g>
      </g>
      <g>{stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.s} fill={s.gold ? "#FFD27A" : "#FFF8E7"} opacity={s.o * (s.x > 500 ? 1 : 0.6)} />)}</g>
    </svg>
  );
}

/** Layered, flowing thermal wave rule. */
export function PlasmaWaveDivider({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const wave = (a: number, ph: number) => {
    let d = `M0 ${9 + ph}`;
    for (let x = 0; x < 1200; x += 150) d += ` C ${x + 40} ${9 + ph - a}, ${x + 100} ${9 + ph + a}, ${x + 150} ${9 + ph}`;
    return d;
  };
  return (
    <svg viewBox="0 0 1200 18" preserveAspectRatio="none" className={cn("h-[14px] w-full", className)} aria-hidden>
      <defs>
        <linearGradient id={`w${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#FFF3C4" /><stop offset="0.18" stopColor="#FF9E1B" /><stop offset="0.5" stopColor="#D9381E" stopOpacity="0.8" /><stop offset="0.8" stopColor="#4A0E1C" stopOpacity="0.55" /><stop offset="1" stopColor="#4A0E1C" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={wave(7, 0)} fill="none" stroke={`url(#w${id})`} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <path d={wave(5, 1.5)} fill="none" stroke={`url(#w${id})`} strokeOpacity="0.5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={wave(9, -1.5)} fill="none" stroke={`url(#w${id})`} strokeOpacity="0.28" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Concentric corona rings (decorative). */
export function CoronaRings({ className }: { className?: string }) {
  return (
    <svg viewBox="-100 -100 200 200" className={cn("pointer-events-none", className)} aria-hidden fill="none">
      {[22, 38, 56, 76, 98].map((r, i) => <circle key={r} r={r} stroke={thermal(0.2 + i * 0.16)} strokeOpacity={0.5 - i * 0.07} strokeWidth="0.6" strokeDasharray={i % 2 ? "1 4" : undefined} />)}
    </svg>
  );
}
