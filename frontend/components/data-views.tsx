"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, ImageOff, Quote, TriangleAlert } from "lucide-react";
import { Badge, Select } from "@/components/ui/primitives";
import { EmptyState, EvidenceBadge, RefChip, citationHref } from "@/components/common";
import type { Citations, Condition, Figure, Finding, Publication } from "@/lib/types";
import { cn, titleCase } from "@/lib/utils";

/* ------------------------------------------------------------------------------------------------
   Presentation of stored scientific records. Nothing is altered: values, wording and source locations
   are shown exactly as stored, only organised so that they can be read and checked quickly.
   ------------------------------------------------------------------------------------------------ */

function PagePill({ pubId, page, section, table, figure }: { pubId: string | null; page: number | null; section?: string | null; table?: string | null; figure?: string | null }) {
  const label = page ? `p.${page}` : "source";
  const tip = [section, table && `Table ${table}`, figure && `Fig. ${figure}`].filter(Boolean).join(" · ");
  if (!pubId) return <span className="rounded-full border border-primary/15 px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title={tip}>{label}</span>;
  return (
    <Link href={citationHref({ ref: "", kind: "", label: "", publication_id: pubId, page, section, table, figure })} title={tip || "Open in the original document"}
      className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/10">
      <FileText className="size-3" />{label}
    </Link>
  );
}

/* ================================================================================== CONDITIONS */
const SECTIONS: [string, RegExp][] = [
  ["Flow", /flow|velocity|reynolds|jet/i],
  ["Thermodynamic state", /oxygen|pressure|temperature|humidity|adiabatic/i],
  ["Environment", /gravity|fuel|material|oxidi[sz]er|atmosphere|diluent|helium|nitrogen|mixture/i],
  ["Apparatus & instrumentation", /instrument|chamber|dimension|camera|igniter|burner|nozzle|apparatus|volume|fib(er|re)|equipment|radiometer|sensor|diameter/i],
  ["Procedure & duration", /duration|burn|dwell|ignition|campaign|test|procedure/i],
];
const classify = (name: string) => SECTIONS.find(([, re]) => re.test(name))?.[0] ?? "Other parameters";
const splitName = (p: string) => { const m = p.match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m ? { base: m[1].trim(), q: m[2] } : { base: p.trim(), q: null as string | null }; };
const isNumeric = (c: Condition) => c.normalized_value !== null || /^[-+]?\d/.test(c.value.trim());

interface Group { label: string; entries: { c: Condition; q: string | null }[] }

export function ConditionsView({ conditions, citations }: { conditions: Condition[]; citations: Citations }) {
  const sections = useMemo(() => {
    const bySection = new Map<string, Map<string, Group>>();
    conditions.forEach((c) => {
      const { base, q } = splitName(c.parameter);
      const sec = classify(base);
      const m = bySection.get(sec) ?? new Map<string, Group>();
      const g = m.get(base.toLowerCase()) ?? { label: base, entries: [] };
      g.entries.push({ c, q });
      m.set(base.toLowerCase(), g);
      bySection.set(sec, m);
    });
    const order = [...SECTIONS.map(([n]) => n), "Other parameters"];
    return order.filter((n) => bySection.has(n)).map((n) => [n, [...bySection.get(n)!.values()]] as const);
  }, [conditions]);

  if (!conditions.length) return <EmptyState title="No experimental conditions recorded" />;
  return (
    <div className="space-y-8">
      {sections.map(([name, groups]) => (
        <section key={name}>
          <h3 className="mb-3 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            {name}<span className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" /><span className="text-muted-foreground">{groups.length}</span>
          </h3>
          <div className="glass litho divide-y divide-primary/10 rounded-xl">
            {groups.map((g) => <ConditionRow key={g.label} g={g} citations={citations} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConditionRow({ g, citations }: { g: Group; citations: Citations }) {
  const first = (c: Condition) => { const m = c.value.match(/[-+]?\d*\.?\d+/); return m ? parseFloat(m[0]) : (c.normalized_value ?? 0); };
  const nums = g.entries.filter((e) => isNumeric(e.c)).sort((a, b) => first(a.c) - first(b.c)), texts = g.entries.filter((e) => !isNumeric(e.c));
  const pills = [...new Map(g.entries.map((e) => [`${e.c.publication_id}|${e.c.source_page}`, e.c])).values()].slice(0, 4);
  const withContext = nums.filter((e) => e.c.context);
  return (
    <div className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[210px_1fr_auto]">
      <p className="font-display text-[16px] font-semibold leading-snug">{g.label}</p>
      <div className="min-w-0 space-y-2.5">
        {nums.length === 1 && (
          <div>
            <p className="font-mono text-[22px] font-medium leading-none tabular-nums">{nums[0].c.value}{nums[0].c.unit && <span className="ml-1.5 text-[13px] text-primary">{nums[0].c.unit}</span>}</p>
            {nums[0].c.normalized_unit && nums[0].c.unit !== nums[0].c.normalized_unit && nums[0].c.normalized_value !== null && (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">≈ {Number(nums[0].c.normalized_value.toPrecision(5))} {nums[0].c.normalized_unit}</p>
            )}
            {nums[0].c.context && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{nums[0].c.context}</p>}
          </div>
        )}
        {nums.length > 1 && (
          <div>
            <div className="flex flex-wrap gap-1.5">
              {nums.map((e, i) => (
                <span key={i} title={e.c.context ?? undefined} className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1 font-mono text-[13px] tabular-nums">
                  {e.c.value}{e.c.unit && <span className="ml-1 text-[11px] text-primary">{e.c.unit}</span>}
                </span>
              ))}
            </div>
            {withContext.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {withContext.slice(0, 5).map((e, i) => <li key={i}><span className="font-mono text-foreground/80">{e.c.value}{e.c.unit ? ` ${e.c.unit}` : ""}</span> — {e.c.context}</li>)}
                {withContext.length > 5 && <li>+{withContext.length - 5} more (hover the values)</li>}
              </ul>
            )}
          </div>
        )}
        {texts.map((e, i) => (
          <div key={i}>
            {e.q && <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{e.q}</p>}
            <p className="text-[14px] leading-relaxed">{e.c.value}{e.c.unit && <span className="ml-1 text-[12px] text-muted-foreground">{e.c.unit}</span>}</p>
            {e.c.context && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{e.c.context}</p>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-1.5 md:max-w-[190px] md:justify-end">
        {pills.map((c) => <PagePill key={c.id} pubId={c.publication_id} page={c.source_page} section={c.source_section} table={c.source_table} figure={c.source_figure} />)}
        <RefChip r={g.entries[0].c.ref} citations={citations} />
      </div>
    </div>
  );
}

/* ==================================================================================== FINDINGS */
const UNITS: Record<string, string> = { mm: "mm", mmHg: "mmHg", mm2_s: "mm²/s", cm_s: "cm/s", atm: "atm", K: "K", s: "s", kPa: "kPa", mg_s: "mg/s", microns: "µm", pct: "%", mm_per_mg_s: "mm per mg/s" };
function labelOf(key: string): { label: string; unit?: string } {
  const t = key.split("_");
  for (const n of [2, 1]) {
    if (t.length > n) { const u = UNITS[t.slice(-n).join("_")]; if (u) return { label: t.slice(0, -n).join(" "), unit: u }; }
  }
  return { label: t.join(" ") };
}
type Tile = { label: string; value: string; unit?: string };
type Block = { title: string | null; tiles: Tile[] };

function toBlocks(v: unknown, title: string | null = null): Block[] {
  if (v === null || v === undefined || v === "") return [];
  if (typeof v !== "object") return [{ title, tiles: [{ label: "", value: String(v) }] }];
  if (Array.isArray(v)) return [{ title, tiles: [{ label: "", value: v.map(String).join(" · ") }] }];
  const own: Tile[] = [], nested: Block[] = [];
  Object.entries(v as Record<string, unknown>).forEach(([k, val]) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) nested.push(...toBlocks(val, titleCase(k)));
    else {
      const { label, unit } = labelOf(k);
      own.push({ label: label || k, value: Array.isArray(val) ? val.join(" · ") : String(val), unit });
    }
  });
  return [...(own.length ? [{ title, tiles: own }] : []), ...nested];
}

function ValueBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={i}>
          {b.title && <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{b.title}</p>}
          {b.tiles.length === 1 && !b.tiles[0].label ? (
            <p className="text-[13.5px] leading-relaxed">{b.tiles[0].value}</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {b.tiles.map((t, j) => (
                <div key={j} className="rounded-md border border-primary/15 bg-black/30 px-2.5 py-1.5">
                  <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground" title={t.label}>{t.label}</p>
                  <p className="font-mono text-[14px] tabular-nums">{t.value}{t.unit && <span className="ml-1 text-[11px] text-primary">{t.unit}</span>}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const STRIPE: Record<string, string> = {
  experimental_observation: "border-l-success", numerical_result: "border-l-primary", theoretical: "border-l-violet",
  author_interpretation: "border-l-warning", review: "border-l-muted-foreground/50", other: "border-l-muted-foreground/40",
};

export function FindingsView({ findings, citations, publications }: { findings: Finding[]; citations: Citations; publications: Publication[] }) {
  const [type, setType] = useState("all");
  const [phen, setPhen] = useState("");
  const [q, setQ] = useState("");
  const types = useMemo(() => [...new Set(findings.map((f) => f.evidence_type))], [findings]);
  const phenomena = useMemo(() => [...new Set(findings.map((f) => f.phenomenon).filter(Boolean) as string[])], [findings]);
  const shown = findings.filter((f) => (type === "all" || f.evidence_type === type) && (!phen || f.phenomenon === phen) && (!q || f.description.toLowerCase().includes(q.toLowerCase())));
  const title = (id: string | null) => publications.find((p) => p.id === id)?.title ?? null;
  if (!findings.length) return <EmptyState title="No scientific findings recorded" />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["all", ...types].map((t) => (
          <button key={t} onClick={() => setType(t)} aria-pressed={type === t}
            className={cn("rounded-full border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors",
              type === t ? "border-primary/60 bg-primary/15 text-primary" : "border-primary/15 text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
            {t === "all" ? `All · ${findings.length}` : `${titleCase(t)} · ${findings.filter((f) => f.evidence_type === t).length}`}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {phenomena.length > 1 && <Select className="h-8 w-52 text-xs" value={phen} onChange={(e) => setPhen(e.target.value)} aria-label="Filter by phenomenon"><option value="">All phenomena</option>{phenomena.map((p) => <option key={p} value={p}>{p.length > 46 ? p.slice(0, 45) + "…" : p}</option>)}</Select>}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter text…" aria-label="Filter findings" className="h-8 w-40 rounded-lg border border-input bg-background/60 px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      </div>

      <div className="space-y-4">
        {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No findings match these filters.</p>}
        {shown.map((f, idx) => {
          const rv = (f.reported_values ?? {}) as Record<string, unknown>;
          const interp = (rv.author_interpretation ?? rv.authors_interpretation) as string | undefined;
          const limits = rv.limitations_and_qualifications as string | undefined;
          const ctx = [rv.experimental_or_computational_context, rv.associated_experimental_conditions && `Conditions: ${rv.associated_experimental_conditions}`].filter(Boolean) as string[];
          const blocks = toBlocks(rv.reported_numerical_values ?? (rv.values as unknown));
          return (
            <article key={f.id} className={cn("glass litho relative rounded-xl border-l-4 p-5", STRIPE[f.evidence_type] ?? STRIPE.other)}>
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">F{String(idx + 1).padStart(2, "0")}</span>
                <EvidenceBadge type={f.evidence_type} />
                {f.phenomenon && <span className="text-[12.5px] text-muted-foreground">{f.phenomenon}</span>}
              </div>
              <p className="text-[15px] leading-relaxed">{f.description}</p>

              {blocks.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Reported values</p>
                  <ValueBlocks blocks={blocks} />
                </div>
              )}
              {interp && (
                <div className="mt-4 rounded-md border border-dashed border-violet/40 bg-violet/5 px-4 py-3">
                  <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-violet"><Quote className="size-3" />Author interpretation — not an experimental observation</p>
                  <p className="text-[13.5px] italic leading-relaxed text-foreground/90">{interp}</p>
                </div>
              )}
              {limits && (
                <div className="mt-3 flex gap-2.5 rounded-md border border-warning/25 bg-warning/5 px-4 py-3">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <div><p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-warning">Limitations & qualifications</p><p className="text-[13px] leading-relaxed text-foreground/85">{limits}</p></div>
                </div>
              )}
              {ctx.length > 0 && (
                <details className="mt-3 text-[12.5px]">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">Experimental context</summary>
                  {ctx.map((c, i) => <p key={i} className="mt-1.5 leading-relaxed text-muted-foreground">{c}</p>)}
                </details>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3">
                <PagePill pubId={f.publication_id} page={f.source_page} section={f.source_section} table={f.source_table} figure={f.source_figure} />
                {f.source_section && <span className="text-[12px] text-muted-foreground">{f.source_section}</span>}
                {f.source_figure && <Badge>Fig. {f.source_figure}</Badge>}{f.source_table && <Badge>Table {f.source_table}</Badge>}
                <span className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">{title(f.publication_id)}<RefChip r={f.ref} citations={citations} /></span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ===================================================================================== FIGURES */
function AxesPlaceholder({ x, y, n }: { x: string | null; y: string | null; n: string }) {
  const short = (s: string | null, n = 38) => (s ? (s.length > n ? s.slice(0, n - 1) + "…" : s) : null);
  const num = n.match(/\d+/)?.[0] ?? "";
  return (
    <svg viewBox="0 0 320 180" className="h-full w-full" role="img" aria-label="Figure placeholder with axis labels">
      <g stroke="rgba(255,158,27,0.09)">{[0, 1, 2, 3, 4].map((i) => <line key={i} x1="46" x2="300" y1={24 + i * 30} y2={24 + i * 30} />)}{[0, 1, 2, 3, 4, 5].map((i) => <line key={i} y1="24" y2="144" x1={46 + i * 50.8} x2={46 + i * 50.8} />)}</g>
      <g stroke="rgba(255,248,231,0.5)" strokeWidth="1" fill="none"><path d="M46 20 V144 H304" /></g>
      <text x="173" y="126" textAnchor="middle" fontFamily="var(--font-display)" fontSize="64" fill="rgba(255,158,27,0.16)">{num}</text>
      {short(x) && <text x="175" y="167" textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="#B8A99A" letterSpacing="0.5">{short(x)}</text>}
      {short(y, 26) && <text transform="translate(15 84) rotate(-90)" textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="#B8A99A" letterSpacing="0.5">{short(y, 26)}</text>}
      {!x && !y && <text x="175" y="160" textAnchor="middle" fontSize="7.5" fontFamily="var(--font-mono)" fill="#B8A99A" letterSpacing="1">IMAGE NOT STORED</text>}
    </svg>
  );
}

export function FiguresView({ figures, publications }: { figures: Figure[]; publications: Publication[] }) {
  if (!figures.length) return <EmptyState title="No figures recorded" />;
  const title = (id: string | null) => publications.find((p) => p.id === id)?.title ?? null;
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {figures.map((f) => (
        <article key={f.id} className="glass litho card-sweep relative flex flex-col overflow-hidden rounded-xl">
          <div className="relative aspect-[16/9] border-b border-primary/10 bg-black/50">
            {f.image_url ? (
              <a href={f.image_url} target="_blank" rel="noreferrer"><img src={f.image_url} alt={f.caption ?? `Figure ${f.figure_number}`} className="h-full w-full bg-white/95 object-contain" /></a>
            ) : <AxesPlaceholder x={f.x_axis} y={f.y_axis} n={f.figure_number} />}
            {!f.image_url && <span className="absolute right-3 top-2.5 inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground"><ImageOff className="size-3" />schematic</span>}
          </div>
          <div className="flex flex-1 flex-col gap-2.5 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-[17px] font-semibold leading-snug">{f.figure_number.replace(/\s*\(.*\)$/, "")}</p>
              <PagePill pubId={f.publication_id} page={f.page_number} figure={f.figure_number} />
            </div>
            {f.caption && <p className="text-[13.5px] leading-relaxed text-foreground/90">{f.caption}</p>}
            {f.description && (
              <details className="text-[12.5px]">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-primary hover:underline">What it shows</summary>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{f.description}</p>
              </details>
            )}
            {f.qualitative_observations && (
              <div className="rounded-md border border-primary/15 bg-black/25 px-3 py-2.5">
                <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Observed</p>
                <p className="text-[12.5px] leading-relaxed">{f.qualitative_observations}</p>
              </div>
            )}
            {(f.x_axis || f.y_axis) && (
              <p className="mt-auto flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                {f.x_axis && <span><span className="text-primary">x</span> {f.x_axis}</span>}{f.y_axis && <span><span className="text-primary">y</span> {f.y_axis}</span>}
              </p>
            )}
            {title(f.publication_id) && <p className="text-[11.5px] text-muted-foreground/80">{title(f.publication_id)}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}
