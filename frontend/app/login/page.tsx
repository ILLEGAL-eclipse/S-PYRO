"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";
import { Notice, PageHeader } from "@/components/common";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const sb = getSupabase();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setBusy(true); setMsg(null);
    const { error, data } = mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg({ tone: "warning", text: error.message });
    if (mode === "up" && !data.session) return setMsg({ tone: "info", text: "Check your email to confirm your account, then sign in." });
    refresh();
    router.push("/");
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={mode === "in" ? "Sign in" : "Create account"} description="Sign in to keep validation history across devices. Administrators can ingest research packages." />
      {!sb && <Notice tone="warning" className="mb-4">Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local.</Notice>}
      <Card><CardHeader><CardTitle>{mode === "in" ? "Welcome back" : "New researcher account"}</CardTitle></CardHeader><CardContent>
        <form onSubmit={submit} className="space-y-3.5">
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="pw">Password</Label><Input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit" className="w-full" disabled={busy || !sb}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</Button>
          <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "No account? Create one" : "Already registered? Sign in"}</button>
        </form></CardContent></Card>
    </div>
  );
}
