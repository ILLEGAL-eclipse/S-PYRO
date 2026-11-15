from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from ..config import get_settings
from ..db import get_db, rows
from ..security import User, limiter, optional_user, require_admin
from ..services import gemini_client as G
from ..services.ingest import ingest_package

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/me")
@limiter.limit(get_settings().rate_limit_default)
def me(request: Request, user: User | None = Depends(optional_user)):
    s = get_settings()
    return {"authenticated": bool(user), "is_admin": bool(user and user.is_admin), "email": user.email if user else None,
            "gemini_configured": s.gemini_configured}


@router.post("/admin/ingest")
@limiter.limit(get_settings().rate_limit_admin)
async def ingest(request: Request, files: list[UploadFile] = File(...), dry_run: bool = Form(False),
                 admin: User = Depends(require_admin)):
    s = get_settings()
    if len(files) > 200:
        raise HTTPException(413, "Too many files in one upload.")
    payload: dict[str, bytes] = {}
    total = 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > s.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"Upload exceeds {s.max_upload_mb} MB.")
        payload[(f.filename or "unnamed").split("/")[-1].split("\\")[-1]] = data
    return await asyncio.to_thread(ingest_package, payload, admin.id, dry_run)


@router.post("/admin/embeddings/backfill")
@limiter.limit(get_settings().rate_limit_admin)
def backfill_embeddings(request: Request, limit: int = Query(100, ge=1, le=500), admin: User = Depends(require_admin)):
    """Embed research chunks that have no embedding yet (requires Gemini). Retrieval works without embeddings (keyword only)."""
    db = get_db()
    todo = rows(db.table("research_chunks").select("id,content").is_("embedding", "null").limit(limit).execute())
    done = 0
    for i in range(0, len(todo), 50):
        part = todo[i:i + 50]
        vecs = G.embed_texts([c["content"][:6000] for c in part], "RETRIEVAL_DOCUMENT", admin.id)
        for c, v in zip(part, vecs):
            db.table("research_chunks").update({"embedding": G.pgvec(v)}).eq("id", c["id"]).execute()
            done += 1
    remaining = db.table("research_chunks").select("id", count="exact").is_("embedding", "null").limit(1).execute().count or 0
    return {"embedded": done, "remaining": remaining}


@router.get("/admin/usage")
@limiter.limit(get_settings().rate_limit_admin)
def usage(request: Request, admin: User = Depends(require_admin)):
    r = rows(get_db().table("ai_usage_log").select("endpoint,input_tokens,output_tokens,tool_calls,error,created_at").order(
        "created_at", desc=True).limit(500).execute())
    return {"model": get_settings().gemini_model, "total_input_tokens": sum(x["input_tokens"] for x in r),
            "total_output_tokens": sum(x["output_tokens"] for x in r), "errors": sum(1 for x in r if x["error"]), "recent": r[:50]}


@router.get("/admin/ingestion-reports")
@limiter.limit(get_settings().rate_limit_admin)
def reports(request: Request, admin: User = Depends(require_admin)):
    return {"items": rows(get_db().table("ingestion_reports").select("id,investigation_id,report,created_at").order(
        "created_at", desc=True).limit(20).execute())}
