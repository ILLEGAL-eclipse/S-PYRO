"""Supabase access (service role, backend only)."""
from functools import lru_cache
from typing import Any

from fastapi import HTTPException
from supabase import Client, create_client

from .config import get_settings


@lru_cache
def get_db() -> Client:
    s = get_settings()
    if not s.supabase_url or not s.supabase_service_role_key:
        raise HTTPException(503, "Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def rows(resp: Any) -> list[dict]:
    return list(resp.data or [])


def chunked(seq: list, n: int):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def fetch_all(builder, page: int = 1000) -> list[dict]:
    """Page through a PostgREST query (the API caps a single response at ~1000 rows)."""
    out: list[dict] = []
    i = 0
    while True:
        batch = rows(builder.range(i, i + page - 1).execute())
        out.extend(batch)
        if len(batch) < page:
            return out
        i += page


def signed_url(bucket: str, path: str | None, expires: int | None = None) -> str | None:
    if not path:
        return None
    try:
        res = get_db().storage.from_(bucket).create_signed_url(path, expires or get_settings().signed_url_seconds)
        return res.get("signedURL") or res.get("signedUrl")
    except Exception:
        return None
