"""Editable bend table in three synchronised formats: XYZ, LRA (YBC) and legs.

Editable cells are white; calculated cells are shaded and read-only. Selecting
any cell reports which calculation traces explain it.
"""
from __future__ import annotations

from dataclasses import replace

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (QAbstractItemView, QButtonGroup, QHBoxLayout, QHeaderView,
                               QLabel, QTableWidget, QTableWidgetItem, QToolButton,
                               QVBoxLayout, QWidget)

from ...geometry.formats import (BendStep, Frame, LegData, LraData, legs_to_route,
                                 lra_to_route, route_to_legs, route_to_lra)
from ...geometry.route import TubeRoute
from ...geometry.springback import SpringbackTable
from ...project import Evaluation
from .common import fmt_num, from_display, parse_number, to_display

MODES = ("XYZ", "LRA", "Legs")
MODE_TIPS = {
    "XYZ": "Intersection points (X, Y, Z) and bend radius at each bend",
    "LRA": "Bender data: Y = feed (straight between tangent points), "
           "B = rotation, C = bend angle",
    "Legs": "Intersection-to-intersection leg lengths, rotation and bend angle",
}


class BendTable(QWidget):
    routeEdited = Signal(object, str)     # (TubeRoute, undo text)
    explain = Signal(list)                # trace keys for the explain panel

    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.mode = "XYZ"
        self.ev: Evaluation | None = None
        self._keys: dict[tuple[int, int], list[str]] = {}
        self._loading = False

        bar = QHBoxLayout()
        title = QLabel("Bend table")
        title.setObjectName("H2")
        bar.addWidget(title)
        bar.addSpacing(12)
        self.group = QButtonGroup(self)
        for m in MODES:
            b = QToolButton(text=m, checkable=True)
            b.setToolTip(MODE_TIPS[m])
            b.setChecked(m == self.mode)
            self.group.addButton(b)
            b.clicked.connect(lambda _=False, m=m: self.set_mode(m))
            bar.addWidget(b)
        bar.addStretch(1)
        self.note = QLabel()
        self.note.setObjectName("Muted")
        bar.addWidget(self.note)

        self.table = QTableWidget(self)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.itemChanged.connect(self._edited)
        self.table.currentCellChanged.connect(self._selected)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(bar)
        lay.addWidget(self.table)

    # -- display -------------------------------------------------------------------
    def set_mode(self, mode: str) -> None:
        self.mode = mode
        for b in self.group.buttons():
            b.setChecked(b.text() == mode)
        if self.ev is not None:
            self.show_evaluation(self.ev)

    @property
    def unit(self) -> str:
        return self.ev.project.settings.display_unit if self.ev else "in"

    def _conv(self):
        return self.ev.project.settings.rotation_convention

    def show_evaluation(self, ev: Evaluation) -> None:
        self.ev = ev
        self._loading = True
        row, col = self.table.currentRow(), self.table.currentColumn()
        self.table.blockSignals(True)
        self.table.clear()
        self._keys.clear()
        mode = self.mode if ev.analysis.ok else "XYZ"
        if mode != self.mode:
            self.note.setText("Geometry has errors: showing XYZ only")
        else:
            self.note.setText(f"Units: {self.unit} / deg · Rotation {self._conv().label}")
        {"XYZ": self._fill_xyz, "LRA": self._fill_lra, "Legs": self._fill_legs}[mode]()
        self.table.blockSignals(False)
        if 0 <= row < self.table.rowCount() and 0 <= col < self.table.columnCount():
            self.table.setCurrentCell(row, col)
        self._loading = False

    def _set(self, r: int, c: int, text: str, editable: bool, keys: list[str] = (),
             tip: str = "") -> None:
        it = QTableWidgetItem(text)
        it.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        if not editable:
            it.setFlags(it.flags() & ~Qt.ItemIsEditable)
            it.setForeground(QBrush(QColor("#6B7480")))
        if tip:
            it.setToolTip(tip)
        self.table.setItem(r, c, it)
        self._keys[(r, c)] = list(keys)

    def _headers(self, names: list[str]) -> None:
        self.table.setColumnCount(len(names))
        self.table.setHorizontalHeaderLabels(names)

    def _fill_xyz(self) -> None:
        ev, u = self.ev, self.unit
        route, a = ev.project.route, ev.analysis
        self._headers(["Point", f"X ({u})", f"Y ({u})", f"Z ({u})", f"CLR ({u})",
                       "Bend (°)", "Rotation (°)", f"Straight → ({u})"])
        self.table.setRowCount(len(route.points))
        n = len(route.points)
        for i, p in enumerate(route.points):
            label = "P0 (end 1)" if i == 0 else f"P{i} (end 2)" if i == n - 1 else f"P{i} / B{i}"
            self._set(i, 0, label, False)
            for c in range(3):
                self._set(i, 1 + c, fmt_num(to_display(p[c], u)), True,
                          tip="Intersection point coordinate (Z up)")
            interior = 0 < i < n - 1
            if interior:
                self._set(i, 4, fmt_num(to_display(route.radii[i - 1], u)), True,
                          [f"bend{i}.tangent", f"bend{i}.arc"], "Centerline bend radius")
            else:
                self._set(i, 4, "", False)
            if a.ok and interior:
                b = a.bend(i)
                self._set(i, 5, fmt_num(b.angle_deg, 2), False, [f"bend{i}.angle_deg", f"bend{i}.angle"])
                rot = "ref" if b.rotation_deg is None else fmt_num(
                    self._conv().to_display(b.rotation_deg), 2)
                self._set(i, 6, rot, False, [f"bend{i}.rotation_deg", f"bend{i}.rotation"],
                          "First real bend: plane is the reference" if rot == "ref" else "")
            else:
                self._set(i, 5, "", False)
                self._set(i, 6, "", False)
            if a.ok and i < n - 1:
                self._set(i, 7, fmt_num(to_display(a.segments[i].straight, u)), False,
                          [f"seg{i}.straight"])
            else:
                self._set(i, 7, "", False)

    def _springback(self) -> SpringbackTable | None:
        r = self.ev.resolved.get("springback_points")
        if r is None or r.missing:
            return None
        return SpringbackTable(tuple(tuple(p) for p in r.value), enabled=True)

    def _fill_lra(self) -> None:
        ev, u = self.ev, self.unit
        lra = route_to_lra(ev.analysis)
        sb = self._springback()
        self._headers(["Step", f"Y feed ({u})", "B rotate (°)", "C bend (°)", f"CLR ({u})",
                       "C at bender (°)"])
        self.table.setRowCount(len(lra.feeds))
        for i, y in enumerate(lra.feeds):
            last = i == len(lra.steps)
            self._set(i, 0, "Final" if last else f"{i + 1}", False)
            self._set(i, 1, fmt_num(to_display(y, u)), True, [f"seg{i}.straight"],
                      "Straight between tangent points before this bend")
            if last:
                for c in (2, 3, 4, 5):
                    self._set(i, c, "", False)
                continue
            s = lra.steps[i]
            k = i + 1
            self._set(i, 2, fmt_num(self._conv().to_display(s.rotation_deg), 2), True,
                      [f"bend{k}.rotation_deg", f"bend{k}.rotation"],
                      "Bend 1 B is measured from the reference plane (+Z projected)" if i == 0 else "")
            self._set(i, 3, fmt_num(s.angle_deg, 2), True, [f"bend{k}.angle_deg", f"bend{k}.angle"])
            self._set(i, 4, fmt_num(to_display(s.clr, u)), True, [f"bend{k}.tangent"])
            if sb is not None:
                res = sb.apply(s.angle_deg)
                self._set(i, 5, fmt_num(res.bender_deg, 2) + (" *" if res.extrapolated else ""),
                          False, [], "Design angle + springback (shop table)")
            else:
                self._set(i, 5, "—", False, [], "Springback off")

    def _fill_legs(self) -> None:
        ev, u = self.ev, self.unit
        legs = route_to_legs(ev.analysis)
        self._headers(["Leg", f"Length ({u})", "B rotate (°)", "C bend (°)", f"CLR ({u})"])
        self.table.setRowCount(len(legs.legs))
        for i, L in enumerate(legs.legs):
            last = i == len(legs.steps)
            self._set(i, 0, f"{i}", False)
            self._set(i, 1, fmt_num(to_display(L, u)), True, [f"seg{i}.leg"])
            if last:
                for c in (2, 3, 4):
                    self._set(i, c, "", False)
                continue
            s, k = legs.steps[i], i + 1
            self._set(i, 2, fmt_num(self._conv().to_display(s.rotation_deg), 2), True,
                      [f"bend{k}.rotation_deg", f"bend{k}.rotation"])
            self._set(i, 3, fmt_num(s.angle_deg, 2), True, [f"bend{k}.angle_deg", f"bend{k}.angle"])
            self._set(i, 4, fmt_num(to_display(s.clr, u)), True, [f"bend{k}.tangent"])

    # -- interaction ---------------------------------------------------------------
    def _selected(self, row: int, col: int, *_):
        self.explain.emit(self._keys.get((row, col), []))

    def _edited(self, item: QTableWidgetItem) -> None:
        if self._loading or self.ev is None:
            return
        v = parse_number(item.text())
        if v is None:
            self.show_evaluation(self.ev)
            return
        try:
            route, text = self._apply_edit(item.row(), item.column(), v)
        except ValueError:
            route = None
        if route is None:
            self.show_evaluation(self.ev)
            return
        self.routeEdited.emit(route, text)

    def _apply_edit(self, r: int, c: int, v: float) -> tuple[TubeRoute | None, str]:
        ev, u = self.ev, self.unit
        route = ev.project.route
        if self.mode == "XYZ" or not ev.analysis.ok:
            if 1 <= c <= 3:
                p = list(route.points[r])
                p[c - 1] = from_display(v, u)
                return route.with_point(r, tuple(p)), f"Edit P{r} {'XYZ'[c - 1]}"
            if c == 4 and 0 < r < len(route.points) - 1:
                return route.with_radius(r, from_display(v, u)), f"Edit CLR B{r}"
            return None, ""
        a = ev.analysis
        frame = Frame(route.points[0], a.start_direction, a.reference_normal)
        conv = self._conv()
        if self.mode == "LRA":
            lra = route_to_lra(a)
            feeds, steps = list(lra.feeds), list(lra.steps)
            if c == 1:
                feeds[r] = from_display(v, u)
            else:
                steps[r] = _edit_step(steps[r], c, v, u, conv)
            return lra_to_route(LraData(tuple(feeds), tuple(steps), frame)), f"Edit LRA step {r + 1}"
        legs = route_to_legs(a)
        lens, steps = list(legs.legs), list(legs.steps)
        if c == 1:
            lens[r] = from_display(v, u)
        else:
            steps[r] = _edit_step(steps[r], c, v, u, conv)
        return legs_to_route(LegData(tuple(lens), tuple(steps), frame)), f"Edit leg {r}"


def _edit_step(s: BendStep, col: int, v: float, unit: str, conv) -> BendStep:
    if col == 2:
        return replace(s, rotation_deg=conv.from_display(v))
    if col == 3:
        if not 0 <= v < 180:
            raise ValueError("bend angle must be in [0, 180)")
        return replace(s, angle_deg=v)
    if col == 4:
        return replace(s, clr=from_display(v, unit))
    raise ValueError("column not editable")
