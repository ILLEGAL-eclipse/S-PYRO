"""Convert a 'gemini-code-N.json' extraction set (one publication) into an S-PYRO ingestion package and ingest it.

  gemini-code-6.json  publication metadata        gemini-code-3.json  references
  gemini-code-5.json  experimental conditions     gemini-code-2.json  fire-safety applications
  gemini-code-4.json  scientific findings         gemini-code-1.json  figures

Source wording is carried over unchanged. The only normalisations are structural (field names, units split from
descriptors, figure labels stripped of the word 'Figure') and are listed in README output below.

Usage (run from backend/):  python ../scripts/convert_gemini_code.py <input_folder> <output_folder> [--dry-run|--ingest]
"""
import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "backend"))

# The extraction used its own lettered category list; map onto S-PYRO's fixed categories (reviewable here).
FIRE_CATEGORY = {
    "flame spread over solid materials": "material_flammability",
    "spacecraft habitat fire safety": "oxygen_management",   # the cited finding is an oxygen-concentration extinction threshold
}
EVIDENCE = [("interpretation", "author_interpretation"), ("regression", "numerical_result"), ("calculated", "numerical_result"),
            ("experimental", "experimental_observation")]
TITLE = "Advanced Combustion via Microgravity Experiments (ACME)"   # named in the Figure 1 caption; no investigation title was supplied


def load(p, n):
    return json.loads((p / f"gemini-code-{n}.json").read_text(encoding="utf-8-sig"))


def fig_label(x):
    if not x or str(x).strip().lower() in ("none", "null", "n/a"):
        return None
    return re.sub(r"^(figures?|figs?\.?)\s*", "", str(x).strip(), flags=re.I)


def unit_of(u):
    if not u or str(u).strip().upper() in ("N/A", "NA", "NONE"):
        return None, None
    m = re.match(r"^([A-Za-z%µ°/]+)\s*\((.+)\)$", str(u).strip())
    return (m.group(1), m.group(2)) if m else (str(u).strip(), None)


def build(src: pathlib.Path):
    pub, conds, finds, refs, fire, figs = (load(src, n) for n in (6, 5, 4, 3, 2, 1))
    code = pub["investigation_id"]
    phenomena = list(dict.fromkeys(f["scientific_phenomenon"] for f in finds if f.get("scientific_phenomenon")))
    investigation = {
        "investigation_code": code, "title": TITLE, "abstract": pub["abstract"], "investigation_type": "Flight experiment (ISS)",
        "keywords": pub.get("keywords", []), "combustion_phenomena": phenomena, "objectives": [],
        "metadata": {"publication_date": pub.get("publication_date"), "title_basis": "Named in the Figure 1 caption of the source; no investigation title field was supplied."},
        "publication": {"title": pub["publication_title"], "authors": pub["authors"], "publication_year": pub.get("publication_year"),
                        "doi": pub.get("doi"), "journal": pub.get("journal_or_conference"), "publication_type": pub.get("publication_type"),
                        "abstract": pub["abstract"]},
    }

    cond_rows = []
    for c in conds:
        unit, unit_note = unit_of(c.get("original_unit"))
        value = str(c["original_value"])
        param = c["parameter"]
        ctx = c.get("experimental_context") or ""
        notes = []
        if param == "Fuel types":           # canonical parameter name so that fuel filters and validation can find it
            notes.append("Source parameter: Fuel types"); param = "Fuel"
        if unit_note:
            notes.append(f"Unit as written: {c['original_unit']}")
        if c.get("determination_method"):
            notes.append(f"Determination: {c['determination_method']}")
        if param.startswith("Gravity"):
            unit = None                    # 'g' accompanies a descriptive value, not a number
        cond_rows.append({"parameter": param, "value": value, "unit": unit, "context": "; ".join(x for x in [ctx, *notes] if x),
                          "source_page": c.get("source_page"), "source_section": c.get("source_section")})

    finding_rows = []
    for f in finds:
        et = next((v for k, v in EVIDENCE if k in (f.get("evidence_type") or "").lower()), "other")
        rv = {"reported_numerical_values": f.get("reported_numerical_values"), "authors_interpretation": f.get("authors_interpretation"),
              "limitations_and_qualifications": f.get("limitations_and_qualifications"),
              "experimental_or_computational_context": f.get("experimental_or_computational_context"),
              "associated_experimental_conditions": f.get("associated_experimental_conditions"),
              "evidence_type_as_extracted": f.get("evidence_type"), "extraction_finding_id": f.get("finding_id")}
        finding_rows.append({"description": f["description"], "evidence_type": et, "phenomenon": f.get("scientific_phenomenon"),
                             "reported_values": {k: v for k, v in rv.items() if v not in (None, "")},
                             "source_page": f.get("supporting_page_number"), "source_section": f.get("supporting_section"),
                             "source_figure": fig_label(f.get("supporting_figure_label"))})

    # fire-safety rows -> the stored finding they rest on (both rows cite the Burning Rate Emulator result, FIND-ACME-03)
    bre = next(f for f in finds if f["finding_id"] == "FIND-ACME-03")["description"][:60]
    fire_rows = []
    for a in fire:
        raw = a["application_category"]
        key = re.sub(r"^[A-Z]\.\s*", "", raw).strip().lower()
        cat = FIRE_CATEGORY.get(key)
        if not cat:
            print(f"  ! unmapped fire-safety category skipped: {raw}")
            continue
        status = "demonstrated" if "demonstrat" in a["direct_or_potential_application"].lower() or a["direct_or_potential_application"].lower().startswith("direct") else "potential"
        fire_rows.append({
            "application_category": cat, "status": status, "evidence_type": "experimental_observation",
            "description": f"{a['relevant_scientific finding']} Supporting evidence: {a['supporting_experimental_evidence']}",
            "limitations": a.get("experimental_limitations"), "supporting_finding": bre})

    figure_rows = []
    for f in figs:
        desc = " ".join(x for x in [f.get("what_it_represents"), f"Figure type: {f['figure_type']}." if f.get("figure_type") else None,
                                    f"Legend: {f['legend_information']}" if f.get("legend_information") else None,
                                    f"Conditions represented: {f['experimental_conditions_represented']}" if f.get("experimental_conditions_represented") else None,
                                    f"Related finding: {f['related_scientific_finding']}" if f.get("related_scientific_finding") not in (None, "None") else None] if x)
        figure_rows.append({"figure_number": f["figure_number"], "caption": f.get("caption"), "page_number": f.get("page_number"),
                            "x_axis": f.get("x_axis_and_units"), "y_axis": f.get("y_axis_and_units"), "description": desc,
                            "qualitative_observations": f.get("qualitative_trends_and_observations")})
    return code, {"investigation.json": investigation, "experimental_conditions.json": cond_rows, "scientific_findings.json": finding_rows,
                  "figures.json": figure_rows, "references.json": refs, "fire_safety_applications.json": fire_rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input"), ap.add_argument("output")
    ap.add_argument("--dry-run", action="store_true"), ap.add_argument("--ingest", action="store_true")
    a = ap.parse_args()
    code, pkg = build(pathlib.Path(a.input))
    out = pathlib.Path(a.output) / code
    out.mkdir(parents=True, exist_ok=True)
    for n, c in pkg.items():
        (out / n).write_text(json.dumps(c, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{code}: " + ", ".join(f"{len(v) if isinstance(v, list) else 1} {k.split('.')[0]}" for k, v in pkg.items()) + f" -> {out}")
    if a.ingest or a.dry_run:
        from app.services.ingest import ingest_package
        rep = ingest_package({p.name: p.read_bytes() for p in out.iterdir()}, None, dry_run=a.dry_run)
        print(json.dumps({k: rep.get(k) for k in ("ok", "investigation", "counts", "errors", "warnings")}, indent=1, default=str))


if __name__ == "__main__":
    main()
