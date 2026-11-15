"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History, ShieldCheck, Upload } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Loading, Notice, PageHeader, SourceRef } from "@/components/common";
import { InvestigationPicker } from "@/components/investigation";
import { api, useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Classification, ValidationIssue, ValidationSession } from "@/lib/types";
import { cn, titleCase } from "@/lib/utils";

const CLS: Record<Classification, { tone: "success" | "warning" | "violet" | "neutral" | "primary"; label: string }> = {
  "MATCH": { tone: "success", label: "MATCH" }, "DISCREPANCY": { tone: "warning", label: "DISCREPANCY DETECTED" },
  "CONTEXT MISMATCH": { tone: "violet", label: "CONTEXT MISMATCH" }, "NOT FOUND": { tone: "neutral", label: "NOT FOUND" }, "INSUFFICIENT EVIDENCE": { tone: "primary", label: "INSUFFICIENT EVIDENCE" },
};
const TYPES = [["parameters", "Experimental parameters"], ["measurements", "Numerical measurements"], ["observations", "Experimental observations"], ["hypothesis", "Research hypothesis"],
  ["conclusion", "Scientific conclusion"], ["methodology", "Methodology description"], ["notes", "Research notes"], ["csv", "CSV dataset"], ["json", "JSON research record"], ["document", "Research paper / document"]];
const PLACEHOLDER: Record<string, string> = {
  parameters: "One per line, e.g.\nOxygen concentration: 21 %\nPressure: 101.3 kPa\nFuel: PMMA", csv: "parameter,value,unit,context\nOxygen concentration,21,%,Test A",
  json: '{"investigation": "CODE", "parameters": [{"parameter": "Pressure", "value": 101.3, "unit": "kPa"}]}',
};
const HIST_KEY = "spyro.validation.sessions";

function Validation() {
  const sp = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const [type, setType] = useState("parameters");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inv, setInv] = useState<{ id: string; code: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationSession | null>(null);
  const [hist, setHist] = useState<{ id: string; input_type: string; created_at: string; context: ValidationSession["session"]["context"] }[]>([]);
  const [filter, setFilter] = useState<string>("");

  const loadHistory = useCallback(async () => {
    let ids = "";
    try { ids = (JSON.parse(localStorage.getItem(HIST_KEY) || "[]") as string[]).join(","); } catch { /* ignore */ }
    try { setHist((await api<{ items: typeof hist }>(`/api/validation${ids ? `?ids=${ids}` : ""}`)).items); } catch { setHist([]); }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory, me?.authenticated]);

  const open = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try { setResult(await api<ValidationSession>(`/api/validation/${id}`)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { const s = sp.get("session"); if (s) open(s); }, [sp, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const form = new FormData();
    form.set("input_type", type); form.set("content", text);
    if (inv[0]) form.set("investigation", inv[0].id);
    if (file) form.set("file", file);
    try {
      const r = await api<ValidationSession>("/api/validation/check", { method: "POST", form });
      setResult(r);
      try { const ids = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); localStorage.setItem(HIST_KEY, JSON.stringify([r.session.id, ...ids].slice(0, 50))); } catch { /* ignore */ }
      router.replace(`/validation?session=${r.session.id}`, { scroll: false });
      loadHistory();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const issues = result?.issues.filter((i) => !filter || i.classification === filter) ?? [];
  const counts = result?.session.context.counts ?? {};

  return (
    <>
      <PageHeader title="Research Validation" description="Compare your information with what the S-PYRO database documents. S-PYRO reports differences from the cited sources; it never declares your data wrong, never alters it, and the decision stays with you." />
      <Notice className="mb-6">Every result is backed by a stored source record. If the database has no corresponding record, S-PYRO reports <strong>NOT FOUND</strong> instead of using outside knowledge. Differing values may simply reflect different experimental conditions.</Notice>
      <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Your input</CardTitle></CardHeader><CardContent>
            <form onSubmit={submit} className="space-y-3.5">
              <div><Label htmlFor="type">Input type</Label><Select id="type" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
              <div><Label>Investigation (recommended)</Label><InvestigationPicker selected={inv} onChange={(v) => setInv(v.slice(-1))} max={1} placeholder="Search to choose the reference investigation…" />
                <p className="mt-1 text-xs text-muted-foreground">If omitted, S-PYRO only uses investigations your input names explicitly (code or title).</p></div>
              <div><Label htmlFor="content">Content</Label><Textarea id="content" value={text} onChange={(e) => setText(e.target.value)} rows={9} className="font-mono text-[13px]" placeholder={PLACEHOLDER[type] ?? "Paste your research text…"} /></div>
              <div><Label htmlFor="file">…or upload a file (.csv .json .txt .md .pdf)</Label>
                <Input id="file" type="file" accept=".csv,.json,.txt,.md,.pdf" className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
              <Button type="submit" className="w-full" disabled={busy || (!text.trim() && !file)}><ShieldCheck />{busy ? "Comparing with sources…" : "Compare with database sources"}</Button>
              {me && !me.gemini_configured && <p className="text-xs text-warning">Gemini is off: only explicit “Parameter: value unit” lines, CSV and JSON can be checked.</p>}
            </form></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" />Validation history</CardTitle></CardHeader><CardContent>
            {hist.length === 0 ? <p className="text-sm text-muted-foreground">{me?.authenticated ? "No saved validations yet." : "Sessions from this browser appear here. Sign in to keep history across devices."}</p> :
              <ul className="space-y-1">{hist.map((h) => (
                <li key={h.id}><button onClick={() => { router.replace(`/validation?session=${h.id}`, { scroll: false }); open(h.id); }}
                  className={cn("w-full rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary/60", result?.session.id === h.id && "bg-secondary/60")}>
                  <span className="font-medium">{titleCase(h.input_type)}</span> · {h.context?.items_checked ?? 0} items<br /><span className="text-muted-foreground">{new Date(h.created_at).toLocaleString()}{h.context?.investigation && ` · ${h.context.investigation.code}`}</span></button></li>))}</ul>}
          </CardContent></Card>
        </div>

        <div className="min-w-0">
          {error && <ErrorState error={error} />}
          {busy && <Loading rows={3} />}
          {!busy && !result && !error && <EmptyState icon={<ShieldCheck className="size-8" />} title="No validation yet" description="Submit parameters, measurements, observations or a dataset to see how they compare with the documented sources." />}
          {result && !busy && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {(Object.keys(CLS) as Classification[]).map((c) => (
                    <button key={c} onClick={() => setFilter(filter === c ? "" : c)} aria-pressed={filter === c}><Badge tone={CLS[c].tone} className={cn("cursor-pointer px-2.5 py-1 text-xs", filter === c && "ring-2 ring-ring")}>{counts[c] ?? 0} · {c}</Badge></button>))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{result.session.context.items_checked} item(s) checked
                  {result.session.context.investigation ? <> against <Link className="text-primary hover:underline" href={`/investigations/${result.session.context.investigation.id}`}>{result.session.context.investigation.code}</Link></> : " (no single investigation identified)"} · numeric tolerance {result.session.context.tolerance_relative * 100}% relative</p>
                {result.session.context.warnings.map((w, i) => <p key={i} className="mt-2 text-xs text-warning">⚠ {w}</p>)}
                <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">Your original input (preserved unchanged)</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/50 p-3 font-mono">{result.session.submitted_input.raw || result.session.submitted_input.filename}</pre></details>
              </Card>
              {issues.length === 0 && <EmptyState title="No results for this filter" />}
              {issues.map((i) => <IssueCard key={i.id} issue={i} onChange={(u) => setResult((r) => r && { ...r, issues: r.issues.map((x) => (x.id === u.id ? { ...x, status: u.status, researcher_note: u.researcher_note } : x)) })} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IssueCard({ issue: i, onChange }: { issue: ValidationIssue; onChange: (u: ValidationIssue) => void }) {
  const [note, setNote] = useState(i.researcher_note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = CLS[i.classification];
  async function save(status: ValidationIssue["status"]) {
    setSaving(true); setErr(null);
    try { onChange(await api<ValidationIssue>(`/api/validation/issues/${i.id}`, { method: "PATCH", json: { status, researcher_note: note || null } })); } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <Card className={cn("animate-fade-up border-l-4 p-5", ({ "MATCH": "border-l-success", "DISCREPANCY": "border-l-warning shadow-[0_0_22px_rgba(245,158,11,0.28)]", "CONTEXT MISMATCH": "border-l-violet", "NOT FOUND": "border-l-muted-foreground/50", "INSUFFICIENT EVIDENCE": "border-l-primary" } as Record<string, string>)[i.classification])}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.tone} className="px-2.5 py-0.5 text-xs">{c.label}</Badge><Badge>{titleCase(i.issue_type)}</Badge>
        {i.status !== "open" && <Badge tone="primary">{titleCase(i.status)}</Badge>}
        {i.source_record?.ai_assisted && <Badge tone="violet">AI-assisted comparison</Badge>}
      </div>
      <p className="mt-3 text-sm"><span className="text-muted-foreground">Parameter / statement:</span> <span className="font-medium">{i.parameter ?? "—"}</span></p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3"><p className="label-caps">Researcher input</p><p className="mt-1 break-words font-mono text-sm">{i.researcher_value ?? "—"}</p></div>
        <div className="rounded-md border p-3"><p className="label-caps">Database source</p><p className="mt-1 break-words font-mono text-sm">{i.source_value ?? <span className="font-sans text-muted-foreground">no corresponding record</span>}</p></div>
      </div>
      {(i.publication_id || i.investigation_id) && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {i.investigation_id && <div><dt className="inline text-muted-foreground">Investigation: </dt><dd className="inline"><Link href={`/investigations/${i.investigation_id}`} className="text-primary hover:underline">{i.investigation_code} {i.investigation_title}</Link></dd></div>}
          {i.publication_title && <div><dt className="inline text-muted-foreground">Publication: </dt><dd className="inline">{i.publication_title}</dd></div>}
          {(i.source_page || i.source_section || i.source_table || i.source_figure) && <div><dt className="inline text-muted-foreground">Location: </dt><dd className="inline">{[i.source_page && `Page ${i.source_page}`, i.source_section, i.source_table && `Table ${i.source_table}`, i.source_figure && `Figure ${i.source_figure}`].filter(Boolean).join(", ")}</dd></div>}
          {i.publication_id && <div><dt className="inline text-muted-foreground">Original document: </dt><dd className="inline"><SourceRef publicationId={i.publication_id} page={i.source_page} section={i.source_section} table={i.source_table} figure={i.source_figure} title="Open at cited location" /></dd></div>}
        </dl>)}
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">{i.explanation}</p>
      {i.source_record?.candidates && i.source_record.candidates.length > 0 && <div className="mt-3 text-xs"><span className="text-muted-foreground">Possible investigations (select one above and re-run): </span>{i.source_record.candidates.map((c) => <Link key={c.id} href={`/investigations/${c.id}`} className="mr-3 text-primary hover:underline">{c.code}</Link>)}</div>}
      {i.classification !== "MATCH" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your note (optional)" aria-label="Researcher note" className="h-8 min-w-[10rem] flex-1 text-xs" maxLength={2000} />
          {(["acknowledged", "resolved", "not_applicable"] as const).map((s) => <Button key={s} size="sm" variant={i.status === s ? "default" : "outline"} disabled={saving} onClick={() => save(s)}>{s === "not_applicable" ? "Not applicable" : titleCase(s)}</Button>)}
          {i.status !== "open" && <Button size="sm" variant="ghost" disabled={saving} onClick={() => save("open")}>Reopen</Button>}
          {err && <span className="w-full text-xs text-danger">{err}</span>}
        </div>)}
    </Card>
  );
}

export default function Page() { return <Suspense fallback={<Loading />}><Validation /></Suspense>; }
