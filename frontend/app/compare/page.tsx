"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GitCompare } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AiLayerBadge, EmptyState, ErrorState, EvidenceBadge, Loading, Notice, PageHeader, RefChip, RichText } from "@/components/common";
import { InvestigationPicker } from "@/components/investigation";
import { api } from "@/lib/api";
import type { Citations } from "@/lib/types";
import { cn } from "@/lib/utils";

type Pick = { id: string; code: string; title: string };
interface Cell { value: string; unit: string | null; normalized_value: number | null; normalized_unit: string | null; context: string | null; ref: string }
interface Cmp {
  investigations: { id: string; code: string; title: string }[];
  objectives: Record<string, string[]>; methodology: Record<string, string | null>; categories: Record<string, string | null>; limitations: Record<string, string[] | null>;
  conditions: { key: string; label: string; status: string; note: string | null; cells: Record<string, Cell[]> }[];
  findings: Record<string, { description: string; evidence_type: string; phenomenon: string | null; ref: string }[]>;
  phenomena: { phenomenon: string; investigations_reporting: string[]; status: string }[];
  notes: string[]; summary: { text: string } | null; summary_warnings: string[]; citations: Citations;
}
const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "primary" | "danger" }> = {
  same: { label: "Same", tone: "success" }, overlapping: { label: "Overlapping", tone: "primary" }, different: { label: "Different", tone: "warning" },
  missing: { label: "Missing information", tone: "neutral" }, not_comparable: { label: "Not comparable", tone: "danger" },
};

function Compare() {
  const sp = useSearchParams();
  const [picked, setPicked] = useState<Pick[]>([]);
  const [summary, setSummary] = useState(false);
  const [data, setData] = useState<Cmp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let base: Pick[] = [];
      try { base = JSON.parse(localStorage.getItem("spyro.compare") || "[]"); } catch { /* ignore */ }
      const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
      for (const id of ids) {
        if (base.some((b) => b.id === id)) continue;
        try { const d = await api<{ investigation: { id: string; investigation_code: string; title: string } }>(`/api/investigations/${id}`); base.push({ id, code: d.investigation.investigation_code, title: d.investigation.title }); } catch { /* skip */ }
      }
      setPicked(base.slice(0, 6));
    })();
  }, [sp]);
  const update = (v: Pick[]) => { setPicked(v); try { localStorage.setItem("spyro.compare", JSON.stringify(v)); } catch { /* ignore */ } };

  async function run() {
    setBusy(true); setError(null);
    try { setData(await api<Cmp>("/api/assistant/compare", { method: "POST", json: { investigation_ids: picked.map((p) => p.id), generate_summary: summary } })); }
    catch (e) { setError((e as Error).message); setData(null); } finally { setBusy(false); }
  }
  const cols = data?.investigations ?? [];
  const label = (id: string) => cols.find((c) => c.id === id)?.code ?? id;

  return (
    <>
      <PageHeader title="Investigation Comparison" description="Select 2–6 investigations to compare documented objectives, conditions, findings and limitations side by side. Values with different units or contexts are never compared as if equivalent." />
      <Card className="mb-6"><CardContent className="space-y-4 pt-5">
        <InvestigationPicker selected={picked} onChange={update} />
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={run} disabled={picked.length < 2 || busy}><GitCompare />{busy ? "Comparing…" : "Compare"}</Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />Include AI-generated, evidence-based summary</label>
          {picked.length < 2 && <span className="text-xs text-muted-foreground">Choose at least two investigations.</span>}
        </div>
      </CardContent></Card>

      {error && <ErrorState error={error} />}
      {busy && <Loading rows={3} />}
      {!data && !busy && !error && <EmptyState title="Nothing to compare yet" description="Pick investigations above, or use the “Compare” buttons in the Investigation Explorer." />}
      {data && !busy && (
        <div className="space-y-6">
          {data.summary && <Card className="border-violet/30"><CardHeader><div className="flex items-center justify-between"><CardTitle>Evidence-based summary</CardTitle><AiLayerBadge /></div></CardHeader><CardContent><RichText text={data.summary.text} citations={data.citations} /></CardContent></Card>}
          {data.summary_warnings.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}

          <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left"><th className="label-caps w-52 p-3">Experimental conditions</th>{cols.map((c) => <th key={c.id} className="p-3"><Link href={`/investigations/${c.id}`} className="font-mono text-xs text-primary hover:underline">{c.code}</Link><span className="block line-clamp-2 font-normal text-muted-foreground">{c.title}</span></th>)}</tr></thead>
            <tbody>
              {data.conditions.length === 0 && <tr><td colSpan={cols.length + 1} className="p-4 text-muted-foreground">No experimental conditions are documented for these investigations.</td></tr>}
              {data.conditions.map((r) => (
                <tr key={r.key} className={cn("border-b align-top last:border-0", r.status === "different" && "bg-warning/5")}>
                  <td className="p-3"><p className="font-medium">{r.label}</p><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>{r.note && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}</td>
                  {cols.map((c) => <td key={c.id} className="p-3">{r.cells[c.id]?.length ? r.cells[c.id].map((x, i) => (
                    <p key={i} className="font-mono">{x.value} {x.unit}{x.context && <span className="font-sans text-xs text-muted-foreground"> · {x.context}</span>} <RefChip r={x.ref} citations={data.citations} /></p>)) : <span className="text-muted-foreground">Not documented</span>}</td>)}
                </tr>))}
            </tbody></table></Card>

          <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols.length > 3 ? 260 : 300}px, 1fr))` }}>
            {cols.map((c) => (
              <Card key={c.id} className="p-5 text-sm"><p className="font-mono text-xs text-primary">{c.code}</p>
                <p className="label-caps mt-3 mb-1">Objectives</p>{data.objectives[c.id]?.length ? <ul className="ml-4 list-disc space-y-1">{data.objectives[c.id].map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="text-muted-foreground">Not documented</p>}
                <p className="label-caps mt-4 mb-1">Methodology</p>{data.methodology[c.id] ? <p className="line-clamp-6 whitespace-pre-line text-foreground/80">{data.methodology[c.id]}</p> : <p className="text-muted-foreground">Not documented</p>}
                <p className="label-caps mt-4 mb-1">Limitations</p>{data.limitations[c.id]?.length ? <ul className="ml-4 list-disc space-y-1">{data.limitations[c.id]!.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="text-muted-foreground">Not documented</p>}
              </Card>))}
          </div>

          <Card><CardHeader><CardTitle>Scientific findings</CardTitle></CardHeader><CardContent>
            {data.phenomena.length > 0 && <div className="mb-4 flex flex-wrap gap-2">{data.phenomena.map((p) => <Badge key={p.phenomenon} tone={p.status === "reported in all" ? "success" : "neutral"} title={p.investigations_reporting.map(label).join(", ")}>{p.phenomenon}: {p.status}</Badge>)}</div>}
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols.length > 3 ? 260 : 300}px, 1fr))` }}>
              {cols.map((c) => <div key={c.id}><p className="mb-2 font-mono text-xs text-primary">{c.code}</p>
                {data.findings[c.id]?.length ? <ul className="space-y-2">{data.findings[c.id].map((f, i) => <li key={i} className="rounded-md border p-2.5 text-sm"><div className="mb-1 flex gap-1.5"><EvidenceBadge type={f.evidence_type} />{f.phenomenon && <Badge>{f.phenomenon}</Badge>}</div>{f.description} <RefChip r={f.ref} citations={data.citations} /></li>)}</ul> : <p className="text-sm text-muted-foreground">No findings documented.</p>}</div>)}
            </div></CardContent></Card>
          <ul className="space-y-1 text-xs text-muted-foreground">{data.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>
        </div>
      )}
    </>
  );
}

export default function Page() { return <Suspense fallback={<Loading />}><Compare /></Suspense>; }
