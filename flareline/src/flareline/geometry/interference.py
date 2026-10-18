"""Self-interference check: does the tube touch itself anywhere?

Two centerline points closer than OD (+ required clearance) interfere, except
when they are close simply because they are near each other along the tube.
Exclusion rule: pairs less than pi*OD/2 apart along the centerline are not
compared. For any curve whose bend radius is >= OD/2, points that far apart
or less can be closer than OD without the tube touching itself (it is the
half-circle limit), and points beyond it, up to half a turn of the tightest
bend, cannot be. CLR <= OD/2 is rejected separately as physically impossible.

The check is done on chords (arcs sampled at <= 2 deg and pieces <= OD/4), so
reported distances are approximate to within the chord sagitta.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from .analysis import RouteAnalysis
from .centerline import sample_centerline


@dataclass(frozen=True)
class Contact:
    label_a: str
    label_b: str
    distance: float            # centerline-to-centerline
    location: tuple[float, float, float]


@dataclass(frozen=True)
class InterferenceResult:
    checked: bool
    reason: str                # why not checked, or "" when checked
    min_distance: float        # smallest centerline distance among nearby pairs
    od: float
    required: float            # OD + clearance
    contacts: tuple[Contact, ...]

    @property
    def min_gap(self) -> float:
        """Surface-to-surface gap for the closest nearby pair (inf if none)."""
        return self.min_distance - self.od


def segment_distances(p1, q1, p2, q2):
    """Closest distance between segment arrays (N,3); returns (dist, mid point).

    Ericson, Real-Time Collision Detection, 5.1.9, vectorised. Segments are
    assumed to have non-zero length."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a = np.einsum("ij,ij->i", d1, d1)
    e = np.einsum("ij,ij->i", d2, d2)
    f = np.einsum("ij,ij->i", d2, r)
    c = np.einsum("ij,ij->i", d1, r)
    b = np.einsum("ij,ij->i", d1, d2)
    denom = a * e - b * b
    with np.errstate(divide="ignore", invalid="ignore"):
        s = np.where(denom > 1e-18 * a * e, np.clip((b * f - c * e) / denom, 0, 1), 0.0)
        t = (b * s + f) / e
        lo, hi = t < 0, t > 1
        t = np.clip(t, 0, 1)
        s = np.where(lo, np.clip(-c / a, 0, 1), np.where(hi, np.clip((b - c) / a, 0, 1), s))
    c1 = p1 + d1 * s[:, None]
    c2 = p2 + d2 * t[:, None]
    return np.linalg.norm(c1 - c2, axis=1), (c1 + c2) / 2.0


def check_self_interference(a: RouteAnalysis, od: float,
                            clearance: float = 0.0) -> InterferenceResult:
    required = od + clearance
    if not a.ok:
        return InterferenceResult(False, "route not solved", math.inf, od, required, ())
    if any(sg.straight < -1e-9 for sg in a.segments):
        return InterferenceResult(False, "bends overlap", math.inf, od, required, ())
    if any(b.clr <= od / 2 for b in a.bends if not b.is_zero):
        return InterferenceResult(False, "a bend radius is <= OD/2", math.inf,
                                  od, required, ())

    piece = od / 4.0
    cl = sample_centerline(a, max_piece=piece)
    P0, P1 = cl.points[:-1], cl.points[1:]
    s_start, s_end = cl.s[:-1], cl.s[1:]
    exclusion = math.pi * od / 2.0
    reach = required + piece  # max midpoint distance that could still interfere

    # uniform grid on chord midpoints; compare only neighbouring cells
    mid = (P0 + P1) / 2.0
    cells = np.floor(mid / reach).astype(np.int64)
    grid: dict[tuple, list[int]] = defaultdict(list)
    for i, c in enumerate(map(tuple, cells)):
        grid[c].append(i)
    offsets = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)]
    ii, jj = [], []
    for c, members in grid.items():
        neighbours = [j for o in offsets
                      for j in grid.get((c[0] + o[0], c[1] + o[1], c[2] + o[2]), ())]
        for i in members:
            for j in neighbours:
                if j > i and s_start[j] - s_end[i] >= exclusion:
                    ii.append(i)
                    jj.append(j)
    if not ii:
        return InterferenceResult(True, "", math.inf, od, required, ())
    ii_a, jj_a = np.array(ii), np.array(jj)
    dist, where = segment_distances(P0[ii_a], P1[ii_a], P0[jj_a], P1[jj_a])

    hits: dict[tuple[str, str], Contact] = {}
    for k in np.nonzero(dist < required - 1e-9)[0]:
        la, lb = cl.labels[ii_a[k]], cl.labels[jj_a[k]]
        prev = hits.get((la, lb))
        if prev is None or dist[k] < prev.distance:
            hits[(la, lb)] = Contact(la, lb, float(dist[k]),
                                     tuple(float(x) for x in where[k]))
    return InterferenceResult(True, "", float(dist.min()), od, required,
                              tuple(sorted(hits.values(), key=lambda h: h.distance)))
