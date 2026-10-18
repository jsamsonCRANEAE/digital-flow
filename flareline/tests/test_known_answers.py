"""Known-answer cases: bend geometry checked against hand calculations.

Hand-calculation formulas (centerline, inches):
  T = R tan(theta/2)    A = R theta    S = L - T_start - T_end
  developed = sum(S) + sum(A)
Closed forms used: tan 22.5 = sqrt2 - 1, tan 15 = 2 - sqrt3, tan 60 = sqrt3.
"""
import math

import pytest

from flareline.geometry import TubeRoute, analyze

TOL = 1e-9
SQ2, SQ3, PI = math.sqrt(2), math.sqrt(3), math.pi


def solve(points, clr):
    a = analyze(TubeRoute.uniform(points, clr))
    assert a.ok, a.issues
    return a


def test_ka01_straight_tube():
    """KA-01 Straight tube, 2 points 10 in apart: no bends, developed = 10.0000."""
    a = solve([(0, 0, 0), (10, 0, 0)], 1.0)
    assert a.bends == ()
    assert a.segments[0].straight == pytest.approx(10.0, abs=TOL)
    assert a.developed_length == pytest.approx(10.0, abs=TOL)


def test_ka02_single_90_xy():
    """KA-02 90 deg in XY, legs 10/10, R=2: T=2, A=pi=3.14159265, S=8/8, dev=16+pi."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 10, 0)], 2.0)
    b = a.bend(1)
    assert b.angle_deg == pytest.approx(90.0, abs=1e-12)
    assert b.tangent == pytest.approx(2.0, abs=TOL)
    assert b.arc == pytest.approx(PI, abs=TOL)
    assert [s.straight for s in a.segments] == pytest.approx([8.0, 8.0], abs=TOL)
    assert a.developed_length == pytest.approx(16 + PI, abs=TOL)  # 19.14159265


def test_ka03_single_45():
    """KA-03 45 deg, legs 10/10, R=3: T=3(sqrt2-1)=1.24264069, A=3pi/4=2.35619449,
    dev = 2(10-T) + A = 19.87091312."""
    c = math.cos(math.radians(45))
    a = solve([(0, 0, 0), (10, 0, 0), (10 + 10 * c, 10 * c, 0)], 3.0)
    T = 3 * (SQ2 - 1)
    assert a.bend(1).angle_deg == pytest.approx(45.0, abs=1e-10)
    assert a.bend(1).tangent == pytest.approx(T, abs=TOL)
    assert a.bend(1).arc == pytest.approx(3 * PI / 4, abs=TOL)
    assert a.developed_length == pytest.approx(19.870913115953773, abs=TOL)


def test_ka04_single_30_unequal_legs():
    """KA-04 30 deg, legs 10/5, R=1: T=2-sqrt3=0.26794919, A=pi/6,
    S=9.73205081/4.73205081, dev=14.98770039."""
    a = solve([(0, 0, 0), (10, 0, 0),
               (10 + 5 * math.cos(PI / 6), 5 * math.sin(PI / 6), 0)], 1.0)
    T = 2 - SQ3
    assert a.bend(1).tangent == pytest.approx(T, abs=TOL)
    assert [s.straight for s in a.segments] == pytest.approx([10 - T, 5 - T], abs=TOL)
    assert a.developed_length == pytest.approx(15 - 2 * T + PI / 6, abs=TOL)


def test_ka05_single_120():
    """KA-05 120 deg, legs 5/5, R=1: T=sqrt3=1.73205081, A=2pi/3=2.09439510,
    dev = 10 - 2sqrt3 + 2pi/3 = 8.63029349."""
    a = solve([(0, 0, 0), (5, 0, 0),
               (5 + 5 * math.cos(2 * PI / 3), 5 * math.sin(2 * PI / 3), 0)], 1.0)
    assert a.bend(1).angle_deg == pytest.approx(120.0, abs=1e-10)
    assert a.bend(1).tangent == pytest.approx(SQ3, abs=TOL)
    assert a.developed_length == pytest.approx(8.630293487255441, abs=TOL)


def test_ka06_vertical_90_xz():
    """KA-06 90 deg up into +Z (Z-up), legs 6/6, R=1.5: T=1.5, S=4.5/4.5,
    dev = 9 + 0.75pi = 11.35619449; bend-plane normal = X x Z = -Y."""
    a = solve([(0, 0, 0), (6, 0, 0), (6, 0, 6)], 1.5)
    assert a.developed_length == pytest.approx(9 + 0.75 * PI, abs=TOL)
    assert a.bend(1).normal == pytest.approx((0, -1, 0), abs=1e-12)


def test_ka07_s_offset():
    """KA-07 S-offset: 45 deg left then 45 deg right, offset leg 4, outer legs 5, R=1.
    T = sqrt2-1; S = 5-T, 4-2T, 5-T; dev = 14 - 4T + pi/2 = 13.91394208;
    bend planes opposite => rotation 180."""
    p2 = (5 + 2 * SQ2, 2 * SQ2, 0)
    a = solve([(0, 0, 0), (5, 0, 0), p2, (p2[0] + 5, p2[1], 0)], 1.0)
    T = SQ2 - 1
    assert [s.straight for s in a.segments] == pytest.approx([5 - T, 4 - 2 * T, 5 - T], abs=TOL)
    assert a.developed_length == pytest.approx(13.913942077302517, abs=TOL)
    assert abs(a.bend(2).rotation_deg) == pytest.approx(180.0, abs=1e-9)


def test_ka08_u_bend_same_plane():
    """KA-08 U: two 90 deg in the same plane, legs 10/4/10, R=1:
    S = 9, 2, 9; dev = 20 + pi = 23.14159265; rotation 0."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 4, 0), (0, 4, 0)], 1.0)
    assert [s.straight for s in a.segments] == pytest.approx([9, 2, 9], abs=TOL)
    assert a.developed_length == pytest.approx(20 + PI, abs=TOL)
    assert a.bend(2).rotation_deg == pytest.approx(0.0, abs=1e-9)


def test_ka09_3d_two_bends_rotation_plus_90():
    """KA-09 X -> Y -> +Z, legs 10/10/10, R=2: S = 8, 6, 8, dev = 22 + 2pi.
    n1 = X x Y = +Z, n2 = Y x Z = +X. Right-hand turn about +Y takes Z to X,
    so B2 = +90 (clockwise looking toward end 2)."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 2.0)
    assert [s.straight for s in a.segments] == pytest.approx([8, 6, 8], abs=TOL)
    assert a.developed_length == pytest.approx(22 + 2 * PI, abs=TOL)
    assert a.bend(1).rotation_deg is None  # first bend: reference, no rotation
    assert a.bend(2).rotation_deg == pytest.approx(90.0, abs=1e-9)


def test_ka10_3d_two_bends_rotation_minus_90():
    """KA-10 mirror of KA-09 going down to -Z: n2 = Y x (-Z) = -X, B2 = -90."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, -10)], 2.0)
    assert a.bend(2).rotation_deg == pytest.approx(-90.0, abs=1e-9)
    assert a.developed_length == pytest.approx(22 + 2 * PI, abs=TOL)


def test_ka11_3d_skew_90():
    """KA-11 skew 90 deg: u = +X, v = (0, 0.6, 0.8), legs 4/5, R=1:
    u.v = 0 so 90 deg; S = 3, 4; dev = 7 + pi/2 = 8.57079633; n = (0, -0.8, 0.6)."""
    a = solve([(0, 0, 0), (4, 0, 0), (4, 3, 4)], 1.0)
    assert a.bend(1).angle_deg == pytest.approx(90.0, abs=1e-10)
    assert a.developed_length == pytest.approx(7 + PI / 2, abs=TOL)
    assert a.bend(1).normal == pytest.approx((0, -0.8, 0.6), abs=1e-12)


def test_ka12_oblique_compound():
    """KA-12 compound bend into (1,1,1) direction, legs 3/sqrt3, R=2:
    theta = acos(1/sqrt3) = 54.73561032 deg; tan(theta/2) = sin/(1+cos) = 0.51763809;
    T = 1.03527618; A = 1.91063324; dev = 3 + sqrt3 - 2T + A = 4.57213168."""
    a = solve([(0, 0, 0), (3, 0, 0), (4, 1, 1)], 2.0)
    assert a.bend(1).angle_deg == pytest.approx(54.735610317245346, abs=1e-9)
    assert a.bend(1).tangent == pytest.approx(1.035276180410083, abs=TOL)
    assert a.developed_length == pytest.approx(4.572131682997729, abs=TOL)


def test_ka13_collinear_vertex_is_zero_bend():
    """KA-13 collinear interior vertex: angle 0, T=0, A=0, dev = 12; INFO issue raised."""
    a = solve([(0, 0, 0), (5, 0, 0), (12, 0, 0)], 1.0)
    assert a.bend(1).is_zero and a.bend(1).tangent == 0.0
    assert a.developed_length == pytest.approx(12.0, abs=TOL)
    assert any(i.code == "ZERO_ANGLE_BEND" for i in a.issues)


def test_ka14_rotation_skips_zero_bend():
    """KA-14 KA-09 with an extra collinear vertex on the middle leg: B is measured
    from the last real bend, so bend 3 still reads +90 and dev is unchanged."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 5, 0), (10, 10, 0), (10, 10, 10)], 2.0)
    assert a.bend(2).is_zero
    assert a.bend(3).rotation_deg == pytest.approx(90.0, abs=1e-9)
    assert a.developed_length == pytest.approx(22 + 2 * PI, abs=TOL)


def test_ka15_translation_invariance():
    """KA-15 moving the whole route changes no length, angle or rotation."""
    pts = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)]
    a = solve(pts, 2.0)
    b = analyze(TubeRoute.uniform(pts, 2.0).translated(12.5, -3.25, 100.0))
    assert b.developed_length == pytest.approx(a.developed_length, abs=TOL)
    assert b.bend(2).rotation_deg == pytest.approx(a.bend(2).rotation_deg, abs=1e-9)


def test_ka16_reversal_flips_rotation_sign_not_lengths():
    """KA-16 the same tube described from end 2: lengths are identical, bend
    order reverses, and the KA-09 rotation reads +90 again (a right-handed
    turn stays right-handed when both the axis and the planes reverse)."""
    pts = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)]
    a = solve(pts, 2.0)
    b = solve(list(reversed(pts)), 2.0)
    assert b.developed_length == pytest.approx(a.developed_length, abs=TOL)
    assert b.bend(2).rotation_deg == pytest.approx(90.0, abs=1e-9)


def test_ka17_bend_marks():
    """KA-17 marks from end 1 for KA-09: bend 1 starts at 8, ends at 8+pi;
    bend 2 starts at 14+pi, ends at 14+2pi; total = 22+2pi."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 2.0)
    assert a.bend(1).mark_start == pytest.approx(8.0, abs=TOL)
    assert a.bend(1).mark_end == pytest.approx(8 + PI, abs=TOL)
    assert a.bend(2).mark_start == pytest.approx(14 + PI, abs=TOL)
    assert a.bend(2).mark_end == pytest.approx(14 + 2 * PI, abs=TOL)


def test_ka18_tangent_points():
    """KA-18 tangent points of KA-02: (8,0,0) in, (10,2,0) out."""
    a = solve([(0, 0, 0), (10, 0, 0), (10, 10, 0)], 2.0)
    assert a.bend(1).tangent_point_in == pytest.approx((8, 0, 0), abs=TOL)
    assert a.bend(1).tangent_point_out == pytest.approx((10, 2, 0), abs=TOL)


def test_ka19_per_bend_radii():
    """KA-19 different CLR per bend (U, legs 10/6/10, R1=1, R2=2):
    T = 1 and 2; S = 9, 3, 8; dev = 20 + pi/2 + pi = 24.71238898."""
    a = analyze(TubeRoute(((0, 0, 0), (10, 0, 0), (10, 6, 0), (0, 6, 0)), (1.0, 2.0)))
    assert [s.straight for s in a.segments] == pytest.approx([9, 3, 8], abs=TOL)
    assert a.developed_length == pytest.approx(20 + 1.5 * PI, abs=TOL)
