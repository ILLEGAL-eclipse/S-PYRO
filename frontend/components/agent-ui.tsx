"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, FileText, FlaskConical, Wrench } from "lucide-react";
import { CitationList, RichText, citationHref } from "@/components/common";
import { SparkTrail } from "@/components/optics";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface TraceStep {
  tool: string; arguments: Record<string, unknown>; ok: boolean; error?: string | null; note?: string;
  conditions?: { parameter: string; value: string; unit: string | null; context?: string | null; ref: string }[];
}
export interface ChatMsg {
  role: "user" | "assistant"; content: string; citations?: Citation[]; warnings?: string[]; trace?: TraceStep[];
  usage?: Record<string, number>; extra?: ReactNode;
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-sm border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm shadow-[0_0_20px_rgba(255,158,27,0.1)]">{children}</div>
    </div>
  );
}

/** Collapsible "Agent reasoning / tool execution" trace; steps joined by amber spark hairlines. */
export function TraceView({ steps, usage, defaultOpen = false }: { steps: TraceStep[]; usage?: Record<string, number>; defaultOpen?: boolean }) {
  if (!steps.length) return null;
  return (
    <details open={defaultOpen} className="group mt-4 rounded-lg border border-primary/15 bg-black/30 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
        <Wrench className="size-3.5 text-primary" />Agent reasoning · {steps.length} tool call{steps.length === 1 ? "" : "s"}
        <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="px-3 pb-3 pt-1">
        {steps.map((t, i) => (
          <li key={i}>
            <div className="flex gap-3">
              <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", t.ok ? "bg-primary shadow-[0_0_10px_rgba(255,158,27,0.8)]" : "bg-danger shadow-[0_0_10px_rgba(251,113,133,0.7)]")} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[12px]"><span className="text-primary">{t.tool}</span><span className="text-muted-foreground">(</span>
                  <span className="break-all text-foreground/80">{Object.entries(t.arguments).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}</span><span className="text-muted-foreground">)</span></p>
                {t.note && <p className="mt-0.5 text-muted-foreground">{t.note}</p>}
                {t.error && <p className="mt-0.5 text-danger">{t.error}</p>}
              </div>
            </div>
            {i < steps.length - 1 && <div className="ml-[-6px] flex"><SparkTrail height={22} /></div>}
          </li>
        ))}
      </ol>
      {usage && <p className="border-t border-primary/10 px-3 py-2 font-mono text-[11px] text-muted-foreground">tokens in {usage.input_tokens} · out {usage.output_tokens}</p>}
    </details>
  );
}

export function AssistantCard({ m, className }: { m: ChatMsg; className?: string }) {
  const cites = Object.fromEntries((m.citations ?? []).map((c) => [c.ref, c]));
  return (
    <article className={cn("glass relative rounded-xl p-5 animate-fade-up", className)}>
      <RichText text={m.content} citations={cites} />
      {m.extra}
      {m.warnings?.map((w, j) => (
        <p key={j} className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-foreground/85">{w}</p>
      ))}
      <CitationList citations={m.citations ?? []} />
      <TraceView steps={m.trace ?? []} usage={m.usage} />
    </article>
  );
}

/** Right-hand live parameter inspector: everything shown here is derived from the conversation's actual tool calls and citations. */
export function ContextPanel({ steps, citations, mock }: { steps: TraceStep[]; citations: Citation[]; mock?: boolean }) {
  const args = steps.flatMap((s) => Object.entries(s.arguments).map(([k, v]) => ({ tool: s.tool, k, v })))
    .filter((a) => a.v !== null && a.v !== "" && a.k !== "limit" && a.k !== "offset");
  const conds = steps.flatMap((s) => s.conditions ?? []);
  const invs = [...new Map(citations.filter((c) => c.investigation_id).map((c) => [c.investigation_id, c])).values()];
  const pubs = [...new Map(citations.filter((c) => c.publication_id).map((c) => [c.publication_id, c])).values()];
  const empty = !args.length && !conds.length && !citations.length;
  const head = (t: string) => <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary/80">{t}</p>;
  return (
    <aside className="glass sticky top-20 max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto rounded-xl p-4 text-sm" aria-label="Context inspector">
      <p className="flex items-center gap-2 font-display text-sm font-semibold"><FlaskConical className="size-4 text-primary" />Context inspector</p>
      {mock && <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">Mock values — design preview only</p>}
      {empty && <p className="text-xs leading-relaxed text-muted-foreground">Retrieval parameters, extracted boundary conditions and cited sources from this conversation will appear here.</p>}
      {conds.length > 0 && (
        <section>{head("Boundary conditions (retrieved)")}
          <dl className="space-y-1.5">{conds.slice(0, 14).map((c, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 border-b border-primary/10 pb-1">
              <dt className="text-xs text-muted-foreground">{c.parameter}</dt><dd className="telemetry text-right text-foreground">{c.value}{c.unit ? ` ${c.unit}` : ""}</dd></div>))}</dl></section>)}
      {args.length > 0 && (
        <section>{head("Retrieval parameters")}
          <div className="flex flex-wrap gap-1.5">{args.slice(0, 24).map((a, i) => (
            <span key={i} className="rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 font-mono text-[11px]"><span className="text-muted-foreground">{a.k}</span> <span className="text-primary">{typeof a.v === "string" ? a.v : JSON.stringify(a.v)}</span></span>))}</div></section>)}
      {invs.length > 0 && (
        <section>{head("Investigations")}
          <ul className="space-y-1.5">{invs.map((c) => (
            <li key={c.investigation_id}><Link href={`/investigations/${c.investigation_id}`} className="text-xs hover:text-primary"><span className="font-mono text-muted-foreground">{c.label.split(" · ")[0]}</span><br />{c.investigation_title}</Link></li>))}</ul></section>)}
      {pubs.length > 0 && (
        <section>{head("Cited papers")}
          <ul className="space-y-1.5">{pubs.map((c) => (
            <li key={c.publication_id}><Link href={citationHref(c)} className="flex gap-2 text-xs hover:text-primary"><FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />{c.publication_title}</Link></li>))}</ul></section>)}
    </aside>
  );
}
