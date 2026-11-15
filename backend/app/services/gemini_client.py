"""Thin Gemini wrapper. The API key lives only in backend environment variables."""
import json
import logging
import math
from functools import lru_cache

from fastapi import HTTPException

from ..config import get_settings
from ..db import get_db

log = logging.getLogger("spyro.gemini")


@lru_cache
def get_client():
    s = get_settings()
    if not s.gemini_configured:
        raise HTTPException(503, "Gemini is not configured (set GEMINI_API_KEY and GEMINI_MODEL on the backend).")
    from google import genai
    return genai.Client(api_key=s.gemini_api_key)


def log_usage(endpoint: str, input_tokens: int = 0, output_tokens: int = 0, tool_calls: int = 0,
              error: str | None = None, user_id: str | None = None) -> None:
    s = get_settings()
    try:
        get_db().table("ai_usage_log").insert({
            "user_id": user_id, "endpoint": endpoint, "model": s.gemini_model, "input_tokens": input_tokens,
            "output_tokens": output_tokens, "tool_calls": tool_calls, "error": (error or None) and error[:500],
        }).execute()
    except Exception as e:  # logging must never break a request
        log.warning("usage log failed: %s", type(e).__name__)
    log.info("gemini endpoint=%s in=%s out=%s tools=%s err=%s", endpoint, input_tokens, output_tokens, tool_calls, bool(error))


def usage_of(resp) -> tuple[int, int]:
    u = getattr(resp, "usage_metadata", None)
    if not u:
        return 0, 0
    return (getattr(u, "prompt_token_count", 0) or 0), (getattr(u, "candidates_token_count", 0) or 0)


def _normalise(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed_texts(texts: list[str], task: str = "RETRIEVAL_DOCUMENT", user_id: str | None = None) -> list[list[float]]:
    from google.genai import types
    s = get_settings()
    client = get_client()
    try:
        resp = client.models.embed_content(
            model=s.gemini_embedding_model, contents=texts,
            config=types.EmbedContentConfig(task_type=task, output_dimensionality=s.embedding_dim))
    except Exception as e:
        log_usage("embed", error=type(e).__name__, user_id=user_id)
        raise HTTPException(502, "Embedding service error.")
    log_usage("embed", input_tokens=sum(len(t) for t in texts) // 4, user_id=user_id)
    return [_normalise(list(e.values)) for e in resp.embeddings]


def pgvec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in v) + "]"


def embed_query(text: str) -> str | None:
    """pgvector literal for the query, or None when Gemini is unavailable (semantic search is optional)."""
    if not get_settings().gemini_configured:
        return None
    try:
        return pgvec(embed_texts([text], "RETRIEVAL_QUERY")[0])
    except HTTPException:
        return None


def generate_json(prompt: str, system: str, schema: dict, endpoint: str, user_id: str | None = None,
                  max_output_tokens: int = 2048) -> dict:
    """Single structured call (no tools)."""
    from google.genai import types
    s = get_settings()
    client = get_client()
    try:
        resp = client.models.generate_content(
            model=s.gemini_model, contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system, temperature=0.0, max_output_tokens=max_output_tokens,
                response_mime_type="application/json", response_json_schema=schema))
    except Exception as e:
        log_usage(endpoint, error=f"{type(e).__name__}: {str(e)[:200]}", user_id=user_id)
        raise HTTPException(502, "AI service error.")
    i, o = usage_of(resp)
    log_usage(endpoint, i, o, user_id=user_id)
    try:
        return json.loads(resp.text)
    except Exception:
        raise HTTPException(502, "AI service returned an unreadable response.")
