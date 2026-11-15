"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Select } from "@/components/ui/primitives";
import { EmptyState, ErrorState, EvidenceBadge, Loading, Notice, PageHeader, RefChip, SourceRef } from "@/components/common";
import { qs, useApi } from "@/lib/api";
import type { Citations, FireApp } from "@/lib/types";
import { titleCase } from "@/lib/utils";

interface Resp { categories: { category: string; applications: FireApp[]; demonstrated: number; potential: number }[]; notice: string; citations: Citations }

export default function FireSafetyPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<Resp>(`/api/fire-safety${qs({ status })}`);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Fire Safety Intelligence" description="Connects combustion research with fire-safety research areas. Each entry shows the evidence documented in the source; S-PYRO does not recommend engineering solutions."
        actions={<Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by evidence status"><option value="">All evidence</option><option value="demonstrated">Demonstrated only</option><option value="potential">Potential only</option></Select>} />
      <Notice className="mb-6"><strong>Demonstrated</strong> = the application is documented in the cited source. <strong>Potential</strong> = suggested or plausible but not demonstrated by the source. Neither is an engineering recommendation.</Notice>
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !data && <Loading rows={4} />}
      {data && (data.categories.every((c) => c.applications.length === 0) && !status ? (
        <EmptyState title="No fire-safety links recorded yet" description="Fire-safety applications are ingested from fire_safety_applications.json packages. None are stored, so S-PYRO does not display any." />
      ) : (
        <div className="space-y-3">
          {data.categories.map((c) => (
            <Card key={c.category}>
              <button className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={open === c.category} onClick={() => setOpen(open === c.category ? null : c.category)}>
                <span className="font-medium">{titleCase(c.category)}</span>
                <span className="flex items-center gap-2"><Badge tone="success">{c.demonstrated} demonstrated</Badge><Badge tone="warning">{c.potential} potential</Badge></span>
              </button>
              {open === c.category && (
                <div className="space-y-3 border-t p-4">
                  {c.applications.length === 0 && <p className="text-sm text-muted-foreground">No investigations are linked to this area in the database.</p>}
                  {c.applications.map((a, i) => (
                    <div key={i} className="rounded-md border p-4 text-sm">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone={a.status === "demonstrated" ? "success" : "warning"}>{a.status === "demonstrated" ? "Demonstrated research application" : "Potential application"}</Badge>
                        {a.evidence_type && <EvidenceBadge type={a.evidence_type} />}
                      </div>
                      <p>{a.description}</p>
                      {a.supporting_finding && <p className="mt-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">Supporting finding: {a.supporting_finding.description}</p>}
                      {a.limitations ? <p className="mt-2 text-xs"><span className="label-caps">Research limitations </span><br />{a.limitations}</p> : <p className="mt-2 text-xs text-muted-foreground">No limitations recorded.</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <Link className="text-primary hover:underline" href={`/investigations/${a.investigation.id}`}>{a.investigation.code} — {a.investigation.title}</Link>
                        <RefChip r={a.ref} citations={data.citations} />
                        {a.publication && <SourceRef publicationId={a.publication.id} title={a.publication.title} page={data.citations[a.ref]?.page} section={data.citations[a.ref]?.section} />}
                      </div>
                    </div>))}
                </div>)}
            </Card>))}
        </div>
      ))}
    </>
  );
}
