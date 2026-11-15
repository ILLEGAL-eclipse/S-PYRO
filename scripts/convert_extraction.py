"""Convert Gemini-extracted research files (investigation.json with an `investigations` array, nested
experimental_conditions.json, scientific_findings.json, figures.json, experimental_data.csv) into S-PYRO ingestion
packages (docs/INGESTION_FORMAT.md), one per investigation, and optionally ingest them.

Nothing is reworded: source text is carried over verbatim. Values that the source states as ranges are kept as ranges;
anything that cannot be expressed as a clean number stays descriptive text (and is therefore never compared numerically).

Usage (from the backend folder so backend/.env is found):
    python ../scripts/convert_extraction.py <input_folder> <output_folder> [--dry-run] [--ingest] [--pdf CODE=path.pdf ...]
"""
import argparse
import csv
import json
import pathlib
import re
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))
from app.services.units import find_unit  # noqa: E402

PUB_TITLES = {  # taken from the corpus_note of investigation.json
    "INV-SPICE-001": "Smoke Point in Co-flow Experiment (SPICE) Final Report",
    "INV-CFI-001": "Cool Flame Investigation (CFI) Science Final Report",
}
NUM = r"[-+]?\d+(?:\.\d+)?"


def clean_unit(u):
    if not u or "not reported" in str(u).lower():
        return None
    u = str(u).strip()
    if find_unit(u):
        return u
    first = re.split(r"[\s(]", u)[0]
    return first if first and find_unit(first) else (u[0] if u.startswith("%") else None)


def strip_prefix(x, pat):
    return re.sub(pat, "", x, flags=re.I).strip() if x else None


def src_of(rec):
    s = rec.get("source") or {}
    return {"source_page": s.get("page"), "source_section": s.get("section"),
            "source_table": strip_prefix(s.get("table"), r"^tables?\s*"),
            "source_figure": strip_prefix(s.get("figure"), r"^(figures?|figs?\.?)\s*")}


def numeric_part(value):
    """'19-24% (nominal 21 +/- 1%)' -> ('19-24', '%'); '10% to 30% operational range' -> ('10-30', '%'); else None."""
    m = re.match(rf"^\s*({NUM})\s*(%|[A-Za-z]+)?\s*(?:-|–|to)\s*({NUM})\s*(%|[A-Za-z/]+)?", str(value))
    if m:
        return f"{m.group(1)}-{m.group(3)}", m.group(2) or m.group(4)
    m = re.match(rf"^\s*({NUM})\s*(%|[A-Za-z/]+)?(?=\s|$|[;,(])", str(value))
    return (m.group(1), m.group(2)) if m else None


def condition_rows(c):
    src = src_of(c)
    rows = []

    def add(param, value, unit=None, context=None):
        rows.append({"parameter": param, "value": value if isinstance(value, str) else str(value), "unit": unit, "context": context, **src})

    def numeric(param, d):
        if not isinstance(d, dict):
            return add(param, d)
        v, u, ctx = d.get("value"), clean_unit(d.get("unit")), d.get("context")
        if isinstance(v, (int, float)):
            return add(param, v, u, ctx)
        np_ = numeric_part(v)
        if np_:
            num, inline_u = np_
            unit = u or clean_unit(inline_u)
            return add(param, num, unit, f"{ctx + '. ' if ctx else ''}Source wording: {v}")
        add(param, v, None, ctx)

    add("Gravity", c["gravity_level"], None, c.get("gravity_environment"))
    add("Fuel", c["fuel_type"])
    add("Material composition", c["material_composition"])
    add("Oxidizer", c["oxidizer"])
    numeric("Oxygen concentration", c["oxygen_concentration"])
    numeric("Pressure", c["ambient_pressure"])
    numeric("Temperature", c["temperature"])
    fv = c.get("flow_velocity")
    if isinstance(fv, dict) and "value" not in fv:
        numeric("Co-flow air velocity", fv.get("co_flow_air_velocity_ua"))
        numeric("Fuel jet velocity", fv.get("fuel_jet_velocity_uf"))
    elif fv:
        numeric("Flow velocity", fv)
    cd = c.get("chamber_dimensions")
    if isinstance(cd, dict):
        for k, v in cd.items():
            add(f"Chamber dimensions ({k.replace('_', ' ')})", v if isinstance(v, str) else json.dumps(v))
    add("Ignition method", c["ignition_method"])
    for k, v in (c.get("experimental_duration") or {}).items():
        add(f"Experimental duration ({k.replace('_', ' ')})", v)
    for item in c.get("equipment_and_instrumentation") or []:
        add("Instrumentation", item)
    for k, v in (c.get("other_relevant_parameters") or {}).items():
        add(k.replace("_", " ").capitalize(), v)
    return rows


# Values stated verbatim in the source text of the CFI conditions (ranges / lists inside prose), added as separate numeric rows
# so that they can be filtered. Each carries the source wording in `context`.
EXTRA_ROWS = {
    "INV-CFI-001": [
        {"parameter": "Oxygen concentration", "value": "21", "unit": "%", "context": "Tested in air (e.g. Y_O2 = 0.210 in FLEX-1223)"},
        {"parameter": "Oxygen concentration", "value": "17", "unit": "%", "context": "Tested, 17% O2 / 83% N2 (Fig. 5)"},
        {"parameter": "Pressure", "value": "0.5-5", "unit": "atm", "context": "Operational requirement (Section: Operational Requirements and Protocols)"},
        *[{"parameter": "Pressure", "value": p, "unit": "atm", "context": "Tested for pure n-dodecane (Fig. 6 / Section 5)"}
          for p in ("0.5", "0.75", "1", "1.25", "2", "3", "5")],
        {"parameter": "Cool-flame temperature", "value": "700-900", "unit": "K", "context": "Cited from FLEX background: cool flames (vs >1200 K for hot flames)"},
    ]
}

EVIDENCE = [("interpretation and comparative", "author_interpretation"), ("regression", "numerical_result"),
            ("calculated", "numerical_result"), ("experimental", "experimental_observation")]


def finding_rows(findings, code):
    out = []
    for f in findings:
        label = f.get("evidence_type") or ""
        et = next((v for k, v in EVIDENCE if k in label.lower()), "other")
        rv = {"reported_numerical_values": f.get("reported_numerical_values"), "evidence_type_as_extracted": label,
              "author_interpretation": f.get("author_interpretation"), "experimental_or_computational_context": f.get("experimental_or_computational_context"),
              "associated_experimental_conditions": f.get("associated_experimental_conditions"), "extraction_finding_id": f.get("finding_id")}
        s = f.get("source") or {}
        out.append({"description": f["description"], "evidence_type": et, "phenomenon": f.get("scientific_phenomenon"),
                    "reported_values": {k: v for k, v in rv.items() if v not in (None, "", {})},
                    "source_page": s.get("page") or f.get("supporting_page_number"), "source_section": s.get("section") or f.get("supporting_section"),
                    "source_figure": strip_prefix(s.get("figure"), r"^(figures?|figs?\.?)\s*"), "source_table": strip_prefix(s.get("table"), r"^tables?\s*")})
    return out


def axis_text(ax):
    if not isinstance(ax, dict):
        return None
    parts = []
    for k, v in ax.items():
        if k.endswith("unit") or v in (None, ""):
            continue
        u = ax.get(k.replace("label", "unit")) if "label" in k else ax.get(k + "_unit")
        parts.append(f"{v} ({u})" if u else str(v))
    return "; ".join(parts) or None


def figure_rows(figs):
    out = []
    for f in figs:
        desc = " ".join(x for x in [f.get("what_the_figure_represents"), f"Figure type: {f['figure_type']}." if f.get("figure_type") else None,
                                    f"Legend: {f['legend_information']}" if f.get("legend_information") else None,
                                    f"Conditions represented: {f['experimental_conditions_represented']}" if f.get("experimental_conditions_represented") else None,
                                    f"Related finding: {f['related_scientific_finding']}" if f.get("related_scientific_finding") else None] if x)
        out.append({"figure_number": f["figure_number"], "caption": f.get("caption"), "page_number": f.get("page_number"),
                    "x_axis": axis_text(f.get("x_axis")), "y_axis": axis_text(f.get("y_axis")), "description": desc,
                    "qualitative_observations": f.get("qualitative_trends_and_observations")})
    return out


DS_NAMES = {"DS-SPICE-01": "SPICE Table 1 - smoke-point ranges by fuel", "DS-CFI-FLEX1223": "CFI FLEX-1223 (n-dodecane, 1.25 atm) - Figure 1 data box",
            "DS-CFI-FLEX1268": "CFI FLEX-1268 (n-dodecane, ~3 atm, He dilution) - Figure 3 data box"}


def data_rows(rows):
    """Range cells ('0.76-1.6') are stored as <variable>_min and <variable>_max; each fuel / test is one table row."""
    out = []
    idx_by_ds = defaultdict(dict)
    for r in rows:
        ds = r["dataset_id"]
        label = r["fuel"] if ds == "DS-SPICE-01" else ds
        idx = idx_by_ds[ds].setdefault(label, len(idx_by_ds[ds]))
        cond = f"{label}; {r['experimental_condition']}" if ds == "DS-SPICE-01" else r["experimental_condition"]
        ref = f"Table 1" if ds == "DS-SPICE-01" else r["source_table"]
        base = {"dataset_name": DS_NAMES.get(ds, ds), "row_index": idx, "unit": r["unit"], "experimental_condition": cond,
                "source_reference": ref + (f"; {r['notes']}" if r.get("notes") else ""), "source_page": r["source_page"], "source_table": strip_prefix(r["source_table"], r"^tables?\s*")}
        m = re.match(rf"^({NUM})\s*-\s*({NUM})$", r["value"].strip())
        if m:
            out.append({**base, "variable": r["variable"] + "_min", "value": m.group(1)})
            out.append({**base, "variable": r["variable"] + "_max", "value": m.group(2)})
        else:
            out.append({**base, "variable": r["variable"], "value": r["value"].strip()})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input"), ap.add_argument("output")
    ap.add_argument("--dry-run", action="store_true"), ap.add_argument("--ingest", action="store_true")
    ap.add_argument("--pdf", action="append", default=[], help="CODE=path/to/original.pdf")
    a = ap.parse_args()
    inp, outp = pathlib.Path(a.input), pathlib.Path(a.output)
    load = lambda n: json.loads((inp / n).read_text(encoding="utf-8-sig"))  # noqa: E731
    invs = load("investigation.json")["investigations"]
    conds = load("experimental_conditions.json")["experimental_conditions"]
    finds = load("scientific_findings.json")["scientific_findings"]
    figs = load("figures.json")["figures"]
    with open(inp / "experimental_data.csv", encoding="utf-8-sig", newline="") as fh:
        data = list(csv.DictReader(fh))
    pdfs = dict(p.split("=", 1) for p in a.pdf)

    for inv in invs:
        code = inv["investigation_id"]
        meta = {k: inv.get(k) for k in ("associated_research_programme", "research_institution", "authors", "associated_publications",
                                         "mission_relevance_explicitly_supported", "investigation_identifier", "publication_date")}
        pkg = {
            "investigation.json": {
                "investigation_code": code, "title": inv["investigation_name"], "abstract": inv.get("abstract"),
                "research_category": inv.get("research_category"), "investigation_type": "Flight experiment (ISS)",
                "combustion_phenomena": inv.get("combustion_phenomena_investigated", []), "keywords": inv.get("keywords", []),
                "objectives": inv.get("research_objectives", []), "metadata": {k: v for k, v in meta.items() if v},
                "publication": {"title": PUB_TITLES[code], "authors": inv.get("authors", []), "publication_year": inv.get("publication_year"),
                                "doi": inv.get("doi"), "publication_type": "Final report", "abstract": inv.get("abstract"),
                                **({"file_name": pathlib.Path(pdfs[code]).name} if code in pdfs else {})}},
            "experimental_conditions.json": [r for c in conds if c["investigation_id"] == code for r in condition_rows(c)] + [
                {**e, **src_of(next(c for c in conds if c["investigation_id"] == code))} for e in EXTRA_ROWS.get(code, [])],
            "scientific_findings.json": finding_rows([f for f in finds if f["investigation_id"] == code], code),
            "figures.json": figure_rows([f for f in figs if f["investigation_id"] == code]),
        }
        d = data_rows([r for r in data if r["investigation_id"] == code])
        d_dir = outp / code
        d_dir.mkdir(parents=True, exist_ok=True)
        for name, content in pkg.items():
            (d_dir / name).write_text(json.dumps(content, indent=2, ensure_ascii=False), encoding="utf-8")
        with open(d_dir / "experimental_data.csv", "w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["dataset_name", "row_index", "variable", "value", "unit", "experimental_condition",
                                               "source_reference", "source_page", "source_table"])
            w.writeheader()
            w.writerows(d)
        print(f"{code}: {len(pkg['experimental_conditions.json'])} conditions, {len(pkg['scientific_findings.json'])} findings, "
              f"{len(pkg['figures.json'])} figures, {len(d)} data rows -> {d_dir}")

        if a.ingest or a.dry_run:
            from app.services.ingest import ingest_package
            files = {p.name: p.read_bytes() for p in d_dir.iterdir()}
            if code in pdfs:
                files[pathlib.Path(pdfs[code]).name] = pathlib.Path(pdfs[code]).read_bytes()
            rep = ingest_package(files, None, dry_run=a.dry_run)
            print(json.dumps({k: rep.get(k) for k in ("ok", "investigation", "counts", "errors", "warnings")}, indent=1, default=str))


if __name__ == "__main__":
    main()
