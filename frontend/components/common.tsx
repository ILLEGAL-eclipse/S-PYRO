"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CountUp } from "@/components/visuals";
import { PlasmaWaveDivider } from "@/components/plasma";
import { AlertTriangle, FileSearch, Info, Loader2, ExternalLink, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import katex from "katex";
import { cn } from "@/lib/utils";
import type { Citation, Citations } from "@/lib/types";

const SECTIONS: [string, string][] = [["/investigations", "02 · Investigation Explorer"], ["/missions", "03 · Mission Analysis"], ["/assistant", "04 · AI Research Assistant"],
  ["/compare", "05 · Investigation Comparison"], ["/data", "06 · Scientific Data Explorer"], ["/fire-safety", "07 · Fire Safety Intelligence"],
  ["/validation", "08 · Research Validation"], ["/publications", "Source document"], ["/admin", "Administration"], ["/login", "Account"]];

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  const path = usePathname() ?? "";
  const auto = path === "/" ? "01 · Overview" : SECTIONS.find(([p]) => path.startsWith(p))?.[1];
  return (
    <div className="mb-8 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {(eyebrow ?? auto) && <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary"><span className="inline-block size-1.5 animate-ember rounded-full bg-primary shadow-[0_0_10px_rgba(255,158,27,.9)]" />{eyebrow ?? auto}</p>}
          <h1 className="text-[30px] font-semibold leading-tight sm:text-[40px]">{title}</h1>
          {description && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <PlasmaWaveDivider className="mt-5" />
    </div>
  );
}

export function Loading({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{label}</span>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center">
      <div className="text-muted-foreground">{icon ?? <FileSearch className="size-8" />}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

export function ErrorState({ error, retry }: { error: { message: string } | string; retry?: () => void }) {
  const msg = typeof error === "string" ? error : error.message;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex-1"><p className="font-medium text-danger">Something went wrong</p><p className="mt-0.5 text-foreground/80">{msg}</p></div>
      {retry && <button onClick={retry} className="text-xs font-medium text-primary hover:underline">Retry</button>}
    </div>
  );
}

export function Notice({ children, tone = "info", className }: { children: ReactNode; tone?: "info" | "warning"; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed",
      tone === "warning" ? "border-warning/30 bg-warning/10" : "border-primary/20 bg-primary/5", className)}>
      <Info className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-primary")} />
      <div className="text-foreground/85">{children}</div>
    </div>
  );
}

export function Section({ title, description, children, aside }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><h2 className="text-base font-semibold">{title}</h2>{description && <p className="text-sm text-muted-foreground">{description}</p>}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <Card className="group overflow-hidden p-4 transition-colors hover:border-primary/40">
      <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-primary/10 blur-2xl" />
      <div className="flex items-start justify-between"><p className="label-caps">{label}</p><span className="text-primary/70">{icon}</span></div>
      <p className="mt-2 font-display text-[34px] font-semibold leading-none tabular-nums text-primary">{typeof value === "number" ? <CountUp value={value} /> : value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/* --------------------------------------------------------------- citations */
export function citationHref(c: Citation): string {
  if (c.publication_id) {
    const p = new URLSearchParams();
    if (c.page) p.set("page", String(c.page));
    if (c.section) p.set("section", c.section);
    if (c.figure) p.set("figure", c.figure);
    if (c.table) p.set("table", c.table);
    if (c.quote) p.set("quote", c.quote.slice(0, 300));
    const s = p.toString();
    return `/publications/${c.publication_id}${s ? `?${s}` : ""}`;
  }
  return c.investigation_id ? `/investigations/${c.investigation_id}` : "#";
}

export function sourceText(c: { page?: number | null; section?: string | null; figure?: string | null; table?: string | null }) {
  return [c.page ? `p.${c.page}` : null, c.section, c.figure ? `Fig. ${c.figure}` : null, c.table ? `Table ${c.table}` : null].filter(Boolean).join(" · ");
}

export function CiteChip({ c }: { c: Citation }) {
  return (
    <Link href={citationHref(c)} title={`${c.label}${c.quote ? ` — “${c.quote}”` : ""}`}
      className="mx-0.5 inline-flex -translate-y-px items-center rounded border border-primary/30 bg-primary/10 px-1.5 font-mono text-[11px] font-medium text-primary no-underline hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {c.ref}
    </Link>
  );
}

/** Small inline reference for a record: [R3] chip, falling back to nothing when there is no source. */
export function RefChip({ r, citations }: { r?: string | null; citations?: Citations }) {
  const c = r && citations ? citations[r] : null;
  return c ? <CiteChip c={c} /> : null;
}

const CITE = /\[(R\d+(?:\s*,\s*R\d+)*)\]/g;

function Math_({ src, display }: { src: string; display?: boolean }) {
  let html = "";
  try { html = katex.renderToString(src, { throwOnError: false, displayMode: !!display, output: "html" }); } catch { html = ""; }
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{src}</code>;
}

function inline(text: string, citations: Citations, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(CITE.source, "g");
  let n = 0;
  const pushText = (s: string) => {
    s.split(/(\$[^$\n]+\$)/g).forEach((chunk, ci) => {
      if (!chunk) return;
      if (chunk.length > 2 && chunk.startsWith("$") && chunk.endsWith("$")) {
        out.push(<Math_ key={`${keyBase}-m${n}-${ci}`} src={chunk.slice(1, -1)} />);
        return;
      }
      chunk.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((seg, i) => {
        if (!seg) return;
        if (seg.startsWith("**")) out.push(<strong key={`${keyBase}-b${n}-${ci}-${i}`}>{seg.slice(2, -2)}</strong>);
        else if (seg.startsWith("`")) out.push(<code key={`${keyBase}-c${n}-${ci}-${i}`}>{seg.slice(1, -1)}</code>);
        else out.push(seg);
      });
    });
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    m[1].split(",").map((s) => s.trim()).forEach((id) => {
      const c = citations[id];
      out.push(c ? <CiteChip key={`${keyBase}-r${n++}`} c={c} /> : null);
    });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

/** Tiny markdown subset (paragraphs, bullets, bold, code) with clickable citation chips. */
export function RichText({ text, citations }: { text: string; citations: Citations }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="prose-spyro text-sm">
      {blocks.map((b, i) => {
        const dm = b.match(/^\s*\$\$([\s\S]+?)\$\$\s*$/);
        if (dm) return <div key={i}><Math_ src={dm[1]} display /></div>;
        const lines = b.split("\n");
        if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) return <h3 key={i}>{inline(lines[0].replace(/^#{1,4}\s+/, ""), citations, `${i}`)}</h3>;
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), citations, `${i}-${j}`)}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, citations, `${i}-${j}`)}</span>)}</p>;
      })}
    </div>
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="label-caps mb-2">Sources</p>
      <ol className="space-y-1.5">
        {citations.map((c) => (
          <li key={c.ref} className="flex items-start gap-2 text-xs">
            <CiteChip c={c} />
            <Link href={citationHref(c)} className="min-w-0 flex-1 text-foreground/80 hover:text-primary hover:underline">
              {c.label}
              {c.quote && <span className="block truncate text-muted-foreground">“{c.quote}”</span>}
            </Link>
            <span className="text-muted-foreground">{c.publication_id ? <FileText className="size-3.5" /> : <ExternalLink className="size-3.5" />}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "p.8 · Table 2" linking to the original document where one is known. */
export function SourceRef({ publicationId, page, section, figure, table, title }: {
  publicationId?: string | null; page?: number | null; section?: string | null; figure?: string | null; table?: string | null; title?: string | null;
}) {
  const label = sourceText({ page, section, figure, table });
  if (!publicationId) return <span className="text-xs text-muted-foreground">{label || "No source location stored"}</span>;
  return (
    <Link href={citationHref({ ref: "", kind: "", label: "", publication_id: publicationId, page, section, figure, table })}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      <FileText className="size-3.5" />{title ? `${title}${label ? " — " : ""}` : ""}{label || "Open source"}
    </Link>
  );
}

export function EvidenceBadge({ type }: { type: string }) {
  const map: Record<string, { tone: "success" | "primary" | "violet" | "warning" | "neutral"; label: string }> = {
    experimental_observation: { tone: "success", label: "Experimental observation" },
    numerical_result: { tone: "primary", label: "Numerical result" },
    theoretical: { tone: "violet", label: "Theoretical" },
    author_interpretation: { tone: "warning", label: "Author interpretation" },
    review: { tone: "neutral", label: "Review" },
    other: { tone: "neutral", label: "Other" },
  };
  const m = map[type] ?? map.other;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function AiLayerBadge() {
  return <Badge tone="violet">AI-generated · not evidence</Badge>;
}
