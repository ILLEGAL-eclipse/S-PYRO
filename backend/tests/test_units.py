from app.services.units import canonical_key, compare_quantities, parse_quantity, gravity_class, categorical_equal


def cmp(a, ua, b, ub):
    return compare_quantities(parse_quantity(a, ua), parse_quantity(b, ub))


def test_parse_inline_units():
    q = parse_quantity("21 %")
    assert q.nums == [21.0] and q.unit == "%"
    q = parse_quantity("18-21 vol%")
    assert q.nums == [18.0, 21.0]
    q = parse_quantity("300 °C")
    assert q.unit == "°C"
    assert parse_quantity("methane") is None


def test_numeric_discrepancy():
    r = cmp("21", "%", "18", "%")
    assert r.outcome == "discrepancy" and r.delta_abs == 3


def test_match_after_conversion():
    assert cmp("1", "atm", "101.325", "kPa").outcome == "match"
    assert cmp("27", "°C", "300.15", "K").outcome == "match"


def test_unit_discrepancy_same_number():
    r = cmp("300", "°C", "300", "K")
    assert r.outcome == "unit_discrepancy"


def test_incomparable_and_missing_units():
    assert cmp("5", "kg", "5", "K").outcome == "incomparable"
    assert cmp("5", None, "5", "K").outcome == "unit_missing"


def test_range_containment():
    assert cmp("20", "%", "18-21", "%").outcome == "match_in_range"
    assert cmp("25", "%", "18-21", "%").outcome == "discrepancy"


def test_canonical_keys():
    assert canonical_key("Oxygen concentration") == "oxygen_concentration"
    assert canonical_key("O2 mole fraction") == "oxygen_concentration"
    assert canonical_key("Ambient pressure") == "pressure"
    assert canonical_key("Flame temperature") == "flame_temperature"   # not comparable to ambient temperature
    assert canonical_key("Gravity level") == "gravity"


def test_gravity_and_categorical():
    assert gravity_class(1e-6) == "microgravity" and gravity_class(0.166) == "partial gravity"
    assert gravity_class(text="Microgravity (drop tower)") == "microgravity"
    assert categorical_equal("PMMA", "pmma") == "equal"
    assert categorical_equal("methane", "polymethyl methacrylate") == "different"
