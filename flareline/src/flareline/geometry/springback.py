"""Springback compensation (user/shop data, never standards data).

A table of (design angle, springback) points per material. The bender angle
is design angle + springback, linearly interpolated between points. One
point means a constant springback; points (0, 0) and (90, 3) mean a springback
proportional to angle. Outside the table the end value is held and the result
is flagged as extrapolated so it can be warned about.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass


@dataclass(frozen=True)
class SpringbackResult:
    design_deg: float
    springback_deg: float
    bender_deg: float
    extrapolated: bool


@dataclass(frozen=True)
class SpringbackTable:
    points: tuple[tuple[float, float], ...]   # (design angle deg, springback deg)
    enabled: bool = False
    source: str = "user input"

    def __post_init__(self) -> None:
        pts = tuple(sorted((float(a), float(s)) for a, s in self.points))
        if not pts:
            raise ValueError("springback table needs at least one point")
        if len({a for a, _ in pts}) != len(pts):
            raise ValueError("springback table has duplicate angles")
        object.__setattr__(self, "points", pts)

    def springback(self, design_deg: float) -> tuple[float, bool]:
        pts = self.points
        if len(pts) == 1:
            return pts[0][1], False
        if design_deg < pts[0][0]:
            return pts[0][1], True
        if design_deg > pts[-1][0]:
            return pts[-1][1], True
        i = bisect_right([a for a, _ in pts], design_deg)
        if i >= len(pts):
            return pts[-1][1], False
        (a0, s0), (a1, s1) = pts[i - 1], pts[i]
        return s0 + (s1 - s0) * (design_deg - a0) / (a1 - a0), False

    def apply(self, design_deg: float) -> SpringbackResult:
        if not self.enabled or design_deg == 0.0:
            return SpringbackResult(design_deg, 0.0, design_deg, False)
        sb, extrap = self.springback(design_deg)
        return SpringbackResult(design_deg, sb, design_deg + sb, extrap)
