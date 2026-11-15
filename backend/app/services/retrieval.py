"""Controlled retrieval tools. Gemini never touches SQL: it can only call these validated functions.

Every function takes a validated Pydantic args model plus a RefRegistry and returns plain
JSON-serialisable data in which each citable record carries a `ref` ("R1", ...).
"""
from __future__ import annotations

import re
from typing import Any, Callable, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from ..config import get_settings
from ..db import get_db, rows, signed_url
from .gemini_client import embed_query
from .refs import RefRegistry


class ToolError(Exception):
    pass


GravityClass = Literal["microgravity", "partial gravity", "normal gravity", "hypergravity"]
EvidenceType = Literal["experimental_observation", "numerical_result", "theoretical", "author_interpretation", "review", "other"]
FIRE_CATEGORIES = ["fire_detection", "smoke_monitoring", "fire_suppression", "fine_water_mist", "material_flammability",
                   "oxygen_management", "ventilation", "fire_resistant_materials", "protective_equipment"]


def _cap(n: int) -> int:
    return max(1, min(n, get_settings().retrieval_max_results))


def _snip(s: str | None, n: int = 900) -> str | None:
    if s is None:
        return None
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _like(q: str) -> str:
    """Make a user string safe for a PostgREST ilike/or filter."""
    return re.sub(r"[,()%*\\]", " ", q).strip()[:200]


_QSTOP = set("which what where when who whom whose does did done have has been were with from that this these those into than then "
             "about their there also tested studied study studies investigation investigations experiment experiments research "
             "cite sources source please show give find list tell explain describe range ranges used using across over under".split())


def or_query(q: str | None) -> str | None:
    """Natural-language question -> 'w1 or w2 ...' for websearch_to_tsquery (which otherwise ANDs every word)."""
    words = [w for w in dict.fromkeys(re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", q or "")) if w.lower() not in _QSTOP]
    return " or ".join(words[:10]) if len(words) > 1 else None


def _uuid(x: str) -> bool:
    try:
        UUID(str(x))
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------- shared lookups
def inv_index(ids: list[str]) -> dict[str, dict]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    r = rows(get_db().table("investigations").select("id,investigation_code,title").in_("id", ids).execute())
    return {x["id"]: x for x in r}


def pub_index(ids: list[str]) -> dict[str, dict]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    r = rows(get_db().table("publications").select("id,investigation_id,title,publication_year,doi,journal").in_("id", ids).execute())
    return {x["id"]: x for x in r}


def resolve_investigation(ident: str) -> dict:
    db = get_db()
    ident = (ident or "").strip()
    if _uuid(ident):
        r = rows(db.table("investigations").select("*").eq("id", ident).limit(1).execute())
    else:
        r = rows(db.table("investigations").select("*").ilike("investigation_code", _like(ident)).limit(1).execute())
        if not r:
            r = rows(db.table("investigations").select("*").ilike("title", f"%{_like(ident)}%").limit(2).execute())
            if len(r) > 1:
                raise ToolError(f"'{ident}' matches more than one investigation; use search_investigations to pick one.")
    if not r:
        raise ToolError(f"No investigation found for '{ident}'.")
    return r[0]


def cite(reg: RefRegistry, kind: str, inv: dict | None, pub: dict | None, *, page=None, section=None, figure=None,
         table=None, quote=None) -> str:
    code = inv.get("investigation_code") if inv else None
    label = " · ".join(x for x in [
        code or (inv or {}).get("title"),
        (pub or {}).get("title") if pub else None,
        f"p.{page}" if page else None, section, f"Fig. {figure}" if figure else None, f"Table {table}" if table else None,
    ] if x)
    return reg.add(kind=kind, label=label or kind, investigation_id=(inv or {}).get("id"),
                   investigation_title=(inv or {}).get("title"), publication_id=(pub or {}).get("id"),
                   publication_title=(pub or {}).get("title"), page=page, section=section, figure=figure, table=table,
                   quote=quote)


def _ctx(ids_inv: list[str], ids_pub: list[str]):
    return inv_index(ids_inv), pub_index(ids_pub)


# --------------------------------------------------------------------- 1. search_investigations
class SearchInvestigationsArgs(BaseModel):
    query: str | None = Field(default=None, max_length=300, description="Keywords: title, topic, phenomenon, material…")
    research_category: str | None = Field(default=None, max_length=100)
    combustion_phenomenon: str | None = Field(default=None, max_length=100)
    gravity_class: GravityClass | None = None
    fuel: str | None = Field(default=None, max_length=100)
    material: str | None = Field(default=None, max_length=100)
    oxygen_min_percent: float | None = Field(default=None, ge=0, le=100)
    oxygen_max_percent: float | None = Field(default=None, ge=0, le=100)
    pressure_min_kpa: float | None = Field(default=None, ge=0)
    pressure_max_kpa: float | None = Field(default=None, ge=0)
    temperature_min_k: float | None = Field(default=None, ge=0)
    temperature_max_k: float | None = Field(default=None, ge=0)
    year_min: int | None = Field(default=None, ge=1900, le=2100)
    year_max: int | None = Field(default=None, ge=1900, le=2100)
    sort: Literal["relevance", "title", "year", "recent"] = "relevance"
    limit: int = Field(default=10, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=10000)


def _investigation_cards(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    db = get_db()
    invs = {i["id"]: i for i in rows(db.table("investigations").select(
        "id,investigation_code,title,description,abstract,research_category,investigation_type,combustion_phenomena,keywords,created_at"
    ).in_("id", ids).execute())}
    pubs = rows(db.table("publications").select("investigation_id,publication_year").in_("investigation_id", ids).execute())
    grav = rows(db.table("experimental_conditions").select("investigation_id,value_class").eq("parameter_key", "gravity")
                .in_("investigation_id", ids).execute())
    # telemetry: documented ranges of oxygen (%), pressure (kPa), temperature (K), computed from stored conditions
    from .units import Quantity, normalise
    cond = rows(db.table("experimental_conditions").select("investigation_id,parameter_key,value_min,value_max,unit,normalized_value")
                .in_("investigation_id", ids).in_("parameter_key", ["oxygen_concentration", "pressure", "temperature"]).limit(2000).execute())
    counts = {}
    for t in ("scientific_findings", "figures", "experimental_datasets"):
        for r in rows(db.table(t).select("investigation_id").in_("investigation_id", ids).limit(5000).execute()):
            counts.setdefault(r["investigation_id"], {}).setdefault(t, 0)
            counts[r["investigation_id"]][t] += 1
    keymap = {"oxygen_concentration": "oxygen", "pressure": "pressure", "temperature": "temperature"}
    for i in invs.values():
        yrs = sorted({p["publication_year"] for p in pubs if p["investigation_id"] == i["id"] and p["publication_year"]})
        i["publication_count"] = sum(1 for p in pubs if p["investigation_id"] == i["id"])
        i["publication_years"] = yrs
        i["gravity_classes"] = sorted({g["value_class"] for g in grav if g["investigation_id"] == i["id"] and g["value_class"]})
        i["description"] = _snip(i.get("description") or i.get("abstract"), 400)
        i.pop("abstract", None)
        tel: dict[str, list[float]] = {}
        for c in cond:
            if c["investigation_id"] != i["id"]:
                continue
            nums = None
            if c["value_min"] is not None and c["unit"]:
                q = Quantity(raw="", nums=[c["value_min"], c["value_max"] if c["value_max"] is not None else c["value_min"]], unit=c["unit"])
                n = normalise(q)
                nums = n[0] if n else None
            if nums is None and c["normalized_value"] is not None:
                nums = [c["normalized_value"]]
            if nums:
                k = keymap[c["parameter_key"]]
                lo, hi = min(nums), max(nums)
                tel[k] = [min(tel[k][0], lo), max(tel[k][1], hi)] if k in tel else [lo, hi]
        i["telemetry"] = tel
        cn = counts.get(i["id"], {})
        i["counts"] = {"findings": cn.get("scientific_findings", 0), "figures": cn.get("figures", 0), "datasets": cn.get("experimental_datasets", 0)}
    return invs


def search_investigations_core(a: SearchInvestigationsArgs) -> tuple[list[dict], int]:
    res = _filter_rpc(a, a.query)
    if not res and a.query and or_query(a.query):
        res = _filter_rpc(a, or_query(a.query))
    total = int(res[0]["total"]) if res else 0
    cards = _investigation_cards([r["id"] for r in res])
    items = []
    for r in res:
        c = cards.get(r["id"])
        if c:
            c["rank"] = r["rank"]
            items.append(c)
    return items, total


def _filter_rpc(a: SearchInvestigationsArgs, q: str | None) -> list[dict]:
    return rows(get_db().rpc("filter_investigations", {
        "q": q, "category": a.research_category, "phenomenon": a.combustion_phenomenon,
        "gravity_class": a.gravity_class, "fuel": a.fuel, "material": a.material,
        "o2_min": a.oxygen_min_percent, "o2_max": a.oxygen_max_percent,
        "p_min": a.pressure_min_kpa, "p_max": a.pressure_max_kpa,
        "t_min": a.temperature_min_k, "t_max": a.temperature_max_k,
        "year_min": a.year_min, "year_max": a.year_max,
        "sort": a.sort, "lim": a.limit, "off": a.offset}).execute())


def search_investigations(a: SearchInvestigationsArgs, reg: RefRegistry) -> dict:
    a.limit = _cap(a.limit)
    items, total = search_investigations_core(a)
    for i in items:
        i["ref"] = cite(reg, "investigation", i, None)
        i.pop("created_at", None)
    return {"total_matches": total, "returned": len(items), "investigations": items}


# --------------------------------------------------------------------- 2. search_publications
class SearchPublicationsArgs(BaseModel):
    query: str | None = Field(default=None, max_length=300)
    investigation_id: str | None = Field(default=None, description="Investigation UUID or code")
    year_min: int | None = Field(default=None, ge=1900, le=2100)
    year_max: int | None = Field(default=None, ge=1900, le=2100)
    limit: int = Field(default=10, ge=1, le=50)
    offset: int = Field(default=0, ge=0, le=10000)


def search_publications_core(a: SearchPublicationsArgs) -> tuple[list[dict], int]:
    q = get_db().table("publications").select(
        "id,investigation_id,title,authors,publication_year,doi,journal,publication_type,source_url,abstract,original_file_path",
        count="exact")
    if a.investigation_id:
        q = q.eq("investigation_id", resolve_investigation(a.investigation_id)["id"])
    if a.query:
        t = _like(a.query)
        q = q.or_(f"title.ilike.%{t}%,abstract.ilike.%{t}%,journal.ilike.%{t}%,doi.ilike.%{t}%")
    if a.year_min:
        q = q.gte("publication_year", a.year_min)
    if a.year_max:
        q = q.lte("publication_year", a.year_max)
    r = q.order("publication_year", desc=True).range(a.offset, a.offset + a.limit - 1).execute()
    return list(r.data or []), r.count or 0


def search_publications(a: SearchPublicationsArgs, reg: RefRegistry) -> dict:
    a.limit = _cap(a.limit)
    items, total = search_publications_core(a)
    invs = inv_index([p["investigation_id"] for p in items])
    for p in items:
        p["has_original_pdf"] = bool(p.pop("original_file_path", None))
        p["abstract"] = _snip(p.get("abstract"), 500)
        inv = invs.get(p["investigation_id"])
        p["investigation_code"] = inv["investigation_code"] if inv else None
        p["ref"] = cite(reg, "publication", inv, p)
    return {"total_matches": total, "returned": len(items), "publications": items}


# --------------------------------------------------------------------- 3. search_research_text (hybrid)
class SearchResearchTextArgs(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    investigation_ids: list[str] | None = Field(default=None, max_length=10, description="Restrict to these investigations (UUID or code)")
    include_ai_summaries: bool = Field(default=False, description="Include AI-generated summaries (never original evidence)")
    limit: int = Field(default=8, ge=1, le=25)


def search_research_text(a: SearchResearchTextArgs, reg: RefRegistry) -> dict:
    limit = _cap(a.limit)
    inv_ids = [resolve_investigation(i)["id"] for i in a.investigation_ids] if a.investigation_ids else None
    emb = embed_query(a.query)
    res = rows(get_db().rpc("hybrid_search_chunks", {
        "q": a.query, "q_emb": emb, "inv_ids": inv_ids, "pub_ids": None, "match_count": limit * 2}).execute())
    if not res and or_query(a.query):
        res = rows(get_db().rpc("hybrid_search_chunks", {
            "q": or_query(a.query), "q_emb": emb, "inv_ids": inv_ids, "pub_ids": None, "match_count": limit * 2}).execute())
    if not a.include_ai_summaries:
        res = [r for r in res if r["evidence_layer"] != "ai_interpretation"]
    res = res[:limit]
    invs, pubs = _ctx([r["investigation_id"] for r in res], [r["publication_id"] for r in res if r["publication_id"]])
    out = []
    for r in res:
        inv, pub = invs.get(r["investigation_id"]), pubs.get(r["publication_id"])
        out.append({
            "ref": cite(reg, "text", inv, pub, page=r["page_number"], section=r["section"], quote=_snip(r["content"], 300)),
            "investigation": inv["investigation_code"] if inv else None, "publication": pub["title"] if pub else None,
            "page": r["page_number"], "section": r["section"], "evidence_layer": r["evidence_layer"],
            "matched_by": [m for m, k in (("keyword", "fts_rank"), ("semantic", "vec_rank")) if r.get(k)],
            "text": _snip(r["content"]),
        })
    return {"semantic_search_active": emb is not None, "returned": len(out), "passages": out}


# --------------------------------------------------------------------- 4. get_investigation_details
class InvestigationRef(BaseModel):
    investigation_id: str = Field(description="Investigation UUID or investigation code")


def get_investigation_details(a: InvestigationRef, reg: RefRegistry) -> dict:
    db = get_db()
    inv = resolve_investigation(a.investigation_id)
    pubs = rows(db.table("publications").select("id,title,authors,publication_year,doi,journal,publication_type").eq(
        "investigation_id", inv["id"]).order("publication_year").execute())
    counts = {}
    for t in ("experimental_conditions", "scientific_findings", "figures", "experimental_datasets"):
        counts[t] = db.table(t).select("id", count="exact").eq("investigation_id", inv["id"]).limit(1).execute().count or 0
    for p in pubs:
        p["ref"] = cite(reg, "publication", inv, p)
    return {
        "ref": cite(reg, "investigation", inv, None),
        "investigation_code": inv["investigation_code"], "title": inv["title"], "description": inv["description"],
        "abstract": inv["abstract"], "research_category": inv["research_category"], "investigation_type": inv["investigation_type"],
        "combustion_phenomena": inv["combustion_phenomena"], "keywords": inv["keywords"], "objectives": inv["objectives"],
        "methodology": _snip(inv["methodology"], 2500),
        "known_limitations": (inv.get("metadata") or {}).get("limitations"),
        "ai_generated_summary": {"layer": "ai_interpretation", "text": _snip(inv["research_summary"], 1500)} if inv["research_summary"] else None,
        "publications": pubs, "record_counts": counts,
    }


# --------------------------------------------------------------------- 5. get_experimental_conditions
class ConditionsArgs(BaseModel):
    investigation_id: str
    parameter_key: str | None = Field(default=None, max_length=80, description="e.g. oxygen_concentration, pressure, temperature, gravity, fuel, material")
    limit: int = Field(default=50, ge=1, le=100)


def get_experimental_conditions_core(inv: dict, key: str | None = None, limit: int = 100) -> list[dict]:
    q = get_db().table("experimental_conditions").select("*").eq("investigation_id", inv["id"])
    if key:
        q = q.eq("parameter_key", key)
    return rows(q.order("parameter_key").limit(limit).execute())


def get_experimental_conditions(a: ConditionsArgs, reg: RefRegistry) -> dict:
    inv = resolve_investigation(a.investigation_id)
    conds = get_experimental_conditions_core(inv, a.parameter_key, _cap(a.limit) * 4)
    pubs = pub_index([c["publication_id"] for c in conds if c["publication_id"]])
    out = []
    for c in conds[: a.limit]:
        pub = pubs.get(c["publication_id"])
        out.append({
            "ref": cite(reg, "condition", inv, pub, page=c["source_page"], section=c["source_section"], table=c["source_table"],
                        figure=c["source_figure"]),
            "parameter": c["parameter"], "parameter_key": c["parameter_key"], "value": c["value"], "unit": c["unit"],
            "normalized": ({"value": c["normalized_value"], "unit": c["normalized_unit"]} if c["normalized_value"] is not None else None),
            "context": c["context"],
        })
    return {"investigation": inv["investigation_code"], "returned": len(out), "conditions": out}


# --------------------------------------------------------------------- 6. get_scientific_findings
class FindingsArgs(BaseModel):
    investigation_id: str
    query: str | None = Field(default=None, max_length=300)
    evidence_type: EvidenceType | None = None
    phenomenon: str | None = Field(default=None, max_length=100)
    limit: int = Field(default=10, ge=1, le=30)


def get_scientific_findings_core(inv: dict, query=None, evidence_type=None, phenomenon=None, limit=30) -> list[dict]:
    q = get_db().table("scientific_findings").select("*").eq("investigation_id", inv["id"])
    if evidence_type:
        q = q.eq("evidence_type", evidence_type)
    if phenomenon:
        q = q.ilike("phenomenon", f"%{_like(phenomenon)}%")
    if query:
        q = q.text_search("fts", query, options={"type": "websearch", "config": "english"})
    return rows(q.limit(limit).execute())


def get_scientific_findings(a: FindingsArgs, reg: RefRegistry) -> dict:
    inv = resolve_investigation(a.investigation_id)
    fs = get_scientific_findings_core(inv, a.query, a.evidence_type, a.phenomenon, _cap(a.limit))
    pubs = pub_index([f["publication_id"] for f in fs if f["publication_id"]])
    out = []
    for f in fs:
        pub = pubs.get(f["publication_id"])
        out.append({
            "id": f["id"],
            "ref": cite(reg, "finding", inv, pub, page=f["source_page"], section=f["source_section"], figure=f["source_figure"],
                        table=f["source_table"], quote=f["description"]),
            "description": f["description"], "evidence_type": f["evidence_type"], "phenomenon": f["phenomenon"],
            "reported_values": f["reported_values"],
        })
    return {"investigation": inv["investigation_code"], "returned": len(out),
            "note": "evidence_type distinguishes experimental observations from author interpretations.", "findings": out}


# --------------------------------------------------------------------- 7. get_figure_descriptions
class FiguresArgs(BaseModel):
    investigation_id: str
    figure_number: str | None = Field(default=None, max_length=30)
    limit: int = Field(default=10, ge=1, le=30)


def get_figures_core(inv: dict, figure_number: str | None = None, limit: int = 100) -> list[dict]:
    q = get_db().table("figures").select("*").eq("investigation_id", inv["id"])
    if figure_number:
        q = q.eq("figure_number", figure_number)
    return rows(q.order("figure_number").limit(limit).execute())


def get_figure_descriptions(a: FiguresArgs, reg: RefRegistry) -> dict:
    inv = resolve_investigation(a.investigation_id)
    figs = get_figures_core(inv, a.figure_number, _cap(a.limit))
    pubs = pub_index([f["publication_id"] for f in figs if f["publication_id"]])
    out = [{
        "ref": cite(reg, "figure", inv, pubs.get(f["publication_id"]), page=f["page_number"], figure=f["figure_number"]),
        "figure_number": f["figure_number"], "caption": f["caption"], "x_axis": f["x_axis"], "y_axis": f["y_axis"],
        "units": f["units"], "description": f["description"], "qualitative_observations": f["qualitative_observations"],
    } for f in figs]
    return {"investigation": inv["investigation_code"], "returned": len(out), "figures": out}


# --------------------------------------------------------------------- 8. get_experimental_data
class DataArgs(BaseModel):
    investigation_id: str | None = None
    dataset_id: str | None = None
    variable: str | None = Field(default=None, max_length=100)
    row_limit: int = Field(default=50, ge=1, le=200)


def get_datasets_core(investigation_id: str | None = None) -> list[dict]:
    q = get_db().table("experimental_datasets").select("*")
    if investigation_id:
        q = q.eq("investigation_id", resolve_investigation(investigation_id)["id"])
    return rows(q.order("dataset_name").limit(500).execute())


def get_dataset_rows(dataset_id: str, variable: str | None = None, limit: int = 5000) -> list[dict]:
    q = get_db().table("experimental_data").select("row_index,variable,value,unit,experimental_condition,source_reference").eq(
        "dataset_id", dataset_id)
    if variable:
        q = q.eq("variable", variable)
    return rows(q.order("row_index").order("variable").limit(limit).execute())


def get_experimental_data(a: DataArgs, reg: RefRegistry) -> dict:
    if not a.dataset_id and not a.investigation_id:
        raise ToolError("Provide investigation_id or dataset_id.")
    dss = rows(get_db().table("experimental_datasets").select("*").eq("id", a.dataset_id).execute()) if a.dataset_id \
        else get_datasets_core(a.investigation_id)
    if not dss:
        return {"returned": 0, "datasets": [], "note": "No numerical datasets are stored for this selection."}
    dss = dss[:5]
    invs, pubs = _ctx([d["investigation_id"] for d in dss], [d["publication_id"] for d in dss if d["publication_id"]])
    out = []
    for d in dss:
        data = get_dataset_rows(d["id"], a.variable, a.row_limit * 8)
        grouped: dict[int, dict] = {}
        for r in data:
            g = grouped.setdefault(r["row_index"], {"row": r["row_index"], "values": {}, "condition": r["experimental_condition"]})
            g["values"][r["variable"]] = {"value": r["value"], "unit": r["unit"]}
        inv = invs.get(d["investigation_id"])
        out.append({
            "dataset_id": d["id"], "dataset_name": d["dataset_name"], "description": d["description"],
            "ref": cite(reg, "dataset", inv, pubs.get(d["publication_id"]), page=d["source_page"], table=d["source_table"]),
            "rows": list(grouped.values())[: a.row_limit], "rows_total": len(grouped),
        })
    return {"returned": len(out), "datasets": out}


# --------------------------------------------------------------------- 12. get_fire_safety_applications
class FireSafetyArgs(BaseModel):
    category: Literal[tuple(FIRE_CATEGORIES)] | None = None  # type: ignore[valid-type]
    investigation_id: str | None = None
    status: Literal["demonstrated", "potential"] | None = None
    limit: int = Field(default=15, ge=1, le=50)


def get_fire_safety_core(category=None, investigation_id=None, status=None, limit=200) -> list[dict]:
    q = get_db().table("fire_safety_applications").select("*")
    if category:
        q = q.eq("application_category", category)
    if investigation_id:
        q = q.eq("investigation_id", resolve_investigation(investigation_id)["id"])
    if status:
        q = q.eq("application_status", status)
    return rows(q.limit(limit).execute())


def enrich_fire_safety(apps: list[dict], reg: RefRegistry) -> list[dict]:
    db = get_db()
    fids = [a["supporting_finding_id"] for a in apps if a["supporting_finding_id"]]
    findings = {f["id"]: f for f in rows(db.table("scientific_findings").select("*").in_("id", fids).execute())} if fids else {}
    invs, pubs = _ctx([a["investigation_id"] for a in apps], [f["publication_id"] for f in findings.values() if f["publication_id"]])
    out = []
    for a in apps:
        f = findings.get(a["supporting_finding_id"])
        inv = invs.get(a["investigation_id"])
        pub = pubs.get(f["publication_id"]) if f else None
        out.append({
            "category": a["application_category"], "description": a["description"], "status": a["application_status"],
            "evidence_type": a["evidence_type"], "limitations": a["limitations"],
            "investigation": {"id": a["investigation_id"], "code": inv["investigation_code"] if inv else None,
                              "title": inv["title"] if inv else None},
            "ref": cite(reg, "finding" if f else "investigation", inv, pub,
                        page=f["source_page"] if f else None, section=f["source_section"] if f else None,
                        figure=f["source_figure"] if f else None, table=f["source_table"] if f else None,
                        quote=f["description"] if f else None),
            "supporting_finding": ({"description": f["description"], "evidence_type": f["evidence_type"]} if f else None),
            "publication": ({"id": pub["id"], "title": pub["title"]} if pub else None),
        })
    return out


def get_fire_safety_applications(a: FireSafetyArgs, reg: RefRegistry) -> dict:
    apps = get_fire_safety_core(a.category, a.investigation_id, a.status, _cap(a.limit))
    return {"returned": len(apps),
            "note": "status 'demonstrated' = application documented in the source; 'potential' = suggested but not demonstrated.",
            "applications": enrich_fire_safety(apps, reg)}


# --------------------------------------------------------------------- tool registry (compare/rank live elsewhere)
Tool = tuple[type[BaseModel], Callable[[Any, RefRegistry], dict], str]

BASE_TOOLS: dict[str, Tool] = {
    "search_investigations": (SearchInvestigationsArgs, search_investigations,
        "Find NASA combustion investigations by keyword and structured filters (category, phenomenon, gravity class, fuel, material, "
        "oxygen %, pressure kPa, temperature K, publication year)."),
    "search_publications": (SearchPublicationsArgs, search_publications, "Find publications by keyword, investigation or year."),
    "search_research_text": (SearchResearchTextArgs, search_research_text,
        "Hybrid (structured + keyword + semantic) search over original research text passages, with page and section."),
    "get_investigation_details": (InvestigationRef, get_investigation_details,
        "Overview, objectives, methodology, publications and record counts for one investigation."),
    "get_experimental_conditions": (ConditionsArgs, get_experimental_conditions,
        "Documented experimental conditions (parameters, values, units, context) with source page/section."),
    "get_scientific_findings": (FindingsArgs, get_scientific_findings,
        "Documented scientific findings with evidence type and source page/section/figure/table."),
    "get_figure_descriptions": (FiguresArgs, get_figure_descriptions, "Figure captions, axes, units and descriptions."),
    "get_experimental_data": (DataArgs, get_experimental_data, "Numerical datasets extracted from research tables."),
    "get_fire_safety_applications": (FireSafetyArgs, get_fire_safety_applications,
        "Fire-safety application areas linked to investigations; distinguishes demonstrated from potential applications."),
}
