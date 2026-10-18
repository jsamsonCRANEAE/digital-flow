"""Bend geometry: angles, tangents, arcs, straights, plane rotations and
developed / cut length, each recorded with its formula in a TraceBook.

Definitions (all on the tube centerline):
  u_k, v_k     unit directions into and out of vertex k
  theta_k      bend angle = atan2(|u x v|, u . v)
  T_k          tangent length = R_k * tan(theta_k / 2)   (vertex to tangent point)
  A_k          nominal arc length = R_k * theta_k
  A_dev_k      developed arc = A_k * arc_length_factor + per_bend_adjust
  S_j          straight between tangent points on leg j = L_j - T_start - T_end
  n_k          bend-plane normal = unit(u_k x v_k)
  B_k          plane rotation from the previous non-zero bend, measured about the
               leg direction (end 1 -> end 2) by the right-hand rule, which is
               clockwise when viewed looking along the tube toward end 2
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .issues import Issue, Severity
from .route import TubeRoute
from .trace import TraceBook
from .vec import (EPS_ANGLE, EPS_LENGTH, angle_between, as_vec, norm,
                  perpendicular_reference, signed_angle, unit)

# A bend this close to 180 deg has an unbounded tangent length.
MAX_BEND_ANGLE = math.pi - 1e-6


@dataclass(frozen=True)
class DevelopmentOptions:
    """Inputs that turn centerline length into cut length.

    The factors are shop-derived (user input), never standards data. Defaults
    give pure centerline development.
    """
    arc_length_factor: float = 1.0   # multiplies R*theta for every bend
    per_bend_adjust: float = 0.0     # inches added per non-zero bend
    end1_allowance: float = 0.0      # end prep / flare allowance, end 1
    end2_allowance: float = 0.0      # end prep / flare allowance, end 2
    end1_allowance_source: str = "user input"
    end2_allowance_source: str = "user input"


@dataclass(frozen=True)
class TubeSection:
    od: float
    wall: float


@dataclass(frozen=True)
class BendResult:
    number: int                  # 1-based; equals the vertex index
    vertex: tuple[float, float, float]
    angle_rad: float
    clr: float
    tangent: float
    arc: float                   # nominal R*theta
    arc_developed: float
    normal: Optional[tuple[float, float, float]]   # None for a zero-angle bend
    rotation_rad: Optional[float]  # None for the first non-zero bend / zero bends
    tangent_point_in: tuple[float, float, float]
    tangent_point_out: tuple[float, float, float]
    mark_start: float            # developed distance from P0 to start of bend
    mark_end: float              # developed distance from P0 to end of bend

    @property
    def angle_deg(self) -> float:
        return math.degrees(self.angle_rad)

    @property
    def rotation_deg(self) -> Optional[float]:
        return None if self.rotation_rad is None else math.degrees(self.rotation_rad)

    @property
    def is_zero(self) -> bool:
        return self.angle_rad < EPS_ANGLE


@dataclass(frozen=True)
class SegmentResult:
    index: int                   # leg from vertex index to index + 1
    direction: tuple[float, float, float]
    leg: float                   # intersection-to-intersection length
    tangent_start: float
    tangent_end: float
    straight: float              # between tangent points; negative = overlap


@dataclass(frozen=True)
class RouteAnalysis:
    route: TubeRoute
    options: DevelopmentOptions
    section: Optional[TubeSection]
    ok: bool                     # False when the geometry could not be solved
    issues: tuple[Issue, ...]
    bends: tuple[BendResult, ...]
    segments: tuple[SegmentResult, ...]
    centerline_length: float
    developed_length: float
    cut_length: float
    traces: TraceBook
    # LRA reference frame: first leg direction and reference bend-plane normal
    start_direction: Optional[tuple[float, float, float]]
    reference_normal: Optional[tuple[float, float, float]]

    def bend(self, number: int) -> BendResult:
        return self.bends[number - 1]


def _t(v: np.ndarray) -> tuple[float, float, float]:
    return (float(v[0]), float(v[1]), float(v[2]))


def _failed(route, options, section, issues, traces) -> RouteAnalysis:
    nan = float("nan")
    return RouteAnalysis(route, options, section, False, tuple(issues), (), (),
                         nan, nan, nan, traces, None, None)


def analyze(route: TubeRoute,
            options: DevelopmentOptions = DevelopmentOptions(),
            section: Optional[TubeSection] = None) -> RouteAnalysis:
    tb = TraceBook()
    issues: list[Issue] = []
    pts = [as_vec(p) for p in route.points]
    n_seg = len(pts) - 1

    # -- legs ---------------------------------------------------------------
    legs: list[float] = []
    dirs: list[np.ndarray] = []
    for j in range(n_seg):
        d = pts[j + 1] - pts[j]
        L = norm(d)
        legs.append(tb.add(f"seg{j}.leg", L, "in", "L = |P[j+1] - P[j]|",
                           {"P[j]": _t(pts[j]), "P[j+1]": _t(pts[j + 1])},
                           f"Leg {j} intersection-to-intersection length"))
        if L < EPS_LENGTH:
            issues.append(Issue(Severity.ERROR, "ZERO_LENGTH_LEG",
                                f"points {j} and {j + 1} coincide",
                                f"segment {j}", (f"seg{j}.leg",)))
            dirs.append(np.zeros(3))
        else:
            dirs.append(d / L)

    for k, r in enumerate(route.radii, start=1):
        if r <= 0.0:
            issues.append(Issue(Severity.ERROR, "CLR_NOT_POSITIVE",
                                f"bend radius must be > 0 (got {r!r})", f"bend {k}"))
    if issues:
        return _failed(route, options, section, issues, tb)

    # -- bends --------------------------------------------------------------
    angles: list[float] = []
    tangents: list[float] = [0.0] * len(pts)   # indexed by vertex; ends stay 0
    for k in range(1, len(pts) - 1):
        u, v, R = dirs[k - 1], dirs[k], route.radii[k - 1]
        theta = tb.add(f"bend{k}.angle", angle_between(u, v), "rad",
                       "theta = atan2(|u x v|, u . v)",
                       {"u": _t(u), "v": _t(v)}, f"Bend {k} angle")
        tb.add(f"bend{k}.angle_deg", math.degrees(theta), "deg",
               "theta_deg = theta * 180 / pi", {"theta": theta},
               f"Bend {k} angle in degrees")
        if theta > MAX_BEND_ANGLE:
            issues.append(Issue(Severity.ERROR, "BEND_180",
                                "bend angle is 180 deg: the tube doubles back on itself",
                                f"bend {k}", (f"bend{k}.angle",)))
        angles.append(theta)
    if issues:
        return _failed(route, options, section, issues, tb)

    for k, theta in enumerate(angles, start=1):
        R = route.radii[k - 1]
        tangents[k] = tb.add(f"bend{k}.tangent", R * math.tan(theta / 2.0), "in",
                             "T = R * tan(theta / 2)", {"R": R, "theta": theta},
                             f"Bend {k} tangent length (vertex to tangent point)",)

    # -- straights ----------------------------------------------------------
    segments: list[SegmentResult] = []
    for j in range(n_seg):
        ts, te = tangents[j], tangents[j + 1]
        S = tb.add(f"seg{j}.straight", legs[j] - ts - te, "in",
                   "S = L - T_start - T_end",
                   {"L": legs[j], "T_start": ts, "T_end": te},
                   f"Leg {j} straight between tangent points")
        segments.append(SegmentResult(j, _t(dirs[j]), legs[j], ts, te, S))

    # -- arcs, normals, rotations, marks ------------------------------------
    f, adj = options.arc_length_factor, options.per_bend_adjust
    bends: list[BendResult] = []
    prev_normal: Optional[np.ndarray] = None
    s = segments[0].straight  # running developed distance from P0
    for k, theta in enumerate(angles, start=1):
        R = route.radii[k - 1]
        zero = theta < EPS_ANGLE
        arc = tb.add(f"bend{k}.arc", R * theta, "in", "A = R * theta",
                     {"R": R, "theta": theta}, f"Bend {k} nominal centerline arc")
        arc_dev = tb.add(f"bend{k}.arc_dev", 0.0 if zero else arc * f + adj, "in",
                         "A_dev = A * f + adj",
                         {"A": arc, "f": f, "adj": 0.0 if zero else adj},
                         f"Bend {k} developed arc length")
        if zero:
            issues.append(Issue(Severity.INFO, "ZERO_ANGLE_BEND",
                                "points are collinear; this vertex adds no bend",
                                f"bend {k}", (f"bend{k}.angle",)))
            normal = rotation = None
        else:
            u, v = dirs[k - 1], dirs[k]
            normal = unit(np.cross(u, v))
            rotation = None
            if prev_normal is None:
                ref = perpendicular_reference(dirs[0])
                b1 = signed_angle(ref, normal, dirs[0])
                tb.add(f"bend{k}.rotation_from_ref_deg", math.degrees(b1), "deg",
                       "B1 = atan2((n_ref x n) . d0, n_ref . n) * 180 / pi",
                       {"n_ref": _t(ref), "n": _t(normal), "d0": _t(dirs[0])},
                       f"Bend {k} plane rotation from the reference plane (+Z projected "
                       f"normal to the first leg; +Y if that leg is vertical)")
            else:
                rotation = tb.add(
                    f"bend{k}.rotation", signed_angle(prev_normal, normal, u), "rad",
                    "B = atan2((n_prev x n) . d, n_prev . n)",
                    {"n_prev": _t(prev_normal), "n": _t(normal), "d": _t(u)},
                    f"Bend {k} plane rotation from previous bend "
                    f"(+ = clockwise looking toward end 2)")
                tb.add(f"bend{k}.rotation_deg", math.degrees(rotation), "deg",
                       "B_deg = B * 180 / pi", {"B": rotation},
                       f"Bend {k} plane rotation in degrees")
            prev_normal = normal
        V = pts[k]
        tp_in = V - dirs[k - 1] * tangents[k]
        tp_out = V + dirs[k] * tangents[k]
        mark_start = tb.add(f"bend{k}.mark_start", s, "in",
                            "M_start = sum(S before) + sum(A_dev before)",
                            {"value": s}, f"Bend {k} start mark from end 1 tube end")
        mark_end = tb.add(f"bend{k}.mark_end", s + arc_dev, "in",
                          "M_end = M_start + A_dev",
                          {"M_start": s, "A_dev": arc_dev},
                          f"Bend {k} end mark from end 1 tube end")
        s += arc_dev + segments[k].straight
        bends.append(BendResult(
            k, _t(V), theta, R, tangents[k], arc, arc_dev,
            None if normal is None else _t(normal), rotation,
            _t(tp_in), _t(tp_out), mark_start, mark_end))

    # -- totals ---------------------------------------------------------------
    sum_s = sum(sg.straight for sg in segments)
    sum_a = sum(b.arc for b in bends)
    sum_ad = sum(b.arc_developed for b in bends)
    centerline = tb.add("total.centerline", sum_s + sum_a, "in", "C = sum(S) + sum(A)",
                        {"sum(S)": sum_s, "sum(A)": sum_a},
                        "Centerline length (tangent straights + nominal arcs)")
    developed = tb.add("total.developed", sum_s + sum_ad, "in",
                       "D = sum(S) + sum(A_dev)", {"sum(S)": sum_s, "sum(A_dev)": sum_ad},
                       "Developed length (with shop arc factor / per-bend adjust)")
    tb.add("end1.allowance", options.end1_allowance, "in", "input", {},
           "End 1 end-prep / flare allowance", options.end1_allowance_source)
    tb.add("end2.allowance", options.end2_allowance, "in", "input", {},
           "End 2 end-prep / flare allowance", options.end2_allowance_source)
    cut = tb.add("total.cut", developed + options.end1_allowance + options.end2_allowance,
                 "in", "Cut = D + FA1 + FA2",
                 {"D": developed, "FA1": options.end1_allowance,
                  "FA2": options.end2_allowance}, "Cut (stock) length")

    if section is not None:
        for b in bends:
            if not b.is_zero:
                estimate_extrados_wall(section, b.clr, tb, f"bend{b.number}")

    d0 = dirs[0]
    ref = perpendicular_reference(d0)
    return RouteAnalysis(route, options, section, True, tuple(issues), tuple(bends),
                         tuple(segments), centerline, developed, cut, tb,
                         _t(d0), _t(ref))


def estimate_extrados_wall(section: TubeSection, clr: float,
                           tb: Optional[TraceBook] = None, prefix: str = "") -> float:
    """Outside-of-bend wall estimate from a simple strain model.

    Extrados strain e = (OD/2)/R relative to the centerline; with volume held
    constant and no change in width, t_out = t / (1 + e) = t * 2R / (2R + OD).
    This is an ESTIMATE for screening only, not a standards value.
    """
    t_out = section.wall * 2.0 * clr / (2.0 * clr + section.od)
    if tb is not None:
        tb.add(f"{prefix}.wall_extrados_est", t_out, "in",
               "t_out ~= t * 2R / (2R + OD)",
               {"t": section.wall, "R": clr, "OD": section.od},
               "Estimated extrados wall (simple strain model, screening only)")
    return t_out
