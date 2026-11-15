"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "./supabase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function messageFrom(status: number, body: any): string {
  if (body?.detail && typeof body.detail === "string") {
    if (body.errors?.length) return `${body.detail} ${body.errors.map((e: any) => `${e.field}: ${e.message}`).join("; ")}`;
    return body.detail;
  }
  if (body?.detail?.message) return body.detail.message;
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 503) return "The service is not configured yet. See the setup instructions.";
  return `Request failed (${status}).`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()), ...(init.headers as Record<string, string>) };
  let body: BodyInit | undefined = init.body as BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) body = init.form;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, `Cannot reach the S-PYRO API at ${API_URL}. Is the backend running?`);
  }
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, parsed), parsed?.detail);
  return parsed as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Minimal data hook with loading / error state. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) { setData(null); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => { if (my === seq.current) setData(d); })
      .catch((e) => { if (my === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e))); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}


/** POST and consume a server-sent-event stream, calling onEvent for every `data:` JSON payload. */
export async function streamSSE<T = any>(path: string, json: unknown, onEvent: (e: T) => void, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { ...(await authHeaders()), "Content-Type": "application/json", Accept: "text/event-stream" };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(json), signal });
  } catch {
    throw new ApiError(0, `Cannot reach the S-PYRO API at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok || !res.body) {
    let body: any = null;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, messageFrom(res.status, body), body?.detail);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) { try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore malformed frame */ } }
    }
  }
}
