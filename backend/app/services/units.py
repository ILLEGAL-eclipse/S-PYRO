"""Deterministic, unit-aware value parsing and comparison.

No AI is involved here. A comparison is only ever made between quantities of the
same physical dimension; anything else is reported as incomparable.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"

# unit alias -> (dimension, scale, offset): normalised = value * scale + offset
# normalised: pressure kPa, temperature K, fraction %, gravity g, length m, time s,
#             velocity m/s, power W, heat_flux kW/m2, mass kg
NORMALISED_UNIT = {
    "pressure": "kPa", "temperature": "K", "fraction": "%", "gravity": "g", "length": "m",
    "time": "s", "velocity": "m/s", "power": "W", "heat_flux": "kW/m2", "mass": "kg",
}
_U: dict[str, tuple[str, float, float]] = {}


def _reg(dim: str, scale: float, *names: str, offset: float = 0.0):
    for n in names:
        _U[n] = (dim, scale, offset)


_reg("pressure", 1e-3, "pa")
_reg("pressure", 1, "kpa")
_reg("pressure", 1e3, "mpa")
_reg("pressure", 100, "bar")
_reg("pressure", 0.1, "mbar")
_reg("pressure", 101.325, "atm")
_reg("pressure", 6.894757, "psi", "psia")
_reg("pressure", 0.1333224, "torr", "mmhg")
_reg("temperature", 1, "k", "kelvin")
_reg("temperature", 1, "degc", "c", "celsius", "oc", offset=273.15)
_U["degf"] = _U["f"] = _U["fahrenheit"] = ("temperature", 5 / 9, 273.15 - 32 * 5 / 9)
_reg("fraction", 1, "%", "percent", "vol%", "%vol", "volpercent", "mol%", "%mol", "mole%", "%v/v", "v/v%")
_reg("fraction", 1e-4, "ppm")
_reg("fraction", 100, "fraction", "molefraction", "volumefraction", "molarfraction")
_reg("gravity", 1, "g", "g0", "gn")
_reg("gravity", 1e-6, "ug", "microg")
_reg("gravity", 1e-3, "mg", "milli-g")
_reg("gravity", 1 / 9.80665, "m/s2", "m/s^2", "ms-2")
_reg("length", 1, "m", "meter", "metre")
_reg("length", 1e-2, "cm")
_reg("length", 1e-3, "mm")
_reg("length", 1e-6, "um", "micron")
_reg("time", 1, "s", "sec", "second", "seconds")
_reg("time", 1e-3, "ms")
_reg("time", 60, "min", "minute", "minutes")
_reg("time", 3600, "h", "hr", "hour", "hours")
_reg("velocity", 1, "m/s")
_reg("velocity", 1e-2, "cm/s")
_reg("velocity", 1e-3, "mm/s")
_reg("power", 1, "w", "watt")
_reg("power", 1e3, "kw")
_reg("heat_flux", 1, "kw/m2", "kw/m^2")
_reg("heat_flux", 1e-3, "w/m2", "w/m^2")
_reg("mass", 1, "kg")

_UNIT_CHARS = re.compile(r"\s+")


def norm_unit(u: str | None) -> str | None:
    if u is None:
        return None
    s = u.strip().lower()
    if not s:
        return None
    s = (s.replace("°", "deg").replace("º", "deg").replace("µ", "u").replace("μ", "u")
         .replace("²", "2").replace("³", "3").replace("−", "-"))
    s = _UNIT_CHARS.sub("", s)
    if s in ("degc", "degreec", "degreescelsius", "degreecelsius"):
        s = "degc"
    if s in ("degf", "degreef", "degreesfahrenheit"):
        s = "degf"
    if s in ("degk", "degreek"):
        s = "k"
    return s


def find_unit(u: str | None):
    n = norm_unit(u)
    if n is None:
        return None
    return _U.get(n)


@dataclass
class Quantity:
    raw: str
    nums: list[float] = field(default_factory=list)   # [x] or [lo, hi]
    unit: str | None = None
    note: str | None = None

    @property
    def is_range(self) -> bool:
        return len(self.nums) == 2

    @property
    def lo(self) -> float:
        return min(self.nums)

    @property
    def hi(self) -> float:
        return max(self.nums)


def _match_unit_prefix(rest: str) -> tuple[str | None, str]:
    rest = rest.strip()
    if not rest:
        return None, ""
    if rest.startswith("%"):
        return "%", rest[1:].strip()
    toks = rest.split()
    for n in (2, 1):
        cand = " ".join(toks[:n])
        if cand and find_unit(cand):
            return cand, " ".join(toks[n:])
    return None, rest


def parse_quantity(value: str | float | int | None, unit: str | None = None) -> Quantity | None:
    """Parse '21', '21 %', '18-21 %', '300 °C', '0.5 to 1 atm'. Returns None when non-numeric."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return Quantity(raw=str(value), nums=[float(value)], unit=(unit or None))
    text = str(value).strip().replace("−", "-").replace("–", "-").replace("—", "-")
    if not text:
        return None
    m = re.match(rf"^({NUM})\s*(?:-|to)\s*({NUM.replace('[-+]?', '')})\s*(.*)$", text, re.I)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        u, extra = _match_unit_prefix(m.group(3))
        return Quantity(raw=str(value), nums=[lo, hi], unit=unit or u, note=extra or None)
    m = re.match(rf"^({NUM})\s*(.*)$", text)
    if m:
        u, extra = _match_unit_prefix(m.group(2))
        return Quantity(raw=str(value), nums=[float(m.group(1))], unit=unit or u, note=extra or None)
    return None


def normalise(q: Quantity) -> tuple[list[float], str, str] | None:
    """-> (normalised numbers, dimension, normalised unit) or None if unit unknown/missing."""
    info = find_unit(q.unit)
    if not info:
        return None
    dim, scale, offset = info
    return [n * scale + offset for n in q.nums], dim, NORMALISED_UNIT[dim]


def gravity_class(normalised_g: float | None = None, text: str | None = None) -> str | None:
    if normalised_g is not None:
        if normalised_g < 0.01:
            return "microgravity"
        if normalised_g < 0.9:
            return "partial gravity"
        if normalised_g <= 1.1:
            return "normal gravity"
        return "hypergravity"
    t = (text or "").lower()
    if re.search(r"micro-?\s?gravity|zero-?g|weightless|reduced gravity|free[- ]fall", t):
        return "microgravity"
    if re.search(r"normal gravity|1\s?-?g\b|earth|terrestrial|1g\b", t):
        return "normal gravity"
    if re.search(r"lunar|moon|mars|martian|partial", t):
        return "partial gravity"
    return None


@dataclass
class Comparison:
    outcome: str  # match | match_converted | match_in_range | discrepancy | unit_discrepancy | unit_missing | incomparable
    note: str
    delta_abs: float | None = None
    delta_rel: float | None = None
    a_norm: list[float] | None = None
    b_norm: list[float] | None = None
    unit: str | None = None


def _close(a: float, b: float, rel_tol: float) -> bool:
    return math.isclose(a, b, rel_tol=rel_tol, abs_tol=1e-12)


def _fmt(nums: list[float]) -> str:
    return " – ".join(f"{n:.6g}" for n in nums)


def compare_quantities(a: Quantity, b: Quantity, rel_tol: float = 1e-3) -> Comparison:
    """a = researcher value, b = source value."""
    ua, ub = norm_unit(a.unit), norm_unit(b.unit)
    if ua is None and ub is None:
        return _compare_same_scale(a.nums, b.nums, rel_tol, "match", "Both values are given without units.")
    if ua is None or ub is None:
        side = "researcher input" if ua is None else "source record"
        return Comparison("unit_missing", f"The {side} has no unit, so the values cannot be compared safely.")
    na, nb = normalise(a), normalise(b)
    if na is None or nb is None:
        if ua == ub:
            return _compare_same_scale(a.nums, b.nums, rel_tol, "match", "Same (unrecognised) unit; compared as written.")
        return Comparison("incomparable", f"Unit '{a.unit if na is None else b.unit}' is not in the supported unit table; "
                                          f"'{a.unit}' and '{b.unit}' were not converted.")
    (xa, da, un), (xb, db, _) = na, nb
    if da != db:
        return Comparison("incomparable", f"'{a.unit}' ({da.replace('_', ' ')}) and '{b.unit}' ({db.replace('_', ' ')}) "
                                          "measure different quantities and cannot be compared.")
    res = _compare_same_scale(xa, xb, rel_tol, "match", "")
    res.a_norm, res.b_norm, res.unit = xa, xb, un
    if res.outcome in ("match", "match_in_range"):
        if ua != ub:
            res.note = (res.note + f" Values agree after converting {a.unit} and {b.unit} to {un}.").strip()
        return res
    # Mismatch after conversion: is it the classic "same number, different unit" situation?
    if ua != ub and len(a.nums) == len(b.nums) and all(_close(x, y, rel_tol) for x, y in zip(a.nums, b.nums)):
        res.outcome = "unit_discrepancy"
        res.note = (f"The numerical values are identical ({_fmt(a.nums)}) but the units differ "
                    f"({a.unit} vs {b.unit}); after conversion they are {_fmt(xa)} vs {_fmt(xb)} {un}.")
        return res
    res.note = f"After conversion to {un}: researcher {_fmt(xa)} vs source {_fmt(xb)}."
    return res


def _compare_same_scale(x: list[float], y: list[float], rel_tol: float, ok: str, note: str) -> Comparison:
    if len(x) == 1 and len(y) == 1:
        d = x[0] - y[0]
        rel = abs(d) / abs(y[0]) if y[0] else None
        if _close(x[0], y[0], rel_tol):
            return Comparison("match", note, 0.0, 0.0)
        return Comparison("discrepancy", note, d, rel)
    if len(x) == 2 and len(y) == 2:
        if _close(min(x), min(y), rel_tol) and _close(max(x), max(y), rel_tol):
            return Comparison("match", note or "Ranges are equal.", 0.0, 0.0)
        return Comparison("discrepancy", note or "Ranges differ.")
    scalar, rng, who = (x[0], y, "researcher value") if len(x) == 1 else (y[0], x, "source value")
    lo, hi = min(rng), max(rng)
    if lo - abs(lo) * rel_tol <= scalar <= hi + abs(hi) * rel_tol:
        return Comparison("match_in_range", f"The {who} lies within the reported range {_fmt(rng)}.", 0.0, 0.0)
    return Comparison("discrepancy", f"The {who} {scalar:.6g} lies outside the reported range {_fmt(rng)}.")


# ----------------------------------------------------------------- parameter keys
_STOP = {"the", "of", "in", "at", "a", "an", "and", "initial", "ambient", "chamber", "test", "environment", "environmental",
         "atmospheric", "atmosphere", "gas", "background", "nominal", "concentration", "content", "level", "fraction",
         "mole", "molar", "volume", "volumetric", "percent", "vol", "type", "composition", "sample", "solid", "condition",
         "conditions", "value", "for", "mixture", "oxidizer", "oxidiser", "is", "was"}
_SYN = {"o2": "oxygen", "microgravity": "gravity", "gravitational": "gravity", "g-level": "gravity", "temp": "temperature",
        "p": "pressure", "speed": "velocity"}


def canonical_key(parameter: str | None) -> str | None:
    if not parameter:
        return None
    words = re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", parameter.lower().replace("_", " "))
    out = []
    for w in words:
        w = _SYN.get(w, w)
        if w in _STOP:
            continue
        if w not in out:
            out.append(w)
    if not out:
        return None
    s = set(out)
    if s == {"oxygen"}:
        return "oxygen_concentration"
    if s == {"gravity"}:
        return "gravity"
    if s == {"pressure"}:
        return "pressure"
    if s == {"temperature"}:
        return "temperature"
    if s in ({"fuel"}, {"fuel", "material"}):
        return "fuel"
    if s == {"material"}:
        return "material"
    if s == {"flow", "velocity"} or s == {"velocity"}:
        return "flow_velocity"
    if s == {"duration"} or s == {"experiment", "duration"}:
        return "duration"
    return "_".join(out)


def categorical_equal(a: str, b: str) -> str:
    """-> 'equal' | 'overlap' | 'different' (textual comparison only)."""
    def toks(s: str) -> set[str]:
        return set(re.findall(r"[a-z0-9]+", s.lower())) - {"the", "a", "an", "of", "and", "with", "in"}
    ta, tb = toks(a), toks(b)
    if not ta or not tb:
        return "different"
    if ta == tb:
        return "equal"
    if ta <= tb or tb <= ta or len(ta & tb) / len(ta | tb) >= 0.5:
        return "overlap"
    return "different"
