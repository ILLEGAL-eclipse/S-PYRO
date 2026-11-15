"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, Download, Plus, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Select } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Loading, Notice, PageHeader, SourceRef } from "@/components/common";
import { SERIES_COLORS, tooltipStyle } from "@/components/charts";
import { API_URL, api, useApi } from "@/lib/api";
import type { DatasetMeta } from "@/lib/types";
import { fmtNum } from "@/lib/utils";

interface Detail {
  dataset: DatasetMeta; investigation: { id: string; code: string; title: string }; publication: { id: string; title: string } | null;
  rows: { row_index: number; variable: string; value: number; unit: string | null; experimental_condition: string | null; source_reference: string | null }[];
  variables: string[]; units: Record<string, string | null>;
  experimental_conditions: { parameter: string; value: string; unit: string | null; context: string | null; source_page: number | null }[];
}
type Kind = "line" | "scatter" | "bar" | "histogram";
interface Series { id: string; x: string; y: string }

const axis = { tick: { fill: "#B8A99A", fontSize: 11 }, axisLine: { stroke: "hsl(75 4% 22%)" }, tickLine: false as const };

function pointsOf(d: Detail, s: Series) {
  const by = new Map<number, Record<string, number>>();
  d.rows.forEach((r) => { const o = by.get(r.row_index) ?? {}; o[r.variable] = r.value; by.set(r.row_index, o); });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([i, o]) => ({ i, x: o[s.x], y: o[s.y] })).filter((p) => p.y !== undefined);
}

function Explorer() {
  const sp = useSearchParams();
  const list = useApi<{ items: DatasetMeta[] }>("/api/datasets");
  const [series, setSeries] = useState<Series[]>([]);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [kind, setKind] = useState<Kind>("scatter");
  const [error, setError] = useState<string | null>(null);

  async function add(id: string) {
    if (series.some((s) => s.id === id) || series.length >= 4) return;
    try {
      const d = details[id] ?? await api<Detail>(`/api/datasets/${id}`);
      setDetails((x) => ({ ...x, [id]: d }));
      setSeries((s) => [...s, { id, x: d.variables.length > 1 ? d.variables[0] : "", y: d.variables[d.variables.length > 1 ? 1 : 0] }]);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { const d = sp.get("dataset"); if (d && series.length === 0) add(d); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp]);

  const ready = series.filter((s) => details[s.id]);
  // group series that share the same units so incomparable quantities never share an axis
  const groups = useMemo(() => {
    const m = new Map<string, Series[]>();
    ready.forEach((s) => {
      const d = details[s.id];
      const key = kind === "histogram" ? `${d.units[s.y] ?? ""}` : `${d.units[s.x] ?? ""}|${d.units[s.y] ?? ""}`;
      m.set(key, [...(m.get(key) ?? []), s]);
    });
    return [...m.entries()];
  }, [ready, details, kind]);

  return (
    <>
      <PageHeader title="Scientific Data Explorer" description="Chart numerical values that were extracted from research tables and supplementary material. No values are estimated and no graphs are digitised. Series with different units are shown on separate charts." />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Datasets</CardTitle></CardHeader><CardContent className="space-y-2">
            {list.loading && <Loading rows={2} />}
            {list.error && <ErrorState error={list.error} retry={list.reload} />}
            {list.data && list.data.items.length === 0 && <p className="text-sm text-muted-foreground">No numerical datasets have been ingested yet.</p>}
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {list.data?.items.map((d) => (
                <button key={d.id} disabled={series.some((s) => s.id === d.id) || series.length >= 4} onClick={() => add(d.id)}
                  className="flex w-full items-start justify-between gap-2 rounded-md border p-2.5 text-left text-sm hover:border-primary/40 disabled:opacity-40">
                  <span><span className="block font-medium">{d.dataset_name}</span><span className="font-mono text-xs text-muted-foreground">{d.investigation_code}</span></span><Plus className="mt-0.5 size-4 shrink-0 text-primary" /></button>))}
            </div>
            <p className="text-xs text-muted-foreground">Up to 4 datasets can be compared.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Chart</CardTitle></CardHeader><CardContent className="space-y-3">
            <div><Label htmlFor="kind">Chart type</Label><Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="scatter">Scatter plot</option><option value="line">Line chart</option><option value="bar">Bar chart</option><option value="histogram">Histogram (distribution of Y)</option></Select></div>
            {ready.map((s, i) => { const d = details[s.id]; return (
              <div key={s.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ background: SERIES_COLORS[i] }} />{d.dataset.dataset_name}</span>
                  <button onClick={() => setSeries((x) => x.filter((q) => q.id !== s.id))} aria-label="Remove dataset" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>
                <div className="grid grid-cols-2 gap-2">
                  {kind !== "histogram" && <div><Label>X variable</Label><Select value={s.x} onChange={(e) => setSeries((x) => x.map((q) => q.id === s.id ? { ...q, x: e.target.value } : q))}><option value="">Row index</option>{d.variables.map((v) => <option key={v} value={v}>{v}{d.units[v] ? ` (${d.units[v]})` : ""}</option>)}</Select></div>}
                  <div className={kind === "histogram" ? "col-span-2" : ""}><Label>Y variable</Label><Select value={s.y} onChange={(e) => setSeries((x) => x.map((q) => q.id === s.id ? { ...q, y: e.target.value } : q))}>{d.variables.map((v) => <option key={v} value={v}>{v}{d.units[v] ? ` (${d.units[v]})` : ""}</option>)}</Select></div>
                </div></div>); })}
          </CardContent></Card>
        </div>

        <div className="min-w-0 space-y-5">
          {error && <ErrorState error={error} />}
          {ready.length === 0 && <EmptyState icon={<BarChart3 className="size-8" />} title="Select a dataset to begin" description="Choose a dataset on the left, then pick variables. Every chart shows its source dataset, units and experimental conditions." />}
          {groups.length > 1 && <Notice tone="warning">The selected series use different units, so they are plotted on separate charts and are not directly comparable.</Notice>}
          {groups.map(([key, ss]) => <ChartCard key={key} ss={ss} details={details} kind={kind} allReady={ready} />)}
          {ready.map((s, i) => { const d = details[s.id]; return (
            <Card key={s.id}><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle><span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: SERIES_COLORS[i] }} />{d.dataset.dataset_name}</CardTitle>
              <Button size="sm" variant="outline" asChild><a href={`${API_URL}/api/datasets/${d.dataset.id}?format=csv`}><Download />Download CSV</a></Button></div></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{d.dataset.description}</p>
                <p>Investigation <Link className="text-primary hover:underline" href={`/investigations/${d.investigation.id}`}>{d.investigation.code} — {d.investigation.title}</Link></p>
                <SourceRef publicationId={d.publication?.id} title={d.publication?.title} page={d.dataset.source_page} table={d.dataset.source_table} />
                <div><p className="label-caps mb-1">Units</p><div className="flex flex-wrap gap-1.5">{d.variables.map((v) => <Badge key={v}>{v}: {d.units[v] ?? "unitless / not stated"}</Badge>)}</div></div>
                <div><p className="label-caps mb-1">Experimental conditions (investigation)</p>
                  {d.experimental_conditions.length ? <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{d.experimental_conditions.slice(0, 12).map((c, i) => <li key={i} className="text-xs"><span className="text-muted-foreground">{c.parameter}:</span> <span className="font-mono">{c.value} {c.unit}</span>{c.context && <span className="text-muted-foreground"> · {c.context}</span>}</li>)}</ul> : <p className="text-xs text-muted-foreground">No conditions documented.</p>}</div>
                <details><summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Show data ({new Set(d.rows.map((r) => r.row_index)).size} rows)</summary>
                  <div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left"><th className="label-caps p-1.5">Row</th><th className="label-caps p-1.5">Variable</th><th className="label-caps p-1.5">Value</th><th className="label-caps p-1.5">Condition</th><th className="label-caps p-1.5">Source</th></tr></thead>
                    <tbody>{d.rows.slice(0, 200).map((r, k) => <tr key={k} className="border-t"><td className="p-1.5 font-mono">{r.row_index}</td><td className="p-1.5">{r.variable}</td><td className="p-1.5 font-mono">{r.value} {r.unit}</td><td className="p-1.5 text-muted-foreground">{r.experimental_condition}</td><td className="p-1.5 text-muted-foreground">{r.source_reference}</td></tr>)}</tbody></table></div></details>
              </CardContent></Card>); })}
        </div>
      </div>
    </>
  );
}

function ChartCard({ ss, details, kind, allReady }: { ss: Series[]; details: Record<string, Detail>; kind: Kind; allReady: Series[] }) {
  const d0 = details[ss[0].id];
  const xu = d0.units[ss[0].x] ?? "", yu = d0.units[ss[0].y] ?? "";
  const xLabel = kind === "histogram" ? `${ss[0].y}${yu ? ` (${yu})` : ""}` : `${ss[0].x || "Row index"}${xu ? ` (${xu})` : ""}`;
  const yLabel = kind === "histogram" ? "Count" : `${ss[0].y}${yu ? ` (${yu})` : ""}`;
  const color = (id: string) => SERIES_COLORS[allReady.findIndex((s) => s.id === id)];

  let chart: React.ReactNode;
  if (kind === "histogram") {
    const vals = ss.flatMap((s) => pointsOf(details[s.id], s).map((p) => p.y));
    const lo = Math.min(...vals), hi = Math.max(...vals), n = Math.max(3, Math.ceil(Math.log2(vals.length) + 1));
    const w = (hi - lo) / n || 1;
    const bins = Array.from({ length: n }, (_, b) => ({ bin: `${fmtNum(lo + b * w, 3)}–${fmtNum(lo + (b + 1) * w, 3)}`, ...Object.fromEntries(ss.map((s) => [s.id, 0])) } as Record<string, string | number>));
    ss.forEach((s) => pointsOf(details[s.id], s).forEach((p) => { const b = Math.min(n - 1, Math.floor((p.y - lo) / w)); (bins[b][s.id] as number) += 1; }));
    chart = <BarChart data={bins} margin={{ left: 4, right: 12, top: 8, bottom: 24 }}><CartesianGrid stroke="hsl(75 4% 18%)" vertical={false} /><XAxis dataKey="bin" {...axis} label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "#B8A99A", fontSize: 11 }} /><YAxis allowDecimals={false} {...axis} />
      <Tooltip {...tooltipStyle} />{ss.map((s) => <Bar key={s.id} dataKey={s.id} name={details[s.id].dataset.dataset_name} fill={color(s.id)} radius={[3, 3, 0, 0]} />)}{ss.length > 1 && <Legend />}</BarChart>;
  } else if (kind === "bar") {
    const keys = new Map<string, Record<string, string | number>>();
    ss.forEach((s) => pointsOf(details[s.id], s).forEach((p) => { const k = s.x ? String(p.x) : String(p.i); const row = keys.get(k) ?? { x: k }; row[s.id] = p.y; keys.set(k, row); }));
    chart = <BarChart data={[...keys.values()]} margin={{ left: 4, right: 12, top: 8, bottom: 24 }}><CartesianGrid stroke="hsl(75 4% 18%)" vertical={false} /><XAxis dataKey="x" {...axis} label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "#B8A99A", fontSize: 11 }} /><YAxis {...axis} />
      <Tooltip {...tooltipStyle} />{ss.map((s) => <Bar key={s.id} dataKey={s.id} name={details[s.id].dataset.dataset_name} fill={color(s.id)} radius={[3, 3, 0, 0]} />)}{ss.length > 1 && <Legend />}</BarChart>;
  } else {
    chart = <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 24 }}><CartesianGrid stroke="hsl(75 4% 18%)" /><XAxis type="number" dataKey="x" name={xLabel} domain={["auto", "auto"]} {...axis} label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "#B8A99A", fontSize: 11 }} />
      <YAxis type="number" dataKey="y" name={yLabel} domain={["auto", "auto"]} {...axis} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "#B8A99A", fontSize: 11 }} /><Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
      {ss.map((s) => { const pts = pointsOf(details[s.id], s).map((p) => ({ x: s.x ? p.x : p.i, y: p.y })).filter((p) => p.x !== undefined).sort((a, b) => a.x - b.x);
        return <Scatter key={s.id} name={details[s.id].dataset.dataset_name} data={pts} fill={color(s.id)} line={kind === "line" ? { stroke: color(s.id), strokeWidth: 2 } : false} />; })}
      {ss.length > 1 && <Legend />}</ScatterChart>;
  }
  return (
    <Card><CardHeader><CardTitle>{ss.map((s) => details[s.id].dataset.dataset_name).join(" vs ")}</CardTitle>
      <p className="text-xs text-muted-foreground">Source: {ss.map((s) => `${details[s.id].investigation.code}${details[s.id].dataset.source_table ? ` · Table ${details[s.id].dataset.source_table}` : ""}${details[s.id].dataset.source_page ? ` · p.${details[s.id].dataset.source_page}` : ""}`).join("  |  ")}</p></CardHeader>
      <CardContent><div role="img" aria-label={`${kind} chart of ${yLabel} against ${xLabel}`}><ResponsiveContainer width="100%" height={340}>{chart as React.ReactElement}</ResponsiveContainer></div>
        <p className="mt-2 text-xs text-muted-foreground">Experimental conditions: {ss.map((s) => { const c = details[s.id].experimental_conditions; return c.length ? c.slice(0, 4).map((x) => `${x.parameter} ${x.value}${x.unit ? " " + x.unit : ""}`).join(", ") : "none documented"; }).join("  |  ")}</p></CardContent></Card>
  );
}

export default function Page() { return <Suspense fallback={<Loading />}><Explorer /></Suspense>; }
