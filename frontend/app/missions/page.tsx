"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Orbit } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { EmptyState, ErrorState, EvidenceBadge, Loading, Notice, PageHeader, RefChip } from "@/components/common";
import { Gauge } from "@/components/visuals";
import { api, useApi } from "@/lib/api";
import type { Citations } from "@/lib/types";
import { fmtNum } from "@/lib/utils";

interface Preset { label: string; gravity_g: number | null; note: string }
interface Result {
  investigation: { id: string; code: string; title: string; research_category: string | null }; ref: string; relevance_score: number;
  score_components: { environment_similarity: number | null; objective_text_match: number | null };
  breakdown: { parameter: string; label: string; requested: number; similarity: number; documented: { value: string; unit: string | null; context: string | null; class_level_match_only: boolean } | null; ref?: string }[];
  reasons: string[]; experimental_differences: string[]; limitations: string[];
  supporting_findings: { description: string; evidence_type: string; ref: string }[];
  publications: { id: string; title: string; year: number | null; ref: string }[];
  documented_mission_relevance: { mission_type: string; rationale: string | null; limitations: string | null }[];
}
interface Out { disclaimer: string; scoring_method: string; results: Result[]; citations: Citations }

export default function MissionPage() {
  const presets = useApi<{ presets: Record<string, Preset>; notice: string }>("/api/mission/presets");
  const [mission, setMission] = useState("iss");
  const [f, setF] = useState({ gravity_g: "", oxygen_percent: "", pressure_kpa: "", temperature_k: "", atmosphere_composition: "", objective: "" });
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = presets.data?.presets[mission];
    if (p) setF((x) => ({ ...x, gravity_g: p.gravity_g !== null ? String(p.gravity_g) : "" }));
  }, [mission, presets.data]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const n = (v: string) => (v.trim() === "" ? null : Number(v));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      setOut(await api<Out>("/api/mission/analyse", { method: "POST", json: {
        mission_type: mission, gravity_g: n(f.gravity_g), oxygen_percent: n(f.oxygen_percent), pressure_kpa: n(f.pressure_kpa),
        temperature_k: n(f.temperature_k), atmosphere_composition: f.atmosphere_composition || null, objective: f.objective || null, limit: 10 } }));
    } catch (err) { setError((err as Error).message); setOut(null); } finally { setBusy(false); }
  }
  const preset = presets.data?.presets[mission];

  return (
    <>
      <PageHeader title="Mission Analysis" description="Describe a mission environment and a research objective. S-PYRO retrieves and ranks investigations whose documented conditions are most similar, with the reasons for each ranking." />
      <Notice tone="warning" className="mb-6">Relevance scores are research discovery aids, not certified engineering or fire-safety ratings. A high score does not mean an investigation shows that any solution is effective.</Notice>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit lg:sticky lg:top-20"><CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent><form onSubmit={run} className="space-y-3.5">
            <div><Label htmlFor="mission">Mission environment</Label>
              <Select id="mission" value={mission} onChange={(e) => setMission(e.target.value)}>
                {Object.entries(presets.data?.presets ?? { iss: { label: "International Space Station" } }).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
              {preset?.note && <p className="mt-1.5 text-xs text-muted-foreground">{preset.note}</p>}</div>
            <div><Label htmlFor="g">Gravity (g)</Label><Input id="g" type="number" step="any" min="0" value={f.gravity_g} onChange={set("gravity_g")} placeholder="1 = Earth; 1e-6 ≈ microgravity" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="o2">Oxygen (%)</Label><Input id="o2" type="number" step="any" min="0" max="100" value={f.oxygen_percent} onChange={set("oxygen_percent")} /></div>
              <div><Label htmlFor="p">Pressure (kPa)</Label><Input id="p" type="number" step="any" min="0" value={f.pressure_kpa} onChange={set("pressure_kpa")} /></div>
            </div>
            <div><Label htmlFor="t">Temperature (K)</Label><Input id="t" type="number" step="any" min="0" value={f.temperature_k} onChange={set("temperature_k")} /></div>
            <div><Label htmlFor="atm">Atmospheric composition</Label><Input id="atm" value={f.atmosphere_composition} onChange={set("atmosphere_composition")} placeholder="e.g. O2/N2, helium diluent" /></div>
            <div><Label htmlFor="obj">Research objective</Label><Textarea id="obj" value={f.objective} onChange={set("objective")} placeholder="e.g. flame spread over thermally thin solid fuels" /></div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Analysing…" : "Retrieve & rank investigations"}</Button>
            <p className="text-xs text-muted-foreground">Leave a field empty to exclude it. Atmospheric values are never assumed.</p>
          </form></CardContent></Card>

        <div className="min-w-0">
          {error && <ErrorState error={error} />}
          {busy && <Loading rows={3} />}
          {!busy && !out && !error && <EmptyState icon={<Orbit className="size-8" />} title="No analysis yet" description="Set at least one environmental parameter or an objective, then run the analysis." />}
          {out && !busy && (out.results.length === 0 ? <EmptyState title="No investigations matched" description="No investigation documents comparable conditions, or the database has no records yet." /> : (
            <div className="stagger space-y-4">
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">How scores are calculated</summary><p className="mt-1.5 leading-relaxed">{out.scoring_method}</p></details>
              {out.results.map((r, idx) => (
                <Card key={r.investigation.id} className="card-sweep p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0"><span className="font-mono text-xs text-muted-foreground">#{idx + 1} · {r.investigation.code}</span>
                      <Link href={`/investigations/${r.investigation.id}`} className="block font-display text-base font-semibold hover:text-primary">{r.investigation.title}</Link></div>
                    <Gauge value={r.relevance_score} label="relevance" size={92} className="shrink-0" />
                  </div>

                  {r.breakdown.length > 0 && (
                    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left"><th className="label-caps py-1.5 pr-3">Parameter</th><th className="label-caps py-1.5 pr-3">Requested</th><th className="label-caps py-1.5 pr-3">Documented</th><th className="label-caps py-1.5 pr-3">Similarity</th><th /></tr></thead>
                      <tbody>{r.breakdown.map((b) => (
                        <tr key={b.parameter} className="border-t border-primary/10"><td className="py-2 pr-3">{b.label}</td><td className="py-2 pr-3 font-mono">{fmtNum(b.requested)}</td>
                          <td className="py-2 pr-3 font-mono">{b.documented ? <>{b.documented.value} {b.documented.unit}{b.documented.class_level_match_only && <Badge className="ml-1.5">regime only</Badge>}</> : <span className="font-sans text-muted-foreground">not documented</span>}</td>
                          <td className="py-2 pr-3">{b.documented ? (
                            <span className="inline-flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-gradient-to-r from-primary to-primary" style={{ width: `${b.similarity * 100}%` }} /></span><span className="font-mono text-xs">{Math.round(b.similarity * 100)}%</span></span>
                          ) : "—"}</td><td><RefChip r={b.ref} citations={out.citations} /></td></tr>))}</tbody></table></div>)}

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div><p className="label-caps mb-1.5">Reasons for relevance</p>{r.reasons.length ? <ul className="ml-4 list-disc space-y-1 text-sm">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">No close matches in documented conditions.</p>}</div>
                    <div><p className="label-caps mb-1.5">Experimental differences</p>{r.experimental_differences.length ? <ul className="ml-4 list-disc space-y-1 text-sm">{r.experimental_differences.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">None among compared parameters.</p>}</div>
                  </div>
                  {r.supporting_findings.length > 0 && <div className="mt-4"><p className="label-caps mb-1.5">Supporting findings (as documented)</p><ul className="space-y-2">{r.supporting_findings.map((f, i) => <li key={i} className="rounded-md border border-primary/15 bg-black/20 p-2.5 text-sm"><div className="mb-1"><EvidenceBadge type={f.evidence_type} /></div>{f.description} <RefChip r={f.ref} citations={out.citations} /></li>)}</ul></div>}
                  {r.documented_mission_relevance.length > 0 && <div className="mt-4"><p className="label-caps mb-1.5">Documented mission relevance</p>{r.documented_mission_relevance.map((m, i) => <p key={i} className="text-sm"><Badge tone="primary">{m.mission_type}</Badge> {m.rationale}</p>)}</div>}
                  <div className="mt-4"><p className="label-caps mb-1.5">Research limitations</p>{r.limitations.length ? <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">{r.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">No limitations recorded for this investigation.</p>}</div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-primary/10 pt-3 text-xs">{r.publications.map((p) => <Link key={p.id} href={`/publications/${p.id}`} className="text-primary hover:underline">{p.title}{p.year && ` (${p.year})`}</Link>)}</div>
                </Card>))}
            </div>))}
        </div>
      </div>
    </>
  );
}
