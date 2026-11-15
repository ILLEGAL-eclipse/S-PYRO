"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { RichText } from "@/components/common";
import { FlameFront, SparkTrail } from "@/components/optics";
import { cn } from "@/lib/utils";

export interface LiveStep {
  id: number; tool: string; arguments: Record<string, unknown>; status: "running" | "ok" | "error"; returned?: number | null; error?: string | null;
}

const LABEL: Record<string, [string, string]> = {
  search_investigations: ["Searching investigations", "investigations"],
  search_publications: ["Searching publications", "publications"],
  search_research_text: ["Searching paper text", "passages"],
  get_investigation_details: ["Opening investigation record", "record"],
  get_experimental_conditions: ["Reading experimental conditions", "conditions"],
  get_scientific_findings: ["Collecting documented findings", "findings"],
  get_figure_descriptions: ["Reading figure descriptions", "figures"],
  get_experimental_data: ["Loading numerical data", "datasets"],
  compare_investigations: ["Comparing investigations", "comparison"],
  rank_investigations: ["Ranking by similarity", "ranked"],
  get_fire_safety_applications: ["Checking fire-safety links", "applications"],
};

const TIPS = [
  "Every claim in the answer will link to a page in the original paper.",
  "S-PYRO only answers from records in its database — it never invents sources.",
  "Different units or conditions are never compared as if equivalent.",
  "Author interpretations are kept separate from experimental observations.",
];

function Stage({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("grid size-5 place-items-center rounded-full border text-[10px] transition-all",
        state === "done" && "border-primary bg-primary/20 text-primary shadow-[0_0_10px_rgba(255,158,27,.6)]",
        state === "active" && "border-warning bg-warning/15 text-warning shadow-[0_0_12px_rgba(255,158,27,.6)]",
        state === "todo" && "border-primary/20 text-muted-foreground/50")}>
        {state === "done" ? <Check className="size-3" /> : state === "active" ? <span className="size-1.5 animate-ember rounded-full bg-warning" /> : null}
      </span>
      <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", state === "todo" ? "text-muted-foreground/50" : state === "active" ? "text-foreground" : "text-primary")}>{label}</span>
    </div>
  );
}

/** Live loading screen: stage tracker, each retrieval step as it happens, running timer, and the answer typing in. */
export function AgentProgress({ steps, text, startedAt }: { steps: LiveStep[]; text: string; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  const [tip, setTip] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 4500); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, now - startedAt) / 1000;

  const composing = text.length > 0;
  const retrieving = steps.length > 0 && !composing;
  const s1 = steps.length || composing ? "done" : "active";
  const s2 = composing ? "done" : steps.length ? "active" : "todo";
  const s3 = composing ? "active" : "todo";

  return (
    <article className="glass relative overflow-hidden rounded-xl p-5" role="status" aria-live="polite" aria-label="S-PYRO is working on your question">
      <FlameFront active />
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Agent working</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">{elapsed.toFixed(1)}<span className="ml-0.5 text-[10px]">s</span></p>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Stage label="Interpreting question" state={s1 as "done" | "active"} />
        <span className="hidden h-px w-6 bg-primary/25 sm:block" />
        <Stage label="Retrieving evidence" state={s2 as "todo" | "active" | "done"} />
        <span className="hidden h-px w-6 bg-primary/25 sm:block" />
        <Stage label="Composing answer" state={s3 as "todo" | "active"} />
      </div>

      {steps.length === 0 && !composing && (
        <div className="space-y-2.5" aria-hidden>
          {[88, 64, 76].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-gradient-to-r from-primary/15 via-primary/5 to-transparent" style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }} />)}
        </div>
      )}

      {steps.length > 0 && (
        <ol className="rounded-lg border border-primary/15 bg-black/30 p-3">
          {steps.map((st, i) => {
            const [label, noun] = LABEL[st.tool] ?? [st.tool, "records"];
            const chips = Object.entries(st.arguments).filter(([k, v]) => v !== null && v !== "" && !["limit", "offset", "row_limit"].includes(k)).slice(0, 3);
            return (
              <li key={st.id} className="animate-fade-up">
                <div className="flex items-start gap-3">
                  <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
                    st.status === "running" && "border border-warning/60", st.status === "ok" && "bg-primary/20 text-primary shadow-[0_0_8px_rgba(255,158,27,.7)]", st.status === "error" && "bg-danger/20 text-danger")}>
                    {st.status === "running" ? <span className="size-1.5 animate-ember rounded-full bg-warning" /> : st.status === "ok" ? <Check className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className={st.status === "running" ? "text-foreground" : "text-foreground/80"}>{label}</span>
                      {st.status === "ok" && st.returned != null && <span className="font-mono text-[11px] text-primary">{st.returned} {noun}</span>}
                      {st.status === "error" && <span className="font-mono text-[11px] text-danger">{st.error ?? "failed"}</span>}
                    </p>
                    {chips.length > 0 && <p className="mt-0.5 flex flex-wrap gap-1.5">{chips.map(([k, v]) => (
                      <span key={k} className="max-w-full truncate rounded border border-primary/15 bg-primary/5 px-1.5 py-px font-mono text-[10.5px] text-muted-foreground"><span className="text-muted-foreground/70">{k}</span> {typeof v === "string" ? v : JSON.stringify(v)}</span>))}</p>}
                  </div>
                </div>
                {i < steps.length - 1 && <div className="-ml-[3px] flex"><SparkTrail height={16} active={steps[i + 1].status === "running"} /></div>}
              </li>
            );
          })}
        </ol>
      )}

      {composing && (
        <div className="mt-4 border-t border-primary/10 pt-4">
          <RichText text={text} citations={{}} />
          <span className="inline-block h-4 w-[7px] translate-y-0.5 animate-ember bg-primary" aria-hidden />
        </div>
      )}

      {!composing && (
        <p key={tip} className="mt-4 animate-fade-up border-t border-primary/10 pt-3 text-xs text-muted-foreground">
          <span className="mr-1.5 font-mono uppercase tracking-[0.14em] text-primary/80">{retrieving ? "Working" : "Tip"}</span>{TIPS[tip]}
        </p>
      )}
    </article>
  );
}
