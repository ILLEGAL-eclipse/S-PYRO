"use client";
import Link from "next/link";
import { ArrowRight, BarChart3, Bot, FileText, FlaskConical, GitCompare, Image as ImageIcon, Layers, ShieldCheck, Table2, Telescope, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Loading, Section, StatCard } from "@/components/common";
import { DistributionChart } from "@/components/charts";
import { Constellation } from "@/components/constellation";
import { InvestigationCard } from "@/components/investigation";
import { OpticalHero, Viewport } from "@/components/optics";
import { useApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { InvestigationCard as Inv, Paged } from "@/lib/types";

interface Dash {
  statistics: {
    investigations: number; publications: number; datasets: number; figures: number; categories: number;
    by_category: { name: string; count: number }[]; by_type: { name: string; count: number }[];
    by_phenomenon: { name: string; count: number }[]; by_gravity: { name: string; count: number }[];
  };
  featured: Inv[];
  featured_basis: string;
  recent_investigations: { id: string; investigation_code: string; title: string; research_category: string | null; created_at: string }[];
  recent_publications: { id: string; title: string; publication_year: number | null; journal: string | null }[];
}

const ACTIONS = [
  { href: "/investigations", label: "Explore investigations", icon: Telescope, desc: "Search and filter the catalogue" },
  { href: "/assistant", label: "Ask S-PYRO", icon: Bot, desc: "Cited answers from the database" },
  { href: "/compare", label: "Compare experiments", icon: GitCompare, desc: "Conditions and findings side by side" },
  { href: "/data", label: "Explore datasets", icon: BarChart3, desc: "Chart extracted numerical data" },
  { href: "/validation", label: "Validate research inputs", icon: ShieldCheck, desc: "Check inputs against sources" },
];

export default function Overview() {
  const { data, error, loading, reload } = useApi<Dash>("/api/dashboard/statistics");
  const all = useApi<Paged<Inv>>("/api/investigations?page_size=50&sort=title");
  const { me } = useAuth();
  const s = data?.statistics;
  const empty = s && s.investigations === 0;

  return (
    <>
      <OpticalHero eyebrow="S-PYRO · Explore · Understand · Discover" title={<>Combustion science, <span className="text-chemi">traceable to the source</span></>}>
        S-PYRO organises documented NASA combustion investigations so that researchers can inspect the evidence behind every answer and every flagged discrepancy. It assists; the researcher decides.
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild><Link href="/investigations"><Telescope />Explore investigations</Link></Button>
          <Button asChild variant="outline"><Link href="/assistant"><Bot />Ask S-PYRO</Link></Button>
        </div>
      </OpticalHero>
      {error && <ErrorState error={error} retry={reload} />}
      {loading && <Loading rows={4} />}
      {s && (
        <>
          <div className="stagger mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Investigations" value={s.investigations} icon={<FlaskConical className="size-4" />} />
            <StatCard label="Publications" value={s.publications} icon={<FileText className="size-4" />} />
            <StatCard label="Datasets" value={s.datasets} icon={<Table2 className="size-4" />} />
            <StatCard label="Research categories" value={s.categories} icon={<Layers className="size-4" />} />
            <StatCard label="Figures" value={s.figures} icon={<ImageIcon className="size-4" />} />
          </div>

          {empty ? (
            <EmptyState title="The research database is empty"
              description="No investigations have been ingested yet. An administrator can upload extracted research packages (investigation.json, conditions, findings, datasets, original PDF)."
              action={me?.is_admin ? <Button asChild><Link href="/admin/ingest"><Upload />Open data ingestion</Link></Button> : <Button asChild variant="outline"><Link href="/login">Sign in as administrator</Link></Button>} />
          ) : (
            <>
              <Section title="Research constellation" description="Investigations linked by shared keywords and phenomena. Node colour follows each investigation's documented oxygen level (hotter colour = more oxygen; spherical = microgravity, teardrop = normal gravity).">
                <Viewport label="Network" meta={`${all.data?.items.length ?? 0} investigations`} bodyClassName="p-2 sm:p-4">
                  {all.loading ? <Loading rows={2} /> : <Constellation items={all.data?.items ?? []} />}
                </Viewport>
              </Section>

              <Section title="Quick actions">
                <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {ACTIONS.map(({ href, label, icon: Icon, desc }) => (
                    <Link key={href} href={href} className="card-sweep glass group rounded-xl p-4 transition-transform hover:-translate-y-0.5">
                      <span className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shadow-glow-cyan ring-1 ring-primary/30 transition-colors group-hover:bg-primary/20"><Icon className="size-[18px]" /></span>
                      <p className="flex items-center gap-1 text-sm font-medium">{label}<ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" /></p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                    </Link>
                  ))}
                </div>
              </Section>

              <Section title="Featured research" description={data.featured_basis}>
                {data.featured.length ? (
                  <div className="stagger grid gap-5 md:grid-cols-2 xl:grid-cols-4">{data.featured.map((i) => <InvestigationCard key={i.id} inv={i} />)}</div>
                ) : <p className="text-sm text-muted-foreground">No investigations with publications yet.</p>}
              </Section>

              <Section title="Research distribution" description="Counts computed from stored records.">
                <Card><CardContent className="grid gap-8 pt-5 md:grid-cols-2">
                  <DistributionChart title="Research categories" data={s.by_category} />
                  <DistributionChart title="Gravity conditions" data={s.by_gravity} />
                  <DistributionChart title="Combustion phenomena" data={s.by_phenomenon} />
                  <DistributionChart title="Investigation types" data={s.by_type} />
                </CardContent></Card>
              </Section>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Recently added investigations</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="divide-y divide-primary/10">
                      {data.recent_investigations.map((i) => (
                        <li key={i.id}><Link href={`/investigations/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary">
                          <span className="min-w-0"><span className="font-mono text-xs text-muted-foreground">{i.investigation_code}</span><br /><span className="line-clamp-1">{i.title}</span></span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{new Date(i.created_at).toLocaleDateString()}<ArrowRight className="size-3.5" /></span>
                        </Link></li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Recently added publications</CardTitle></CardHeader>
                  <CardContent>
                    {data.recent_publications.length === 0 ? <p className="text-sm text-muted-foreground">No publications yet.</p> : (
                      <ul className="divide-y divide-primary/10">
                        {data.recent_publications.map((p) => (
                          <li key={p.id}><Link href={`/publications/${p.id}`} className="block py-2.5 text-sm hover:text-primary">
                            <span className="line-clamp-2">{p.title}</span>
                            <span className="mt-0.5 flex gap-2 text-xs text-muted-foreground">{p.publication_year && <Badge>{p.publication_year}</Badge>}{p.journal}</span>
                          </Link></li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
