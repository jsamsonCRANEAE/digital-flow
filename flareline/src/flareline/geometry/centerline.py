"""Dense sampling of the tube centerline (straights + true circular arcs).

Used by the interference check and by the 3D / 2D views. Sampling never
feeds back into lengths: lengths always come from the exact formulas in
analysis.py.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .analysis import RouteAnalysis
from .vec import as_vec, rotate, unit


@dataclass(frozen=True)
class CenterlineSamples:
    points: np.ndarray    # (M, 3)
    s: np.ndarray         # (M,) centerline distance from P0 (nominal arcs)
    labels: tuple[str, ...]   # (M-1,) owner of each chord: "segment j" / "bend k"


def arc_points(tp_in: np.ndarray, u: np.ndarray, normal: np.ndarray, radius: float,
               angle: float, n_chords: int) -> np.ndarray:
    """Points on the bend arc from the incoming tangent point, n_chords + 1 of them."""
    center = tp_in + unit(np.cross(normal, u)) * radius
    r0 = tp_in - center
    return np.array([center + rotate(r0, normal, angle * i / n_chords)
                     for i in range(n_chords + 1)])


def sample_centerline(a: RouteAnalysis, max_piece: float,
                      max_chord_deg: float = 2.0) -> CenterlineSamples:
    """Sample with chords no longer than max_piece and arc steps no larger than
    max_chord_deg. Requires a solved route with no overlapping bends."""
    if not a.ok:
        raise ValueError("cannot sample an unsolved route")
    pts: list[np.ndarray] = [as_vec(a.route.points[0])]
    s_vals: list[float] = [0.0]
    labels: list[str] = []

    def add_straight(p_from: np.ndarray, p_to: np.ndarray, label: str) -> None:
        length = float(np.linalg.norm(p_to - p_from))
        if length < 1e-9:  # zero straight between touching bends
            return
        n = max(1, math.ceil(length / max_piece))
        s0 = s_vals[-1]
        for i in range(1, n + 1):
            pts.append(p_from + (p_to - p_from) * (i / n))
            s_vals.append(s0 + length * i / n)
            labels.append(label)

    cursor = as_vec(a.route.points[0])
    for b in a.bends:
        tp_in, tp_out = as_vec(b.tangent_point_in), as_vec(b.tangent_point_out)
        add_straight(cursor, tp_in, f"segment {b.number - 1}")
        if not b.is_zero:
            u = as_vec(a.segments[b.number - 1].direction)
            n = max(1, math.ceil(math.degrees(b.angle_rad) / max_chord_deg),
                    math.ceil(b.arc / max_piece))
            arc = arc_points(tp_in, u, as_vec(b.normal), b.clr, b.angle_rad, n)
            s0 = s_vals[-1]
            for i in range(1, n + 1):
                pts.append(arc[i])
                s_vals.append(s0 + b.arc * i / n)
                labels.append(f"bend {b.number}")
        cursor = tp_out
    add_straight(cursor, as_vec(a.route.points[-1]), f"segment {len(a.segments) - 1}")
    return CenterlineSamples(np.array(pts), np.array(s_vals), tuple(labels))
