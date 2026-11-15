"""Administrative ingestion of externally-extracted research packages. Needs no Gemini access.

Idempotent: records are de-duplicated by content hash, so re-uploading the same package never duplicates data.
Three evidence layers are kept apart: the original PDF (stored byte-identical, chunks 'original'), structured
extractions (conditions/findings/figures/datasets, methodology chunks 'extracted'), and AI-generated text
(research_summary.md -> investigations.research_summary and chunks 'ai_interpretation').
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..config import get_settings
from ..db import chunked, get_db, rows
from .units import canonical_key, gravity_class, normalise, parse_quantity

EVIDENCE = {"experimental_observation", "numerical_result", "theoretical", "author_interpretation", "review", "other"}
FIRE_CATS = {"fire_detection", "smoke_monitoring", "fire_suppression", "fine_water_mist", "material_flammability",
             "oxygen_management", "ventilation", "fire_resistant_materials", "protective_equipment"}
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
KNOWN = {"investigation.json", "experimental_conditions.json", "scientific_findings.json", "experimental_data.csv", "figures.json",
         "methodology.md", "research_summary.md", "references.json", "fire_safety_applications.json", "mission_relevance.json"}


def _hash(*parts: Any) -> str:
    return hashlib.sha1("|".join(re.sub(r"\s+", " ", str(p or "")).strip().lower() for p in parts).encode()).hexdigest()


def _list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [x.strip() for x in re.split(r"[;\n]", v) if x.strip()] if (";" in v or "\n" in v) else [v.strip()]
    return [str(x).strip() for x in v if str(x).strip()]


class Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")


class PublicationIn(Loose):
    title: str = Field(min_length=1)
    authors: list[str] | str = []
    publication_year: int | None = Field(default=None, ge=1900, le=2100)
    doi: str | None = None
    journal: str | None = None
    publication_type: str | None = None
    source_url: str | None = None
    abstract: str | None = None
    file_name: str | None = None


class InvestigationIn(Loose):
    investigation_code: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1)
    description: str | None = None
    abstract: str | None = None
    research_category: str | None = None
    investigation_type: str | None = None
    combustion_phenomena: list[str] | str = []
    keywords: list[str] | str = []
    objectives: list[str] | str = []
    limitations: list[str] | str = []
    publication: PublicationIn | None = None
    publications: list[PublicationIn] = []
    metadata: dict = {}


class RecordBase(Loose):
    publication_doi: str | None = None
    publication_title: str | None = None
    source_page: int | None = Field(default=None, ge=0)
    source_section: str | None = None
    source_table: str | None = None
    source_figure: str | None = None

    @field_validator("source_page", mode="before")
    @classmethod
    def _page(cls, v):
        if v in (None, ""):
            return None
        m = re.search(r"\d+", str(v))
        return int(m.group()) if m else None


class ConditionIn(RecordBase):
    parameter: str = Field(min_length=1)
    value: str | int | float
    unit: str | None = None
    context: str | None = None


class FindingIn(RecordBase):
    description: str = Field(min_length=3)
    evidence_type: str | None = None
    phenomenon: str | None = None
    reported_values: dict | list | None = None


class FigureIn(RecordBase):
    figure_number: str | int | float
    caption: str | None = None
    page_number: int | None = None
    image_file: str | None = None
    x_axis: str | None = None
    y_axis: str | None = None
    units: str | None = None
    description: str | None = None
    qualitative_observations: str | None = None


class FireIn(Loose):
    application_category: str
    description: str = Field(min_length=3)
    status: str = "potential"
    evidence_type: str | None = None
    limitations: str | None = None
    supporting_finding: str | None = None


class MissionIn(Loose):
    mission_type: str
    relevance_score: float | None = Field(default=None, ge=0, le=1)
    rationale: str | None = None
    supporting_evidence: list | dict = []
    limitations: str | None = None


class Report:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {"files": [], "errors": [], "warnings": [], "counts": {}, "duplicates": []}

    def err(self, f: str, msg: str):
        self.data["errors"].append({"file": f, "message": msg})

    def warn(self, f: str, msg: str):
        self.data["warnings"].append({"file": f, "message": msg})

    def count(self, k: str, inserted=0, duplicates=0, rejected=0, **kw):
        self.data["counts"][k] = {"inserted": inserted, "duplicates": duplicates, "rejected": rejected, **kw}

    @property
    def fatal(self) -> bool:
        return bool(self.data["errors"])


def _json(name: str, data: bytes, rep: Report):
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError) as e:
        rep.err(name, f"Invalid JSON: {e}")
        return None


def _records(name: str, raw, model, rep: Report, key: str | None = None) -> list:
    if isinstance(raw, dict) and key and isinstance(raw.get(key), list):
        raw = raw[key]
    if not isinstance(raw, list):
        rep.err(name, "Expected a JSON array of records" + (f" (or an object with a '{key}' array)." if key else "."))
        return []
    out = []
    for n, r in enumerate(raw):
        try:
            out.append(model.model_validate(r))
        except ValidationError as e:
            rep.data["warnings"].append({"file": name, "message": f"Record {n}: rejected - " + "; ".join(
                f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:3])})
            rep.data.setdefault("_rejected", {}).setdefault(name, 0)
            rep.data["_rejected"][name] += 1
    return out


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def _chunks(text: str, size: int = 1200, overlap: int = 150) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    paras, out, cur = [p.strip() for p in re.split(r"\n\s*\n|\n(?=[A-Z0-9])", text) if p.strip()], [], ""
    for p in paras:
        if len(cur) + len(p) + 1 <= size:
            cur = f"{cur}\n{p}".strip()
            continue
        if cur:
            out.append(cur)
        while len(p) > size:
            out.append(p[:size])
            p = p[size - overlap:]
        cur = p
    if cur:
        out.append(cur)
    return out


def _pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader
    # NUL and other control characters (common in OCR'd scans) cannot be stored in Postgres text columns
    clean = lambda t: re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", t)  # noqa: E731
    return [clean(p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages]


def _upload(bucket: str, path: str, data: bytes, ctype: str) -> None:
    get_db().storage.from_(bucket).upload(path, data, {"content-type": ctype, "upsert": "true"})


def ingest_package(files: dict[str, bytes], user_id: str | None, dry_run: bool = False) -> dict:
    s = get_settings()
    rep = Report()
    byname = {n.lower(): (n, b) for n, b in files.items()}
    for n in files:
        kind = "known" if n.lower() in KNOWN else "pdf" if n.lower().endswith(".pdf") else "image" if n.lower().endswith(IMAGE_EXT) else "ignored"
        rep.data["files"].append({"name": n, "size": len(files[n]), "role": kind})
        if kind == "ignored":
            rep.warn(n, "File is not part of the S-PYRO package format and was ignored.")

    # ---- 1/2. identify investigation + publications
    if "investigation.json" not in byname:
        raise HTTPException(422, {"message": "investigation.json is required.", "report": rep.data})
    raw = _json("investigation.json", byname["investigation.json"][1], rep)
    try:
        inv_in = InvestigationIn.model_validate(raw)
    except ValidationError as e:
        rep.err("investigation.json", "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))
        inv_in = None
    except Exception:
        inv_in = None
    if inv_in is None:
        raise HTTPException(422, {"message": "investigation.json is invalid.", "report": _public(rep)})
    pubs_in = ([inv_in.publication] if inv_in.publication else []) + list(inv_in.publications)
    if not pubs_in:
        rep.warn("investigation.json", "No publication metadata supplied; PDFs, publication-linked records and citations will lack a publication.")

    # ---- 3. validate everything BEFORE writing anything
    conds = findings = figs = fire = mission = []
    if "experimental_conditions.json" in byname:
        j = _json("experimental_conditions.json", byname["experimental_conditions.json"][1], rep)
        conds = _records("experimental_conditions.json", j, ConditionIn, rep, "conditions") if j is not None else []
    if "scientific_findings.json" in byname:
        j = _json("scientific_findings.json", byname["scientific_findings.json"][1], rep)
        findings = _records("scientific_findings.json", j, FindingIn, rep, "findings") if j is not None else []
    if "figures.json" in byname:
        j = _json("figures.json", byname["figures.json"][1], rep)
        figs = _records("figures.json", j, FigureIn, rep, "figures") if j is not None else []
    if "fire_safety_applications.json" in byname:
        j = _json("fire_safety_applications.json", byname["fire_safety_applications.json"][1], rep)
        fire = _records("fire_safety_applications.json", j, FireIn, rep) if j is not None else []
        for f in list(fire):
            if f.application_category not in FIRE_CATS or f.status not in ("demonstrated", "potential"):
                rep.warn("fire_safety_applications.json", f"Rejected application with category '{f.application_category}' / status '{f.status}'.")
                fire.remove(f)
    if "mission_relevance.json" in byname:
        j = _json("mission_relevance.json", byname["mission_relevance.json"][1], rep)
        mission = _records("mission_relevance.json", j, MissionIn, rep) if j is not None else []
    refs = None
    if "references.json" in byname:
        refs = _json("references.json", byname["references.json"][1], rep)
        if refs is not None and not isinstance(refs, (list, dict)):
            rep.err("references.json", "Expected an array or object.")

    data_rows, dataset_meta = [], {}
    if "experimental_data.csv" in byname:
        data_rows, dataset_meta = _parse_csv(byname["experimental_data.csv"][1], rep)
    for pdf in [n for n in files if n.lower().endswith(".pdf")]:
        if not files[pdf].startswith(b"%PDF"):
            rep.err(pdf, "File does not look like a PDF.")
    if rep.fatal:
        raise HTTPException(422, {"message": "Validation failed; nothing was written.", "report": _public(rep)})
    rep.data["counts"]["validated"] = {"conditions": len(conds), "findings": len(findings), "figures": len(figs), "data_rows": len(data_rows)}
    if dry_run:
        rep.data["dry_run"] = True
        return _public(rep)

    db = get_db()

    # ---- 4. investigation upsert
    meta = {**inv_in.metadata, **({"limitations": _list(inv_in.limitations)} if inv_in.limitations else {})}
    inv_row = {
        "investigation_code": inv_in.investigation_code.strip(), "title": inv_in.title, "description": inv_in.description,
        "abstract": inv_in.abstract, "research_category": inv_in.research_category, "investigation_type": inv_in.investigation_type,
        "combustion_phenomena": _list(inv_in.combustion_phenomena), "keywords": _list(inv_in.keywords),
        "objectives": _list(inv_in.objectives), "metadata": meta,
    }
    if "methodology.md" in byname:
        inv_row["methodology"] = byname["methodology.md"][1].decode("utf-8-sig", "replace")
    if "research_summary.md" in byname:
        inv_row["research_summary"] = byname["research_summary.md"][1].decode("utf-8-sig", "replace")
    if refs is not None:
        inv_row["references"] = refs
    existing = rows(db.table("investigations").select("id,metadata").eq("investigation_code", inv_row["investigation_code"]).execute())
    if existing:
        inv_row["metadata"] = {**(existing[0]["metadata"] or {}), **meta}
        inv = rows(db.table("investigations").update(inv_row).eq("id", existing[0]["id"]).execute())[0]
        rep.data["investigation"] = {"id": inv["id"], "code": inv["investigation_code"], "action": "updated"}
    else:
        inv = rows(db.table("investigations").insert(inv_row).execute())[0]
        rep.data["investigation"] = {"id": inv["id"], "code": inv["investigation_code"], "action": "created"}
    iid, code = inv["id"], inv["investigation_code"]

    # ---- 5. publications + original PDFs (stored unchanged)
    pdfs = {n: b for n, b in files.items() if n.lower().endswith(".pdf")}
    pub_rows: list[dict] = []
    used_pdfs: set[str] = set()
    for p in pubs_in:
        row = {"investigation_id": iid, "title": p.title, "authors": _list(p.authors), "publication_year": p.publication_year,
               "doi": (p.doi or "").strip() or None, "journal": p.journal, "publication_type": p.publication_type,
               "source_url": p.source_url, "abstract": p.abstract}
        found = []
        if row["doi"]:
            found = rows(db.table("publications").select("id,investigation_id").ilike("doi", row["doi"]).execute())
            if found and found[0]["investigation_id"] != iid:
                rep.err("investigation.json", f"DOI {row['doi']} already belongs to a different investigation.")
                continue
        if not found:
            found = rows(db.table("publications").select("id").eq("investigation_id", iid).eq("title", p.title).execute())
        pub = rows(db.table("publications").update(row).eq("id", found[0]["id"]).execute())[0] if found else \
            rows(db.table("publications").insert(row).execute())[0]
        rep.data.setdefault("publications", []).append({"id": pub["id"], "title": pub["title"], "action": "updated" if found else "created"})
        # match a PDF
        pdf_name = None
        if p.file_name and p.file_name in pdfs:
            pdf_name = p.file_name
        elif len(pubs_in) == 1 and len(pdfs) == 1:
            pdf_name = next(iter(pdfs))
        pub_rows.append({**pub, "_pdf": pdf_name})
    for pr in pub_rows:
        if pr["_pdf"]:
            data = pdfs[pr["_pdf"]]
            sha = hashlib.sha256(data).hexdigest()
            path = f"{_safe(code)}/{sha[:12]}_{_safe(pr['_pdf'])}"
            _upload(s.storage_documents_bucket, path, data, "application/pdf")
            db.table("publications").update({"original_file_path": path, "file_sha256": sha}).eq("id", pr["id"]).execute()
            used_pdfs.add(pr["_pdf"])
            n = _ingest_pdf_chunks(iid, pr["id"], data)
            rep.data.setdefault("pdfs", []).append({"name": pr["_pdf"], "stored_as": path, "sha256": sha, **n})
    for n in pdfs:
        if n not in used_pdfs:
            rep.warn(n, "PDF could not be matched to a publication (set 'file_name' in investigation.json). It was not stored.")

    def pub_for(rec: RecordBase) -> str | None:
        if rec.publication_doi:
            m = next((p for p in pub_rows if (p["doi"] or "").lower() == rec.publication_doi.lower()), None)
            if m:
                return m["id"]
        if rec.publication_title:
            m = next((p for p in pub_rows if p["title"].lower() == rec.publication_title.strip().lower()), None)
            if m:
                return m["id"]
        return pub_rows[0]["id"] if len(pub_rows) == 1 else None

    unlinked = 0

    # ---- conditions
    crow = []
    for c in conds:
        q = parse_quantity(c.value, c.unit)
        key = canonical_key(c.parameter)
        norm = normalise(q) if q else None
        vclass = None
        if key == "gravity":
            vclass = gravity_class(norm[0][0] if norm and not q.is_range else None, f"{c.value} {c.context or ''}")
        pid = pub_for(c)
        unlinked += pid is None
        crow.append({
            "investigation_id": iid, "publication_id": pid, "parameter": c.parameter, "parameter_key": key, "value": str(c.value),
            "value_numeric": q.nums[0] if q and not q.is_range else None, "value_min": q.lo if q else None, "value_max": q.hi if q else None,
            "unit": c.unit or (q.unit if q else None),
            "normalized_value": (sum(norm[0]) / 2 if norm and q.is_range else (norm[0][0] if norm else None)),
            "normalized_unit": norm[2] if norm else None, "value_class": vclass, "context": c.context,
            "source_page": c.source_page, "source_section": c.source_section, "source_table": c.source_table,
            "source_figure": c.source_figure,
            "content_hash": _hash(key or c.parameter, c.value, c.unit, c.context, c.source_page, pid),
        })
    ins = _insert_many("experimental_conditions", crow, "investigation_id,content_hash")
    rep.count("experimental_conditions", ins, len(crow) - ins, rep.data.get("_rejected", {}).get("experimental_conditions.json", 0))

    # ---- findings
    frow = []
    for f in findings:
        et = (f.evidence_type or "other").strip().lower().replace(" ", "_").replace("-", "_")
        if et not in EVIDENCE:
            rep.warn("scientific_findings.json", f"Unknown evidence_type '{f.evidence_type}' stored as 'other'.")
            et = "other"
        pid = pub_for(f)
        unlinked += pid is None
        frow.append({"investigation_id": iid, "publication_id": pid, "description": f.description.strip(), "evidence_type": et,
                     "phenomenon": f.phenomenon, "reported_values": f.reported_values if isinstance(f.reported_values, dict) else
                     ({"values": f.reported_values} if f.reported_values else {}), "source_page": f.source_page,
                     "source_section": f.source_section, "source_figure": f.source_figure, "source_table": f.source_table,
                     "content_hash": _hash(f.description, pid)})
    ins = _insert_many("scientific_findings", frow, "investigation_id,content_hash")
    rep.count("scientific_findings", ins, len(frow) - ins, rep.data.get("_rejected", {}).get("scientific_findings.json", 0))

    # ---- figures (+ image upload)
    imgs = {n.lower(): (n, b) for n, b in files.items() if n.lower().endswith(IMAGE_EXT)}
    firow, img_up = [], 0
    for f in figs:
        pid = pub_for(f)
        path = None
        if f.image_file:
            hit = imgs.get(f.image_file.lower())
            if hit:
                path = f"{_safe(code)}/{_safe(str(f.figure_number))}_{_safe(hit[0])}"
                ctype = "image/svg+xml" if hit[0].lower().endswith(".svg") else f"image/{hit[0].rsplit('.', 1)[-1].lower().replace('jpg', 'jpeg')}"
                _upload(s.storage_figures_bucket, path, hit[1], ctype)
                img_up += 1
            else:
                rep.warn("figures.json", f"Figure {f.figure_number}: image file '{f.image_file}' was not uploaded; no image stored.")
        firow.append({"investigation_id": iid, "publication_id": pid, "figure_number": str(f.figure_number), "caption": f.caption,
                      "page_number": f.page_number or f.source_page, "image_path": path, "x_axis": f.x_axis, "y_axis": f.y_axis,
                      "units": f.units, "description": f.description, "qualitative_observations": f.qualitative_observations})
    if firow:
        dedup = {(r["publication_id"], r["figure_number"]): r for r in firow}
        out = rows(db.table("figures").upsert(list(dedup.values()), on_conflict="investigation_id,publication_id,figure_number").execute())
        rep.count("figures", len(out), len(firow) - len(dedup), 0, images_uploaded=img_up)
    else:
        rep.count("figures", 0, 0, 0, images_uploaded=0)

    # ---- datasets
    if data_rows:
        _ingest_dataset(iid, code, data_rows, dataset_meta, byname["experimental_data.csv"][1], pub_for, rep)

    # ---- optional: fire safety + mission relevance
    if fire:
        fr = rows(db.table("scientific_findings").select("id,description").eq("investigation_id", iid).execute())
        arow = []
        have = {(r["application_category"], _hash(r["description"])) for r in rows(
            db.table("fire_safety_applications").select("application_category,description").eq("investigation_id", iid).execute())}
        for f in fire:
            if (f.application_category, _hash(f.description)) in have:
                continue
            sf = None
            if f.supporting_finding:
                t = f.supporting_finding.strip().lower()[:60]
                sf = next((x["id"] for x in fr if x["description"].lower().startswith(t)), None)
                if not sf:
                    rep.warn("fire_safety_applications.json", "A supporting_finding text did not match any stored finding; application stored without link.")
            arow.append({"investigation_id": iid, "application_category": f.application_category, "description": f.description,
                         "supporting_finding_id": sf, "evidence_type": f.evidence_type, "application_status": f.status, "limitations": f.limitations})
        if arow:
            db.table("fire_safety_applications").insert(arow).execute()
        rep.count("fire_safety_applications", len(arow), len(fire) - len(arow), 0)
    if mission:
        have = {(r["mission_type"], _hash(r["rationale"])) for r in rows(
            db.table("mission_relevance").select("mission_type,rationale").eq("investigation_id", iid).execute())}
        mrow = [{"investigation_id": iid, "mission_type": m.mission_type, "relevance_score": m.relevance_score, "rationale": m.rationale,
                 "supporting_evidence": m.supporting_evidence, "limitations": m.limitations} for m in mission
                if (m.mission_type, _hash(m.rationale)) not in have]
        if mrow:
            db.table("mission_relevance").insert(mrow).execute()
        rep.count("mission_relevance", len(mrow), len(mission) - len(mrow), 0)

    if unlinked:
        rep.warn("package", f"{unlinked} record(s) could not be linked to a publication (several publications and no publication_doi/title); "
                            "they are attached to the investigation only and cannot be cited with a page.")
    pending = db.table("research_chunks").select("id", count="exact").eq("investigation_id", iid).is_("embedding", "null").limit(1).execute().count
    rep.data["chunks_pending_embedding"] = pending or 0
    out = _public(rep)
    try:
        db.table("ingestion_reports").insert({"user_id": user_id, "investigation_id": iid, "report": out}).execute()
    except Exception:
        pass
    return out


def _public(rep: Report) -> dict:
    d = {k: v for k, v in rep.data.items() if not k.startswith("_")}
    d["ok"] = not rep.fatal
    return d


def _insert_many(table: str, rws: list[dict], conflict: str) -> int:
    if not rws:
        return 0
    uniq = {tuple(r[c] for c in conflict.split(",")): r for r in rws}
    n = 0
    for part in chunked(list(uniq.values()), 200):
        n += len(rows(get_db().table(table).upsert(part, on_conflict=conflict, ignore_duplicates=True).execute()))
    return n


def _ingest_pdf_chunks(iid: str, pid: str, data: bytes) -> dict:
    try:
        pages = _pdf_pages(data)
    except Exception:
        return {"pages": 0, "chunks": 0, "note": "PDF text could not be extracted (scanned?)."}
    crow = []
    for pno, text in enumerate(pages, start=1):
        for k, ch in enumerate(_chunks(text)):
            crow.append({"investigation_id": iid, "publication_id": pid, "content": ch, "page_number": pno, "chunk_index": k,
                         "evidence_layer": "original", "content_hash": _hash(pid, pno, ch)})
    n = _insert_many("research_chunks", crow, "investigation_id,content_hash")
    return {"pages": len(pages), "chunks": n, "chunks_duplicate": len(crow) - n}


def _parse_csv(data: bytes, rep: Report) -> tuple[list[dict], dict]:
    name = "experimental_data.csv"
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        rep.err(name, "CSV is not UTF-8 encoded.")
        return [], {}
    reader = csv.DictReader(io.StringIO(text))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    missing = {"dataset_name", "variable", "value"} - set(fields)
    if missing:
        rep.err(name, f"Missing required column(s): {', '.join(sorted(missing))}. Expected: dataset_name, variable, value, unit, "
                      "experimental_condition, source_reference [, row_index, description, source_page, source_table, publication_doi].")
        return [], {}
    out, bad, auto = [], 0, {}
    for n, r in enumerate(reader, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        if not r.get("dataset_name") or not r.get("variable"):
            bad += 1
            continue
        try:
            val = float(r["value"].replace(",", ""))
        except ValueError:
            bad += 1
            rep.warn(name, f"Row {n}: non-numeric value '{r['value']}' rejected (only numerical data is stored).")
            continue
        if r.get("row_index", "").lstrip("-").isdigit():
            idx = int(r["row_index"])
        else:
            key = (r["dataset_name"], r["variable"])
            idx = auto[key] = auto.get(key, -1) + 1
        r.update(_val=val, _idx=idx)
        out.append(r)
    if bad:
        rep.data.setdefault("_rejected", {})[name] = bad
    return out, {}


def _ingest_dataset(iid, code, data_rows, _meta, raw_csv: bytes, pub_for, rep: Report) -> None:
    db = get_db()
    s = get_settings()
    path = f"{_safe(code)}/{hashlib.sha256(raw_csv).hexdigest()[:12]}_experimental_data.csv"
    _upload(s.storage_datasets_bucket, path, raw_csv, "text/csv")
    groups: dict[str, list[dict]] = {}
    for r in data_rows:
        groups.setdefault(r["dataset_name"], []).append(r)
    inserted = replaced = 0
    for name, rs in groups.items():
        first = rs[0]
        pub_stub = type("P", (), {"publication_doi": first.get("publication_doi"), "publication_title": first.get("publication_title")})
        pid = pub_for(pub_stub)
        page = int(first["source_page"]) if first.get("source_page", "").isdigit() else None
        ds_row = {"investigation_id": iid, "publication_id": pid, "dataset_name": name, "description": first.get("description") or None,
                  "file_path": path, "source_page": page, "source_table": first.get("source_table") or None}
        ex = rows(db.table("experimental_datasets").select("id").eq("investigation_id", iid).eq("dataset_name", name).execute())
        if ex:
            ds = rows(db.table("experimental_datasets").update(ds_row).eq("id", ex[0]["id"]).execute())[0]
            db.table("experimental_data").delete().eq("dataset_id", ds["id"]).execute()
            replaced += 1
        else:
            ds = rows(db.table("experimental_datasets").insert(ds_row).execute())[0]
        seen, drow = set(), []
        for r in rs:
            k = (r["_idx"], r["variable"])
            if k in seen:
                rep.data["duplicates"].append({"file": "experimental_data.csv", "dataset": name, "row": r["_idx"], "variable": r["variable"]})
                continue
            seen.add(k)
            drow.append({"dataset_id": ds["id"], "row_index": r["_idx"], "variable": r["variable"], "value": r["_val"],
                         "unit": r.get("unit") or None, "experimental_condition": r.get("experimental_condition") or None,
                         "source_reference": r.get("source_reference") or None})
        for part in chunked(drow, 500):
            db.table("experimental_data").insert(part).execute()
        inserted += len(drow)
    rep.count("experimental_data", inserted, len(data_rows) - inserted, rep.data.get("_rejected", {}).get("experimental_data.csv", 0),
              datasets=len(groups), datasets_replaced=replaced)
