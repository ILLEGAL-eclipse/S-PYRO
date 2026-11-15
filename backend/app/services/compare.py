"""Structured side-by-side comparison of investigations. Deterministic; AI summary is optional and separate."""
from __future__ import annotations

from pydantic import BaseModel, Field

from ..db import get_db, rows
from .refs import RefRegistry
from .retrieval import (ToolError, cite, get_experimental_conditions_core, get_figures_core, get_scientific_findings_core,
                        pub_index, resolve_investigation)
from .units import categorical_equal


class CompareArgs(BaseModel):
    investigation_ids: list[str] = Field(min_length=2, max_length=6, description="2-6 investigation UUIDs or codes")


def _status_for_key(per_inv: dict[str, list[dict]], ids: list[str]) -> tuple[str, str | None]:
    present = [i for i in ids if per_inv.get(i)]
    if len(present) < len(ids):
        return "missing", "No documented value for: " + ", ".join(i for i in ids if i not in present)
    all_c = [c for i in ids for c in per_inv[i]]
    nums = [c for c in all_c if c["normalized_value"] is not None]
    if len(nums) == len(all_c):
        if len({c["normalized_unit"] for c in nums}) > 1:
            return "not_comparable", "Values are expressed in different physical units."
        sets = [{round(c["normalized_value"], 6) for c in per_inv[i]} for i in ids]
        if all(s == sets[0] for s in sets):
            return "same", None
        ranges = [(min(s), max(s)) for s in sets]
        if max(r[0] for r in ranges) <= min(r[1] for r in ranges):
            return "overlapping", "Documented values overlap but are not identical."
        return "different", None
    if nums:
        return "not_comparable", "Mix of numeric and descriptive values."
    texts = [{c["value"].strip().lower() for c in per_inv[i]} for i in ids]
    if all(t == texts[0] for t in texts):
        return "same", None
    flat = [sorted(t)[0] for t in texts]
    if all(categorical_equal(flat[0], f) != "different" for f in flat[1:]):
        return "overlapping", "Descriptions overlap textually; review the wording."
    return "different", None


def compare_core(a: CompareArgs, reg: RefRegistry) -> dict:
    db = get_db()
    invs = [resolve_investigation(x) for x in a.investigation_ids]
    ids = [i["id"] for i in invs]
    if len(set(ids)) != len(ids):
        raise ToolError("Select distinct investigations.")
    pubs = pub_index([p["id"] for p in rows(db.table("publications").select("id").in_("investigation_id", ids).execute())])

    conds = {i["id"]: get_experimental_conditions_core(i, None, 300) for i in invs}
    keys: dict[str, str] = {}
    for cs in conds.values():
        for c in cs:
            keys.setdefault(c["parameter_key"] or c["parameter"].lower(), c["parameter"])
    condition_rows = []
    for k, label in sorted(keys.items()):
        per_inv = {i["id"]: [c for c in conds[i["id"]] if (c["parameter_key"] or c["parameter"].lower()) == k] for i in invs}
        status, note = _status_for_key(per_inv, ids)
        condition_rows.append({
            "key": k, "label": label, "status": status, "note": note,
            "cells": {i["id"]: [{
                "value": c["value"], "unit": c["unit"], "normalized_value": c["normalized_value"],
                "normalized_unit": c["normalized_unit"], "context": c["context"],
                "ref": cite(reg, "condition", i, pubs.get(c["publication_id"]), page=c["source_page"], section=c["source_section"],
                            table=c["source_table"], figure=c["source_figure"]),
            } for c in per_inv[i["id"]]] for i in invs},
        })
    order = {"different": 0, "not_comparable": 1, "missing": 2, "overlapping": 3, "same": 4}
    condition_rows.sort(key=lambda r: (order[r["status"]], r["label"]))

    findings, phen = {}, {}
    for i in invs:
        fs = get_scientific_findings_core(i, limit=40)
        findings[i["id"]] = [{
            "description": f["description"], "evidence_type": f["evidence_type"], "phenomenon": f["phenomenon"],
            "ref": cite(reg, "finding", i, pubs.get(f["publication_id"]), page=f["source_page"], section=f["source_section"],
                        figure=f["source_figure"], table=f["source_table"], quote=f["description"])} for f in fs]
        for f in fs:
            if f["phenomenon"]:
                phen.setdefault(f["phenomenon"].strip().lower(), set()).add(i["id"])
    phenomena = [{"phenomenon": p, "investigations_reporting": sorted(v),
                  "status": "reported in all" if len(v) == len(ids) else "reported in some" if len(v) > 1 else "reported in one"}
                 for p, v in sorted(phen.items())]

    return {
        "investigations": [{"id": i["id"], "code": i["investigation_code"], "title": i["title"],
                            "ref": cite(reg, "investigation", i, None)} for i in invs],
        "objectives": {i["id"]: i["objectives"] for i in invs},
        "methodology": {i["id"]: i["methodology"] for i in invs},
        "categories": {i["id"]: i["research_category"] for i in invs},
        "limitations": {i["id"]: (i.get("metadata") or {}).get("limitations") for i in invs},
        "figure_counts": {i["id"]: len(get_figures_core(i, None, 200)) for i in invs},
        "conditions": condition_rows, "findings": findings, "phenomena": phenomena,
        "notes": ["Conditions with different physical units or mixed numeric/descriptive values are marked 'not_comparable' "
                  "and are not compared numerically.",
                  "Findings are listed side by side; this table does not decide whether observations conflict."],
    }


def compare_investigations(a: CompareArgs, reg: RefRegistry) -> dict:
    full = compare_core(a, reg)   # compact for the model
    full["methodology"] = {k: (v[:600] + "…" if v and len(v) > 600 else v) for k, v in full["methodology"].items()}
    full["findings"] = {k: v[:8] for k, v in full["findings"].items()}
    return full
