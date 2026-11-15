"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { flameColors } from "@/components/visuals";
import type { InvestigationCard } from "@/lib/types";

const W = 900, H = 340;

/** Investigations as nodes; a link is drawn when two share documented keywords / phenomena. Node colour = mean documented oxygen. */
export function Constellation({ items }: { items: InvestigationCard[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const n = items.length;
    const nodes = items.map((it, i) => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      const o2 = it.telemetry?.oxygen ? (it.telemetry.oxygen[0] + it.telemetry.oxygen[1]) / 2 : null;
      return { it, x: W / 2 + Math.cos(a) * W * 0.34, y: H / 2 + Math.sin(a) * H * 0.33, colors: flameColors(o2) };
    });
    const terms = (it: InvestigationCard) => new Set([...it.keywords, ...it.combustion_phenomena].map((s) => s.toLowerCase().trim()));
    const edges: { a: number; b: number; shared: string[] }[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const tj = terms(items[j]);
      const shared = [...terms(items[i])].filter((x) => tj.has(x));
      if (shared.length) edges.push({ a: i, b: j, shared });
    }
    return { nodes, edges };
  }, [items]);

  if (items.length < 2) return <p className="py-10 text-center text-sm text-muted-foreground">Add at least two investigations to see how they connect.</p>;
  const hv = nodes.findIndex((n) => n.it.id === hover);
  const tip = hv >= 0 ? nodes[hv] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label="Research constellation: investigations linked by shared keywords and phenomena">
        {[60, 120, 175].map((r) => <ellipse key={r} cx={W / 2} cy={H / 2} rx={r * 2.2} ry={r * 1.05} fill="none" stroke="rgba(255,158,27,0.07)" strokeDasharray="2 6" />)}
        {edges.map((e, k) => {
          const A = nodes[e.a], B = nodes[e.b];
          const cx = (A.x + B.x) / 2 + (W / 2 - (A.x + B.x) / 2) * 0.45, cy = (A.y + B.y) / 2 + (H / 2 - (A.y + B.y) / 2) * 0.45;
          const on = hv === e.a || hv === e.b;
          return <path key={k} d={`M${A.x} ${A.y} Q${cx} ${cy} ${B.x} ${B.y}`} fill="none" stroke={on ? "#FFF3C4" : "#FF9E1B"}
            strokeOpacity={on ? 0.95 : 0.16 + Math.min(e.shared.length, 4) * 0.07} strokeWidth={on ? 1.6 : 0.8 + Math.min(e.shared.length, 4) * 0.2}
            style={{ transition: "stroke-opacity .25s, stroke-width .25s", filter: on ? "drop-shadow(0 0 5px #FF9E1B)" : undefined }} />;
        })}
        {nodes.map(({ it, x, y, colors }) => {
          const on = hover === it.id;
          return (
            <g key={it.id} transform={`translate(${x} ${y})`} tabIndex={0} role="link" aria-label={`${it.investigation_code} ${it.title}`} className="cursor-pointer outline-none"
              onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(it.id)} onBlur={() => setHover(null)}
              onClick={() => router.push(`/investigations/${it.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/investigations/${it.id}`)}>
              <circle r={on ? 40 : 32} fill={colors[1]} opacity={on ? 0.22 : 0.12} style={{ transition: "all .3s" }} />
              <circle r="21" fill="none" stroke={colors[1]} strokeOpacity="0.8" strokeWidth="1.2" />
              <circle r="13" fill="none" stroke={colors[0]} strokeOpacity="0.35" strokeDasharray="2 3" />
              <circle r="6" fill={colors[0]} style={{ filter: `drop-shadow(0 0 7px ${colors[1]})` }} className="animate-ember" />
              <text y="42" textAnchor="middle" fill="#B8A99A" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="1.2">{it.investigation_code.replace("INV-", "")}</text>
            </g>
          );
        })}
        <text x={W / 2} y={H / 2 - 4} textAnchor="middle" fill="#B8A99A" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="3">RESEARCH</text>
        <text x={W / 2} y={H / 2 + 12} textAnchor="middle" fill="#FF9E1B" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="3">CONSTELLATION</text>
      </svg>
      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-[16rem] -translate-x-1/2 rounded-lg border border-primary/30 bg-[#110C0E]/95 px-3 py-2 text-xs shadow-xl shadow-black/50"
          style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100 + 10}%` }}>
          <p className="font-mono text-[10px] text-primary">{tip.it.investigation_code}</p>
          <p className="font-medium leading-snug">{tip.it.title}</p>
          {edges.filter((e) => nodes[e.a].it.id === tip.it.id || nodes[e.b].it.id === tip.it.id).slice(0, 3).map((e, i) => (
            <p key={i} className="mt-1 text-muted-foreground">↔ {nodes[e.a].it.id === tip.it.id ? nodes[e.b].it.investigation_code : nodes[e.a].it.investigation_code}: {e.shared.slice(0, 3).join(", ")}</p>
          ))}
        </div>
      )}
    </div>
  );
}
