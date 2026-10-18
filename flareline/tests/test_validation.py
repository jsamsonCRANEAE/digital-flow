"""Validation checks and self-interference."""
import pytest

from flareline.geometry import (CheckLimits, Severity, SpringbackTable, TubeRoute,
                                analyze, check_self_interference, validate)

OD = 0.25


def codes(issues, severity=None):
    return [i.code for i in issues if severity is None or i.severity == severity]


def run(points, clr, **limits):
    return validate(analyze(TubeRoute.uniform(points, clr)), CheckLimits(**limits))


GOOD_3D = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)]
ALL_LIMITS = dict(od=OD, min_clr=0.75, min_straight_between_bends=1.0,
                  min_end_straight_end1=1.0, min_end_straight_end2=1.0)


def test_va01_clean_route_has_no_findings():
    """VA-01 KA-09 route with every limit set: no errors, no warnings, no info."""
    assert run(GOOD_3D, 2.0, **ALL_LIMITS) == []


def test_va02_unset_limits_reported_as_info():
    """VA-02 limits left unset are not silently skipped: one INFO each, plus
    interference not checked when OD is unknown."""
    found = codes(run(GOOD_3D, 2.0))
    assert found.count("LIMIT_NOT_SET") == 4
    assert "INTERFERENCE_NOT_CHECKED" in found


def test_va03_bend_overlap():
    """VA-03 U with middle leg 1.0 and R=1: S1 = 1 - 1 - 1 = -1 -> BEND_OVERLAP by 1.0000."""
    issues = run([(0, 0, 0), (10, 0, 0), (10, 1, 0), (0, 1, 0)], 1.0, **ALL_LIMITS)
    hit = [i for i in issues if i.code == "BEND_OVERLAP"]
    assert len(hit) == 1 and hit[0].location == "segment 1"
    assert "1.0000 in" in hit[0].message


def test_va04_bend_past_end():
    """VA-04 first leg 1.0 with a 90 deg R=2 bend: T=2 > 1 -> BEND_PAST_END on end 1."""
    issues = run([(0, 0, 0), (1, 0, 0), (1, 10, 0)], 2.0, **ALL_LIMITS)
    assert codes(issues, Severity.ERROR) == ["BEND_PAST_END"]
    assert "end 1" in issues[0].message


def test_va05_clr_below_min_warns_with_source():
    """VA-05 CLR 0.5 < min 0.75 -> WARNING citing the limit source."""
    issues = validate(analyze(TubeRoute.uniform(GOOD_3D, 0.5)),
                      CheckLimits(**{**ALL_LIMITS, "min_clr_source": "AS33611 (placeholder)"}))
    w = [i for i in issues if i.code == "CLR_BELOW_MIN"]
    assert len(w) == 2 and all(i.severity == Severity.WARNING for i in w)
    assert "AS33611 (placeholder)" in w[0].message


def test_va06_clr_at_or_below_half_od_is_error():
    """VA-06 CLR 0.125 = OD/2 is not physically bendable -> ERROR, not just a warning."""
    issues = run(GOOD_3D, 0.125, **ALL_LIMITS)
    assert codes(issues, Severity.ERROR).count("CLR_LE_HALF_OD") == 2


def test_va07_straight_between_bends_below_bender_min():
    """VA-07 U legs 10/2.5/10, R=1: S1 = 0.5 < 1.0 bender minimum -> WARNING."""
    issues = run([(0, 0, 0), (10, 0, 0), (10, 2.5, 0), (0, 2.5, 0)], 1.0, **ALL_LIMITS)
    assert codes(issues) == ["STRAIGHT_BELOW_MIN"]


def test_va08_end_straight_below_flare_min():
    """VA-08 end 2 leg 2.5 with R=2: S = 0.5 < 1.0 -> END_STRAIGHT_BELOW_MIN on end 2 only."""
    issues = run([(0, 0, 0), (10, 0, 0), (10, 2.5, 0)], 2.0, **ALL_LIMITS)
    assert codes(issues) == ["END_STRAIGHT_BELOW_MIN"]
    assert "end 2" in issues[0].message


@pytest.mark.parametrize("points, radii, code", [
    (((0, 0, 0), (5, 0, 0), (5, 0, 0), (5, 5, 0)), (1.0, 1.0), "ZERO_LENGTH_LEG"),
    (((0, 0, 0), (5, 0, 0), (5, 5, 0)), (0.0,), "CLR_NOT_POSITIVE"),
    (((0, 0, 0), (5, 0, 0), (0, 0, 0)), (1.0,), "BEND_180"),
])
def test_va09_unsolvable_geometry_is_fatal(points, radii, code):
    """VA-09 coincident points, zero CLR and a 180 deg fold stop the solve with an ERROR."""
    a = analyze(TubeRoute(points, radii))
    assert not a.ok and codes(a.issues, Severity.ERROR) == [code]


def test_va10_springback_extrapolation_warns():
    """VA-10 a 120 deg bend with a table that ends at 90 deg -> SPRINGBACK_EXTRAPOLATED."""
    import math
    a = analyze(TubeRoute.uniform(
        [(0, 0, 0), (5, 0, 0), (5 + 5 * math.cos(2 * math.pi / 3), 5 * math.sin(2 * math.pi / 3), 0)], 1.0))
    sb = SpringbackTable(((0, 0), (90, 3)), enabled=True)
    assert "SPRINGBACK_EXTRAPOLATED" in codes(validate(a, CheckLimits(), sb))


# -- self-interference ---------------------------------------------------------

CROSSING = [(0, 0, 0), (10, 0, 0), (10, 5, 0), (5, 5, 0), (5, -5, 0)]


def test_in01_planar_crossing_detected():
    """IN-01 last leg (x=5) crosses the first leg (y=0) in the same plane -> contact
    between segment 0 and segment 3 at about (5, 0, 0), distance ~0."""
    res = check_self_interference(analyze(TubeRoute.uniform(CROSSING, 0.5)), OD)
    assert res.checked
    c = [c for c in res.contacts if {c.label_a, c.label_b} == {"segment 0", "segment 3"}]
    assert c and c[0].distance == pytest.approx(0.0, abs=1e-9)
    assert c[0].location == pytest.approx((5, 0, 0), abs=1e-6)


def _over_under(h):
    return [(0, 0, 0), (10, 0, 0), (10, 5, 0), (5, 5, h), (5, -5, h)]


def test_in02_3d_pass_over_with_clearance_is_clean():
    """IN-02 same crossing but the last leg runs 1.0 above the first: gap 0.75 -> no contact."""
    res = check_self_interference(analyze(TubeRoute.uniform(_over_under(1.0), 0.5)), OD)
    assert res.checked and res.contacts == ()


def test_in03_3d_pass_over_too_close():
    """IN-03 last leg only 0.2 above the first: centerline distance 0.2 < OD 0.25 -> contact."""
    res = check_self_interference(analyze(TubeRoute.uniform(_over_under(0.2), 0.5)), OD)
    hit = [c for c in res.contacts if {c.label_a, c.label_b} == {"segment 0", "segment 3"}]
    assert hit and hit[0].distance == pytest.approx(0.2, abs=1e-6)


def test_in04_tight_u_bend_no_false_positive():
    """IN-04 U with CLR 0.15 (0.6 x OD) and zero straight between bends: legs 0.30 apart,
    tube is continuous, nothing touches -> no contact reported."""
    R = 0.15
    res = check_self_interference(
        analyze(TubeRoute.uniform([(0, 0, 0), (10, 0, 0), (10, 2 * R, 0), (0, 2 * R, 0)], R)), OD)
    assert res.checked and res.contacts == ()


@pytest.mark.parametrize("pitch, touching", [(0.1, True), (1.0, False)])
def test_in05_coil_pitch(pitch, touching):
    """IN-05 two square turns of a coil: pitch 0.1 < OD touches, pitch 1.0 does not."""
    pts = [(0, 0, 0), (4, 0, 0), (4, 4, 0), (0, 4, 0), (0, 0, pitch), (4, 0, pitch), (4, 4, pitch)]
    res = check_self_interference(analyze(TubeRoute.uniform(pts, 0.5)), OD)
    assert res.checked and bool(res.contacts) == touching


def test_in06_validate_reports_interference_as_error():
    """IN-06 validate() turns a contact into a SELF_INTERFERENCE error."""
    issues = run(CROSSING, 0.5, **ALL_LIMITS)
    assert "SELF_INTERFERENCE" in codes(issues, Severity.ERROR)
