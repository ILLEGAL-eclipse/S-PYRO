"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { getSupabase } from "./supabase";

interface Me { authenticated: boolean; is_admin: boolean; email: string | null; gemini_configured: boolean }
interface AuthCtx { me: Me | null; refresh: () => void; signOut: () => Promise<void>; configured: boolean }

const Ctx = createContext<AuthCtx>({ me: null, refresh: () => {}, signOut: async () => {}, configured: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [tick, setTick] = useState(0);
  const sb = getSupabase();

  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(() => setMe({ authenticated: false, is_admin: false, email: null, gemini_configured: false }));
  }, [tick]);

  useEffect(() => {
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange(() => setTick((t) => t + 1));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  return (
    <Ctx.Provider value={{
      me, configured: !!sb, refresh: () => setTick((t) => t + 1),
      signOut: async () => { await sb?.auth.signOut(); setTick((t) => t + 1); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
