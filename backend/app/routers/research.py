"""Read endpoints: investigations, publications, datasets, fire safety, dashboard, search."""
from __future__ import annotations

import csv
import io
from collections import Counter
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from ..config import get_settings
from ..db import fetch_all, get_db, rows, signed_url
from ..security import limiter
from ..services import retrieval as R
from ..services.refs import RefRegistry

router = APIRouter(prefix="/api", tags=["research"])
_lim = get_settings().rate_limit_default


def _tool(fn):
    try:
        return fn()
    except R.ToolError as e:
        raise HTTPException(404, str(e))


# ------------------------------------------------------------------ investigations
@router.get("/investigations")
@limiter.limit(_lim)
def list_investigations(
    request: Request, q: str | None = None, category: str | None = None, phenomenon: str | None = None,
    gravity: Literal["microgravity", "partial gravity", "normal gravity", "hypergravity"] | None = None,
    fuel: str | None = None, material: str | None = None,
    o2_min: float | None = Query(None, ge=0, le=100), o2_max: float | None = Query(None, ge=0, le=100),
    pressure_min: float | None = Query(None, ge=0), pressure_max: float | None = Query(None, ge=0),
    temp_min: float | None = Query(None, ge=0), temp_max: float | None = Query(None, ge=0),
    year_min: int | None = Query(None, ge=1900, le=2100), year_max: int | None = Query(None, ge=1900, le=2100),
    sort: Literal["relevance", "title", "year", "recent"] = "relevance",
    page: int = Query(1, ge=1, le=10000), page_size: int = Query(12, ge=1, le=50),
):
    """Filters: oxygen in %, pressure in kPa, temperature in K (values are matched on normalised documented conditions)."""
    args = R.SearchInvestigationsArgs(
        query=q, research_category=category, combustion_phenomenon=phenomenon, gravity_class=gravity, fuel=fuel, material=material,
        oxygen_min_percent=o2_min, oxygen_max_percent=o2_max, pressure_min_kpa=pressure_min, pressure_max_kpa=pressure_max,
        temperature_min_k=temp_min, temperature_max_k=temp_max, year_min=year_min, year_max=year_max, sort=sort,
        limit=page_size, offset=(page - 1) * page_size)
    items, total = R.search_investigations_core(args)
    return {"items": items, "total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


@router.get("/investigations/facets")
@limiter.limit(_lim)
def facets(request: Request):
    db = get_db()
    invs = rows(db.table("investigations").select("research_category,combustion_phenomena,investigation_type").limit(5000).execute())
    fuels = rows(db.table("experimental_conditions").select("value").eq("parameter_key", "fuel").limit(2000).execute())
    return {
        "categories": sorted({i["research_category"] for i in invs if i["research_category"]}),
        "phenomena": sorted({p for i in invs for p in i["combustion_phenomena"]}),
        "fuels": sorted({f["value"] for f in fuels})[:100],
        "gravity_classes": ["microgravity", "partial gravity", "normal gravity", "hypergravity"],
    }


@router.get("/investigations/{investigation_id}")
@limiter.limit(_lim)
def investigation_detail(request: Request, investigation_id: str):
    db = get_db()
    reg = RefRegistry()
    inv = _tool(lambda: R.resolve_investigation(investigation_id))
    iid = inv["id"]
    pubs = rows(db.table("publications").select("*").eq("investigation_id", iid).order("publication_year").execute())
    pub_by_id = {p["id"]: p for p in pubs}
    for p in pubs:
        p["has_original"] = bool(p.get("original_file_path"))
        p["pdf_url"] = signed_url(get_settings().storage_documents_bucket, p.pop("original_file_path", None))
        p.pop("file_sha256", None)
    conds = R.get_experimental_conditions_core(inv, None, 500)
    findings = R.get_scientific_findings_core(inv, limit=200)
    figs = R.get_figures_core(inv, None, 200)
    datasets = R.get_datasets_core(iid)
    for c in conds:
        c["ref"] = R.cite(reg, "condition", inv, pub_by_id.get(c["publication_id"]), page=c["source_page"], section=c["source_section"],
                          table=c["source_table"], figure=c["source_figure"])
    for f in findings:
        f["ref"] = R.cite(reg, "finding", inv, pub_by_id.get(f["publication_id"]), page=f["source_page"], section=f["source_section"],
                          figure=f["source_figure"], table=f["source_table"], quote=f["description"])
        f.pop("fts", None)
    for f in figs:
        f["image_url"] = signed_url(get_settings().storage_figures_bucket, f.get("image_path"))
        f["ref"] = R.cite(reg, "figure", inv, pub_by_id.get(f["publication_id"]), page=f["page_number"], figure=f["figure_number"])
    mission = rows(db.table("mission_relevance").select("*").eq("investigation_id", iid).execute())
    fire = R.enrich_fire_safety(R.get_fire_safety_core(investigation_id=iid), reg)
    inv.pop("fts", None)
    summary = inv.pop("research_summary", None)
    return {
        "investigation": inv, "card": R._investigation_cards([iid]).get(iid), "publications": pubs, "conditions": conds, "findings": findings, "figures": figs,
        "datasets": datasets, "mission_relevance": mission, "fire_safety": fire,
        "ai_generated_summary": {"layer": "ai_interpretation", "text": summary,
                                 "notice": "AI-generated summary supplied with the ingestion package. Not verified scientific evidence."} if summary else None,
        "citations": {k: v.model_dump() for k, v in reg.all().items()},
    }


@router.get("/investigations/{investigation_id}/findings")
@limiter.limit(_lim)
def investigation_findings(request: Request, investigation_id: str, evidence_type: R.EvidenceType | None = None,
                           phenomenon: str | None = None, q: str | None = None, limit: int = Query(100, ge=1, le=200)):
    reg = RefRegistry()
    inv = _tool(lambda: R.resolve_investigation(investigation_id))
    fs = R.get_scientific_findings_core(inv, q, evidence_type, phenomenon, limit)
    pubs = R.pub_index([f["publication_id"] for f in fs if f["publication_id"]])
    for f in fs:
        f.pop("fts", None)
        f["ref"] = R.cite(reg, "finding", inv, pubs.get(f["publication_id"]), page=f["source_page"], section=f["source_section"],
                          figure=f["source_figure"], table=f["source_table"], quote=f["description"])
    return {"investigation": {"id": inv["id"], "code": inv["investigation_code"], "title": inv["title"]}, "findings": fs,
            "citations": {k: v.model_dump() for k, v in reg.all().items()}}


# ------------------------------------------------------------------ publications
@router.get("/publications")
@limiter.limit(_lim)
def list_publications(request: Request, q: str | None = None, investigation_id: str | None = None,
                      year_min: int | None = None, year_max: int | None = None,
                      page: int = Query(1, ge=1, le=10000), page_size: int = Query(20, ge=1, le=50)):
    a = R.SearchPublicationsArgs(query=q, investigation_id=investigation_id, year_min=year_min, year_max=year_max,
                                 limit=page_size, offset=(page - 1) * page_size)
    items, total = _tool(lambda: R.search_publications_core(a))
    invs = R.inv_index([p["investigation_id"] for p in items])
    for p in items:
        p["has_original"] = bool(p.pop("original_file_path", None))
        inv = invs.get(p["investigation_id"])
        p["investigation_code"], p["investigation_title"] = (inv["investigation_code"], inv["title"]) if inv else (None, None)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/publications/{publication_id}")
@limiter.limit(_lim)
def publication_detail(request: Request, publication_id: str):
    db = get_db()
    if not R._uuid(publication_id):
        raise HTTPException(404, "Publication not found.")
    r = rows(db.table("publications").select("*").eq("id", publication_id).execute())
    if not r:
        raise HTTPException(404, "Publication not found.")
    p = r[0]
    inv = R.inv_index([p["investigation_id"]]).get(p["investigation_id"])
    path = p.pop("original_file_path", None)
    p.pop("file_sha256", None)
    p["has_original"] = bool(path)
    p["pdf_url"] = signed_url(get_settings().storage_documents_bucket, path)   # frontend appends #page=N
    p["download_url"] = signed_url(get_settings().storage_documents_bucket, path)
    p["investigation"] = {"id": inv["id"], "code": inv["investigation_code"], "title": inv["title"]} if inv else None
    return p


# ------------------------------------------------------------------ datasets
@router.get("/datasets")
@limiter.limit(_lim)
def list_datasets(request: Request, investigation_id: str | None = None):
    ds = _tool(lambda: R.get_datasets_core(investigation_id))
    invs = R.inv_index([d["investigation_id"] for d in ds])
    counts = {}
    for d in ds:
        inv = invs.get(d["investigation_id"])
        d["investigation_code"], d["investigation_title"] = (inv["investigation_code"], inv["title"]) if inv else (None, None)
        d["file_path"] = None  # storage path is internal
    return {"items": ds, "total": len(ds)}


@router.get("/datasets/{dataset_id}")
@limiter.limit(_lim)
def dataset_detail(request: Request, dataset_id: str, format: Literal["json", "csv"] = "json", variable: str | None = None):
    if not R._uuid(dataset_id):
        raise HTTPException(404, "Dataset not found.")
    db = get_db()
    r = rows(db.table("experimental_datasets").select("*").eq("id", dataset_id).execute())
    if not r:
        raise HTTPException(404, "Dataset not found.")
    ds = r[0]
    data = R.get_dataset_rows(dataset_id, variable)
    inv = R.resolve_investigation(ds["investigation_id"])
    pub = R.pub_index([ds["publication_id"]] if ds["publication_id"] else []).get(ds["publication_id"])
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["dataset_name", "investigation_code", "publication", "source_page", "source_table", "row_index", "variable", "value",
                    "unit", "experimental_condition", "source_reference"])
        for d in data:
            w.writerow([ds["dataset_name"], inv["investigation_code"], pub["title"] if pub else "", ds["source_page"] or "",
                        ds["source_table"] or "", d["row_index"], d["variable"], d["value"], d["unit"] or "",
                        d["experimental_condition"] or "", d["source_reference"] or ""])
        name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in ds["dataset_name"])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    conds = R.get_experimental_conditions_core(inv, None, 100)
    ds["file_path"] = None
    return {
        "dataset": ds, "investigation": {"id": inv["id"], "code": inv["investigation_code"], "title": inv["title"]},
        "publication": ({"id": pub["id"], "title": pub["title"]} if pub else None),
        "rows": data, "variables": sorted({d["variable"] for d in data}),
        "units": {d["variable"]: d["unit"] for d in data},
        "experimental_conditions": [{"parameter": c["parameter"], "value": c["value"], "unit": c["unit"], "context": c["context"],
                                     "source_page": c["source_page"]} for c in conds],
    }


# ------------------------------------------------------------------ fire safety
@router.get("/fire-safety")
@limiter.limit(_lim)
def fire_safety(request: Request, category: str | None = None, status: Literal["demonstrated", "potential"] | None = None):
    if category and category not in R.FIRE_CATEGORIES:
        raise HTTPException(422, "Unknown category.")
    reg = RefRegistry()
    apps = R.enrich_fire_safety(R.get_fire_safety_core(category, None, status, 500), reg)
    grouped = {c: [] for c in R.FIRE_CATEGORIES}
    for a in apps:
        grouped[a["category"]].append(a)
    return {"categories": [{"category": c, "applications": grouped[c], "demonstrated": sum(a["status"] == "demonstrated" for a in grouped[c]),
                            "potential": sum(a["status"] == "potential" for a in grouped[c])} for c in R.FIRE_CATEGORIES],
            "notice": "'Demonstrated' = documented in the cited source. 'Potential' = suggested application not demonstrated by the source. "
                      "S-PYRO does not make engineering recommendations.",
            "citations": {k: v.model_dump() for k, v in reg.all().items()}}


# ------------------------------------------------------------------ dashboard + search
@router.get("/dashboard/statistics")
@limiter.limit(_lim)
def dashboard(request: Request):
    db = get_db()
    stats = db.rpc("dashboard_statistics").execute().data or {}
    counts = Counter(f["investigation_id"] for f in fetch_all(db.table("scientific_findings").select("investigation_id")))
    pcounts = Counter(p["investigation_id"] for p in fetch_all(db.table("publications").select("investigation_id")))
    scored = sorted(pcounts, key=lambda i: (pcounts[i] + counts.get(i, 0)), reverse=True)[:4]
    featured = list(R._investigation_cards(scored).values())
    featured.sort(key=lambda c: -(pcounts[c["id"]] + counts.get(c["id"], 0)))
    for c in featured:
        c["finding_count"] = counts.get(c["id"], 0)
    recent_inv = rows(db.table("investigations").select("id,investigation_code,title,research_category,created_at").order(
        "created_at", desc=True).limit(5).execute())
    recent_pub = rows(db.table("publications").select("id,title,publication_year,journal,investigation_id,created_at").order(
        "created_at", desc=True).limit(5).execute())
    return {"statistics": stats, "featured": featured, "recent_investigations": recent_inv, "recent_publications": recent_pub,
            "featured_basis": "Investigations with the most publications and recorded findings."}


@router.get("/search")
@limiter.limit(_lim)
def global_search(request: Request, q: str = Query(min_length=2, max_length=200)):
    invs, _ = R.search_investigations_core(R.SearchInvestigationsArgs(query=q, limit=6))
    pubs, _ = R.search_publications_core(R.SearchPublicationsArgs(query=q, limit=5))
    return {"investigations": [{"id": i["id"], "code": i["investigation_code"], "title": i["title"]} for i in invs],
            "publications": [{"id": p["id"], "title": p["title"], "year": p["publication_year"]} for p in pubs]}
