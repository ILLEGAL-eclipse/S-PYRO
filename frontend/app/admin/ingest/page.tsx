"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Cpu, FileUp, Upload, X } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Notice, PageHeader, Spinner } from "@/components/common";
import { ApiError, api, useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Report {
  ok: boolean; dry_run?: boolean; files: { name: string; size: number; role: string }[];
  errors: { file: string; message: string }[]; warnings: { file: string; message: string }[];
  counts: Record<string, Record<string, number>>; duplicates: Record<string, unknown>[];
  investigation?: { id: string; code: string; action: string }; publications?: { id: string; title: string; action: string }[];
  pdfs?: { name: string; stored_as: string; pages: number; chunks: number; chunks_duplicate?: number; note?: string }[]; chunks_pending_embedding?: number;
}

export default function IngestPage() {
  const { me } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embed, setEmbed] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const usage = useApi<{ model: string; total_input_tokens: number; total_output_tokens: number; errors: number }>(me?.is_admin ? "/api/admin/usage" : null);

  if (me && !me.is_admin) {
    return (<><PageHeader title="Data ingestion" /><EmptyState title="Administrator access required" description="Ingestion is restricted to authorised administrators. Sign in with an administrator account."
      action={<Button asChild><Link href="/login">Sign in</Link></Button>} /></>);
  }

  const add = (list: FileList | null) => { if (list) setFiles((f) => [...f, ...Array.from(list).filter((n) => !f.some((x) => x.name === n.name))]); };
  async function run(dry: boolean) {
    setBusy(dry ? "Validating…" : "Ingesting…"); setError(null); setReport(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    form.set("dry_run", String(dry));
    try { setReport(await api<Report>("/api/admin/ingest", { method: "POST", form })); }
    catch (e) {
      const d = e instanceof ApiError ? (e.detail as { report?: Report } | undefined) : undefined;
      if (d?.report) setReport({ ...d.report, ok: false });
      setError((e as Error).message);
    } finally { setBusy(null); }
  }
  async function backfill() {
    setBusy("Embedding chunks…"); setEmbed(null);
    try { const r = await api<{ embedded: number; remaining: number }>("/api/admin/embeddings/backfill?limit=200", { method: "POST" }); setEmbed(`Embedded ${r.embedded} chunks; ${r.remaining} remaining.`); }
    catch (e) { setEmbed((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Data ingestion" description="Upload one extracted research package: investigation.json, experimental_conditions.json, scientific_findings.json, experimental_data.csv, figures.json, methodology.md, research_summary.md, references.json, the original PDF and figure images. No Gemini access is needed." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card><CardContent className="pt-5">
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <FileUp className="size-7 text-muted-foreground" /><p className="text-sm">Drop the package files here, or</p>
              <Button variant="outline" onClick={() => input.current?.click()}><Upload />Choose files</Button>
              <input ref={input} type="file" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              <p className="text-xs text-muted-foreground">Re-uploading a package is safe: duplicate records are detected and skipped.</p>
            </div>
            {files.length > 0 && <ul className="mt-4 divide-y rounded-md border text-sm">{files.map((f) => <li key={f.name} className="flex items-center justify-between gap-3 px-3 py-2"><span className="truncate">{f.name}</span><span className="flex items-center gap-3 text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB<button onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}><X className="size-4" /></button></span></li>)}</ul>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" disabled={!files.length || !!busy} onClick={() => run(true)}>Validate only</Button>
              <Button disabled={!files.length || !!busy} onClick={() => run(false)}>Ingest package</Button>
              {busy && <Spinner label={busy} />}
            </div>
          </CardContent></Card>

          {error && !report && <ErrorState error={error} />}
          {report && (
            <Card className={report.ok ? "border-success/40" : "border-danger/40"}><CardHeader><CardTitle className="flex items-center gap-2">{report.ok ? <CheckCircle2 className="size-4 text-success" /> : null}Ingestion report {report.dry_run && <Badge>validation only — nothing written</Badge>}</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                {report.investigation && <p>Investigation <Link className="text-primary hover:underline" href={`/investigations/${report.investigation.id}`}>{report.investigation.code}</Link> <Badge tone="success">{report.investigation.action}</Badge></p>}
                {report.publications?.map((p) => <p key={p.id}>Publication: {p.title} <Badge>{p.action}</Badge></p>)}
                {report.pdfs?.map((p) => <p key={p.name} className="text-xs text-muted-foreground">PDF {p.name}: stored unchanged · {p.pages} pages · {p.chunks} new text chunks{p.chunks_duplicate ? ` (${p.chunks_duplicate} duplicate)` : ""}{p.note && ` · ${p.note}`}</p>)}
                <table className="w-full text-xs"><thead><tr className="text-left"><th className="label-caps py-1">Records</th><th className="label-caps py-1">Inserted</th><th className="label-caps py-1">Duplicates</th><th className="label-caps py-1">Rejected</th></tr></thead>
                  <tbody>{Object.entries(report.counts).filter(([k]) => k !== "validated").map(([k, v]) => <tr key={k} className="border-t"><td className="py-1.5">{k.replace(/_/g, " ")}</td><td className="font-mono">{v.inserted}</td><td className="font-mono">{v.duplicates}</td><td className="font-mono">{v.rejected}</td></tr>)}</tbody></table>
                {report.counts.validated && <p className="text-xs text-muted-foreground">Validated: {Object.entries(report.counts.validated).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ")}</p>}
                {report.errors.map((e, i) => <p key={i} className="rounded-md bg-danger/10 p-2 text-xs text-danger"><strong>{e.file}:</strong> {e.message}</p>)}
                {report.warnings.map((w, i) => <p key={i} className="rounded-md bg-warning/10 p-2 text-xs text-warning"><strong>{w.file}:</strong> {w.message}</p>)}
                {report.duplicates.length > 0 && <p className="text-xs text-muted-foreground">{report.duplicates.length} duplicate data row(s) were skipped.</p>}
                {typeof report.chunks_pending_embedding === "number" && report.chunks_pending_embedding > 0 && <Notice>{report.chunks_pending_embedding} text chunk(s) are waiting for semantic embeddings. Keyword search works now; run the embedding job to enable semantic search.</Notice>}
              </CardContent></Card>
          )}
        </div>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Semantic search</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Create pgvector embeddings for text chunks that have none (uses Gemini on the backend; ingestion itself does not).</p>
            <Button variant="outline" onClick={backfill} disabled={!!busy || !me?.gemini_configured}><Cpu />Embed pending chunks</Button>
            {!me?.gemini_configured && <p className="text-xs text-warning">Gemini is not configured.</p>}{embed && <p className="text-xs">{embed}</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Gemini usage</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
            {usage.data ? <><p className="text-muted-foreground">Model: <span className="font-mono text-foreground">{usage.data.model || "not set"}</span></p><p className="text-muted-foreground">Input tokens: <span className="font-mono text-foreground">{usage.data.total_input_tokens}</span></p><p className="text-muted-foreground">Output tokens: <span className="font-mono text-foreground">{usage.data.total_output_tokens}</span></p><p className="text-muted-foreground">Errors (last 500 calls): <span className="font-mono text-foreground">{usage.data.errors}</span></p></> : <p className="text-muted-foreground">No usage data.</p>}
          </CardContent></Card>
        </div>
      </div>
    </>
  );
}
