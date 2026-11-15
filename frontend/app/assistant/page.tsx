"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { History, PanelRight, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ErrorState, Notice } from "@/components/common";
import { AssistantCard, ContextPanel, type ChatMsg, UserBubble } from "@/components/agent-ui";
import { IgnitionBar, OpticalHero } from "@/components/optics";
import { AgentProgress, type LiveStep } from "@/components/agent-progress";
import { streamSSE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LiveState { steps: LiveStep[]; text: string; startedAt: number }
interface Resp { answer: string; citations: Citation[]; tool_trace: NonNullable<ChatMsg["trace"]>; warnings: string[]; usage: Record<string, number> }
interface Session { id: string; title: string; updated: number; msgs: ChatMsg[] }
const KEY = "spyro.assistant.sessions";

const SUGGESTIONS = [
  "Which investigations studied cool flames, and at what pressures?",
  "Summarise the documented smoke-point findings and their conditions.",
  "How do the documented oxygen concentrations compare across investigations?",
  "Explain the term 'smoke point' (general definition).",
];

const uid = () => Math.random().toString(36).slice(2, 10);

export default function AssistantPage() {
  const { me } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sid, setSid] = useState<string>(() => uid());
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [showContext, setShowContext] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { try { setSessions(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { /* ignore */ } }, []);
  useEffect(() => {
    if (!msgs.length) return;
    setSessions((prev) => {
      const next = [{ id: sid, title: msgs[0].content.slice(0, 60), updated: Date.now(), msgs }, ...prev.filter((s) => s.id !== sid)].slice(0, 30);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
      return next;
    });
  }, [msgs, sid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy, live?.steps.length, live?.text.length]);

  const assistantMsgs = msgs.filter((m) => m.role === "assistant");
  const steps = useMemo(() => assistantMsgs.flatMap((m) => m.trace ?? []), [msgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const cites = useMemo(() => [...new Map(assistantMsgs.flatMap((m) => m.citations ?? []).map((c) => [c.label, c])).values()], [msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setLive({ steps: [], text: "", startedAt: Date.now() });
    try {
      let final: Resp | null = null;
      let streamError: string | null = null;
      await streamSSE<any>("/api/assistant/stream", { message, history }, (ev) => {
        if (ev.type === "step") {
          setLive((l) => l && { ...l, steps: l.steps.some((x) => x.id === ev.id) ? l.steps.map((x) => (x.id === ev.id ? { ...x, ...ev } : x)) : [...l.steps, ev] });
        } else if (ev.type === "delta") setLive((l) => l && { ...l, text: l.text + ev.text });
        else if (ev.type === "reset") setLive((l) => l && { ...l, text: "" });
        else if (ev.type === "final") final = ev.response as Resp;
        else if (ev.type === "error") streamError = ev.message;
      });
      if (streamError) throw new Error(streamError);
      if (!final) throw new Error("The assistant ended without an answer. Please try again.");
      const r: Resp = final;
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, citations: r.citations, warnings: r.warnings, trace: r.tool_trace, usage: r.usage }]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); setLive(null); }
  }
  const newSession = () => { setSid(uid()); setMsgs([]); setError(null); };
  const open = (s: Session) => { setSid(s.id); setMsgs(s.msgs); setError(null); };
  const remove = (id: string) => {
    setSessions((prev) => { const n = prev.filter((s) => s.id !== id); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
    if (id === sid) newSession();
  };

  return (
    <div className="flex gap-5">
      {showHistory && (
        <aside className="hidden w-56 shrink-0 lg:block" aria-label="Research sessions">
          <div className="glass sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl p-3">
            <Button size="sm" className="mb-3 w-full" onClick={newSession}><Plus />New session</Button>
            <p className="label-caps mb-1.5 px-1">Research sessions</p>
            {sessions.length === 0 ? <p className="px-1 text-xs text-muted-foreground">Your conversations are saved here, in this browser.</p> : (
              <ul className="space-y-0.5">{sessions.map((s) => (
                <li key={s.id} className="group flex items-center">
                  <button onClick={() => open(s)} className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary/60", s.id === sid && "bg-primary/10 text-primary")}>{s.title}</button>
                  <button onClick={() => remove(s.id)} aria-label="Delete session" className="p-1 text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"><Trash2 className="size-3.5" /></button>
                </li>))}</ul>)}
          </div>
        </aside>
      )}

      <div className="relative min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">AI Research Assistant</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Answers are composed from retrieved database records; every claim links to its source. No engineering recommendations, no judgement of scientific correctness.</p>
          </div>
          <div className="hidden gap-1 lg:flex">
            <Button variant="ghost" size="icon" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory} aria-label="Toggle session history"><History /></Button>
            <Button variant="ghost" size="icon" className="hidden xl:inline-flex" onClick={() => setShowContext((v) => !v)} aria-pressed={showContext} aria-label="Toggle context inspector"><PanelRight /></Button>
          </div>
        </div>
        {me && !me.gemini_configured && <Notice tone="warning" className="mb-4">Gemini is not configured on the backend, so the assistant is unavailable.</Notice>}

        <div className="space-y-5 pb-6">
          {msgs.length === 0 && (
            <>
              <OpticalHero eyebrow="Agent online" title={<>Ask the <span className="text-chemi">combustion record</span></>}>
                Retrieval runs against S-PYRO&apos;s database — investigations, conditions, findings, figures and datasets — and every statement is traceable to a page, table or figure.
              </OpticalHero>
              <div className="grid gap-2 sm:grid-cols-2">{SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="glass rounded-lg px-4 py-3 text-left text-sm transition-all hover:border-primary/50 hover:shadow-glow-cyan">{s}</button>))}</div>
            </>
          )}
          {msgs.map((m, i) => m.role === "user" ? <UserBubble key={i}>{m.content}</UserBubble> : <AssistantCard key={i} m={m} />)}
          {busy && live && <AgentProgress steps={live.steps} text={live.text} startedAt={live.startedAt} />}
          {error && <ErrorState error={error} />}
          <div ref={end} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-4 z-30 mx-auto max-w-3xl">
          <IgnitionBar intensity={input.length / 120} busy={busy}>
            <div className="flex items-end gap-2 p-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={4000} aria-label="Your question" placeholder="Ask about investigations, conditions, findings, publications…"
                className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
              <Button type="submit" size="icon" disabled={busy || input.trim().length < 2} aria-label="Send"><Send /></Button>
            </div>
          </IgnitionBar>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">AI-generated from retrieved records — verify against the cited sources. The researcher decides.</p>
        </form>
      </div>

      {showContext && <div className="hidden w-72 shrink-0 xl:block"><ContextPanel steps={steps} citations={cites} /></div>}
    </div>
  );
}
