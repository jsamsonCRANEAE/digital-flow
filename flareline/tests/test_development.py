"""Developed / cut length, springback, traceability, units and performance."""
import json
import math
import statistics
import time

import pytest

from flareline.geometry import (CheckLimits, DevelopmentOptions, SpringbackTable,
                                TubeRoute, TubeSection, analyze, validate)
from flareline.geometry.units import fmt_angle, fmt_len, from_mm, to_mm

TOL = 1e-9
KA09 = TubeRoute.uniform([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 2.0)


def test_dv01_arc_factor_and_per_bend_adjust():
    """DV-01 KA-09 with arc factor 1.02 and +0.01 per bend:
    developed = 22 + 2pi*1.02 + 0.02 = 28.4288; centerline stays 22 + 2pi."""
    a = analyze(KA09, DevelopmentOptions(arc_length_factor=1.02, per_bend_adjust=0.01))
    assert a.centerline_length == pytest.approx(22 + 2 * math.pi, abs=TOL)
    assert a.developed_length == pytest.approx(22 + 2 * math.pi * 1.02 + 0.02, abs=TOL)


def test_dv02_cut_length_adds_end_allowances_with_source():
    """DV-02 cut = developed + FA1 + FA2 = 22 + 2pi + 0.10 + 0.20; sources are kept."""
    a = analyze(KA09, DevelopmentOptions(end1_allowance=0.10, end2_allowance=0.20,
                                         end1_allowance_source="AS4330 UNVERIFIED"))
    assert a.cut_length == pytest.approx(22 + 2 * math.pi + 0.30, abs=TOL)
    assert a.traces["end1.allowance"].source == "AS4330 UNVERIFIED"


def test_dv03_trace_reproduces_value():
    """DV-03 the tangent trace carries R and theta; R*tan(theta/2) recomputed from the
    trace inputs equals the stored value exactly."""
    a = analyze(KA09)
    t = a.traces["bend1.tangent"]
    assert t.formula == "T = R * tan(theta / 2)"
    assert t.inputs["R"] * math.tan(t.inputs["theta"] / 2) == t.value


def test_dv04_every_number_is_traceable_and_serialisable():
    """DV-04 every bend/segment/total value has a trace, and the trace book
    serialises to JSON for the audit log."""
    a = analyze(KA09, section=TubeSection(0.25, 0.035))
    for k in (1, 2):
        for f in ("angle", "tangent", "arc", "arc_dev", "mark_start", "mark_end",
                  "wall_extrados_est"):
            assert f"bend{k}.{f}" in a.traces
    assert "bend2.rotation" in a.traces
    for j in range(3):
        assert f"seg{j}.leg" in a.traces and f"seg{j}.straight" in a.traces
    for key in ("total.centerline", "total.developed", "total.cut"):
        assert key in a.traces
    json.dumps(a.traces.to_records())


def test_dv05_extrados_wall_estimate():
    """DV-05 t=0.035, OD=0.25, R=1: t_out ~= 0.035 * 2 / 2.25 = 0.031111."""
    a = analyze(KA09.with_radius(1, 1.0), section=TubeSection(0.25, 0.035))
    assert a.traces["bend1.wall_extrados_est"].value == pytest.approx(0.035 * 2 / 2.25, abs=TOL)


@pytest.mark.parametrize("points, design, expect_sb, expect_extrap", [
    (((90, 2.5),), 45.0, 2.5, False),                 # constant
    (((0, 0), (90, 3)), 45.0, 1.5, False),            # proportional, interpolated
    (((0, 0), (90, 3)), 90.0, 3.0, False),            # on a table point
    (((10, 0.5), (90, 3)), 120.0, 3.0, True),         # above table: held + flagged
    (((10, 0.5), (90, 3)), 5.0, 0.5, True),           # below table: held + flagged
])
def test_sb01_springback_table(points, design, expect_sb, expect_extrap):
    """SB-01 springback: bender angle = design + interpolated springback."""
    r = SpringbackTable(points, enabled=True).apply(design)
    assert r.springback_deg == pytest.approx(expect_sb, abs=TOL)
    assert r.bender_deg == pytest.approx(design + expect_sb, abs=TOL)
    assert r.extrapolated == expect_extrap


def test_sb02_springback_off_by_default_and_validated():
    """SB-02 a disabled table changes nothing; duplicate angles are rejected."""
    assert SpringbackTable(((0, 0), (90, 3))).apply(45.0).bender_deg == 45.0
    with pytest.raises(ValueError):
        SpringbackTable(((90, 1), (90, 2)))


def test_un01_display_rounding_never_touches_model():
    """UN-01 display is 4 dp (in/mm) and 2 dp (deg); 1 in = 25.4 mm exactly;
    the stored value keeps full precision."""
    v = 1.0 / 3.0
    route = TubeRoute(((0, 0, 0), (v, 0, 0)), ())
    assert fmt_len(v) == "0.3333 in"
    assert fmt_len(1.0, "mm") == "25.4000 mm"
    assert fmt_angle(54.735610317) == "54.74°"
    assert route.points[1][0] == v
    assert from_mm(to_mm(v)) == pytest.approx(v, abs=1e-15)


def _twenty_bend_route() -> TubeRoute:
    """A 20-bend 3D zig-zag stair, legs 6 in, CLR 0.75, 1/4 in tube."""
    pts, z = [(0.0, 0.0, 0.0)], 0.0
    for i in range(21):
        x, y, _ = pts[-1]
        if i % 3 == 0:
            pts.append((x + 6, y, z))
        elif i % 3 == 1:
            pts.append((x, y + 6, z))
        else:
            z += 6
            pts.append((x, y, z))
    return TubeRoute.uniform(pts, 0.75)


def test_pf01_twenty_bends_under_100ms():
    """PF-01 analyse + validate (incl. self-interference) a 20-bend tube in < 100 ms (median of 5)."""
    route = _twenty_bend_route()
    assert route.n_bends == 20
    limits = CheckLimits(od=0.25, min_clr=0.75, min_straight_between_bends=1.0,
                         min_end_straight_end1=1.0, min_end_straight_end2=1.0)
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        issues = validate(analyze(route), limits)
        times.append(time.perf_counter() - t0)
    assert issues == []
    assert statistics.median(times) < 0.100, times
