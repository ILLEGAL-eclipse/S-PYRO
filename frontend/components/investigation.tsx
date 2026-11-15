"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, FileText, Image as ImageIcon, Plus, Search, Sparkles, Table2, X } from "lucide-react";
import { FlameSigil, Readout, flameColors, fmtRange } from "@/components/visuals";
import { Badge, Card, Input } from "@/components/ui/primitives";
import { api, qs } from "@/lib/api";
import type { InvestigationCard as Inv, Paged } from "@/lib/types";
import { cn } from "@/lib/utils";

export function InvestigationCard({ inv, selected, onToggle }: { inv: Inv; selected?: boolean; onToggle?: () => void }) {
  const t = inv.telemetry ?? {};
  const o2mid = t.oxygen ? (t.oxygen[0] + t.oxygen[1]) / 2 : null;
  const gravity = inv.gravity_classes[0] ?? null;
  const [, mid] = flameColors(o2mid);
  return (
    <article className="card-sweep glass group relative flex h-full flex-col overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-0.5">
      {/* art band: data-driven flame signature */}
      <div className="relative h-32 overflow-hidden border-b border-primary/10" style={{ background: `radial-gradient(120% 140% at 82% 40%, ${mid}26, transparent 60%), linear-gradient(180deg, rgba(5,4,6,.2), rgba(5,4,6,.65))` }}>
        <div className="absolute -right-2 -top-1 transition-transform duration-500 group-hover:scale-110">
          <FlameSigil gravity={gravity} o2={o2mid} seed={inv.investigation_code} size={138} />
        </div>
        <div className="absolute left-4 top-3.5 max-w-[62%]">
          <p className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground">{inv.investigation_code}</p>
          {inv.research_category && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-primary/90" title={inv.research_category}>{inv.research_category}</p>}
        </div>
        <div className="absolute bottom-2.5 left-4 flex gap-1.5">
          {gravity && <Badge tone="violet">{gravity}</Badge>}
          {inv.investigation_type && <Badge className="hidden sm:inline-flex">{inv.investigation_type}</Badge>}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <Link href={`/investigations/${inv.id}`} className="font-display text-[16px] font-semibold leading-snug after:absolute after:inset-0 after:z-0 hover:text-primary">
          {inv.title}
        </Link>
        {inv.description && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{inv.description}</p>}

        <div className="mt-3.5 grid grid-cols-3 gap-1.5">
          <Readout label="O₂" value={fmtRange(t.oxygen)} unit="%" />
          <Readout label="Pressure" value={fmtRange(t.pressure)} unit="kPa" />
          <Readout label="Temp" value={fmtRange(t.temperature)} unit="K" />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span title="Findings" className="inline-flex items-center gap-1"><Sparkles className="size-3.5 text-primary" />{inv.counts?.findings ?? 0}</span>
            <span title="Figures" className="inline-flex items-center gap-1"><ImageIcon className="size-3.5 text-primary" />{inv.counts?.figures ?? 0}</span>
            <span title="Datasets" className="inline-flex items-center gap-1"><Table2 className="size-3.5 text-primary" />{inv.counts?.datasets ?? 0}</span>
            <span title="Publications" className="inline-flex items-center gap-1"><FileText className="size-3.5" />{inv.publication_count}{inv.publication_years[0] ? ` · ${inv.publication_years[0]}` : ""}</span>
          </div>
          {onToggle && (
            <button onClick={(e) => { e.preventDefault(); onToggle(); }} aria-pressed={selected}
              className={cn("relative z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                selected ? "border-primary/50 bg-primary/15 text-primary" : "border-primary/15 hover:bg-primary/10")}>
              {selected ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}Compare
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Search-and-pick control for one or several investigations. */
export function InvestigationPicker({ selected, onChange, max = 6, placeholder = "Search investigations to add…" }: {
  selected: { id: string; code: string; title: string }[]; onChange: (v: { id: string; code: string; title: string }[]) => void; max?: number; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Inv[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const t = setTimeout(() => {
      api<Paged<Inv>>(`/api/investigations${qs({ q: q.trim() || undefined, page_size: 8, sort: q.trim() ? "relevance" : "title" })}`)
        .then((r) => setResults(r.items)).catch(() => setResults([])).finally(() => setBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const has = (id: string) => selected.some((s) => s.id === id);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1 text-xs">
            <span className="font-mono">{s.code}</span><span className="max-w-[16rem] truncate text-foreground/80">{s.title}</span>
            <button onClick={() => onChange(selected.filter((x) => x.id !== s.id))} aria-label={`Remove ${s.code}`} className="rounded p-0.5 hover:bg-primary/20"><X className="size-3.5" /></button>
          </span>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder={selected.length >= max ? `Maximum of ${max} selected` : placeholder} value={q} disabled={selected.length >= max}
          onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {open && selected.length < max && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-card p-1 shadow-xl shadow-black/40">
            {busy && !results.length ? <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p> :
              !results.length ? <p className="px-3 py-2 text-sm text-muted-foreground">No investigations found.</p> :
                results.map((r) => (
                  <button key={r.id} disabled={has(r.id)} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onChange([...selected, { id: r.id, code: r.investigation_code, title: r.title }]); setQ(""); }}
                    className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/60 disabled:opacity-40">
                    <span className="font-mono text-xs text-muted-foreground">{r.investigation_code}</span><span>{r.title}</span>
                  </button>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
