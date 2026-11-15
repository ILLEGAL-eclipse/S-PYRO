"""Deterministic validation engine tests (no database / no Gemini)."""
import pytest

from app.schemas import ValidationItem
from app.services import validation as V
from app.services.refs import RefRegistry

INV = {"id": "i1", "investigation_code": "INV-1", "title": "Test"}
PUB = {"id": "p1", "title": "Paper A", "doi": "10.1/x"}


def cond(key, parameter, value, unit, context=None, page=8, table="2", i=1):
    return {"id": f"c{i}", "investigation_id": "i1", "publication_id": "p1", "parameter": parameter, "parameter_key": key,
            "value": value, "unit": unit, "context": context, "source_page": page, "source_section": "Methods",
            "source_table": table, "source_figure": None}


def check(item, conds, key=None):
    from app.services.units import canonical_key
    return V._compare_parameter(item, INV, conds, {"p1": PUB}, key or canonical_key(item.parameter), False)


def P(parameter, value, unit=None, context=None, **kw):
    return ValidationItem(kind="parameter", parameter=parameter, value=value, unit=unit, context=context, **kw)


def test_numeric_discrepancy_with_source():
    r = check(P("Oxygen concentration", "21", "%"), [cond("oxygen_concentration", "Oxygen concentration", "18", "%")])[0]
    assert r["classification"] == "DISCREPANCY" and r["issue_type"] == "numerical"
    assert r["source_value"] == "18 %" and r["source_page"] == 8 and r["source_table"] == "2" and r["publication_id"] == "p1"
    assert "does not establish which value is correct" in r["explanation"]


def test_match():
    r = check(P("O2", "18", "%"), [cond("oxygen_concentration", "Oxygen concentration", "18", "%")])[0]
    assert r["classification"] == "MATCH"


def test_unit_discrepancy():
    r = check(P("Temperature", "300", "°C"), [cond("temperature", "Temperature", "300", "K")])[0]
    assert r["classification"] == "DISCREPANCY" and r["issue_type"] == "unit"


def test_conversion_is_match_not_discrepancy():
    r = check(P("Pressure", "1", "atm"), [cond("pressure", "Pressure", "101.325", "kPa")])[0]
    assert r["classification"] == "MATCH"


def test_context_mismatch_not_discrepancy():
    c = [cond("oxygen_concentration", "Oxygen", "18", "%", context="Test A, drop tower")]
    r = check(P("Oxygen concentration", "21", "%", context="ground flame spread rig"), c)[0]
    assert r["classification"] == "CONTEXT MISMATCH"


def test_multiple_contexts_without_researcher_context_is_insufficient():
    c = [cond("oxygen_concentration", "Oxygen", "18", "%", "Test A", i=1), cond("oxygen_concentration", "Oxygen", "30", "%", "Test B", i=2)]
    r = check(P("Oxygen concentration", "21", "%"), c)[0]
    assert r["classification"] == "INSUFFICIENT EVIDENCE"
    # but the value matches one documented context -> MATCH
    assert check(P("Oxygen concentration", "30", "%"), c)[0]["classification"] == "MATCH"


def test_not_found_when_parameter_undocumented(monkeypatch):
    monkeypatch.setattr(V, "_lookup_dataset", lambda *a, **k: None)
    r = check(P("Flow velocity", "5", "cm/s"), [cond("oxygen_concentration", "Oxygen", "18", "%")])[0]
    assert r["classification"] == "NOT FOUND"


def test_incomparable_units_insufficient():
    r = check(P("Pressure", "5", "kg"), [cond("pressure", "Pressure", "101", "kPa")])[0]
    assert r["classification"] == "INSUFFICIENT EVIDENCE"


def test_categorical():
    c = [cond("fuel", "Fuel", "PMMA", None)]
    assert check(P("Fuel", "pmma"), c)[0]["classification"] == "MATCH"
    assert check(P("Fuel", "methane"), c)[0]["classification"] == "DISCREPANCY"


def test_gravity_regime():
    c = [{**cond("gravity", "Gravity", "1e-6", "g"), "value_class": "microgravity"}]
    assert check(P("Gravity", "microgravity"), c)[0]["classification"] == "MATCH"
    assert check(P("Gravity", "normal gravity"), c)[0]["classification"] == "DISCREPANCY"


def test_citation_page_check():
    c = cond("oxygen_concentration", "Oxygen", "18", "%", page=8)
    it = P("Oxygen", "18", "%", cited_page=9)
    out = V._check_citation(it, c, INV, [PUB], {"p1": PUB})
    assert out[0]["classification"] == "DISCREPANCY" and out[0]["issue_type"] == "citation" and out[0]["source_page"] == 8
    ok = V._check_citation(P("Oxygen", "18", "%", cited_page=8, cited_table="Table 2"), c, INV, [PUB], {"p1": PUB})
    assert all(o["classification"] == "MATCH" for o in ok)
    missing = V._check_citation(P("Oxygen", "18", "%", cited_publication="Some Other Paper"), c, INV, [PUB], {"p1": PUB})
    assert missing[0]["classification"] == "NOT FOUND"


def test_parsers():
    items, rest = V.parse_text_parameters("Oxygen concentration: 21 %\nPressure = 101.3 kPa\nThe flame was blue.")
    assert [i.parameter for i in items] == ["Oxygen concentration", "Pressure"] and items[0].unit == "%" and rest == ["The flame was blue."]
    items, meta, _ = V.parse_json_input('{"investigation":"INV-1","parameters":[{"name":"Oxygen","value":21,"unit":"%"}]}')
    assert items[0].value == "21" and items[0].investigation_hint == "INV-1"
    items, _, _ = V.parse_json_input('{"Pressure": {"value": 101, "unit": "kPa"}, "Fuel": "PMMA"}')
    assert len(items) == 2
    items, _, w = V.parse_csv_input("parameter,value,unit,context\nOxygen,21,%,Test A\nPressure,101,kPa,\n")
    assert len(items) == 2 and items[0].context == "Test A"


def test_duplicate_detection():
    out = V._dup_issues([P("Oxygen", "21", "%"), P("O2 concentration", "18", "%")])
    assert out and out[0]["issue_type"] == "duplicate"


def test_ref_registry_strips_fabricated_citations():
    reg = RefRegistry()
    r1 = reg.add(kind="finding", label="x", investigation_id="i1", page=3)
    text, cites, warns = reg.resolve_answer(f"Fact one [{r1}]. Fact two [R99]. Both [{r1}, R42].")
    assert "R99" not in text and "R42" not in text and [c.ref for c in cites] == [r1] and warns


def test_tool_declarations_and_param_validation():
    from app.services.assistant import _declarations, execute_tool
    decls = _declarations()
    assert {d.name for d in decls} >= {"search_investigations", "search_publications", "search_research_text", "get_investigation_details",
                                       "get_experimental_conditions", "get_scientific_findings", "get_figure_descriptions",
                                       "get_experimental_data", "compare_investigations", "rank_investigations",
                                       "get_fire_safety_applications"}
    out, ok = execute_tool("search_investigations", {"oxygen_min_percent": 500}, RefRegistry())
    assert not ok and "Invalid parameters" in out["error"]
    out, ok = execute_tool("drop_table", {}, RefRegistry())
    assert not ok


def test_api_boots():
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    assert c.get("/health").json()["status"] == "ok"
    assert c.post("/api/mission/analyse", json={"mission_type": "custom"}).status_code == 422
    assert c.post("/api/admin/ingest").status_code in (401, 422, 503)
