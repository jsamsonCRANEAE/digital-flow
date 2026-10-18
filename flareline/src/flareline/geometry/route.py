"""The tube model: a centerline polyline of intersection points plus a
centerline bend radius (CLR) at each interior vertex.

Conventions (see docs/CONVENTIONS.md):
  * inches, float64, never rounded in the model
  * Z up; the origin is normally at the end-1 tube end (P0)
  * vertex 0 is end 1, vertex N-1 is end 2; bend k sits at vertex k
"""
from __future__ import annotations

import math
from dataclasses import dataclass

Point = tuple[float, float, float]


@dataclass(frozen=True)
class TubeRoute:
    points: tuple[Point, ...]
    radii: tuple[float, ...]  # one CLR per interior vertex, len == len(points) - 2

    def __post_init__(self) -> None:
        pts = tuple(tuple(float(c) for c in p) for p in self.points)
        rad = tuple(float(r) for r in self.radii)
        if len(pts) < 2:
            raise ValueError("a tube needs at least two points")
        if any(len(p) != 3 for p in pts):
            raise ValueError("every point needs X, Y and Z")
        if len(rad) != len(pts) - 2:
            raise ValueError(
                f"need one bend radius per interior vertex: "
                f"{len(pts) - 2} expected, {len(rad)} given")
        if not all(math.isfinite(c) for p in pts for c in p):
            raise ValueError("point coordinates must be finite numbers")
        if not all(math.isfinite(r) for r in rad):
            raise ValueError("bend radii must be finite numbers")
        object.__setattr__(self, "points", pts)
        object.__setattr__(self, "radii", rad)

    @classmethod
    def uniform(cls, points, clr: float) -> "TubeRoute":
        """Route with the same CLR at every bend."""
        pts = tuple(points)
        return cls(pts, (clr,) * max(len(pts) - 2, 0))

    @property
    def n_bends(self) -> int:
        return len(self.points) - 2

    def with_point(self, index: int, point: Point) -> "TubeRoute":
        pts = list(self.points)
        pts[index] = point
        return TubeRoute(tuple(pts), self.radii)

    def with_radius(self, bend: int, clr: float) -> "TubeRoute":
        """bend is 1-based, matching the vertex index."""
        rad = list(self.radii)
        rad[bend - 1] = clr
        return TubeRoute(self.points, tuple(rad))

    def translated(self, dx: float, dy: float, dz: float) -> "TubeRoute":
        return TubeRoute(tuple((x + dx, y + dy, z + dz) for x, y, z in self.points),
                         self.radii)
