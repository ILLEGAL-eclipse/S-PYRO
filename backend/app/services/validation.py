"""Source-based scientific consistency checker.

Principle: discrepancies are found ONLY by comparing researcher input with records stored in the S-PYRO
database. Python does every numeric / unit / categorical comparison. Gemini (optional) is limited to
(1) extracting statements from free text (each must quote the input verbatim),
(2) mapping differently-worded parameter names onto existing database parameters (validated against the DB), and
(3) judging whether a documented finding supports / differs from a claim (must quote the finding verbatim).
Every issue references an actual database record. Nothing the researcher submits is ever modified.
"""
from __future__ import annotations

import csv
import io
import json
import re
from typing import Any

from fastapi import HTTPException

from ..config import get_settings
from ..db import get_db, rows
from ..schemas import ValidationItem
from .gemini_client import generate_json
from .retrieval import (ToolError, _like, get_scientific_findings_core, inv_index, pub_index, resolve_investigation)
from .units import (Quantity, canonical_key, categorical_equal, compare_quantities, gravity_class, parse_quantity)

PARAM_ALIASES = {"parameter": ("parameter", "name", "variable", "quantity", "property"),
                 "value": ("value", "val", "measurement", "reading"),
                 "unit": ("unit", "units", "uom"),
                 "context": ("context", "condition", "conditions", "experiment", "test", "run", "experimental_condition"),
                 "claim": ("claim", "finding", "observation", "conclusion", "hypothesis", "text", "statement", "description"),
                 "investigation": ("investigation", "investigation_code", "investigation_id", "experiment_name"),
                 "publication": ("publication", "cited_publication", "paper", "doi", "source"),
                 "page": ("page", "cited_page", "source_page"),
                 "figure": ("figure", "cited_figure", "source_figure"),
                 "table": ("table", "cited_table", "source_table")}
CLAIM_TYPES = {"observations", "hypothesis", "conclusion", "methodology", "notes", "document"}
DISCREPANCY_NOTE = "This comparison does not establish which value is correct for the researcher's current experiment."
STOPWORDS = set("that this with from were have been which their there also into than then these those when while under over "
                "between about after before during using used because would could should shows showed show".split())


def _pick(d: dict, field: str):
    low = {str(k).strip().lower(): v for k, v in d.items()}
    for a in PARAM_ALIASES[field]:
        if a in low and low[a] not in (None, ""):
            return low[a]
    return None


def _s(v) -> str | None:
    return None if v is None else str(v).strip() or None


def _int(v) -> int | None:
    try:
        return int(re.search(r"\d+", str(v)).group()) if v not in (None, "") else None
    except (AttributeError, ValueError):
        return None


# ===================================================================== 1. parsing
def _item_from_dict(d: dict, default_inv: str | None = None) -> ValidationItem | None:
    claim = _pick(d, "claim")
    param = _pick(d, "parameter")
    val = _pick(d, "value")
    base = dict(context=_s(_pick(d, "context")), investigation_hint=_s(_pick(d, "investigation")) or default_inv,
                cited_publication=_s(_pick(d, "publication")), cited_page=_int(_pick(d, "page")),
                cited_figure=_s(_pick(d, "figure")), cited_table=_s(_pick(d, "table")), raw=json.dumps(d, default=str)[:500])
    if param is not None:
        if isinstance(val, dict):   # {"value": 21, "unit": "%"}
            return ValidationItem(kind="parameter", parameter=str(param), value=_s(val.get("value")), unit=_s(val.get("unit")), **base)
        return ValidationItem(kind="parameter", parameter=str(param), value=_s(val), unit=_s(_pick(d, "unit")), **base)
    if claim is not None:
        return ValidationItem(kind="claim", text=str(claim), **base)
    return None


def parse_json_input(text: str) -> tuple[list[ValidationItem], dict, list[str]]:
    try:
        data = json.loads(text)
    except ValueError as e:
        raise HTTPException(422, f"Input is not valid JSON: {e}")
    warns, items = [], []
    meta: dict[str, Any] = {}
    if isinstance(data, dict):
        meta["investigation_hint"] = _s(_pick(data, "investigation"))
        lists = [(k, v) for k, v in data.items() if isinstance(v, list) and k.lower() in
                 ("parameters", "conditions", "measurements", "experimental_conditions", "findings", "claims", "observations", "items", "records")]
        if lists:
            for k, v in lists:
                for e in v:
                    it = _item_from_dict(e, meta["investigation_hint"]) if isinstance(e, dict) else (
                        ValidationItem(kind="claim", text=e, investigation_hint=meta["investigation_hint"], raw=e) if isinstance(e, str) else None)
                    (items.append(it) if it else warns.append(f"Skipped an unreadable entry in '{k}'."))
        else:
            # flat mapping {"Oxygen concentration": "21 %", "Pressure": {"value": 101, "unit": "kPa"}}
            for k, v in data.items():
                if k.lower() in ("investigation", "investigation_code", "title", "description"):
                    continue
                if isinstance(v, (str, int, float)) or isinstance(v, dict):
                    it = _item_from_dict({"parameter": k, "value": v}, meta["investigation_hint"])
                    if it:
                        items.append(it)
    elif isinstance(data, list):
        for e in data:
            it = _item_from_dict(e) if isinstance(e, dict) else None
            (items.append(it) if it else warns.append("Skipped an unreadable entry."))
    else:
        raise HTTPException(422, "JSON input must be an object or a list.")
    return items, meta, warns


def parse_csv_input(text: str) -> tuple[list[ValidationItem], dict, list[str]]:
    try:
        sample = text[:2000]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample.strip() else csv.excel
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise HTTPException(422, "CSV has no header row.")
    items, warns = [], []
    for n, r in enumerate(reader, start=2):
        it = _item_from_dict({k: v for k, v in r.items() if k})
        (items.append(it) if it else warns.append(f"Row {n}: no parameter or statement column recognised; skipped."))
        if len(items) > 500:
            warns.append("Only the first 500 rows were checked.")
            break
    if not items:
        raise HTTPException(422, "No usable rows. Expected columns such as parameter, value, unit, context.")
    return items, {}, warns


_LINE = re.compile(r"^\s*[-*•]?\s*(?P<name>[A-Za-z][^:=\n]{1,80}?)\s*[:=]\s*(?P<value>[-+−]?\d[^\n]*)$")


def parse_text_parameters(text: str) -> tuple[list[ValidationItem], list[str]]:
    """Deterministic 'Name: value unit' line parser. Returns (items, remaining_lines)."""
    items, rest = [], []
    for line in text.splitlines():
        m = _LINE.match(line)
        if m and parse_quantity(m.group("value")) is not None:
            q = parse_quantity(m.group("value"))
            value = " – ".join(f"{n:g}" for n in q.nums)
            items.append(ValidationItem(kind="parameter", parameter=m.group("name").strip(), value=value, unit=q.unit,
                                        raw=line.strip()))
        elif line.strip():
            rest.append(line.strip())
    return items, rest


EXTRACT_SCHEMA = {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {
    "kind": {"type": "string", "enum": ["parameter", "claim"]}, "parameter": {"type": "string", "nullable": True},
    "value": {"type": "string", "nullable": True}, "unit": {"type": "string", "nullable": True},
    "context": {"type": "string", "nullable": True}, "text": {"type": "string", "nullable": True},
    "investigation_hint": {"type": "string", "nullable": True}, "cited_publication": {"type": "string", "nullable": True},
    "cited_page": {"type": "integer", "nullable": True}, "cited_figure": {"type": "string", "nullable": True},
    "cited_table": {"type": "string", "nullable": True}, "raw": {"type": "string"}},
    "required": ["kind", "raw"]}}}, "required": ["items"]}
EXTRACT_SYSTEM = (
    "You extract scientific statements from a researcher's text so that they can be compared with a database. "
    "Extract ONLY what is explicitly written. Never correct, interpret, convert, complete or judge anything. "
    "kind='parameter' for explicit experimental parameters/measurements (name, value as written, unit as written, "
    "context = the experiment/test condition as written). kind='claim' for observations, findings, hypotheses or conclusions "
    "(text = the statement as written). 'raw' must be an exact, verbatim substring of the input. "
    "Fill cited_* and investigation_hint only if the text names them. Output at most 40 items.")


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def ai_extract(text: str, user_id: str | None) -> tuple[list[ValidationItem], list[str]]:
    warns = []
    out = generate_json(text[:30000], EXTRACT_SYSTEM, EXTRACT_SCHEMA, "validation_extract", user_id, 4096)
    norm_input = _norm_ws(text)
    items, dropped = [], 0
    for e in out.get("items", [])[:40]:
        raw = e.get("raw") or ""
        if not raw or _norm_ws(raw) not in norm_input:      # must be traceable to the researcher's own words
            dropped += 1
            continue
        try:
            items.append(ValidationItem(**{k: v for k, v in e.items() if k in ValidationItem.model_fields}))
        except Exception:
            dropped += 1
    if dropped:
        warns.append(f"{dropped} AI-extracted statement(s) were discarded because they could not be traced verbatim to your input.")
    return items, warns


def extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(f"[page {i + 1}]\n{(p.extract_text() or '').strip()}" for i, p in enumerate(reader.pages[:40]))
    except Exception:
        raise HTTPException(422, "The uploaded PDF could not be read.")


# ===================================================================== 2. investigation resolution
def identify_investigations(text: str, hints: set[str]) -> list[dict]:
    """Find investigations the input explicitly names (by code or title). No guessing."""
    allinv = rows(get_db().table("investigations").select("id,investigation_code,title").limit(2000).execute())
    low = text.lower()
    found = {}
    for i in allinv:
        code, title = i["investigation_code"].lower(), i["title"].lower()
        if re.search(rf"(?<![a-z0-9]){re.escape(code)}(?![a-z0-9])", low) or title in low or any(
                h.lower() in (code, title) for h in hints if h):
            found[i["id"]] = i
    return list(found.values())


def _candidates_for(text: str) -> list[dict]:
    try:
        r = rows(get_db().rpc("filter_investigations", {"q": _like(text)[:150], "lim": 5}).execute())
        inv = inv_index([x["id"] for x in r])
        return [{"id": k, "code": v["investigation_code"], "title": v["title"]} for k, v in inv.items()]
    except Exception:
        return []


# ===================================================================== 3. comparison
def _vstr(value: str | None, unit: str | None) -> str:
    return " ".join(x for x in (value, unit) if x)


def _src_str(c: dict) -> str:
    return _vstr(c["value"], c["unit"])


def _ctx_rel(rc: str | None, cc: str | None) -> str:
    if not rc or not cc:
        return "unknown"
    return "same" if categorical_equal(rc, cc) != "different" else "different"


def _issue(item: ValidationItem, cls: str, itype: str, explanation: str, *, inv=None, pub=None, cond=None, finding=None,
           source_value: str | None = None, extra: dict | None = None) -> dict:
    rec = cond or finding or {}
    return {
        "issue_type": itype, "classification": cls,
        "parameter": item.parameter or (item.text[:80] if item.text else None),
        "researcher_value": _vstr(item.value, item.unit) if item.kind == "parameter" else item.text,
        "source_value": source_value,
        "publication_id": (pub or {}).get("id") or rec.get("publication_id"),
        "investigation_id": (inv or {}).get("id") or rec.get("investigation_id"),
        "source_page": rec.get("source_page"), "source_section": rec.get("source_section"),
        "source_figure": rec.get("source_figure"), "source_table": rec.get("source_table"),
        "source_record": {**({"kind": "condition" if cond else "finding", "id": rec.get("id")} if rec else {}), **(extra or {}),
                          "input_item": item.model_dump(exclude_none=True)},
        "explanation": explanation,
    }


def _compare_parameter(item: ValidationItem, inv: dict, conds: list[dict], pubs: dict[str, dict],
                       key: str | None, mapped_by_ai: bool) -> list[dict]:
    tol = get_settings().validation_rel_tol
    name = item.parameter or "parameter"
    cands = [c for c in conds if key and c["parameter_key"] == key]
    ai_note = " The parameter name was matched to this database parameter with AI assistance; please confirm they denote the same quantity." if mapped_by_ai else ""
    if not item.value:
        return [_issue(item, "INSUFFICIENT EVIDENCE", "missing_value",
                       f"No value was supplied for '{name}', so nothing could be compared.", inv=inv)]
    if not cands:
        # secondary: numerical data tables
        hit = _lookup_dataset(item, inv, key, tol)
        if hit:
            return [hit]
        return [_issue(item, "NOT FOUND", "numerical",
                       f"The database holds no documented '{name}' for investigation {inv['investigation_code']}. "
                       "Verification was not possible; no outside scientific knowledge was substituted.", inv=inv)]

    rc = item.context
    allowed = [c for c in cands if _ctx_rel(rc, c["context"]) != "different"]
    if rc and not allowed:
        first = cands[0]
        return [_issue(item, "CONTEXT MISMATCH", "condition",
                       f"Your context ('{rc}') differs from the documented contexts for '{name}': "
                       + "; ".join(f"{_src_str(c)} ({c['context'] or 'no context given'})" for c in cands[:5])
                       + ". The values refer to different experimental contexts, so no discrepancy is asserted." + ai_note,
                       inv=inv, pub=pubs.get(first["publication_id"]), cond=first,
                       source_value="; ".join(f"{_src_str(c)} [{c['context'] or 'n/a'}]" for c in cands[:5]))]

    rq = parse_quantity(item.value, item.unit)
    # ---- categorical values (fuel, material, gravity regime, ...)
    if rq is None:
        return [_compare_categorical(item, inv, allowed, pubs, key, ai_note)]

    results = []
    for c in allowed:
        sq = parse_quantity(c["value"], c["unit"])
        if sq is None:
            results.append((c, None))
            continue
        results.append((c, compare_quantities(rq, sq, tol)))
    numeric = [(c, r) for c, r in results if r is not None]
    if not numeric:
        c = allowed[0]
        return [_issue(item, "INSUFFICIENT EVIDENCE", "numerical",
                       f"Your value is numeric but the documented value for '{name}' is descriptive ('{c['value']}'); not comparable." + ai_note,
                       inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))]

    matches = [(c, r) for c, r in numeric if r.outcome in ("match", "match_in_range")]
    if matches:
        c, r = matches[0]
        extra = " " + r.note if r.note else ""
        return [_issue(item, "MATCH", "numerical",
                       f"Your {name} ({_vstr(item.value, item.unit)}) agrees with the documented value ({_src_str(c)})." + extra + ai_note,
                       inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))]

    # no agreement. Several documented contexts and no researcher context => ambiguous
    ctxs = {(c["context"] or "").strip().lower() for c, _ in numeric}
    if len(ctxs) > 1 and not rc:
        listing = "; ".join(f"{_src_str(c)} [{c['context'] or 'no context'}]" for c, _ in numeric[:6])
        c0 = numeric[0][0]
        return [_issue(item, "INSUFFICIENT EVIDENCE", "numerical",
                       f"The source documents different values for '{name}' under different contexts ({listing}) and your input "
                       "specifies no context, so a single comparison is not meaningful. Add a context (e.g. test or condition) and re-run." + ai_note,
                       inv=inv, pub=pubs.get(c0["publication_id"]), cond=c0, source_value=listing)]

    def sortkey(cr):
        r = cr[1]
        return (r.delta_rel if r.delta_rel is not None else 1e9)
    c, r = sorted(numeric, key=sortkey)[0]
    if r.outcome == "unit_discrepancy":
        return [_issue(item, "DISCREPANCY", "unit",
                       f"Unit difference for {name}: researcher input {_vstr(item.value, item.unit)}; documented {_src_str(c)}. "
                       + r.note + " The parameter and context correspond, so this may be a unit or conversion difference. " + DISCREPANCY_NOTE + ai_note,
                       inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))]
    if r.outcome in ("unit_missing", "incomparable"):
        return [_issue(item, "INSUFFICIENT EVIDENCE", "unit", r.note + f" (Documented: {_src_str(c)}; input: {_vstr(item.value, item.unit)}.)" + ai_note,
                       inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))]
    diff = ""
    if r.delta_abs is not None:
        diff = f" Difference: {r.delta_abs:+.6g} {r.unit or ''}" + (f" ({r.delta_rel * 100:.3g}% of the documented value)." if r.delta_rel is not None else ".")
    return [_issue(item, "DISCREPANCY", "numerical",
                   f"The supplied {name} ({_vstr(item.value, item.unit)}) differs from the value reported in the referenced experiment "
                   f"({_src_str(c)}).{diff} {r.note} {DISCREPANCY_NOTE}{ai_note}".replace("  ", " "),
                   inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))]


def _compare_categorical(item: ValidationItem, inv: dict, cands: list[dict], pubs: dict, key: str | None, ai_note: str) -> dict:
    name = item.parameter or "parameter"
    val = item.value or ""
    if key == "gravity":
        rcls = gravity_class(text=val)
        scls = {c["value_class"] for c in cands if c["value_class"]}
        if rcls and scls:
            c = next((c for c in cands if c["value_class"] == rcls), cands[0])
            if rcls in scls:
                return _issue(item, "MATCH", "condition",
                              f"Gravity regime '{val}' ({rcls}) agrees with the documented condition ({_src_str(c)}); compared at regime level only." + ai_note,
                              inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))
            return _issue(item, "DISCREPANCY", "condition",
                          f"Gravity regime '{val}' ({rcls}) differs from the documented {', '.join(sorted(scls))} condition ({_src_str(c)}). {DISCREPANCY_NOTE}" + ai_note,
                          inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))
    rels = [(c, categorical_equal(val, c["value"])) for c in cands]
    for c, r in rels:
        if r == "equal":
            return _issue(item, "MATCH", "condition", f"{name} '{val}' agrees with the documented value '{c['value']}'." + ai_note,
                          inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))
    c, r = next(((c, r) for c, r in rels if r == "overlap"), (None, None))
    listing = "; ".join(f"{_src_str(x)} [{x['context'] or 'no context'}]" for x in cands[:5])
    if c:
        return _issue(item, "INSUFFICIENT EVIDENCE", "condition",
                      f"{name} '{val}' and the documented '{c['value']}' overlap textually but are worded differently; whether they denote the same "
                      "material or condition cannot be established by text comparison alone." + ai_note,
                      inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=listing)
    ctxs = {(x["context"] or "").lower() for x in cands}
    if len(ctxs) > 1 and not item.context:
        return _issue(item, "INSUFFICIENT EVIDENCE", "condition",
                      f"The source documents several values for '{name}' under different contexts ({listing}); specify a context to compare." + ai_note,
                      inv=inv, pub=pubs.get(cands[0]["publication_id"]), cond=cands[0], source_value=listing)
    c = cands[0]
    return _issue(item, "DISCREPANCY", "condition",
                  f"The supplied {name} ('{val}') differs from the documented value ('{c['value']}'). Comparison is textual; synonyms or alternative "
                  f"names for the same material are not recognised automatically. {DISCREPANCY_NOTE}" + ai_note,
                  inv=inv, pub=pubs.get(c["publication_id"]), cond=c, source_value=_src_str(c))


def _lookup_dataset(item: ValidationItem, inv: dict, key: str | None, tol: float) -> dict | None:
    """Secondary source: numeric tables extracted from the publications."""
    db = get_db()
    dss = rows(db.table("experimental_datasets").select("id,dataset_name,source_page,source_table,publication_id").eq(
        "investigation_id", inv["id"]).execute())
    if not dss or not key:
        return None
    data = rows(db.table("experimental_data").select("dataset_id,variable,value,unit").in_(
        "dataset_id", [d["id"] for d in dss]).limit(5000).execute())
    var_rows = [r for r in data if canonical_key(r["variable"]) == key]
    if not var_rows:
        return None
    rq = parse_quantity(item.value, item.unit)
    ds = {d["id"]: d for d in dss}
    for r in var_rows:
        sq = parse_quantity(r["value"], r["unit"])
        if rq and sq and compare_quantities(rq, sq, tol).outcome in ("match", "match_in_range"):
            d = ds[r["dataset_id"]]
            return _issue(item, "MATCH", "numerical",
                          f"Your value appears in dataset '{d['dataset_name']}' ({r['variable']} = {r['value']} {r['unit'] or ''}).",
                          inv=inv, cond={"id": None, "publication_id": d["publication_id"], "source_page": d["source_page"],
                                         "source_table": d["source_table"]}, source_value=f"{r['value']} {r['unit'] or ''}".strip(),
                          extra={"kind": "dataset", "dataset_id": r["dataset_id"]})
    d = ds[var_rows[0]["dataset_id"]]
    return _issue(item, "INSUFFICIENT EVIDENCE", "numerical",
                  f"'{item.parameter}' exists as a variable in dataset '{d['dataset_name']}' ({len(var_rows)} stored values), but your value is not among them. "
                  "A dataset holds many measurements, so this is not treated as a discrepancy.",
                  inv=inv, cond={"id": None, "publication_id": d["publication_id"], "source_page": d["source_page"], "source_table": d["source_table"]},
                  extra={"kind": "dataset", "dataset_id": d["id"]})


# ---- citation checks ---------------------------------------------------
def _norm_ref(x: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^(table|fig(ure)?\.?)", "", (x or "").lower()))


def _check_citation(item: ValidationItem, primary: dict | None, inv: dict, inv_pubs: list[dict], pubs: dict) -> list[dict]:
    if not any((item.cited_publication, item.cited_page, item.cited_figure, item.cited_table)):
        return []
    out = []
    cited_pub = None
    if item.cited_publication:
        t = item.cited_publication.strip().lower()
        cited_pub = next((p for p in inv_pubs if (p["doi"] and p["doi"].lower() in t) or t in p["title"].lower()
                          or p["title"].lower() in t), None)
        if not cited_pub:
            return [_issue(item, "NOT FOUND", "citation",
                           f"The cited publication '{item.cited_publication}' is not among the publications stored for investigation "
                           f"{inv['investigation_code']}; the citation could not be checked.", inv=inv)]
    if not primary or primary.get("id") is None:
        return [_issue(item, "INSUFFICIENT EVIDENCE", "citation",
                       "No matching source record was found, so the cited page / figure / table could not be verified.", inv=inv, pub=cited_pub)]
    pub = pubs.get(primary["publication_id"]) or {}
    if cited_pub and primary["publication_id"] and cited_pub["id"] != primary["publication_id"]:
        out.append(_issue(item, "DISCREPANCY", "citation",
                          f"The matching record is documented in '{pub.get('title', 'another publication')}', not in the cited publication "
                          f"'{cited_pub['title']}'. {DISCREPANCY_NOTE}", inv=inv, pub=pub or None, cond=primary,
                          source_value=pub.get("title")))
    for label, cited, have in (("page", item.cited_page, primary.get("source_page")),
                               ("table", item.cited_table, primary.get("source_table")),
                               ("figure", item.cited_figure, primary.get("source_figure"))):
        if cited in (None, ""):
            continue
        if have in (None, ""):
            out.append(_issue(item, "INSUFFICIENT EVIDENCE", "citation",
                              f"You cite {label} {cited}, but the stored source record has no {label} reference to check it against.",
                              inv=inv, pub=pub or None, cond=primary))
        elif _norm_ref(str(cited)) == _norm_ref(str(have)):
            out.append(_issue(item, "MATCH", "citation", f"Cited {label} {cited} agrees with the stored source record ({label} {have}).",
                              inv=inv, pub=pub or None, cond=primary, source_value=f"{label} {have}"))
        else:
            out.append(_issue(item, "DISCREPANCY", "citation",
                              f"You cite {label} {cited}; the stored source record is located at {label} {have}. {DISCREPANCY_NOTE}",
                              inv=inv, pub=pub or None, cond=primary, source_value=f"{label} {have}"))
    return out


# ---- findings / claims --------------------------------------------------
JUDGE_SCHEMA = {"type": "object", "properties": {
    "relation": {"type": "string", "enum": ["supported", "differs", "different_context", "not_comparable"]},
    "finding_id": {"type": "string", "nullable": True}, "quote": {"type": "string", "nullable": True},
    "explanation": {"type": "string"}}, "required": ["relation", "explanation"]}
JUDGE_SYSTEM = (
    "You compare a researcher's statement with documented findings from one database. You do NOT decide what is scientifically true "
    "and you use NO outside knowledge. Choose one relation: 'supported' (a documented finding reports the same observation/conclusion "
    "under comparable conditions), 'differs' (a documented finding explicitly reports a different observation under comparable conditions), "
    "'different_context' (the conditions or setting described differ, so they are not contradictory), or 'not_comparable' (no provided finding "
    "addresses the statement). If relation is not 'not_comparable', give finding_id (one of the supplied ids) and 'quote' = an exact verbatim "
    "excerpt of that finding's description that your decision rests on. Explain in two sentences or fewer, describing the difference only.")


def _keywords(text: str) -> list[str]:
    return [w for w in dict.fromkeys(re.findall(r"[a-z][a-z0-9-]{3,}", text.lower())) if w not in STOPWORDS][:12]


def _compare_claim(item: ValidationItem, inv: dict, pubs: dict, user_id: str | None, ai_ok: bool) -> list[dict]:
    text = item.text or ""
    kws = _keywords(text)
    found = []
    if kws:
        found = get_scientific_findings_core(inv, query=" or ".join(kws), limit=40)
    scored = sorted(found, key=lambda f: -len(set(kws) & set(_keywords(f["description"] + " " + (f["phenomenon"] or "")))))
    cands = [f for f in scored if len(set(kws) & set(_keywords(f["description"] + " " + (f["phenomenon"] or "")))) >= 1][:4]
    if not cands:
        return [_issue(item, "NOT FOUND", "finding",
                       f"No documented finding in investigation {inv['investigation_code']} addresses this statement. Verification was not possible.",
                       inv=inv)]
    listing = " | ".join(f"[{f['evidence_type']}] {f['description'][:160]}" for f in cands[:3])
    if not ai_ok:
        f = cands[0]
        return [_issue(item, "INSUFFICIENT EVIDENCE", "finding",
                       "Automated comparison of free-text findings needs the Gemini service, which is not configured. Candidate documented findings for "
                       "manual review: " + listing, inv=inv, pub=pubs.get(f["publication_id"]), finding=f, source_value=f["description"])]
    prompt = json.dumps({"researcher_statement": text, "researcher_context": item.context,
                         "documented_findings": [{"finding_id": f["id"], "evidence_type": f["evidence_type"], "phenomenon": f["phenomenon"],
                                                  "description": f["description"], "reported_values": f["reported_values"]} for f in cands]})
    j = generate_json(prompt, JUDGE_SYSTEM, JUDGE_SCHEMA, "validation_judge", user_id, 800)
    f = next((x for x in cands if x["id"] == j.get("finding_id")), None)
    rel = j.get("relation")
    if rel == "not_comparable" or f is None or not j.get("quote") or _norm_ws(j["quote"]) not in _norm_ws(f["description"]):
        f0 = cands[0]
        why = "" if rel == "not_comparable" else " (the AI comparison could not be tied to a verbatim source quotation and was discarded)"
        return [_issue(item, "INSUFFICIENT EVIDENCE", "finding",
                       "No documented finding could be established as directly comparable to this statement" + why + ". Candidates: " + listing,
                       inv=inv, pub=pubs.get(f0["publication_id"]), finding=f0, source_value=f0["description"])]
    cls = {"supported": "MATCH", "differs": "DISCREPANCY", "different_context": "CONTEXT MISMATCH"}[rel]
    interp = " Note: the documented statement is an author interpretation, not an experimental observation." \
        if f["evidence_type"] == "author_interpretation" else ""
    expl = (f"AI-assisted comparison (verify against the source). Documented finding: “{j['quote']}”. {j['explanation']}"
            + interp + (" " + DISCREPANCY_NOTE if cls == "DISCREPANCY" else ""))
    return [_issue(item, cls, "finding", expl, inv=inv, pub=pubs.get(f["publication_id"]), finding=f, source_value=f["description"],
                   extra={"ai_assisted": True, "quote": j["quote"]})]


# ---- parameter-name mapping (AI, validated) --------------------------------
MAP_SCHEMA = {"type": "object", "properties": {"mappings": {"type": "array", "items": {"type": "object", "properties": {
    "researcher_parameter": {"type": "string"}, "database_key": {"type": "string", "nullable": True}},
    "required": ["researcher_parameter"]}}}, "required": ["mappings"]}
MAP_SYSTEM = (
    "Map each researcher parameter name to a database parameter key ONLY if both denote the same physical quantity in the same sense "
    "(e.g. 'O2 level' = 'oxygen_concentration'). Never map across different qualifiers (flame temperature vs ambient temperature, "
    "partial vs total pressure). If unsure, return null. Choose database_key strictly from the provided list.")


def ai_map_parameters(names: list[str], db_keys: dict[str, str], user_id: str | None) -> dict[str, str]:
    if not names or not db_keys:
        return {}
    out = generate_json(json.dumps({"researcher_parameters": names, "database_parameters": [{"key": k, "as_documented": v} for k, v in db_keys.items()]}),
                        MAP_SYSTEM, MAP_SCHEMA, "validation_map", user_id, 800)
    return {m["researcher_parameter"]: m["database_key"] for m in out.get("mappings", [])
            if m.get("database_key") in db_keys and m.get("researcher_parameter") in names}


# ===================================================================== 4. orchestration
def _dup_issues(items: list[ValidationItem]) -> list[dict]:
    seen: dict[tuple, ValidationItem] = {}
    out = []
    for it in items:
        if it.kind != "parameter" or not it.value:
            continue
        k = (canonical_key(it.parameter), (it.context or "").lower())
        if k[0] is None:
            continue
        if k in seen:
            a, b = parse_quantity(seen[k].value, seen[k].unit), parse_quantity(it.value, it.unit)
            same = a and b and compare_quantities(a, b, get_settings().validation_rel_tol).outcome.startswith("match")
            out.append(_issue(it, "INSUFFICIENT EVIDENCE", "duplicate",
                              f"'{it.parameter}' appears more than once in your input" + ("" if same else
                              f" with different values ({_vstr(seen[k].value, seen[k].unit)} and {_vstr(it.value, it.unit)})")
                              + ". Both entries were kept and checked; duplicates are reported for your information only (no database source involved)."))
        else:
            seen[k] = it
    return out


def build_items(input_type: str, content: str, use_ai: bool, user_id: str | None) -> tuple[list[ValidationItem], dict, list[str], dict]:
    meta: dict[str, Any] = {}
    warns: list[str] = []
    flags = {"ai_extraction": False}
    if input_type == "json":
        items, meta, w = parse_json_input(content)
    elif input_type == "csv":
        items, meta, w = parse_csv_input(content)
    else:
        items, rest = parse_text_parameters(content)
        w = []
        needs_ai = input_type in CLAIM_TYPES or (rest and input_type != "parameters" and input_type != "measurements")
        if needs_ai and rest:
            if use_ai:
                extra, w2 = ai_extract(content, user_id)
                flags["ai_extraction"] = True
                known = {(canonical_key(i.parameter), i.value) for i in items}
                items += [e for e in extra if not (e.kind == "parameter" and (canonical_key(e.parameter), e.value) in known)]
                w += w2
            else:
                w.append("Free-text statements (findings, hypotheses, methodology) can only be extracted with the Gemini service, which is not "
                         "configured. Only explicit 'Parameter: value unit' lines were checked.")
        elif rest and input_type in ("parameters", "measurements"):
            w.append(f"{len(rest)} line(s) were not recognised as 'Parameter: value unit' and were not checked.")
    warns += w
    if not items:
        raise HTTPException(422, "No checkable parameters or statements were found in the input.")
    return items[:200], meta, warns, flags


def run_validation(*, input_type: str, content: str, investigation_ref: str | None, user_id: str | None, filename: str | None = None,
                   file_bytes: bytes | None = None) -> dict:
    db = get_db()
    s = get_settings()
    ai_ok = s.gemini_configured
    original = {"raw": content, "input_type": input_type, "investigation_ref": investigation_ref, "filename": filename}
    if file_bytes is not None and filename and filename.lower().endswith(".pdf"):
        content = extract_pdf_text(file_bytes)
        original["extracted_text"] = content
        input_type = "document"
    items, meta, warns, flags = build_items(input_type, content, ai_ok, user_id)

    # --- 2. investigation context
    explicit = None
    if investigation_ref:
        try:
            explicit = resolve_investigation(investigation_ref)
        except ToolError as e:
            raise HTTPException(404, str(e))
    hints = {i.investigation_hint for i in items if i.investigation_hint} | ({meta["investigation_hint"]} if meta.get("investigation_hint") else set())
    named = identify_investigations(content, hints) if not explicit else []
    session_inv = explicit or (named[0] if len(named) == 1 else None)
    if len(named) > 1 and not explicit:
        warns.append("The input names several investigations (" + ", ".join(n["investigation_code"] for n in named) +
                     "). Items are checked against the investigation they name; others are reported as not checkable. Select one explicitly to avoid ambiguity.")
    named_by_id = {n["id"]: n for n in named}

    cache: dict[str, dict] = {}

    def context_for(inv: dict) -> dict:
        if inv["id"] not in cache:
            full = rows(db.table("investigations").select("*").eq("id", inv["id"]).execute())[0]
            conds = rows(db.table("experimental_conditions").select("*").eq("investigation_id", inv["id"]).limit(2000).execute())
            ps = rows(db.table("publications").select("id,investigation_id,title,doi,publication_year").eq("investigation_id", inv["id"]).execute())
            cache[inv["id"]] = {"inv": full, "conds": conds, "pubs": ps, "pub_by_id": {p["id"]: p for p in ps}}
        return cache[inv["id"]]

    def inv_for_item(it: ValidationItem) -> dict | None:
        if explicit:
            return explicit
        if it.investigation_hint:
            h = it.investigation_hint.lower()
            m = next((n for n in named if h in (n["investigation_code"].lower(), n["title"].lower())), None)
            if m:
                return m
        return session_inv

    issues: list[dict] = []
    # AI mapping of unresolved parameter names, one call per investigation
    ai_maps: dict[str, dict[str, str]] = {}
    if ai_ok:
        pending: dict[str, list[str]] = {}
        for it in items:
            inv = inv_for_item(it)
            if inv and it.kind == "parameter" and it.parameter:
                cx = context_for(inv)
                k = canonical_key(it.parameter)
                if not any(c["parameter_key"] == k for c in cx["conds"]):
                    pending.setdefault(inv["id"], []).append(it.parameter)
        for iid, names in pending.items():
            keys = {c["parameter_key"]: c["parameter"] for c in cache[iid]["conds"] if c["parameter_key"]}
            try:
                ai_maps[iid] = ai_map_parameters(sorted(set(names)), keys, user_id)
            except HTTPException:
                warns.append("AI parameter-name mapping was unavailable; only exact/known parameter names were matched.")
                break

    for it in items:
        inv = inv_for_item(it)
        if inv is None:
            issues.append(_issue(it, "NOT FOUND", "context",
                                 "No investigation was specified or explicitly named in the input, so there is no database record to compare against. "
                                 "Select an investigation and re-run. Verification was not possible.",
                                 extra={"candidates": _candidates_for((it.parameter or it.text or "") + " " + (it.context or ""))}))
            continue
        cx = context_for(inv)
        inv = cx["inv"]
        if it.kind == "claim":
            res = _compare_claim(it, inv, cx["pub_by_id"], user_id, ai_ok)
        else:
            key = canonical_key(it.parameter)
            mapped = False
            if not any(c["parameter_key"] == key for c in cx["conds"]):
                m = ai_maps.get(inv["id"], {}).get(it.parameter or "")
                if m:
                    key, mapped = m, True
            res = _compare_parameter(it, inv, cx["conds"], cx["pub_by_id"], key, mapped)
            primary = None
            if res and res[0]["source_record"].get("kind") == "condition":
                rid = res[0]["source_record"].get("id")
                primary = next((c for c in cx["conds"] if c["id"] == rid), None)
            res += _check_citation(it, primary, inv, cx["pubs"], cx["pub_by_id"])
        issues += res
    issues += _dup_issues(items)

    counts: dict[str, int] = {}
    for i in issues:
        counts[i["classification"]] = counts.get(i["classification"], 0) + 1
    context = {"investigation": {"id": session_inv["id"], "code": session_inv["investigation_code"], "title": session_inv["title"]} if session_inv else None,
               "investigations_named": [{"id": n["id"], "code": n["investigation_code"]} for n in named_by_id.values()],
               "items_checked": len(items), "counts": counts, "warnings": warns, "ai_used": flags["ai_extraction"] or ai_ok,
               "tolerance_relative": s.validation_rel_tol}
    sess = rows(db.table("validation_sessions").insert({
        "user_id": user_id, "submitted_input": original, "input_type": input_type, "status": "completed",
        "context": context}).execute())[0]
    for i in issues:
        i["session_id"] = sess["id"]
    if issues:
        db.table("validation_issues").insert(issues).execute()
    if file_bytes is not None and filename:
        try:
            db.storage.from_(s.storage_datasets_bucket).upload(f"validation/{sess['id']}/{re.sub(r'[^A-Za-z0-9._-]', '_', filename)}", file_bytes)
        except Exception:
            pass  # original text is already preserved in submitted_input
    return get_session(sess["id"], user_id, check_owner=False)


def get_session(session_id: str, user_id: str | None, check_owner: bool = True) -> dict:
    db = get_db()
    r = rows(db.table("validation_sessions").select("*").eq("id", session_id).execute())
    if not r:
        raise HTTPException(404, "Validation session not found.")
    sess = r[0]
    if check_owner and sess["user_id"] and sess["user_id"] != user_id:
        raise HTTPException(403, "This validation session belongs to another user.")
    issues = rows(db.table("validation_issues").select("*").eq("session_id", session_id).order("created_at").execute())
    pubs = pub_index([i["publication_id"] for i in issues if i["publication_id"]])
    invs = inv_index([i["investigation_id"] for i in issues if i["investigation_id"]])
    for i in issues:
        p, v = pubs.get(i["publication_id"]), invs.get(i["investigation_id"])
        i["publication_title"] = p["title"] if p else None
        i["investigation_code"] = v["investigation_code"] if v else None
        i["investigation_title"] = v["title"] if v else None
    return {"session": sess, "issues": issues}
