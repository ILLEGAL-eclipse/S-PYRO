from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from ..config import get_settings
from ..db import get_db, rows
from ..schemas import IssueUpdate
from ..security import User, limiter, optional_user
from ..services import validation as V
from ..services.retrieval import _uuid

router = APIRouter(prefix="/api/validation", tags=["validation"])
InputType = Literal["parameters", "measurements", "observations", "hypothesis", "conclusion", "methodology", "notes", "csv", "json", "document"]


@router.post("/check")
@limiter.limit(get_settings().rate_limit_ai)
async def check(request: Request, input_type: InputType = Form(...), content: str = Form(default=""),
                investigation: str | None = Form(default=None), file: UploadFile | None = File(default=None),
                user: User | None = Depends(optional_user)):
    """Compare researcher input with database sources. Accepts pasted text/CSV/JSON or an uploaded file (.csv .json .txt .md .pdf)."""
    s = get_settings()
    data = None
    name = None
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > s.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"File exceeds {s.max_upload_mb} MB.")
        name = file.filename
        low = name.lower()
        if low.endswith(".pdf"):
            content = content or ""
        else:
            try:
                content = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                raise HTTPException(422, "Uploaded file must be UTF-8 text, CSV, JSON or PDF.")
            if low.endswith(".csv"):
                input_type = "csv"
            elif low.endswith(".json"):
                input_type = "json"
    if not content.strip() and not (data and name and name.lower().endswith(".pdf")):
        raise HTTPException(422, "Provide input text or upload a file.")
    if len(content) > 200_000:
        raise HTTPException(413, "Input is too large (200,000 characters max).")
    import asyncio
    return await asyncio.to_thread(V.run_validation, input_type=input_type, content=content, investigation_ref=(investigation or None),
                                   user_id=user.id if user else None, filename=name, file_bytes=data if name and name.lower().endswith(".pdf") else None)


@router.get("")
@limiter.limit(get_settings().rate_limit_default)
def history(request: Request, ids: str | None = Query(default=None, description="Comma-separated session ids (anonymous history)"),
            user: User | None = Depends(optional_user)):
    db = get_db()
    q = db.table("validation_sessions").select("id,input_type,status,context,created_at").order("created_at", desc=True).limit(50)
    if user:
        q = q.eq("user_id", user.id)
    elif ids:
        id_list = [i for i in ids.split(",") if _uuid(i)][:50]
        q = q.in_("id", id_list).is_("user_id", "null")
    else:
        return {"items": []}
    return {"items": rows(q.execute())}


@router.get("/{session_id}")
@limiter.limit(get_settings().rate_limit_default)
def get_session(request: Request, session_id: str, user: User | None = Depends(optional_user)):
    if not _uuid(session_id):
        raise HTTPException(404, "Validation session not found.")
    return V.get_session(session_id, user.id if user else None)


@router.patch("/issues/{issue_id}")
@limiter.limit(get_settings().rate_limit_default)
def update_issue(request: Request, issue_id: str, body: IssueUpdate, user: User | None = Depends(optional_user)):
    """Only the review status and a note can change; the comparison itself and the original input are immutable."""
    if not _uuid(issue_id):
        raise HTTPException(404, "Issue not found.")
    db = get_db()
    r = rows(db.table("validation_issues").select("id,session_id").eq("id", issue_id).execute())
    if not r:
        raise HTTPException(404, "Issue not found.")
    sess = rows(db.table("validation_sessions").select("user_id").eq("id", r[0]["session_id"]).execute())[0]
    if sess["user_id"] and (not user or sess["user_id"] != user.id):
        raise HTTPException(403, "This issue belongs to another user.")
    patch = {"status": body.status}
    if body.researcher_note is not None:
        patch["researcher_note"] = body.researcher_note
    return rows(db.table("validation_issues").update(patch).eq("id", issue_id).execute())[0]
