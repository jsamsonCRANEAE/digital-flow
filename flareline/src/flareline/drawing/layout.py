"""Build drawing sheets from an Evaluation.

Sheet 1: third-angle orthographic views (top above front, right side to the
right of front) at one common standard scale, an isometric for reference,
the bend table, flare details, notes, revision table and title block.
Sheets 2+: the calculation record listing every input and every traced
calculation, so each number on sheet 1 can be checked.

Conventions follow ASME Y14.5 where they apply (third-angle projection,
dimensions in the bend table, notes block, title block); this is a design
aid layout, not a certified drawing format.
"""
from __future__ import annotations

import datetime
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .. import __version__
from ..data.schema import Status
from ..data.store import Dataset
from ..geometry.centerline import sample_centerline
from ..geometry.formats import route_to_lra
from ..geometry.springback import SpringbackTable
from ..project import Evaluation
from ..project.model import END_TYPE_LABELS
from .model import (L_BORDER, L_CENTER, L_CONSTR, L_TABLE, L_TUBE, L_WATERMARK, PAPER,
                    Circle, Line, Polyline, Rect, Sheet, Text)
from .textfit import text_width, wrap

DISCLAIMER = ("DESIGN AID ONLY. ALL GEOMETRY MUST BE VERIFIED AND APPROVED PER YOUR "
              "ORGANIZATION'S ENGINEERING AND QUALITY PROCESS BEFORE FABRICATION.")
SCALES = [(4, 1), (2, 1), (1, 1), (1, 2), (1, 4), (1, 5), (1, 8), (1, 10), (1, 16), (1, 20),
          (1, 32), (1, 50)]
VIEWS = {  # name: (screen-right axis, screen-up axis)
    "TOP VIEW": ((1, 0, 0), (0, 1, 0)),
    "FRONT VIEW": ((1, 0, 0), (0, 0, 1)),
    "RIGHT SIDE VIEW": ((0, 1, 0), (0, 0, 1)),
    "ISOMETRIC (REFERENCE)": ((-1 / math.sqrt(2), 1 / math.sqrt(2), 0),
                              (-1 / math.sqrt(6), -1 / math.sqrt(6), 2 / math.sqrt(6))),
}
WATERMARK_RED = "#E53935"


@dataclass(frozen=True)
class DrawingInfo:
    """What the export dialog and tests need to know about a built drawing."""
    releasable: bool
    reasons: tuple[str, ...]
    scale_label: str
    scale: float
    sheets: int


def release_reasons(ev: Evaluation) -> list[str]:
    out = []
    if not ev.analysis.ok or ev.errors:
        out.append(f"{len(ev.errors)} geometry / check error(s)")
    if ev.flagged:
        out.append(f"{len(ev.flagged)} unverified or missing data value(s): "
                   + ", ".join(r.label for r in ev.flagged[:4])
                   + (" …" if len(ev.flagged) > 4 else ""))
    if ev.project.route_origin == "image" and not ev.project.image_confirmed:
        out.append("image-derived dimensions not confirmed")
    if not ev.interference_checked:
        out.append("self-interference not checked")
    return out


# -- number formatting (display only; the model is never rounded) -----------------------

def _len(v: float, unit: str) -> str:
    return f"{v * 25.4 if unit == 'mm' else v:.4f}"


def _ang(v: float) -> str:
    return f"{v:.2f}"


class _Builder:
    def __init__(self, ev: Evaluation, ds: Dataset, size: str, date: str):
        self.ev, self.ds, self.size = ev, ds, size
        self.W, self.H = PAPER[size]
        self.k = self.H / 8.5                     # scales spacing with the sheet
        self.h = {"A": 0.085, "B": 0.10, "D": 0.16}[size]   # body text size (in)
        self.unit = ev.project.settings.display_unit
        self.unit_word = "MILLIMETERS" if self.unit == "mm" else "INCHES"
        self.date = date
        self.m = 0.35 * self.k
        self.sheet = Sheet(self.W, self.H, size)

    # -- helpers ---------------------------------------------------------------------
    def text(self, x, y, s, size=None, **kw) -> float:
        size = size or self.h
        self.sheet.add(Text((x, y), s, size, **kw))
        return size

    def para(self, x, y, s, width, size=None, ref="", bold=False, gap=1.35) -> float:
        """Wrapped paragraph from top-left (x, y); returns the y below it."""
        size = size or self.h
        for line in wrap(s, size, width, bold):
            y -= size * gap
            self.sheet.add(Text((x, y), line, size, ref=ref, bold=bold))
        return y

    def box(self, x, y, w, h, width=0.012, layer=L_BORDER, fill=None):
        self.sheet.add(Rect(x, y, w, h, width, layer, fill))

    def cell(self, x, y, w, h, label, value, ref="", vsize=None):
        """Title-block style cell: small label top-left, value below."""
        self.box(x, y, w, h, 0.01)
        ls = self.h * 0.7
        self.text(x + 0.04 * self.k, y + h - ls * 1.2, label, ls)
        if value:
            self.text(x + 0.06 * self.k, y + 0.06 * self.k, value, vsize or self.h * 1.1,
                      ref=ref, bold=True)

    # -- regions -----------------------------------------------------------------------
    def build(self) -> tuple[Sheet, DrawingInfo]:
        m, W, H, k = self.m, self.W, self.H, self.k
        self.box(m, m, W - 2 * m, H - 2 * m, 0.025)
        col_w = 4.3 * k
        col_x = W - m - col_w
        tb_h = 1.45 * k
        rev_h = 0.95 * k
        self.title_block(col_x, m, col_w, tb_h)
        self.revision_table(col_x, H - m - rev_h, col_w, rev_h)
        y_notes_top = H - m - rev_h - 0.08 * k
        y_after = self.notes(col_x, y_notes_top, col_w)
        self.flare_details(col_x, m + tb_h + 0.08 * k, col_w, y_after - (m + tb_h + 0.16 * k))
        left_w = col_x - m - 0.1 * k
        table_top = self.bend_table(m, m, left_w)
        info = self.views(m, table_top + 0.1 * k, left_w, H - m - table_top - 0.1 * k)
        if not self.ev.releasable:
            self.watermark(m, table_top, left_w, H - m - table_top)
        return self.sheet, info

    def title_block(self, x, y, w, h):
        meta = self.ev.project.meta
        r = h / 5
        self.box(x, y, w, h, 0.025)
        self.cell(x, y + 4 * r, w, r, "TITLE", meta.get("title", "").upper(), "meta:title")
        self.cell(x, y + 3 * r, w * 0.6, r, "PART NUMBER", meta.get("part_number", ""),
                  "meta:part_number")
        self.cell(x + w * 0.6, y + 3 * r, w * 0.2, r, "REV", meta.get("revision", ""),
                  "meta:revision")
        self.cell(x + w * 0.8, y + 3 * r, w * 0.2, r, "SIZE", self.size, "static:size")
        self.cell(x, y + 2 * r, w * 0.3, r, "DRAWN", meta.get("drawn_by", ""), "meta:drawn_by")
        self.cell(x + w * 0.3, y + 2 * r, w * 0.3, r, "CHECKED", meta.get("checked_by", ""),
                  "meta:checked_by")
        self.cell(x + w * 0.6, y + 2 * r, w * 0.4, r, "DATE", self.date, "static:export_date")
        self.cell(x, y + r, w * 0.3, r, "SCALE", "", "")
        self._scale_cell = (x, y + r, w * 0.3, r)
        self.cell(x + w * 0.3, y + r, w * 0.3, r, "UNITS", self.unit_word, "static:units")
        self.cell(x + w * 0.6, y + r, w * 0.4, r, "SHEET", "", "")
        self._sheet_cell = (x + w * 0.6, y + r, w * 0.4, r)
        self.cell(x, y, w * 0.5, r, "ENGINEERING APPROVAL", "")
        self.cell(x + w * 0.5, y, w * 0.5, r, "QUALITY APPROVAL", "")
        self.text(x, y - self.h * 1.3, f"FLARELINE {__version__} · " + DISCLAIMER[:60] + "…",
                  self.h * 0.6, ref="static:app_version")

    def revision_table(self, x, y, w, h):
        lines = [ln for ln in self.ev.project.meta.get("revisions", "").splitlines() if ln.strip()]
        rows = [(ln.split("|") + ["", "", "", ""])[:4] for ln in lines][-4:]
        rh = h / 6
        cols = [0.12, 0.58, 0.18, 0.12]
        self.box(x, y, w, h, 0.02)
        self.text(x + w / 2, y + h - rh * 0.75, "REVISIONS", self.h, anchor="center", bold=True)
        cx = x
        for c, name in zip(cols, ("REV", "DESCRIPTION", "DATE", "BY")):
            self.box(cx, y + h - 2 * rh, w * c, rh, 0.01, L_TABLE)
            self.text(cx + 0.04 * self.k, y + h - 2 * rh + rh * 0.3, name, self.h * 0.8, bold=True)
            cx += w * c
        for i in range(4):
            cx = x
            row = rows[i] if i < len(rows) else ["", "", "", ""]
            for c, v in zip(cols, row):
                yy = y + h - (3 + i) * rh
                self.box(cx, yy, w * c, rh, 0.008, L_TABLE)
                fitted = _fit(v.strip(), self.h * 0.85, w * c - 0.08 * self.k)
                self.text(cx + 0.04 * self.k, yy + rh * 0.3, fitted, self.h * 0.85,
                          ref="meta:revisions")
                cx += w * c

    def notes(self, x, top, w) -> float:
        ev, p, u = self.ev, self.ev.project, self.unit
        res, a = ev.resolved, ev.analysis
        y = top
        self.text(x, y - self.h * 1.4, "NOTES:", self.h * 1.1, bold=True)
        y -= self.h * 1.6
        notes: list[tuple[str, str]] = []

        def val(name, fmt=lambda v: str(v)):
            r = res.get(name)
            if r is None or r.missing:
                return "NOT ENTERED"
            return fmt(r.value) + ("" if r.status.trusted else " (UNVERIFIED)")

        mat = self.ds.table("materials").lookup(material_id=p.tube.material_id)
        name = (mat.values.get("name") if mat else p.tube.material_id) or p.tube.material_id
        notes.append((f"MATERIAL: {name.upper()}, SPEC {val('material_spec')}.",
                      "resolved:material_spec"))
        od = val("od", lambda v: _len(v, u))
        wall = val("wall", lambda v: _len(v, u))
        notes.append((f"TUBE: OD {od} X WALL {wall} {self.unit_word} (-{p.tube.dash}).",
                      "resolved:od,resolved:wall"))
        if a.ok:
            cut = _len(a.cut_length, u)
            inc = "" if ev.cut_length_complete else " - INCOMPLETE, END ALLOWANCE NOT ENTERED"
            notes.append((f"DEVELOPED LENGTH {_len(a.developed_length, u)}; CUT LENGTH "
                          f"{cut}{inc}.", "total.developed,total.cut"))
        ends = (f"END 1: {END_TYPE_LABELS[p.end1].upper()}; END 2: "
                f"{END_TYPE_LABELS[p.end2].upper()}. END POINTS SIT AT THE FLARE: "
                f"{val('end_point_definition') if 'end_point_definition' in res else 'N/A'}.")
        notes.append((ends, "static:end_types,resolved:end_point_definition"))
        notes.append(("STANDARDS AND DATA USED: " + "; ".join(self.sources()) + ".",
                      "resolved:*"))
        conv = p.settings.rotation_convention
        notes.append((f"Z UP. P0 = END 1. ROTATION {conv.label.upper()}. FEED = STRAIGHT "
                      f"BETWEEN TANGENT POINTS. CLR = CENTERLINE BEND RADIUS. B1 FROM "
                      f"REFERENCE PLANE (+Z PROJECTED).", "static:conventions"))
        for key, label in (("general_tolerances", "GENERAL TOLERANCES"),
                           ("cleanliness", "CLEANLINESS"), ("proof_test", "PROOF TEST")):
            notes.append((f"{label}: {p.meta.get(key, '').strip() or 'NOT SPECIFIED'}.",
                          f"meta:{key}"))
        devs = [f"{n.upper()} = {o.value} ({o.reason}; {o.entered_by or '?'} "
                f"{o.date or ''})".replace(" )", ")") for n, o in p.overrides.items()]
        notes.append(("APPROVED DEVIATIONS: " + ("; ".join(devs) if devs else "NONE") + ".",
                      "overrides"))
        notes.append((f"DATA SET {ev.dataset_version}, SHA-256 {ev.dataset_sha256[:16]}.",
                      "dataset"))
        notes.append(("ALL DIMENSIONS PER BEND TABLE. EVERY VALUE IS LISTED WITH ITS FORMULA "
                      "AND INPUTS IN THE CALCULATION RECORD (SHEET 2 ON).", "static:note"))
        notes.append((DISCLAIMER, "static:disclaimer"))
        indent = 0.25 * self.k
        for i, (s, ref) in enumerate(notes, 1):
            self.text(x, y - self.h * 1.35, f"{i}.", self.h, ref="static:note_number")
            y = self.para(x + indent, y, s, w - indent, ref=ref)
            y -= self.h * 0.25
        return y

    def sources(self) -> list[str]:
        seen: dict[str, str] = {}
        for r in self.ev.resolved.values():
            if r.status in (Status.USER_INPUT, Status.DERIVED, Status.DEFAULT):
                continue
            src = r.source.split(" (")[0].upper()
            if not src or src.startswith("(NO SOURCE)") or src.startswith("USER INPUT"):
                continue
            flag = "" if not r.flagged else " - UNVERIFIED/NOT ENTERED"
            seen.setdefault(src, src + flag)
        return list(seen.values()) or ["NONE"]

    def flare_details(self, x, y, w, h):
        p = self.ev.project
        ends = [n for n, e in ((1, p.end1), (2, p.end2)) if e == "flare37"]
        if not ends or h < 0.6 * self.k:
            return
        row = self.ds.table("as4330_flare").lookup(dash=p.tube.dash,
                                                   material_id=p.tube.material_id,
                                                   wall=p.tube.wall)
        bw = w / len(ends) - 0.05 * self.k
        for i, n in enumerate(ends):
            bx = x + i * (bw + 0.1 * self.k)
            self.box(bx, y, bw, h, 0.015)
            ty = y + h - self.h * 1.5
            self.text(bx + 0.05 * self.k, ty, f"DETAIL END {n}: 37° FLARE", self.h,
                      bold=True, ref="static:detail_title")
            yy = ty
            for line, ref in self.flare_lines(row):
                yy = self.para(bx + 0.05 * self.k, yy, line, bw - 0.1 * self.k,
                               size=self.h * 0.85, ref=ref)
            area_h = yy - y - 0.35 * self.k            # space left under the text
            if area_h > 0.25 * self.k:
                sh = min(area_h, bw * 0.55)
                self.flare_sketch(bx + bw * 0.5, y + 0.2 * self.k + (area_h - sh) / 2,
                                  bw * 0.8, sh)

    def flare_lines(self, row) -> list[tuple[str, str]]:
        if row is None:
            return [("NO AS4330 DATA ROW FOR THIS SIZE", "data:as4330_flare")]
        v, pv = row.values, row.provenance
        ref = f"data:as4330_flare row {row.index}"
        src = f"PER SAE AS4330 REV {pv.revision or '?'}, {pv.table_ref or 'TABLE ?'}"
        if pv.status != Status.VERIFIED:
            src += " - UNVERIFIED"

        def num(f, fmt):
            return "NOT ENTERED" if v.get(f) is None else fmt(v[f])
        dia = (f"FLARE DIA {num('flare_diameter_min', lambda x: _len(x, self.unit))} - "
               f"{num('flare_diameter_max', lambda x: _len(x, self.unit))}")
        ang = (f"FLARE ANGLE {num('flare_angle_nominal_deg', lambda x: _ang(x) + '°')} ± "
               f"{num('flare_angle_tol_deg', lambda x: _ang(x) + '°')}")
        out = [(src, ref), (dia, ref), (ang, ref),
               ("NUT AND SLEEVE: REFERENCE ONLY (SAE J514)", "static:j514")]
        if v.get("notes"):
            out.append((str(v["notes"]).upper(), ref))
        return out

    def flare_sketch(self, cx, y0, w, h):
        """Schematic half-section of a 37° flared end: tube wall along the axis turning
        out at 37° from the axis at the end. Labelled not to scale."""
        k = self.k
        axis_y = y0 + h * 0.5
        r_out, wall = h * 0.2, h * 0.06
        flare_len = h * 0.42
        x0 = cx - w / 2
        x1 = cx + w / 2 - flare_len * math.cos(math.radians(37)) - 0.1 * k
        dx = flare_len * math.cos(math.radians(37))
        dy = flare_len * math.sin(math.radians(37))
        for sign in (1, -1):
            for r in (r_out, r_out - wall):
                yb = axis_y + sign * r
                self.sheet.add(Polyline(((x0, yb), (x1, yb), (x1 + dx, yb + sign * dy)),
                                        0.012, L_CONSTR))
            # flare face: close the wall at the end of the cone
            self.sheet.add(Line((x1 + dx, axis_y + sign * (r_out + dy)),
                                (x1 + dx, axis_y + sign * (r_out - wall + dy)), 0.012, L_CONSTR))
        self.sheet.add(Line((x0 - 0.05 * k, axis_y), (x1 + dx + 0.1 * k, axis_y), 0.006,
                            L_CENTER, dash=(0.12 * k, 0.04 * k, 0.02 * k, 0.04 * k)))
        self.text(x1 - 0.05 * k, axis_y + r_out + dy * 0.55, "37° TO AXIS", self.h * 0.75,
                  anchor="right", ref="static:flare_name")
        self.text(cx, y0 - self.h * 0.9, "SCHEMATIC HALF-SECTION - NOT TO SCALE",
                  self.h * 0.7, anchor="center")

    # -- bend table ----------------------------------------------------------------------
    def bend_table(self, x, y, w) -> float:
        ev, u = self.ev, self.unit
        a, route = ev.analysis, ev.project.route
        conv = ev.project.settings.rotation_convention
        sb = None
        sbr = ev.resolved.get("springback_points")
        if sbr is not None and not sbr.missing:
            sb = SpringbackTable(tuple(tuple(q) for q in sbr.value), enabled=True)
        heads = ["PT", "X", "Y", "Z", "CLR", "BEND °", "ROT °", "STRAIGHT TO NEXT", "BEND MARKS"]
        if sb:
            heads.append("AT BENDER °")
        rel = [0.07, 0.11, 0.11, 0.11, 0.09, 0.09, 0.09, 0.14, 0.19] + ([0.09] if sb else [])
        tot = sum(rel)
        widths = [w * r / tot for r in rel]
        rows: list[list[tuple[str, str]]] = []
        lra = route_to_lra(a) if a.ok else None
        n = len(route.points)
        for i, pt in enumerate(route.points):
            r = [(f"P{i}", "label:point")] + [(_len(c, u), f"input:P{i}.{ax}")
                                             for c, ax in zip(pt, "xyz")]
            interior = 0 < i < n - 1
            if interior:
                r.append((_len(route.radii[i - 1], u), f"input:clr{i}"))
            else:
                r.append(("", ""))
            if a.ok and interior:
                b = a.bend(i)
                r.append((_ang(b.angle_deg), f"bend{i}.angle_deg"))
                rot = conv.to_display(lra.steps[i - 1].rotation_deg)
                key = (f"bend{i}.rotation_deg" if b.rotation_deg is not None
                       else f"bend{i}.rotation_from_ref_deg" if not b.is_zero else "")
                r.append((_ang(rot), key))
            else:
                r += [("", ""), ("", "")]
            if a.ok and i < n - 1:
                r.append((_len(a.segments[i].straight, u), f"seg{i}.straight"))
            else:
                r.append(("", ""))
            if a.ok and interior:
                b = a.bend(i)
                r.append((f"{_len(b.mark_start, u)} - {_len(b.mark_end, u)}",
                          f"bend{i}.mark_start,bend{i}.mark_end"))
                if sb:
                    res = sb.apply(b.angle_deg)
                    r.append((_ang(res.bender_deg) + ("*" if res.extrapolated else ""),
                              f"springback:{i}"))
            else:
                r += [("", "")] + ([("", "")] if sb else [])
            rows.append(r)
        size = self.h * 0.95
        rh = size * 1.75
        title_h = rh
        top = y + rh * (len(rows) + 1) + title_h
        self.box(x, y, w, top - y, 0.02)
        self.text(x + w / 2, top - title_h * 0.72,
                  f"BEND TABLE ({self.unit_word}, DEGREES). MARKS: DEVELOPED DISTANCE FROM P0.",
                  size, anchor="center", bold=True, ref="static:table_title")
        cy = top - title_h - rh
        cx = x
        for wd, hd in zip(widths, heads):
            self.box(cx, cy, wd, rh, 0.012, L_TABLE, fill="#EEEEEE")
            self.text(cx + wd / 2, cy + rh * 0.3, _fit(hd, size * 0.85, wd), size * 0.85,
                      anchor="center", bold=True, ref="static:header")
            cx += wd
        for r in rows:
            cy -= rh
            cx = x
            for wd, (txt, ref) in zip(widths, r):
                self.box(cx, cy, wd, rh, 0.008, L_TABLE)
                if txt:
                    self.text(cx + wd - 0.04 * self.k, cy + rh * 0.3, txt, size,
                              anchor="right", ref=ref)
                cx += wd
        return top

    # -- views ---------------------------------------------------------------------------
    def views(self, x, y, w, h) -> DrawingInfo:
        ev = self.ev
        a = ev.analysis
        od_r = ev.resolved.get("od")
        od = 0.25 if od_r is None or od_r.missing else float(od_r.value)
        if a.ok and all(s.straight >= -1e-9 for s in a.segments):
            cl = sample_centerline(a, max_piece=1e9, max_chord_deg=3.0).points
        else:
            cl = np.array(ev.project.route.points, dtype=float)
        pts = np.array(ev.project.route.points, dtype=float)
        label_h = self.h * 3.2
        cw, ch = w / 2, h / 2
        cells = {"TOP VIEW": (x, y + ch), "ISOMETRIC (REFERENCE)": (x + cw, y + ch),
                 "FRONT VIEW": (x, y), "RIGHT SIDE VIEW": (x + cw, y)}
        pad = 0.25 * self.k
        avail_w, avail_h = cw - 2 * pad, ch - 2 * pad - label_h

        def proj(name, arr):
            r_ax, u_ax = (np.array(v, dtype=float) for v in VIEWS[name])
            return np.column_stack([arr @ r_ax, arr @ u_ax])

        # one standard scale for the three orthographic views
        fit = math.inf
        for name in ("TOP VIEW", "FRONT VIEW", "RIGHT SIDE VIEW"):
            q = proj(name, cl)
            span_w = np.ptp(q[:, 0]) + od
            span_h = np.ptp(q[:, 1]) + od
            fit = min(fit, avail_w / max(span_w, 1e-9), avail_h / max(span_h, 1e-9))
        scale_label, scale = "NTS", fit
        for num, den in SCALES:
            if num / den <= fit:
                scale, scale_label = num / den, f"{num}:{den}"
                break

        for name, (vx, vy) in cells.items():
            self.box(vx, vy, cw, ch, 0.006, L_CONSTR)
            q, qp = proj(name, cl), proj(name, pts)
            iso = name.startswith("ISO")
            s = scale
            if iso:
                s = min(avail_w / max(np.ptp(q[:, 0]) + od, 1e-9),
                        avail_h / max(np.ptp(q[:, 1]) + od, 1e-9)) * 0.95
            cxm = (q[:, 0].min() + q[:, 0].max()) / 2
            cym = (q[:, 1].min() + q[:, 1].max()) / 2
            ox = vx + cw / 2 - cxm * s
            oy = vy + label_h + pad + avail_h / 2 - cym * s
            tube = tuple((ox + px * s, oy + py * s) for px, py in q)
            self.sheet.add(Polyline(tube, max(od * s, 0.01), L_TUBE, color="#B0B7BF"))
            self.sheet.add(Polyline(tube, 0.006, L_CENTER, color="#000000",
                                    dash=(0.15 * self.k, 0.05 * self.k, 0.03 * self.k,
                                          0.05 * self.k)))
            # points that coincide in this view share one label: "P1, P2"
            groups: list[tuple[tuple[float, float], list[int]]] = []
            for i, (px, py) in enumerate(qp):
                c = (ox + px * s, oy + py * s)
                for gc, members in groups:
                    if math.dist(gc, c) < 0.02 * self.k:
                        members.append(i)
                        break
                else:
                    groups.append((c, [i]))
            for c, members in groups:
                self.sheet.add(Circle(c, 0.025 * self.k, 0.006, L_CENTER, fill="#000000"))
                self.text(c[0] + 0.05 * self.k, c[1] + 0.05 * self.k,
                          ", ".join(f"P{i}" for i in members), self.h * 0.9, bold=True,
                          ref="label:point")
            self.text(vx + cw / 2, vy + label_h * 0.55, name, self.h * 1.1, anchor="center",
                      bold=True)
            self.text(vx + cw / 2, vy + label_h * 0.15,
                      "NOT TO SCALE" if iso else f"SCALE {scale_label}", self.h * 0.9,
                      anchor="center", ref="static:scale")
        x0, y0, w0, h0 = self._scale_cell
        self.text(x0 + 0.06 * self.k, y0 + 0.06 * self.k, scale_label, self.h * 1.1, bold=True,
                  ref="static:scale")
        reasons = tuple(release_reasons(ev))
        return DrawingInfo(ev.releasable, reasons, scale_label, scale, 1)

    def watermark(self, x, y, w, h):
        cx, cy = x + w / 2, y + h / 2
        ang = math.degrees(math.atan2(h, w))
        self.sheet.add(Text((cx, cy), "NOT FOR FABRICATION", min(w, h) * 0.11,
                            anchor="center", bold=True, layer=L_WATERMARK, rotation=ang,
                            color=WATERMARK_RED))
        # reasons stay inside the top-left view cell, wrapped
        yy = y + h - self.h * 1.6
        self.text(x + 0.1 * self.k, yy, "NOT FOR FABRICATION:", self.h, bold=True,
                  layer=L_WATERMARK, color=WATERMARK_RED)
        for r in release_reasons(self.ev):
            for ln in wrap("- " + r, self.h * 0.9, w / 2 - 0.3 * self.k):
                yy -= self.h * 1.2
                self.text(x + 0.15 * self.k, yy, ln, self.h * 0.9, layer=L_WATERMARK,
                          color=WATERMARK_RED, ref="static:release_reasons")

    def set_sheet_numbers(self, n: int, of: int) -> None:
        x, y, w, h = self._sheet_cell
        self.text(x + 0.06 * self.k, y + 0.06 * self.k, f"{n} OF {of}", self.h * 1.1, bold=True,
                  ref="static:sheet_number")


def _fit(s: str, size: float, width: float) -> str:
    if text_width(s, size) <= width:
        return s
    while s and text_width(s + "…", size) > width:
        s = s[:-1]
    return s + "…"


# -- calculation record -------------------------------------------------------------------

def calc_record(ev: Evaluation, size: str, date: str) -> list[Sheet]:
    W, H = PAPER[size]
    k = H / 8.5
    h = {"A": 0.075, "B": 0.09, "D": 0.14}[size]
    m = 0.35 * k
    rows: list[tuple[str, str, str, str]] = []
    for r in ev.resolved.values():
        v = "—" if r.missing else (f"{r.value!r} {r.unit}" if r.unit != "-" else repr(r.value))
        rows.append((f"resolved:{r.name}", r.label, f"INPUT [{r.status.value}]",
                     f"{v}   source: {r.describe()}"))
    for i, pt in enumerate(ev.project.route.points):
        rows.append((f"input:P{i}", f"Point P{i}", "INPUT [USER INPUT]",
                     ", ".join(repr(float(c)) for c in pt) + " in"))
    for i, r in enumerate(ev.project.route.radii, 1):
        rows.append((f"input:clr{i}", f"Bend {i} CLR", "INPUT [USER INPUT]", f"{r!r} in"))
    for t in ev.analysis.traces:
        inputs = ", ".join(f"{n}={_short(v)}" for n, v in t.inputs.items())
        rows.append((t.key, t.description, t.formula, f"= {t.value!r} {t.unit}"
                     + (f"   with {inputs}" if inputs else "")))
    sheets: list[Sheet] = []
    col = [0.17, 0.27, 0.22, 0.34]
    usable_w = W - 2 * m
    y = 0.0
    sheet = None
    for key, desc, formula, value in rows:
        cells = [wrap(c, h, usable_w * f - 0.08 * k) for c, f in zip((key, desc, formula, value), col)]
        nlines = max(len(c) for c in cells)
        need = nlines * h * 1.3 + h * 0.4
        if sheet is None or y - need < m + 0.5 * k:
            sheet = Sheet(W, H, size)
            sheets.append(sheet)
            sheet.add(Rect(m, m, W - 2 * m, H - 2 * m, 0.025))
            y = H - m - h * 2
            sheet.add(Text((m + 0.1 * k, y), "CALCULATION RECORD", h * 1.4, bold=True))
            sheet.add(Text((W - m - 0.1 * k, y), f"{ev.project.meta.get('part_number', '')} "
                           f"REV {ev.project.meta.get('revision', '')} · {date} · DATA "
                           f"{ev.dataset_sha256[:16]}", h, anchor="right", ref="static:header"))
            y -= h * 2
            x = m + 0.05 * k
            for f, name in zip(col, ("KEY", "DESCRIPTION", "FORMULA / STATUS", "VALUE, INPUTS, SOURCE")):
                sheet.add(Text((x, y), name, h, bold=True))
                x += usable_w * f
            y -= h * 0.6
            sheet.add(Line((m, y), (W - m, y), 0.01))
        x = m + 0.05 * k
        for f, lines in zip(col, cells):
            yy = y
            for ln in lines:
                yy -= h * 1.3
                sheet.add(Text((x, yy), ln, h, ref="calc_record"))
            x += usable_w * f
        y -= need
        sheet.add(Line((m, y + h * 0.2), (W - m, y + h * 0.2), 0.004, L_CONSTR, color="#BBBBBB"))
    sheets[-1].add(Text((m + 0.1 * k, m + 0.2 * k),
                        "Values at full double precision as stored; drawing sheet values are "
                        "these rounded for display (4 dp lengths, 2 dp angles).", h,
                        ref="static:note"))
    return sheets


def _short(v) -> str:
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, tuple):
        return "(" + ", ".join(f"{x:.6g}" for x in v) + ")"
    return str(v)


def build_drawing(ev: Evaluation, ds: Dataset, size: str = "B",
                  date: Optional[str] = None,
                  with_calc_record: bool = True) -> tuple[list[Sheet], DrawingInfo]:
    """Sheet 1 (drawing) plus the calculation record sheets."""
    date = date or datetime.date.today().isoformat()
    b = _Builder(ev, ds, size, date)
    sheet1, info = b.build()
    rest = calc_record(ev, size, date) if with_calc_record else []
    total = 1 + len(rest)
    b.set_sheet_numbers(1, total)
    for i, s in enumerate(rest, 2):
        s.number, s.of = i, total
        s.add(Text((s.width - 0.35 * s.height / 8.5 - 0.1, 0.35 * s.height / 8.5 + 0.1),
                   f"SHEET {i} OF {total}", 0.09 * s.height / 8.5, anchor="right",
                   ref="static:sheet_number"))
    sheet1.of = total
    return [sheet1] + rest, DrawingInfo(info.releasable, info.reasons, info.scale_label,
                                        info.scale, total)
