"""AI assistant, comparison, mission analysis."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..config import get_settings
from ..schemas import AssistantQuery, AssistantResponse, CompareRequest, MissionEnvironment
from ..security import User, limiter, optional_user
from ..services import assistant as A
from ..services.compare import CompareArgs, compare_core
from ..services.ranking import RankArgs, rank_core
from ..services.refs import RefRegistry
from ..services.retrieval import ToolError

router = APIRouter(prefix="/api", tags=["intelligence"])
_ai = get_settings().rate_limit_ai
_def = get_settings().rate_limit_default


@router.post("/assistant/query", response_model=AssistantResponse)
@limiter.limit(_ai)
def assistant_query(request: Request, body: AssistantQuery, user: User | None = Depends(optional_user)):
    return A.run_assistant(body, user.id if user else None)


@router.post("/assistant/stream")
@limiter.limit(_ai)
def assistant_stream(request: Request, body: AssistantQuery, user: User | None = Depends(optional_user)):
    """Server-sent events: live retrieval steps, streamed answer text, then the final validated response."""
    uid = user.id if user else None

    def gen():
        try:
            for ev in A.iter_assistant(body, uid):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except HTTPException as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e.detail)})}\n\n"
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': 'The assistant failed. Please try again.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/assistant/compare")
@limiter.limit(_ai)
def assistant_compare(request: Request, body: CompareRequest, user: User | None = Depends(optional_user)):
    reg = RefRegistry()
    try:
        data = compare_core(CompareArgs(investigation_ids=body.investigation_ids), reg)
    except ToolError as e:
        raise HTTPException(404, str(e))
    out = {**data, "summary": None, "summary_warnings": []}
    if body.generate_summary:
        if not get_settings().gemini_configured:
            out["summary_warnings"].append("Gemini is not configured; the structured comparison is shown without an AI summary.")
        else:
            text, cites, warns = A.summarise_comparison(data, reg, user.id if user else None)
            out["summary"] = {"layer": "ai_interpretation", "text": text}
            out["summary_warnings"] = warns
    out["citations"] = {k: v.model_dump() for k, v in reg.all().items()}
    return out


MISSION_PRESETS = {
    "iss": {"label": "International Space Station", "gravity_g": 1e-6, "note": "Nominal microgravity; atmosphere fields left for you to confirm."},
    "spacecraft": {"label": "Spacecraft", "gravity_g": 1e-6, "note": "Nominal microgravity."},
    "lunar_habitat": {"label": "Lunar habitat", "gravity_g": 0.166, "note": "Lunar surface gravity ≈ 0.166 g."},
    "martian_habitat": {"label": "Martian habitat", "gravity_g": 0.378, "note": "Martian surface gravity ≈ 0.378 g."},
    "pressurised_rover": {"label": "Pressurised rover", "gravity_g": None, "note": "Gravity depends on the body; enter it."},
    "custom": {"label": "Custom environment", "gravity_g": None, "note": ""},
}


@router.get("/mission/presets")
@limiter.limit(_def)
def mission_presets(request: Request):
    return {"presets": MISSION_PRESETS,
            "notice": "Presets only pre-fill physical gravity; they are editable inputs, not database records. Atmospheric values are never assumed."}


@router.post("/mission/analyse")
@limiter.limit(_def)
def mission_analyse(request: Request, body: MissionEnvironment):
    reg = RefRegistry()
    args = RankArgs(gravity_g=body.gravity_g, oxygen_percent=body.oxygen_percent, pressure_kpa=body.pressure_kpa,
                    temperature_k=body.temperature_k,
                    objective=" ".join(x for x in (body.objective, body.atmosphere_composition) if x) or None,
                    mission_type=body.mission_type, limit=body.limit)
    out = rank_core(args, reg)
    out["environment"] = body.model_dump()
    out["citations"] = {k: v.model_dump() for k, v in reg.all().items()}
    return out
