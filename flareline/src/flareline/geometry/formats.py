"""Conversions between the three tube description formats.

  XYZ   TubeRoute: intersection points + CLR per bend
  LRA   feed / rotate / bend (YBC). Y = straight between tangent points.
  LEGS  intersection-to-intersection leg lengths + rotation + bend angle
        (how a drafter usually dimensions a tube)

LRA and LEGS describe shape only; a frame (start point, first leg direction,
reference bend-plane normal) places the shape in XYZ. B for the first bend is
measured from that reference normal, B for later bends from the previous
bend's plane. Positive B = right-hand rule about the leg direction (end 1 ->
end 2) = clockwise when viewed looking along the tube toward end 2.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

import numpy as np

from .analysis import RouteAnalysis, analyze
from .route import Point, TubeRoute
from .vec import EPS_ANGLE, as_vec, rotate, signed_angle, unit


class RotationConvention(Enum):
    """How B is shown to the user. Internally B is always right-hand."""
    CW_LOOKING_TOWARD_END2 = 1   # default; equals the internal convention
    CCW_LOOKING_TOWARD_END2 = -1

    def to_display(self, rotation_deg: float) -> float:
        return self.value * rotation_deg

    def from_display(self, rotation_deg: float) -> float:
        return self.value * rotation_deg


@dataclass(frozen=True)
class BendStep:
    rotation_deg: float   # B
    angle_deg: float      # C (design angle, before any springback)
    clr: float


@dataclass(frozen=True)
class Frame:
    start: Point = (0.0, 0.0, 0.0)
    direction: Point = (1.0, 0.0, 0.0)
    reference_normal: Point = (0.0, 0.0, 1.0)


@dataclass(frozen=True)
class LraData:
    feeds: tuple[float, ...]       # Y, len = len(steps) + 1
    steps: tuple[BendStep, ...]
    frame: Frame = Frame()

    def __post_init__(self) -> None:
        if len(self.feeds) != len(self.steps) + 1:
            raise ValueError("LRA needs one more feed than bends")


@dataclass(frozen=True)
class LegData:
    legs: tuple[float, ...]        # intersection-to-intersection, len = len(steps) + 1
    steps: tuple[BendStep, ...]
    frame: Frame = Frame()

    def __post_init__(self) -> None:
        if len(self.legs) != len(self.steps) + 1:
            raise ValueError("leg data needs one more leg than bends")


# -- XYZ -> LRA / LEGS ---------------------------------------------------------

def _steps_and_frame(a: RouteAnalysis) -> tuple[tuple[BendStep, ...], Frame]:
    if not a.ok:
        raise ValueError("route has geometry errors: " +
                         "; ".join(str(i) for i in a.issues))
    d0 = as_vec(a.start_direction)
    ref = as_vec(a.reference_normal)
    steps = []
    first = True
    for b in a.bends:
        if b.normal is None:
            B = 0.0
        elif first:
            B = math.degrees(signed_angle(ref, as_vec(b.normal), d0))
            first = False
        else:
            B = b.rotation_deg
        steps.append(BendStep(B, b.angle_deg, b.clr))
    return tuple(steps), Frame(a.route.points[0], a.start_direction, a.reference_normal)


def route_to_lra(route: TubeRoute | RouteAnalysis) -> LraData:
    a = route if isinstance(route, RouteAnalysis) else analyze(route)
    steps, frame = _steps_and_frame(a)
    return LraData(tuple(s.straight for s in a.segments), steps, frame)


def route_to_legs(route: TubeRoute | RouteAnalysis) -> LegData:
    a = route if isinstance(route, RouteAnalysis) else analyze(route)
    steps, frame = _steps_and_frame(a)
    return LegData(tuple(s.leg for s in a.segments), steps, frame)


# -- LRA <-> LEGS --------------------------------------------------------------

def _tangent(step: BendStep) -> float:
    return step.clr * math.tan(math.radians(step.angle_deg) / 2.0)


def lra_to_legs(lra: LraData) -> LegData:
    t = [_tangent(s) for s in lra.steps]
    legs = []
    for j, y in enumerate(lra.feeds):
        before = t[j - 1] if j > 0 else 0.0
        after = t[j] if j < len(t) else 0.0
        legs.append(y + before + after)
    return LegData(tuple(legs), lra.steps, lra.frame)


def legs_to_lra(legs: LegData) -> LraData:
    t = [_tangent(s) for s in legs.steps]
    feeds = []
    for j, L in enumerate(legs.legs):
        before = t[j - 1] if j > 0 else 0.0
        after = t[j] if j < len(t) else 0.0
        feeds.append(L - before - after)
    return LraData(tuple(feeds), legs.steps, legs.frame)


# -- LEGS / LRA -> XYZ ---------------------------------------------------------

def legs_to_route(legs: LegData) -> TubeRoute:
    for s in legs.steps:
        if not (-EPS_ANGLE <= math.radians(s.angle_deg) < math.pi):
            raise ValueError(f"bend angle must be in [0, 180) deg, got {s.angle_deg}")
    p = as_vec(legs.frame.start)
    d = unit(as_vec(legs.frame.direction))
    n = as_vec(legs.frame.reference_normal)
    n = unit(n - d * float(n @ d))   # tolerate a slightly non-perpendicular input
    points = [p.copy()]
    for L, s in zip(legs.legs, legs.steps):
        p = p + d * L
        points.append(p.copy())
        n = rotate(n, d, math.radians(s.rotation_deg))
        d = unit(rotate(d, n, math.radians(s.angle_deg)))
    p = p + d * legs.legs[-1]
    points.append(p)
    return TubeRoute(tuple(tuple(float(c) for c in q) for q in points),
                     tuple(s.clr for s in legs.steps))


def lra_to_route(lra: LraData) -> TubeRoute:
    return legs_to_route(lra_to_legs(lra))


def frame_for(route: TubeRoute) -> Frame:
    a = analyze(route)
    return Frame(route.points[0], a.start_direction, a.reference_normal)


def max_point_error(a: TubeRoute, b: TubeRoute) -> float:
    """Largest distance between corresponding points (for round-trip checks)."""
    return max(float(np.linalg.norm(as_vec(p) - as_vec(q)))
               for p, q in zip(a.points, b.points))
