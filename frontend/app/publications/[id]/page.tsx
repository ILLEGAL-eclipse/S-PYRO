"use client";
import Link from "next/link";
import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { Download, ExternalLink, FileWarning } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { ErrorState, Loading, Notice, PageHeader, sourceText } from "@/components/common";
import { useApi } from "@/lib/api";
import type { Publication } from "@/lib/types";

function Viewer({ id }: { id: string }) {
  const sp = useSearchParams();
  const page = Number(sp.get("page")) || undefined;
  const loc = sourceText({ page, section: sp.get("section"), figure: sp.get("figure"), table: sp.get("table") });
  const quote = sp.get("quote");
  const { data: p, error, loading, reload } = useApi<Publication>(`/api/publications/${id}`);
  if (loading) return <Loading rows={3} />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!p) return null;

  return (
    <>
      <PageHeader title={p.title}
        description={<>{p.authors.join(", ") || "Authors not recorded"}{p.journal && ` · ${p.journal}`}{p.publication_year && ` · ${p.publication_year}`}</>}
        actions={<div className="flex gap-2">
          {p.investigation && <Button variant="outline" asChild><Link href={`/investigations/${p.investigation.id}`}>Investigation {p.investigation.code}</Link></Button>}
          {p.download_url && <Button variant="outline" asChild><a href={p.download_url} download><Download />Download</a></Button>}
          {p.source_url && <Button variant="ghost" asChild><a href={p.source_url} target="_blank" rel="noreferrer"><ExternalLink />Source</a></Button>}
        </div>} />
      {(loc || quote) && (
        <Notice className="mb-4">
          <p><span className="font-medium">Cited location:</span> {loc || "not specified"}{p.has_original && page ? ` — the PDF below is opened at page ${page}.` : ""}</p>
          {quote && <p className="mt-1 text-muted-foreground">“{quote}”</p>}
        </Notice>
      )}
      {p.has_original && p.pdf_url ? (
        <Card className="overflow-hidden">
          <iframe key={`${p.pdf_url}-${page}`} title={p.title} src={`${p.pdf_url}#page=${page ?? 1}`} className="h-[78vh] w-full bg-white" />
        </Card>
      ) : (
        <Card className="flex items-start gap-3 p-5 text-sm"><FileWarning className="mt-0.5 size-5 text-warning" />
          <div><p className="font-medium">The original document has not been stored in S-PYRO.</p>
            <p className="mt-1 text-muted-foreground">{p.abstract ?? "No abstract recorded."}</p>
            <div className="mt-2 flex gap-2">{p.doi && <Badge tone="primary">DOI {p.doi}</Badge>}</div></div></Card>
      )}
    </>
  );
}

export default function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<Loading />}><Viewer id={id} /></Suspense>;
}
