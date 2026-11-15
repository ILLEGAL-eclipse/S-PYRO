"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart3, Bot, Database, Flame, GitCompare, LayoutDashboard, LogIn, LogOut, Menu, Orbit, Search, ShieldCheck, ShieldAlert, Telescope, Upload, X, FileText, PanelLeftClose, PanelLeftOpen, Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { AmbientBackground } from "@/components/ambient";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/investigations", label: "Investigation Explorer", icon: Telescope },
  { href: "/missions", label: "Mission Analysis", icon: Orbit },
  { href: "/assistant", label: "AI Research Assistant", icon: Bot },
  { href: "/compare", label: "Investigation Comparison", icon: GitCompare },
  { href: "/data", label: "Scientific Data Explorer", icon: BarChart3 },
  { href: "/fire-safety", label: "Fire Safety Intelligence", icon: Flame },
  { href: "/validation", label: "Research Validation", icon: ShieldCheck },
];

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2" aria-label="S-PYRO home">
      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/60 bg-transparent text-primary"><Flame className="size-4" /></span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block font-display text-[19px] font-semibold tracking-[0.2em]">S-PYRO</span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Combustion research</span>
        </span>
      )}
    </Link>
  );
}

function NavList({ onNavigate, collapsed, onToggle }: { onNavigate?: () => void; collapsed?: boolean; onToggle?: () => void }) {
  const path = usePathname();
  const { me, signOut } = useAuth();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="flex h-full flex-col">
      <div className="px-2 py-5"><Logo collapsed={collapsed} /></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active(href) ? "page" : undefined} title={collapsed ? label : undefined}
            className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all", collapsed && "justify-center px-0",
              active(href) ? "bg-primary/10 font-medium text-primary shadow-[0_0_20px_rgba(255,158,27,0.16)] ring-1 ring-primary/30" : "text-muted-foreground hover:bg-primary/5 hover:text-foreground")}>
            <Icon className="size-4 shrink-0" />{!collapsed && label}
          </Link>
        ))}
        {me?.is_admin && (
          <>
            {!collapsed && <p className="label-caps px-3 pb-1 pt-5">Administration</p>}
            <Link href="/admin/ingest" onClick={onNavigate} title={collapsed ? "Data ingestion" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm", collapsed && "mt-3 justify-center px-0",
              path.startsWith("/admin") ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-primary/5 hover:text-foreground")}>
              <Upload className="size-4 shrink-0" />{!collapsed && "Data ingestion"}
            </Link>
          </>
        )}
      </nav>
      <div className="border-t border-primary/15 p-3">
        <Link href="/preview" onClick={onNavigate} title="Design preview" className={cn("mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-primary/5 hover:text-foreground", collapsed && "justify-center px-0")}>
          <Sparkles className="size-4 shrink-0 text-primary" />{!collapsed && "Design preview (mock session)"}
        </Link>
        {onToggle && (
          <button onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={cn("mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-primary/5 hover:text-foreground", collapsed && "justify-center px-0")}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />Collapse sidebar</>}
          </button>
        )}
        {me?.authenticated ? (
          !collapsed && (
            <div className="flex items-center justify-between gap-2 px-2 text-xs">
              <span className="min-w-0 truncate text-muted-foreground" title={me.email ?? ""}>{me.email}{me.is_admin && <span className="ml-1 text-primary">· admin</span>}</span>
              <button onClick={signOut} aria-label="Sign out" className="rounded p-1 text-muted-foreground hover:text-foreground"><LogOut className="size-4" /></button>
            </div>
          )
        ) : (
          <Link href="/login" onClick={onNavigate} title="Sign in" className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-primary/5 hover:text-foreground", collapsed && "justify-center px-0")}><LogIn className="size-4 shrink-0" />{!collapsed && "Sign in"}</Link>
        )}
        {!collapsed && <p className="mt-2 px-2 text-[11px] leading-snug text-muted-foreground/70">S-PYRO assists researchers. Researchers make the decisions.</p>}
      </div>
    </div>
  );
}

interface SearchResult { investigations: { id: string; code: string; title: string }[]; publications: { id: string; title: string; year: number | null }[] }

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => api<SearchResult>(`/api/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("global-search")?.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input id="global-search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) go(`/investigations?q=${encodeURIComponent(q.trim())}`); if (e.key === "Escape") setOpen(false); }}
        placeholder="Search investigations, publications…  (Ctrl K)" aria-label="Global search"
        className="h-9 w-full rounded-md border border-input bg-background/60 pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] overflow-y-auto rounded-lg border bg-card p-2 shadow-2xl shadow-black/40">
          {!res ? <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p> :
            !res.investigations.length && !res.publications.length ? <p className="px-3 py-2 text-sm text-muted-foreground">No matches in the research database.</p> : (
              <>
                {res.investigations.length > 0 && <p className="label-caps px-3 pb-1 pt-1.5">Investigations</p>}
                {res.investigations.map((i) => (
                  <button key={i.id} onClick={() => go(`/investigations/${i.id}`)} className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/60">
                    <Telescope className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-mono text-xs text-muted-foreground">{i.code}</span><br />{i.title}</span>
                  </button>
                ))}
                {res.publications.length > 0 && <p className="label-caps px-3 pb-1 pt-3">Publications</p>}
                {res.publications.map((p) => (
                  <button key={p.id} onClick={() => go(`/publications/${p.id}`)} className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/60">
                    <FileText className="mt-0.5 size-4 shrink-0 text-primary" /><span>{p.title}{p.year && <span className="text-muted-foreground"> · {p.year}</span>}</span>
                  </button>
                ))}
                <button onClick={() => go(`/investigations?q=${encodeURIComponent(q.trim())}`)} className="mt-1 w-full rounded-md border-t px-3 py-2 text-left text-xs text-primary hover:bg-secondary/60">See all results in Investigation Explorer →</button>
              </>
            )}
        </div>
      )}
    </div>
  );
}

function StatusBanner() {
  const { me } = useAuth();
  if (!me || me.gemini_configured) return null;
  return (
    <div className="border-b border-warning/20 bg-warning/5 px-4 py-1.5 text-center text-xs text-warning">
      <ShieldAlert className="mr-1.5 inline size-3.5" />Gemini is not configured on the backend — AI features (assistant, summaries, free-text validation) are disabled; retrieval and deterministic checks still work.
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("spyro.sidebar") === "1"); } catch { /* ignore */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("spyro.sidebar", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  return (
    <div className="min-h-screen">
      <AmbientBackground />
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden border-r border-primary/15 bg-sidebar/90 backdrop-blur-xl transition-[width] duration-300 lg:block", collapsed ? "w-16" : "w-64")}><NavList collapsed={collapsed} onToggle={toggle} /></aside>
      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-16" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-primary/15 bg-[#050406]/70 px-4 backdrop-blur-xl sm:px-6">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation"><Menu /></Button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-sidebar data-[state=open]:animate-in data-[state=open]:slide-in-from-left" aria-describedby={undefined}>
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <Dialog.Close asChild><Button variant="ghost" size="icon" className="absolute right-2 top-3" aria-label="Close navigation"><X /></Button></Dialog.Close>
                <NavList onNavigate={() => setOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <GlobalSearch />
          <span className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:flex"><Database className="size-3.5 text-primary" />NASA combustion science</span>
        </header>
        <StatusBanner />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
