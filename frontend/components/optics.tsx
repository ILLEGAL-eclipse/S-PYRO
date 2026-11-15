"use client";
import type { CSSProperties, ReactNode } from "react";
import { MarbledCoronaBackdrop } from "@/components/plasma";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------------------------------
   Optical-diagnostics building blocks: flame front, HUD viewport, spark trails, ignition bar, hero.
   ---------------------------------------------------------------------------------------------- */

const svg = (inner: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${inner}</svg>`)}")`;

// A 200px tile whose sine path is continuous at the seam; the gradient runs CH* blue -> amber -> white-hot -> blue.
const WAVE = svg(
  `<defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#4A0E1C'/><stop offset='.28' stop-color='#D9381E'/><stop offset='.5' stop-color='#FF9E1B'/>` +
    `<stop offset='.68' stop-color='#FFF3C4'/><stop offset='1' stop-color='#4A0E1C'/></linearGradient></defs>` +
    `<path d='M0 6 Q25 0 50 6 T100 6 T150 6 T200 6' fill='none' stroke='url(#g)' stroke-width='2' stroke-linecap='round'/>`,
  200, 12);
const WAVE2 = svg(
  `<defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#B81D24'/><stop offset='.5' stop-color='#FFD27A'/>` +
    `<stop offset='1' stop-color='#B81D24'/></linearGradient></defs>` +
    `<path d='M0 6 Q32 11 65 6 T130 6 T195 6 T260 6' fill='none' stroke='url(#g)' stroke-width='1' stroke-linecap='round'/>`,
  260, 12);

/** Undulating blue-to-amber plasma arc along the top edge of a container while the agent is working. */
export function FlameFront({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  const layer = (img: string, size: string, anim: string, extra?: string) => (
    <div className={cn("absolute inset-0", anim, extra)} style={{ backgroundImage: img, backgroundRepeat: "repeat-x", backgroundSize: size }} />
  );
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 -top-px h-3 overflow-hidden rounded-t-[inherit]", className)}>
      {layer(WAVE, "200px 12px", "animate-flame", "opacity-80 blur-[5px]")}
      {layer(WAVE, "200px 12px", "animate-flame")}
      {layer(WAVE2, "260px 12px", "animate-flame-rev", "opacity-70")}
    </div>
  );
}

/** Dark viewport container with camera-HUD corner tick marks. */
export function Viewport({ children, label, meta, className, bodyClassName }: {
  children: ReactNode; label?: string; meta?: string; className?: string; bodyClassName?: string;
}) {
  const tick = "pointer-events-none absolute size-3 border-primary/70";
  return (
    <figure className={cn("relative rounded-lg bg-[#050406]/80 ring-1 ring-primary/15", className)}>
      <span className={cn(tick, "left-1.5 top-1.5 border-l border-t")} />
      <span className={cn(tick, "right-1.5 top-1.5 border-r border-t")} />
      <span className={cn(tick, "bottom-1.5 left-1.5 border-b border-l")} />
      <span className={cn(tick, "bottom-1.5 right-1.5 border-b border-r")} />
      {(label || meta) && (
        <figcaption className="flex items-center justify-between px-5 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-primary/80">
          <span>{label}</span><span className="text-muted-foreground">{meta}</span>
        </figcaption>
      )}
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </figure>
  );
}

/** Thin amber hairline with a travelling spark, used to connect steps of the reasoning trace. */
export function SparkTrail({ height = 30, active = false }: { height?: number; active?: boolean }) {
  const d = `M12 0 C 2 ${height * 0.3}, 22 ${height * 0.7}, 12 ${height}`;
  return (
    <svg width="24" height={height} viewBox={`0 0 24 ${height}`} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="#FFF3C4" strokeOpacity="0.55" strokeWidth="1" />
      <path d={d} fill="none" stroke="#FFF3C4" strokeOpacity="0.9" strokeWidth="0.6" strokeDasharray="2 7" />
      {active && (
        <circle r="1.8" fill="#FFF3C4" style={{ filter: "drop-shadow(0 0 3px #FFF3C4)" }}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </svg>
  );
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Floating command bar ("ignition chamber"): cyan perimeter glow that warms toward amber-gold as the user types or a run is active. */
export function IgnitionBar({ intensity, busy, children, className }: { intensity: number; busy?: boolean; children: ReactNode; className?: string }) {
  const t = busy ? 1 : Math.max(0, Math.min(1, intensity));
  const c = `${lerp(184, 255, t)},${lerp(29, 190, t)},${lerp(36, 60, t)}`;
  const style: CSSProperties = {
    borderColor: `rgba(${c},${0.3 + t * 0.35})`,
    boxShadow: `0 0 ${14 + t * 22}px rgba(${c},${0.18 + t * 0.2}), inset 0 0 18px rgba(${c},${0.04 + t * 0.05})`,
    transition: "box-shadow .45s ease, border-color .45s ease",
  };
  return (
    <div style={style} className={cn("relative rounded-2xl border bg-[#110C0E]/85 backdrop-blur-xl", className)}>
      <FlameFront active={!!busy} className="rounded-t-2xl" />
      {children}
    </div>
  );
}

/** Hero banner: a marbled solar-corona plate (SVG turbulence) erupting from the right edge into obsidian. */
export function OpticalHero({ image, eyebrow, title, children, className }: { image?: string; eyebrow?: string; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("glass litho relative mb-8 overflow-hidden rounded-2xl", className)}>
      <div className="absolute inset-y-0 right-0 w-full sm:w-[82%]" style={{ maskImage: "linear-gradient(90deg, transparent 0%, #000 52%)", WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 52%)" }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" aria-hidden className="h-full w-full object-cover opacity-80" />
        ) : <MarbledCoronaBackdrop />}
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-[#110C0E] via-[#110C0E]/75 to-transparent" aria-hidden />
      <div className="relative max-w-xl px-6 py-9 sm:px-9 sm:py-12">
        {eyebrow && <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary"><span className="inline-block size-1.5 animate-ember rounded-full bg-primary shadow-[0_0_10px_rgba(255,158,27,.9)]" />{eyebrow}</p>}
        <h1 className="text-[34px] font-semibold leading-[1.06] sm:text-[48px]">{title}</h1>
        {children && <div className="mt-4 text-sm leading-relaxed text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
