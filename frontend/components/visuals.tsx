"use client";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------------------------------
   Data-driven visuals. A sigil's shape follows the documented gravity regime (spherical = microgravity,
   teardrop = normal gravity, oblate = partial) and its heat follows the documented mean oxygen level.
   ---------------------------------------------------------------------------------------------- */

// [core, mid, edge]: oxygen-lean = deep crimson, air-like = amber, oxygen-rich = white-gold
const STOPS: [string, string, string][] = [
  ["#F2784B", "#B81D24", "#4A0E1C"],
  ["#FFD27A", "#FF9E1B", "#D9381E"],
  ["#FFF3C4", "#FFC24D", "#FF9E1B"],
];

/** Tone triplet for a mean oxygen percentage; unknown -> amber. */
export function flameColors(o2?: number | null): [string, string, string] {
  if (o2 == null) return STOPS[1];
  const t = Math.max(0, Math.min(1, (o2 - 12) / 22)) * 2;
  const lo = Math.min(1, Math.floor(t));
  return t - lo < 0.5 ? STOPS[lo] : STOPS[lo + 1];
}

function hash01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const TEARDROP = "M60 12 C 72 36, 94 50, 94 74 C 94 95, 79 108, 60 108 C 41 108, 26 95, 26 74 C 26 50, 48 36, 60 12 Z";

/** Star / plasma sigil with marbled eddies, corona rays and orbiting embers. */
export function FlameSigil({ gravity, o2, seed = "", size = 120, className }: {
  gravity?: string | null; o2?: number | null; seed?: string; size?: number; className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [core, mid, edge] = flameColors(o2);
  const j = hash01(seed);
  const sphere = !gravity || gravity === "microgravity";
  const normal = gravity === "normal gravity" || gravity === "hypergravity";
  const heat = o2 == null ? 0.5 : Math.max(0, Math.min(1, (o2 - 10) / 24));
  const dur = (16 + j * 12).toFixed(1);
  const rays = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2 + j, l = 7 + ((i * 7 + Math.floor(j * 10)) % 5) * 2.4;
    return <line key={i} x1={60 + Math.cos(a) * 36} y1={62 + Math.sin(a) * 36} x2={60 + Math.cos(a) * (36 + l)} y2={62 + Math.sin(a) * (36 + l)} stroke={mid} strokeOpacity="0.45" strokeWidth="0.8" strokeLinecap="round" />;
  });
  const shape = sphere ? <circle cx="60" cy="62" r="31" /> : normal ? <path d={TEARDROP} /> : <ellipse cx="60" cy="63" rx="37" ry="28" />;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={cn("overflow-visible", className)} role="img"
      aria-label={`${sphere ? "Spherical" : normal ? "Teardrop" : "Oblate"} plasma signature`}>
      <defs>
        <radialGradient id={`b${id}`} cx="40%" cy="38%" r="72%"><stop offset="0" stopColor={core} /><stop offset="0.45" stopColor={mid} /><stop offset="1" stopColor={edge} /></radialGradient>
        <clipPath id={`c${id}`}>{shape}</clipPath>
      </defs>
      {/* corona bloom */}
      <circle cx="60" cy="62" r="46" fill={mid} opacity={0.12 + heat * 0.2} style={{ filter: "blur(13px)" }} />
      {sphere && <g>{rays}</g>}
      <g className={normal ? "animate-flicker" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 90%" }}>
        <g fill={`url(#b${id})`}>{shape}</g>
        {/* marbled eddies */}
        <g clipPath={`url(#c${id})`} fill="none" strokeLinecap="round">
          <path d="M22 54 C 40 40, 52 74, 70 58 S 96 46, 104 62" stroke={core} strokeOpacity="0.55" strokeWidth="1.4" />
          <path d="M20 70 C 38 58, 54 90, 74 72 S 98 66, 106 80" stroke={edge} strokeOpacity="0.65" strokeWidth="1.8" />
          <path d="M26 84 C 44 76, 58 100, 78 86 S 98 84, 106 94" stroke={core} strokeOpacity="0.35" strokeWidth="1" />
          <path d="M30 40 C 46 30, 60 52, 76 40 S 96 34, 104 44" stroke={mid} strokeOpacity="0.6" strokeWidth="1.2" />
        </g>
        <g fill="none" stroke={core} strokeOpacity={0.55 + heat * 0.4} strokeWidth="1.1">{shape}</g>
      </g>
      {/* orbiting embers */}
      <g>
        <circle cx="60" cy="6" r="1.8" fill={core} style={{ filter: `drop-shadow(0 0 4px ${mid})` }} />
        <circle cx="110" cy="80" r="1.1" fill={mid} /><circle cx="12" cy="92" r="1.1" fill={mid} />
        <animateTransform attributeName="transform" type="rotate" from="0 60 62" to="360 60 62" dur={`${dur}s`} repeatCount="indefinite" />
      </g>
    </svg>
  );
}

/** Dial gauge, 0..1: thermal arc (white-gold -> amber -> crimson) with engraved ticks. */
export function Gauge({ value, size = 88, label, className }: { value: number; size?: number; label?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const v = Math.max(0, Math.min(1, value));
  const r = 34, c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(v)); return () => cancelAnimationFrame(t); }, [v]);
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}
      role="img" aria-label={`${label ?? "Score"} ${Math.round(v * 100)} out of 100`}>
      <svg viewBox="0 0 88 88" width={size} height={size}>
        <defs><linearGradient id={`g${id}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#B81D24" /><stop offset="0.45" stopColor="#FF9E1B" /><stop offset="1" stopColor="#FFF3C4" /></linearGradient></defs>
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2, major = i % 9 === 0, r1 = 41, r2 = major ? 37 : 39;
          return <line key={i} x1={44 + Math.cos(a) * r1} y1={44 + Math.sin(a) * r1} x2={44 + Math.cos(a) * r2} y2={44 + Math.sin(a) * r2} stroke="#FFF8E7" strokeOpacity={major ? 0.5 : 0.2} strokeWidth="0.8" />;
        })}
        <g className="-rotate-90" style={{ transformOrigin: "44px 44px" }}>
          <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,158,27,0.14)" strokeWidth="4" />
          <circle cx="44" cy="44" r={r} fill="none" stroke={`url(#g${id})`} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - shown)} style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 5px rgba(255,158,27,.55))" }} />
        </g>
      </svg>
      <div className="absolute text-center leading-none">
        <span className="font-mono text-xl font-semibold tabular-nums">{Math.round(v * 100)}</span>
        {label && <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

/** Count-up number (respects reduced motion). */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <>{n}</>;
}

/** Formats a [lo, hi] range, collapsing to a single value. */
export function fmtRange(r?: number[] | null, digits = 3) {
  if (!r) return "—";
  const f = (x: number) => String(Number(x.toPrecision(digits)));
  return Math.abs(r[0] - r[1]) < 1e-9 * Math.max(1, Math.abs(r[0])) ? f(r[0]) : `${f(r[0])}–${f(r[1])}`;
}

/** One telemetry readout cell. */
export function Readout({ label, value, unit, className }: { label: string; value: string; unit?: string; className?: string }) {
  const empty = value === "—";
  return (
    <div className={cn("rounded-md border border-primary/15 bg-black/30 px-2.5 py-1.5", className)}>
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn("whitespace-nowrap font-mono text-[13px] tabular-nums", empty ? "text-muted-foreground/50" : "text-foreground")}>
        {value}{!empty && unit && <span className="ml-1 text-[10px] text-primary/80">{unit}</span>}
      </p>
    </div>
  );
}
