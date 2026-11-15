"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Download, ExternalLink, FileText, GitCompare, ImageOff } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { AiLayerBadge, EmptyState, ErrorState, EvidenceBadge, Loading, Notice, PageHeader, RefChip, SourceRef } from "@/components/common";
import { useApi, API_URL } from "@/lib/api";
import { FlameSigil, Readout, flameColors, fmtRange } from "@/components/visuals";
import { ConditionsView, FiguresView, FindingsView } from "@/components/data-views";
import type { InvestigationDetail } from "@/lib/types";
import { titleCase } from "@/lib/utils";

function Expandable({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 520;
  return (
    <div>
      <p className={`leading-relaxed ${!open && long ? "line-clamp-5" : ""}`}>{text}</p>
      {long && <button onClick={() => setOpen((o) => !o)} className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary hover:underline">{open ? "Show less" : "Read full abstract"}</button>}
    </div>
  );
}

export default function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApi<InvestigationDetail>(`/api/investigations/${id}`);
  const [tab, setTab] = useState("overview");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t) setTab(t); }, []);
  if (loading) return <Loading rows={4} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return null;
  const { investigation: inv, publications, conditions, findings, figures, datasets, citations } = data;
  const card = data.card;
  const tel = card?.telemetry ?? {};
  const o2mid = tel.oxygen ? (tel.oxygen[0] + tel.oxygen[1]) / 2 : null;
  const pubTitle = (pid: string | null) => publications.find((p) => p.id === pid)?.title ?? null;

  return (
    <>
      <div className="glass relative mb-8 animate-fade-up overflow-hidden rounded-xl">
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(70% 120% at 88% 30%, ${flameColors(o2mid)[1]}2e, transparent 62%)` }} />
        <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
              <span className="inline-block size-1.5 animate-ember rounded-full bg-primary shadow-[0_0_8px_rgba(255,158,27,.9)]" />{inv.investigation_code}
              {inv.research_category && <span className="normal-case tracking-normal text-muted-foreground">· {inv.research_category}</span>}
            </p>
            <h1 className="text-2xl font-semibold leading-tight sm:text-[32px]">{inv.title}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {inv.investigation_type && <Badge tone="primary">{inv.investigation_type}</Badge>}
              {card?.gravity_classes.map((g) => <Badge key={g} tone="violet">{g}</Badge>)}
              {inv.combustion_phenomena.slice(0, 4).map((p) => <Badge key={p} className="max-w-full truncate font-sans text-[11.5px] normal-case tracking-normal" title={p}>{p}</Badge>)}
              {inv.combustion_phenomena.length > 4 && <Badge>+{inv.combustion_phenomena.length - 4}</Badge>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Readout label="Gravity" value={card?.gravity_classes[0] ?? "—"} />
              <Readout label="O₂" value={fmtRange(tel.oxygen)} unit="%" />
              <Readout label="Pressure" value={fmtRange(tel.pressure)} unit="kPa" />
              <Readout label="Temp" value={fmtRange(tel.temperature)} unit="K" />
              <Readout label="Findings" value={String(findings.length)} />
              <Readout label="Figures" value={String(figures.length)} />
              <Readout label="Datasets" value={String(datasets.length)} />
              <Readout label="Papers" value={String(publications.length)} />
            </div>
            <div className="mt-5"><Button variant="outline" asChild><Link href={`/compare?ids=${inv.id}`}><GitCompare />Compare</Link></Button></div>
          </div>
          <div className="hidden items-center lg:flex"><FlameSigil gravity={card?.gravity_classes[0] ?? null} o2={o2mid} seed={inv.investigation_code} size={200} /></div>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {[["overview", "Overview"], ["publications", `Publications (${publications.length})`], ["methodology", "Methodology"], ["conditions", `Conditions (${conditions.length})`],
            ["findings", `Findings (${findings.length})`], ["figures", `Figures (${figures.length})`], ["data", `Datasets (${datasets.length})`], ["missions", "Missions & fire safety"]].map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="overview" className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card><CardHeader><CardTitle>Investigation overview</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-relaxed">
              {inv.description ? <p>{inv.description}</p> : <p className="text-muted-foreground">No description recorded.</p>}
              {inv.abstract && <><p className="label-caps pt-2">Abstract</p><Expandable text={inv.abstract} /></>}
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Research objectives</CardTitle></CardHeader><CardContent>
              {inv.objectives.length ? <ul className="ml-5 list-disc space-y-1.5 text-sm">{inv.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="text-sm text-muted-foreground">No objectives recorded.</p>}
            </CardContent></Card>
            {data.ai_generated_summary && (
              <Card className="border-violet/30"><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Research summary</CardTitle><AiLayerBadge /></div></CardHeader>
                <CardContent><p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{data.ai_generated_summary.text}</p>
                  <p className="mt-3 text-xs text-muted-foreground">{data.ai_generated_summary.notice}</p></CardContent></Card>
            )}
          </div>
          <div className="space-y-5">
            <Card><CardHeader><CardTitle>Known limitations</CardTitle></CardHeader><CardContent>
              {inv.metadata?.limitations?.length ? <ul className="ml-5 list-disc space-y-1.5 text-sm">{inv.metadata.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="text-sm text-muted-foreground">No limitations were recorded for this investigation.</p>}
            </CardContent></Card>
            {inv.keywords.length > 0 && <Card><CardHeader><CardTitle>Keywords</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-1.5">{inv.keywords.map((k) => <Badge key={k}>{k}</Badge>)}</CardContent></Card>}
            <Card><CardHeader><CardTitle>Original source documents</CardTitle></CardHeader><CardContent className="space-y-2">
              {publications.length === 0 && <p className="text-sm text-muted-foreground">No publications recorded.</p>}
              {publications.map((p) => <Link key={p.id} href={`/publications/${p.id}`} className="flex items-start gap-2 text-sm hover:text-primary"><FileText className="mt-0.5 size-4 shrink-0 text-primary" /><span>{p.title}{!p.has_original && <span className="block text-xs text-muted-foreground">Original PDF not stored</span>}</span></Link>)}
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="publications">
          {publications.length === 0 ? <EmptyState title="No associated publications" /> : (
            <div className="space-y-3">{publications.map((p) => (
              <Card key={p.id} className="p-5">
                <Link href={`/publications/${p.id}`} className="font-medium hover:text-primary">{p.title}</Link>
                <p className="mt-1 text-sm text-muted-foreground">{p.authors.join(", ") || "Authors not recorded"}{p.journal && ` · ${p.journal}`}{p.publication_year && ` · ${p.publication_year}`}</p>
                {p.abstract && <p className="mt-2 line-clamp-3 text-sm text-foreground/80">{p.abstract}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.publication_type && <Badge>{p.publication_type}</Badge>}{p.doi && <Badge tone="primary">DOI {p.doi}</Badge>}
                  {p.has_original && p.pdf_url && <>
                    <Button size="sm" variant="outline" asChild><Link href={`/publications/${p.id}`}><FileText />Open original</Link></Button>
                    <Button size="sm" variant="ghost" asChild><a href={p.pdf_url} download><Download />Download PDF</a></Button></>}
                  {p.source_url && <Button size="sm" variant="ghost" asChild><a href={p.source_url} target="_blank" rel="noreferrer"><ExternalLink />Source</a></Button>}
                </div>
              </Card>))}</div>
          )}
        </TabsContent>

        <TabsContent value="methodology">
          <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Experimental methodology</CardTitle><Badge>Extracted</Badge></div></CardHeader>
            <CardContent>{inv.methodology ? <div className="whitespace-pre-line text-sm leading-relaxed">{inv.methodology}</div> : <p className="text-sm text-muted-foreground">No methodology description was ingested for this investigation.</p>}</CardContent></Card>
        </TabsContent>

        <TabsContent value="conditions">
          <ConditionsView conditions={conditions} citations={citations} />
        </TabsContent>

        <TabsContent value="findings">
          <FindingsView findings={findings} citations={citations} publications={publications} />
        </TabsContent>

        <TabsContent value="figures">
          <FiguresView figures={figures} publications={publications} />
        </TabsContent>

        <TabsContent value="data">
          {datasets.length === 0 ? <EmptyState title="No numerical datasets" description="Only numerical values extracted from research tables or supplementary material are stored." /> : (
            <div className="space-y-3">{datasets.map((d) => (
              <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div><p className="font-medium">{d.dataset_name}</p><p className="text-sm text-muted-foreground">{d.description}</p>
                  <SourceRef publicationId={d.publication_id} page={d.source_page} table={d.source_table} /></div>
                <div className="flex gap-2"><Button size="sm" asChild><Link href={`/data?dataset=${d.id}`}>Chart</Link></Button>
                  <Button size="sm" variant="outline" asChild><a href={`${API_URL}/api/datasets/${d.id}?format=csv`}><Download />CSV</a></Button></div>
              </Card>))}</div>
          )}
        </TabsContent>

        <TabsContent value="missions" className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Documented mission relevance</CardTitle></CardHeader><CardContent className="space-y-3">
            {data.mission_relevance.length === 0 ? <p className="text-sm text-muted-foreground">No mission-environment relevance is documented. Use <Link className="text-primary hover:underline" href="/missions">Mission Analysis</Link> to compare conditions.</p> :
              data.mission_relevance.map((m) => <div key={m.id} className="rounded-md border p-3 text-sm"><div className="mb-1 flex justify-between"><Badge tone="primary">{titleCase(m.mission_type)}</Badge>{m.relevance_score !== null && <span className="font-mono text-xs">{m.relevance_score}</span>}</div><p>{m.rationale}</p>{m.limitations && <p className="mt-1 text-xs text-muted-foreground">Limitations: {m.limitations}</p>}</div>)}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Fire-safety research links</CardTitle></CardHeader><CardContent className="space-y-3">
            {data.fire_safety.length === 0 ? <p className="text-sm text-muted-foreground">No fire-safety applications are recorded for this investigation.</p> :
              data.fire_safety.map((a, i) => <div key={i} className="rounded-md border p-3 text-sm"><div className="mb-1 flex gap-2"><Badge tone="primary">{titleCase(a.category)}</Badge><Badge tone={a.status === "demonstrated" ? "success" : "warning"}>{a.status === "demonstrated" ? "Demonstrated" : "Potential"}</Badge></div><p>{a.description}</p>{a.limitations && <p className="mt-1 text-xs text-muted-foreground">Limitations: {a.limitations}</p>}<div className="mt-1"><RefChip r={a.ref} citations={citations} /></div></div>)}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
