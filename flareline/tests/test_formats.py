"""XYZ <-> LRA (YBC) <-> LEGS conversions.

LRA convention under test: Y = straight between tangent points, B = plane
rotation (+ = clockwise looking toward end 2), C = bend angle. Default frame:
start at origin, first leg along +X, reference normal +Z (first bend with
B = 0 turns toward +Y).
"""
import math
import random

import pytest

from flareline.geometry import (BendStep, LegData, LraData, RotationConvention,
                                TubeRoute, legs_to_lra, legs_to_route, lra_to_legs,
                                lra_to_route, route_to_legs, route_to_lra)
from flareline.geometry.formats import max_point_error

TOL = 1e-9


def test_fm01_lra_to_xyz_single_90():
    """FM-01 Y=5, B=0, C=90, R=1, Y=5 -> T=1, legs 6/6 -> (0,0,0),(6,0,0),(6,6,0)."""
    r = lra_to_route(LraData((5.0, 5.0), (BendStep(0.0, 90.0, 1.0),)))
    assert max_point_error(r, TubeRoute(((0, 0, 0), (6, 0, 0), (6, 6, 0)), (1.0,))) < TOL


def test_fm02_lra_to_xyz_rotation_plus_90_goes_up():
    """FM-02 second bend with B=+90 (CW looking toward end 2) turns toward +Z
    (inverse of KA-09): Y 8/6/8, C 90/90, R 2 -> (10,10,10) end point."""
    lra = LraData((8.0, 6.0, 8.0), (BendStep(0, 90, 2.0), BendStep(90, 90, 2.0)))
    r = lra_to_route(lra)
    assert r.points[-1] == pytest.approx((10, 10, 10), abs=TOL)


def test_fm03_first_bend_rotation_from_reference():
    """FM-03 first bend B=-90 from the +Z reference: normal becomes rotate(+Z, +X, -90) = +Y,
    bend direction = +Y x +X = -Z, so a 90 deg bend points the tube straight down."""
    r = lra_to_route(LraData((5.0, 5.0), (BendStep(-90, 90, 1.0),)))
    assert r.points[-1] == pytest.approx((6, 0, -6), abs=TOL)


def test_fm04_xyz_to_lra_known():
    """FM-04 KA-09 route -> Y 8/6/8, B 0/+90, C 90/90."""
    lra = route_to_lra(TubeRoute.uniform([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 2.0))
    assert lra.feeds == pytest.approx((8, 6, 8), abs=TOL)
    assert [s.rotation_deg for s in lra.steps] == pytest.approx([0, 90], abs=1e-9)
    assert [s.angle_deg for s in lra.steps] == pytest.approx([90, 90], abs=1e-9)


def test_fm05_legs_known_and_lra_legs_relation():
    """FM-05 legs = Y + adjoining tangents: KA-09 legs are 10/10/10."""
    route = TubeRoute.uniform([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 2.0)
    legs = route_to_legs(route)
    assert legs.legs == pytest.approx((10, 10, 10), abs=TOL)
    assert lra_to_legs(route_to_lra(route)).legs == pytest.approx(legs.legs, abs=TOL)
    assert legs_to_lra(legs).feeds == pytest.approx((8, 6, 8), abs=TOL)


def _random_route(rng: random.Random, n_bends: int) -> TubeRoute:
    """Random 3D route with legs long enough that bends never overlap."""
    pts = [(0.0, 0.0, 0.0)]
    d = (1.0, 0.0, 0.0)
    for _ in range(n_bends + 1):
        L = rng.uniform(8, 20)
        pts.append(tuple(p + L * c for p, c in zip(pts[-1], d)))
        while True:
            nd = tuple(rng.uniform(-1, 1) for _ in range(3))
            n = math.sqrt(sum(c * c for c in nd))
            nd = tuple(c / n for c in nd)
            if -0.5 < sum(a * b for a, b in zip(nd, d)) < 0.999:  # bend 2.6 .. 120 deg
                d = nd
                break
    return TubeRoute(tuple(pts), tuple(rng.uniform(0.5, 2.0) for _ in range(n_bends)))


@pytest.mark.parametrize("seed", range(10))
def test_fm06_round_trip_xyz_lra_xyz(seed):
    """FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in."""
    rng = random.Random(seed)
    route = _random_route(rng, rng.randint(1, 20))
    back = lra_to_route(route_to_lra(route))
    assert max_point_error(route, back) < 1e-9
    assert back.radii == pytest.approx(route.radii, abs=0)


@pytest.mark.parametrize("seed", range(5))
def test_fm07_round_trip_xyz_legs_xyz(seed):
    """FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in."""
    rng = random.Random(100 + seed)
    route = _random_route(rng, rng.randint(1, 20))
    assert max_point_error(route, legs_to_route(route_to_legs(route))) < 1e-9


def test_fm08_rotation_display_convention():
    """FM-08 the CCW display option only flips the shown sign; stored value unchanged."""
    ccw = RotationConvention.CCW_LOOKING_TOWARD_END2
    cw = RotationConvention.CW_LOOKING_TOWARD_END2
    assert cw.to_display(90.0) == 90.0
    assert ccw.to_display(90.0) == -90.0
    assert ccw.from_display(ccw.to_display(37.25)) == 37.25


def test_fm09_feed_count_validated():
    """FM-09 LRA must have one more feed than bends."""
    with pytest.raises(ValueError):
        LraData((5.0,), (BendStep(0, 90, 1.0),))
    with pytest.raises(ValueError):
        LegData((5.0, 5.0, 5.0), (BendStep(0, 90, 1.0),))


def test_fm10_reject_180_in_lra():
    """FM-10 a 180 deg bend has no finite tangent and is rejected."""
    with pytest.raises(ValueError):
        lra_to_route(LraData((5.0, 5.0), (BendStep(0, 180.0, 1.0),)))
