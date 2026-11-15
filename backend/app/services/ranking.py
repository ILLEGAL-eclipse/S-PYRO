"""Evidence-based, explainable relevance ranking (mission analysis + rank_investigations tool).

Scores are research-DISCOVERY aids: they measure similarity between a requested environment and the
conditions documented in the database. They are not engineering or safety ratings.
"""
from __future__ import annotations

import math
import re

from pydantic import BaseModel, Field, model_validator

from ..db import fetch_all, get_db, rows
from .gemini_client import embed_query
from .refs import RefRegistry
from .retrieval import _cap, cite
from .units import gravity_class

WEIGHTS = {"gravity": 3.0, "oxygen_concentration": 3.0, "pressure": 2.0, "temperature": 1.0}
LABELS = {"gravity": "Gravity", "oxygen_concentration": "Oxygen concentration", "pressure": "Pressure", "temperature": "Temperature"}
DISCLAIMER = ("Relevance scores are research discovery aids based on similarity between the requested environment and "
              "documented experimental conditions. They are not certified engineering or fire-safety ratings and do not show "
              "that any solution is effective.")


class RankArgs(BaseModel):
    gravity_g: float | None = Field(default=None, ge=0, le=100, description="Gravity in g")
    oxygen_percent: float | None = Field(default=None, ge=0, le=100)
    pressure_kpa: float | None = Field(default=None, gt=0)
    temperature_k: float | None = Field(default=None, gt=0)
    objective: str | None = Field(default=None, max_length=1000, description="Free-text research objective / topic")
    mission_type: str | None = Field(default=None, max_length=40)
    limit: int = Field(default=10, ge=1, le=25)

    @model_validator(mode="after")
    def need_criteria(self):
        if all(v is None for v in (self.gravity_g, self.oxygen_percent, self.pressure_kpa, self.temperature_k, self.objective)):
            raise ValueError("Provide at least one ranking criterion.")
        return self


def _sim(key: str, req: float, src: float) -> float:
    if key == "gravity":
        d = abs(math.log10(max(req, 1e-6)) - math.log10(max(src, 1e-6)))
        return max(0.0, 1 - d / 3)
    if key == "oxygen_concentration":
        return max(0.0, 1 - abs(req - src) / 10)
    if key == "pressure":
        return max(0.0, 1 - abs(math.log(req / src)) / math.log(4)) if src > 0 else 0.0
    if key == "temperature":
        return max(0.0, 1 - abs(req - src) / 150)
    return 0.0


def _fmt(x: float) -> str:
    return f"{x:.4g}"


def _requested(a: RankArgs) -> dict[str, float]:
    return {k: v for k, v in (("gravity", a.gravity_g), ("oxygen_concentration", a.oxygen_percent),
                              ("pressure", a.pressure_kpa), ("temperature", a.temperature_k)) if v is not None}


def rank_core(a: RankArgs, reg: RefRegistry) -> dict:
    db = get_db()
    req = _requested(a)
    limit = min(a.limit, 25)
    conds: list[dict] = []
    if req:
        conds = fetch_all(db.table("experimental_conditions").select(
            "investigation_id,publication_id,parameter,parameter_key,value,unit,normalized_value,normalized_unit,value_class,context,"
            "source_page,source_section,source_table,source_figure").in_("parameter_key", list(req)))
    by_inv: dict[str, list[dict]] = {}
    for c in conds:
        by_inv.setdefault(c["investigation_id"], []).append(c)

    # text relevance (hybrid retrieval over original research text + investigation keyword search)
    text_scores: dict[str, float] = {}
    if a.objective:
        hits = rows(db.rpc("hybrid_search_chunks", {"q": a.objective, "q_emb": embed_query(a.objective), "inv_ids": None,
                                                    "pub_ids": None, "match_count": 60}).execute())
        for h in hits:
            if h["evidence_layer"] != "ai_interpretation":
                text_scores[h["investigation_id"]] = max(text_scores.get(h["investigation_id"], 0), h["score"])
        mx = max(text_scores.values(), default=0)
        text_scores = {k: v / mx for k, v in text_scores.items()} if mx else {}
        for r in rows(db.rpc("filter_investigations", {"q": a.objective, "lim": 50}).execute()):
            text_scores[r["id"]] = max(text_scores.get(r["id"], 0), 0.5)

    candidates = set(by_inv) | set(text_scores)
    citations = lambda: {k: v.model_dump() for k, v in reg.all().items()}  # noqa: E731
    if not candidates:
        return {"disclaimer": DISCLAIMER, "results": [], "citations": citations()}
    invs = {i["id"]: i for i in rows(db.table("investigations").select(
        "id,investigation_code,title,research_category,combustion_phenomena,metadata").in_("id", list(candidates)).execute())}
    pub_rows = rows(db.table("publications").select("id,investigation_id,title,publication_year,doi").in_(
        "investigation_id", list(invs)).execute())
    pubs_by_inv: dict[str, list[dict]] = {}
    for p in pub_rows:
        pubs_by_inv.setdefault(p["investigation_id"], []).append(p)
    pub_by_id = {p["id"]: p for p in pub_rows}

    wsum = sum(WEIGHTS[k] for k in req)
    scored = []
    for iid, inv in invs.items():
        breakdown, total = [], 0.0
        for key, rv in req.items():
            cs = [c for c in by_inv.get(iid, []) if c["parameter_key"] == key]
            best, best_sim, class_only = None, 0.0, False
            for c in cs:
                if c["normalized_value"] is not None:
                    s, co = _sim(key, rv, c["normalized_value"]), False
                elif key == "gravity" and c["value_class"] and c["value_class"] == gravity_class(rv):
                    s, co = 0.8, True
                else:
                    continue
                if best is None or s > best_sim:
                    best, best_sim, class_only = c, s, co
            if best is None:
                breakdown.append({"parameter": key, "label": LABELS[key], "requested": rv, "documented": None, "similarity": 0.0})
                continue
            total += WEIGHTS[key] * best_sim
            pub = pub_by_id.get(best["publication_id"])
            breakdown.append({
                "parameter": key, "label": LABELS[key], "requested": rv, "similarity": round(best_sim, 3),
                "documented": {"value": best["value"], "unit": best["unit"], "normalized_value": best["normalized_value"],
                               "normalized_unit": best["normalized_unit"], "context": best["context"],
                               "class_level_match_only": class_only},
                "ref": cite(reg, "condition", inv, pub, page=best["source_page"], section=best["source_section"],
                            table=best["source_table"], figure=best["source_figure"]),
            })
        p_score = total / wsum if wsum else None
        t_score = text_scores.get(iid)
        if p_score is not None and t_score is not None:
            final = 0.7 * p_score + 0.3 * t_score
        else:
            final = p_score if p_score is not None else (t_score or 0.0)
        if final > 0:
            scored.append((final, p_score, t_score, inv, breakdown))
    scored.sort(key=lambda x: x[0], reverse=True)
    scored = scored[:limit]

    top_ids = [s[3]["id"] for s in scored]
    findings = rows(db.table("scientific_findings").select("*").in_("investigation_id", top_ids).limit(1000).execute()) if top_ids else []
    mission = rows(db.table("mission_relevance").select("*").in_("investigation_id", top_ids).execute()) if top_ids else []
    words = set(re.findall(r"[a-z0-9]{4,}", (a.objective or "").lower()))

    results = []
    for final, p_score, t_score, inv, breakdown in scored:
        fs = [f for f in findings if f["investigation_id"] == inv["id"]]
        fs.sort(key=lambda f: (-len(words & set(re.findall(r"[a-z0-9]{4,}", f["description"].lower()))),
                               f["evidence_type"] != "experimental_observation"))
        supporting = [{
            "description": f["description"], "evidence_type": f["evidence_type"],
            "ref": cite(reg, "finding", inv, pub_by_id.get(f["publication_id"]), page=f["source_page"], section=f["source_section"],
                        figure=f["source_figure"], table=f["source_table"], quote=f["description"])} for f in fs[:3]]
        reasons, diffs, limits = [], [], []
        for b in breakdown:
            if b["documented"] is None:
                limits.append(f"No documented {b['label'].lower()} is stored for this investigation, so it could not be compared.")
                continue
            d = b["documented"]
            txt = f"{b['label']}: requested {_fmt(b['requested'])}; documented {d['value']} {d['unit'] or ''}".strip()
            if d["class_level_match_only"]:
                txt += " (matched at gravity-class level only; no numeric value documented)"
            if d.get("context"):
                txt += f" [{d['context']}]"
            (reasons if b["similarity"] >= 0.8 else diffs).append(txt)
        if t_score:
            reasons.append("Research text matches the stated objective (keyword/semantic retrieval).")
        limits.extend((inv.get("metadata") or {}).get("limitations") or [])
        docs = [{"mission_type": m["mission_type"], "relevance_score": m["relevance_score"], "rationale": m["rationale"],
                 "limitations": m["limitations"]} for m in mission if m["investigation_id"] == inv["id"]
                and (not a.mission_type or m["mission_type"] == a.mission_type)]
        results.append({
            "investigation": {"id": inv["id"], "code": inv["investigation_code"], "title": inv["title"],
                              "research_category": inv["research_category"]},
            "ref": cite(reg, "investigation", inv, None),
            "relevance_score": round(final, 3),
            "score_components": {"environment_similarity": None if p_score is None else round(p_score, 3),
                                 "objective_text_match": None if t_score is None else round(t_score, 3)},
            "breakdown": breakdown, "reasons": reasons, "experimental_differences": diffs, "limitations": limits,
            "supporting_findings": supporting,
            "publications": [{"id": p["id"], "title": p["title"], "year": p["publication_year"],
                              "ref": cite(reg, "publication", inv, p)} for p in pubs_by_inv.get(inv["id"], [])],
            "documented_mission_relevance": docs,
        })
    return {"disclaimer": DISCLAIMER, "scoring_method": (
        "Environment similarity per parameter (gravity: log-scale distance; oxygen: percentage-point distance over 10; pressure: log-ratio "
        "over 4x; temperature: distance over 150 K), weighted gravity 3, oxygen 3, pressure 2, temperature 1; missing documentation scores 0. "
        "With an objective, the final score is 0.7 x environment + 0.3 x text match."), "results": results}


def rank_investigations(a: RankArgs, reg: RefRegistry) -> dict:
    a.limit = _cap(a.limit)
    out = rank_core(a, reg)
    for r in out["results"]:   # keep tool output compact for the model
        r.pop("publications", None)
    return out
