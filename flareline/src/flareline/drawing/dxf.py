"""DXF backend (ezdxf, R2013).

Model space: the tube centerline at TRUE SIZE in 3D (inches): LINE entities
for straights and ARC entities, in their own bend planes, for bends, plus
POINTs at the intersection points. CAD users can sweep a circle along it.

Paper space layout "SHEET": sheet 1 of the drawing, 1:1 in sheet inches.
"""
from __future__ import annotations

import math
from pathlib import Path

import ezdxf
import numpy as np
from ezdxf.math import OCS, Vec3

from ..project import Evaluation
from .model import Circle, Line, Polyline, Rect, Sheet, Text
from .textfit import safe

LAYERS = {"TUBE_CENTERLINE_3D": 5, "INTERSECTION_POINTS": 3, "BORDER": 7, "TUBE": 8,
          "CENTERLINE": 7, "TEXT": 7, "TABLES": 7, "WATERMARK": 1, "CONSTRUCTION": 9}


def write_dxf(ev: Evaluation, sheet: Sheet, path: Path | str) -> None:
    doc = ezdxf.new("R2013", setup=True)
    doc.units = ezdxf.units.IN   # the model is always inches
    for name, colour in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=colour)
    msp = doc.modelspace()
    _centerline_3d(ev, msp)
    psp = doc.layouts.new("SHEET")
    psp.page_setup(size=(sheet.width, sheet.height), margins=(0, 0, 0, 0), units="inch")
    for it in sheet.items:
        _paper(psp, it)
    doc.set_modelspace_vport(height=40, center=(0, 0))
    doc.saveas(str(path))


def _centerline_3d(ev: Evaluation, msp) -> None:
    a = ev.analysis
    for i, p in enumerate(ev.project.route.points):
        msp.add_point(p, dxfattribs={"layer": "INTERSECTION_POINTS"})
        msp.add_text(f"P{i}", height=0.1, dxfattribs={"layer": "INTERSECTION_POINTS"}
                     ).set_placement(p)
    if not a.ok:
        return
    cursor = np.array(a.route.points[0], dtype=float)
    for b in a.bends:
        tp_in = np.array(b.tangent_point_in)
        if np.linalg.norm(tp_in - cursor) > 1e-12:
            msp.add_line(tuple(cursor), tuple(tp_in), dxfattribs={"layer": "TUBE_CENTERLINE_3D"})
        if not b.is_zero:
            _arc(msp, b, np.array(a.segments[b.number - 1].direction))
        cursor = np.array(b.tangent_point_out)
    end = np.array(a.route.points[-1], dtype=float)
    if np.linalg.norm(end - cursor) > 1e-12:
        msp.add_line(tuple(cursor), tuple(end), dxfattribs={"layer": "TUBE_CENTERLINE_3D"})


def _arc(msp, b, u: np.ndarray) -> None:
    """A bend arc in its own plane: DXF ARCs live in an OCS whose Z is the plane
    normal, with counter-clockwise angles about that normal."""
    n = np.array(b.normal)
    tp_in, tp_out = np.array(b.tangent_point_in), np.array(b.tangent_point_out)
    center = tp_in + np.cross(n, u) * b.clr
    ocs = OCS(Vec3(*n))
    c_ocs = ocs.from_wcs(Vec3(*center))
    s_ocs, e_ocs = ocs.from_wcs(Vec3(*tp_in)), ocs.from_wcs(Vec3(*tp_out))
    start = math.degrees(math.atan2(s_ocs.y - c_ocs.y, s_ocs.x - c_ocs.x))
    end = math.degrees(math.atan2(e_ocs.y - c_ocs.y, e_ocs.x - c_ocs.x))
    msp.add_arc(center=(c_ocs.x, c_ocs.y, c_ocs.z), radius=b.clr, start_angle=start,
                end_angle=end, dxfattribs={"layer": "TUBE_CENTERLINE_3D",
                                           "extrusion": tuple(n)})


def _paper(psp, it) -> None:
    layer = {"layer": getattr(it, "layer", "BORDER")}
    if isinstance(it, Line):
        psp.add_line(it.a, it.b, dxfattribs=layer)
    elif isinstance(it, Polyline):
        if len(it.points) >= 2:
            pl = psp.add_lwpolyline(it.points, dxfattribs=layer)
            if it.layer == "TUBE":
                pl.dxf.const_width = it.width
            pl.closed = it.closed
    elif isinstance(it, Rect):
        psp.add_lwpolyline([(it.x, it.y), (it.x + it.w, it.y), (it.x + it.w, it.y + it.h),
                            (it.x, it.y + it.h)], close=True, dxfattribs=layer)
    elif isinstance(it, Circle):
        psp.add_circle(it.center, it.radius, dxfattribs=layer)
    elif isinstance(it, Text):
        align = {"left": "LEFT", "center": "CENTER", "right": "RIGHT"}[it.anchor]
        from ezdxf.enums import TextEntityAlignment
        t = psp.add_text(safe(it.text), height=it.height * 0.72,  # cap height ~ 0.72 em
                         rotation=it.rotation, dxfattribs=layer)
        t.set_placement(it.pos, align=TextEntityAlignment[align])
