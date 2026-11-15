"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, GitCompare, SlidersHorizontal, X } from "lucide-react";
import { Button, Input, Label, Select, Card } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Loading, PageHeader } from "@/components/common";
import { InvestigationCard } from "@/components/investigation";
import { qs, useApi } from "@/lib/api";
import type { InvestigationCard as Inv, Paged } from "@/lib/types";

interface Facets { categories: string[]; phenomena: string[]; fuels: string[]; gravity_classes: string[] }
const KEYS = ["q", "category", "phenomenon", "gravity", "fuel", "material", "o2_min", "o2_max", "pressure_min", "pressure_max", "temp_min", "temp_max", "year_min", "year_max", "sort", "page"] as const;
const COMPARE_KEY = "spyro.compare";

function Explorer() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [advanced, setAdvanced] = useState(false);
  const [text, setText] = useState(sp.get("q") ?? "");
  const [picked, setPicked] = useState<{ id: string; code: string; title: string }[]>([]);
  const facets = useApi<Facets>("/api/investigations/facets");

  const params = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""])), [sp]);
  const apiPath = `/api/investigations${qs({ ...params, page_size: 12 })}`;
  const { data, error, loading, reload } = useApi<Paged<Inv>>(apiPath);

  useEffect(() => { try { setPicked(JSON.parse(localStorage.getItem(COMPARE_KEY) || "[]")); } catch { /* ignore */ } }, []);
  useEffect(() => { setText(sp.get("q") ?? ""); }, [sp]);
  useEffect(() => { if (KEYS.slice(4, 14).some((k) => sp.get(k))) setAdvanced(true); }, [sp]);

  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (!("page" in patch)) n.delete("page");
    router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false });
  };
  const toggle = (i: Inv) => {
    const next = picked.some((p) => p.id === i.id) ? picked.filter((p) => p.id !== i.id) : [...picked, { id: i.id, code: i.investigation_code, title: i.title }].slice(0, 6);
    setPicked(next);
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const active = KEYS.filter((k) => !["page", "sort"].includes(k) && sp.get(k));
  const page = Number(params.page || 1);

  const num = (k: string, label: string, ph?: string) => (
    <div><Label htmlFor={k}>{label}</Label>
      <Input id={k} type="number" step="any" placeholder={ph} defaultValue={params[k as keyof typeof params]} key={`${k}-${params[k as keyof typeof params]}`}
        onBlur={(e) => e.target.value !== params[k as keyof typeof params] && set({ [k]: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && set({ [k]: (e.target as HTMLInputElement).value })} /></div>
  );

  return (
    <>
      <PageHeader title="Investigation Explorer" description="A searchable catalogue of NASA combustion science investigations. Filters use the documented, unit-normalised experimental conditions (oxygen in %, pressure in kPa, temperature in K)." />
      <Card className="mb-6 p-4">
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
          <Input className="min-w-[14rem] flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, topic, phenomenon, material, keyword…" aria-label="Search investigations" />
          <Select className="w-44" value={params.sort || "relevance"} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
            <option value="relevance">Sort: relevance</option><option value="title">Sort: title A–Z</option><option value="year">Sort: newest publication</option><option value="recent">Sort: recently added</option>
          </Select>
          <Button type="submit">Search</Button>
          <Button type="button" variant="outline" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}><SlidersHorizontal />Filters{active.length > 0 && ` (${active.length})`}</Button>
        </form>
        {advanced && (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label htmlFor="category">Research category</Label>
              <Select id="category" value={params.category} onChange={(e) => set({ category: e.target.value })}><option value="">Any</option>{facets.data?.categories.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><Label htmlFor="phenomenon">Combustion phenomenon</Label>
              <Select id="phenomenon" value={params.phenomenon} onChange={(e) => set({ phenomenon: e.target.value })}><option value="">Any</option>{facets.data?.phenomena.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><Label htmlFor="gravity">Gravity conditions</Label>
              <Select id="gravity" value={params.gravity} onChange={(e) => set({ gravity: e.target.value })}><option value="">Any</option>{(facets.data?.gravity_classes ?? ["microgravity", "partial gravity", "normal gravity", "hypergravity"]).map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><Label htmlFor="fuel">Fuel type</Label>
              <Input id="fuel" list="fuels" defaultValue={params.fuel} key={`fuel-${params.fuel}`} placeholder="e.g. methane" onBlur={(e) => e.target.value !== params.fuel && set({ fuel: e.target.value })} />
              <datalist id="fuels">{facets.data?.fuels.map((f) => <option key={f} value={f} />)}</datalist></div>
            <div><Label htmlFor="material">Material composition</Label>
              <Input id="material" defaultValue={params.material} key={`mat-${params.material}`} placeholder="e.g. PMMA" onBlur={(e) => e.target.value !== params.material && set({ material: e.target.value })} /></div>
            {num("o2_min", "Oxygen min (%)", "0")}{num("o2_max", "Oxygen max (%)", "100")}
            {num("pressure_min", "Pressure min (kPa)")}{num("pressure_max", "Pressure max (kPa)")}
            {num("temp_min", "Temperature min (K)")}{num("temp_max", "Temperature max (K)")}
            {num("year_min", "Publication year from")}{num("year_max", "Publication year to")}
            <div className="flex items-end"><Button variant="ghost" onClick={() => { setText(""); router.replace(path); }}><X />Clear all</Button></div>
          </div>
        )}
      </Card>

      {error && <ErrorState error={error} retry={reload} />}
      {loading && !data && <Loading rows={4} />}
      {data && (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{data.total} investigation{data.total === 1 ? "" : "s"}{active.length ? " match your filters" : ""}</p>
          {data.items.length === 0 ? (
            <EmptyState title="No investigations found" description={active.length ? "Try removing a filter. Filters only match investigations with documented values for that condition." : "The database has no investigations yet."}
              action={active.length ? <Button variant="outline" onClick={() => { setText(""); router.replace(path); }}>Clear filters</Button> : undefined} />
          ) : (
            <div className={`stagger grid gap-5 md:grid-cols-2 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
              {data.items.map((i) => <InvestigationCard key={i.id} inv={i} selected={picked.some((p) => p.id === i.id)} onToggle={() => toggle(i)} />)}
            </div>
          )}
          {(data.pages ?? 1) > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft />Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {data.pages}</span>
              <Button variant="outline" size="sm" disabled={page >= (data.pages ?? 1)} onClick={() => set({ page: String(page + 1) })}>Next<ChevronRight /></Button>
            </nav>
          )}
        </>
      )}
      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-2xl shadow-black/50 lg:left-64">
          <span className="text-sm">{picked.length} selected</span>
          <Button size="sm" asChild disabled={picked.length < 2}><Link href="/compare"><GitCompare />Compare</Link></Button>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setPicked([]); try { localStorage.removeItem(COMPARE_KEY); } catch { /* ignore */ } }}>Clear</button>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading rows={4} />}><Explorer /></Suspense>;
}
