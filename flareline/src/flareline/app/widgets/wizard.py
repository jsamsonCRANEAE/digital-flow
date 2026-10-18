"""Left panel: guided steps 1 Tube spec -> 2 Ends -> 3 Route -> 4 Check -> 5 Drawing."""
from __future__ import annotations

import math
from dataclasses import replace

from PySide6.QtCore import QEvent, Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QFormLayout, QGridLayout, QHBoxLayout,
                               QLabel, QLineEdit, QListWidget, QPlainTextEdit, QPushButton,
                               QScrollArea, QStackedWidget, QVBoxLayout, QWidget)

from ...geometry.issues import Severity
from ...geometry.route import TubeRoute
from ...project import Evaluation, Project
from ...project.model import END_TYPE_LABELS, END_TYPES
from ..state import DocumentState
from .common import Chip, NumberField, card, fmt_num, muted, to_display

STEPS = ["1  Tube spec", "2  Ends", "3  Route & bends", "4  Check", "5  Drawing"]


class _Page(QScrollArea):
    def __init__(self, state: DocumentState, title: str, intro: str):
        super().__init__()
        self.state = state
        self.setWidgetResizable(True)
        inner = QWidget()
        self.lay = QVBoxLayout(inner)
        self.lay.setContentsMargins(4, 4, 8, 4)
        self.lay.setSpacing(12)
        h = QLabel(title)
        h.setObjectName("H1")
        self.lay.addWidget(h)
        self.lay.addWidget(muted(intro))
        self.setWidget(inner)

    def finish(self) -> None:
        self.lay.addStretch(1)

    @property
    def p(self) -> Project:
        return self.state.project

    def change(self, new: Project, text: str) -> None:
        self.state.change(new, text)

    def unit(self) -> str:
        return self.p.settings.display_unit

    def refresh(self, ev: Evaluation) -> None:  # pragma: no cover - overridden
        pass


def _status_row(form: QFormLayout, label: str, tip: str) -> tuple[QLabel, Chip]:
    value, chip = QLabel("—"), Chip()
    value.setToolTip(tip)
    row = QHBoxLayout()
    row.addWidget(value, 1)
    row.addWidget(chip)
    form.addRow(label, row)
    return value, chip


def _show_resolved(ev: Evaluation, name: str, value: QLabel, chip: Chip, unit: str) -> None:
    r = ev.resolved.get(name)
    if r is None:
        value.setText("not used")
        chip.setText("")
        chip.setStyleSheet("")
        return
    if r.missing:
        value.setText("no value")
    elif isinstance(r.value, (int, float)) and not isinstance(r.value, bool):
        value.setText(f"{fmt_num(to_display(r.value, unit) if r.unit == 'in' else r.value)} "
                      f"{unit if r.unit == 'in' else r.unit}")
    else:
        value.setText(str(r.value))
    chip.set_status(r.status, r.missing, r.describe())


class TubePage(_Page):
    def __init__(self, state):
        super().__init__(state, "Tube spec", "Choose the tube size, material and wall. "
                         "Sizes and materials come from the data files.")
        f, lay = card("Tube")
        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignRight)
        self.dash = QComboBox()
        self.dash.setToolTip("Dash size: tube OD in 1/16 in (-4 = 1/4 in)")
        for row in state.dataset.table("tube_sizes").rows:
            d = row.key["dash"]
            self.dash.addItem(f"-{d}   ({row.values['od']:.4f} in OD)", d)
        self.material = QComboBox()
        self.material.setToolTip("Tube material (materials data file)")
        for row in state.dataset.table("materials").rows:
            self.material.addItem(row.values.get("name") or row.key["material_id"],
                                  row.key["material_id"])
        self.wall = QComboBox()
        self.wall.setEditable(True)
        self.wall.setToolTip("Wall thickness. Pick a value from the wall table, or type one "
                             "(recorded as user input)")
        self.unit_box = QComboBox()
        self.unit_box.addItems(["in", "mm"])
        self.unit_box.setToolTip("Display unit. The model is always stored in inches, unrounded")
        form.addRow("Size", self.dash)
        form.addRow("Material", self.material)
        form.addRow("Wall", self.wall)
        form.addRow("Display unit", self.unit_box)
        lay.addLayout(form)
        self.lay.addWidget(f)

        f2, lay2 = card("From the data files")
        form2 = QFormLayout()
        self.od_v, self.od_c = _status_row(form2, "OD", "Tube OD from the size table")
        self.wall_v, self.wall_c = _status_row(form2, "Wall", "Wall and where it came from")
        self.clr_v, self.clr_c = _status_row(form2, "Min CLR", "Minimum bend radius, AS33611 table")
        self.spec_v, self.spec_c = _status_row(form2, "Material spec", "Material specification")
        lay2.addLayout(form2)
        self.lay.addWidget(f2)
        self.finish()

        self.dash.activated.connect(lambda _: self._tube(dash=self.dash.currentData()))
        self.material.activated.connect(
            lambda _: self._tube(material_id=self.material.currentData()))
        self.wall.lineEdit().editingFinished.connect(self._wall)
        self.wall.activated.connect(lambda _: self._wall())
        self.unit_box.activated.connect(lambda _: self.change(
            replace(self.p, settings=replace(self.p.settings,
                                             display_unit=self.unit_box.currentText())),
            "Change display unit"))

    def _tube(self, **kw) -> None:
        self.change(replace(self.p, tube=replace(self.p.tube, **kw)), "Change tube spec")

    def _walls(self) -> list[float]:
        row = self.state.dataset.table("tube_walls").lookup(dash=self.p.tube.dash,
                                                             material_id=self.p.tube.material_id)
        return list(row.values.get("walls") or []) if row else []

    def _wall(self) -> None:
        text = self.wall.currentText().strip().split(" ")[0]
        try:
            v = float(text)
        except ValueError:
            return
        if not math.isfinite(v) or v <= 0:
            return
        if self.p.settings.display_unit == "mm":
            v = v / 25.4
        from_data = any(abs(w - v) < 1e-9 for w in self._walls())
        if self.p.tube.wall is not None and abs(self.p.tube.wall - v) < 5e-5 and \
                from_data == self.p.tube.wall_from_data:
            return  # display rounding only; keep the stored value
        self._tube(wall=v, wall_from_data=from_data)

    def refresh(self, ev: Evaluation) -> None:
        t, u = self.p.tube, self.unit()
        for box, val in ((self.dash, t.dash), (self.material, t.material_id)):
            box.blockSignals(True)
            box.setCurrentIndex(max(box.findData(val), 0))
            box.blockSignals(False)
        self.wall.blockSignals(True)
        self.wall.clear()
        for w in self._walls():
            self.wall.addItem(fmt_num(to_display(w, u)))
        self.wall.setEditText("" if t.wall is None else fmt_num(to_display(t.wall, u)))
        self.wall.blockSignals(False)
        self.unit_box.blockSignals(True)
        self.unit_box.setCurrentText(u)
        self.unit_box.blockSignals(False)
        _show_resolved(ev, "od", self.od_v, self.od_c, u)
        _show_resolved(ev, "wall", self.wall_v, self.wall_c, u)
        _show_resolved(ev, "min_clr", self.clr_v, self.clr_c, u)
        _show_resolved(ev, "material_spec", self.spec_v, self.spec_c, u)


class EndsPage(_Page):
    def __init__(self, state):
        super().__init__(state, "Ends", "Each end point sits at the flare. The allowance "
                         "(stock from the end point to the cut end) is added to the cut length.")
        self.boxes, self.rows = {}, {}
        for n in (1, 2):
            f, lay = card(f"End {n}")
            form = QFormLayout()
            box = QComboBox()
            for e in END_TYPES:
                box.addItem(END_TYPE_LABELS[e], e)
            box.setToolTip("End type. Nut and sleeve are shown as reference geometry only")
            box.activated.connect(lambda _, n=n, box=box: self.change(
                replace(self.p, **{f"end{n}": box.currentData()}), f"Change end {n} type"))
            form.addRow("Type", box)
            a = _status_row(form, "Allowance", "Added to cut length (AS4330 data file)")
            s = _status_row(form, "Min straight", "Shortest straight for flare tool, nut and "
                                                  "sleeve (shop data)")
            lay.addLayout(form)
            self.lay.addWidget(f)
            self.boxes[n], self.rows[n] = box, (a, s)
        f, lay = card("Flare reference")
        form = QFormLayout()
        self.epd = _status_row(form, "End point", "Where the end point sits on the flare "
                                                  "(AS4330 data file note)")
        lay.addLayout(form)
        self.lay.addWidget(f)
        self.finish()

    def refresh(self, ev: Evaluation) -> None:
        u = self.unit()
        for n in (1, 2):
            box = self.boxes[n]
            box.blockSignals(True)
            box.setCurrentIndex(box.findData(getattr(self.p, f"end{n}")))
            box.blockSignals(False)
            (av, ac), (sv, sc) = self.rows[n]
            _show_resolved(ev, f"end{n}.allowance", av, ac, u)
            _show_resolved(ev, f"end{n}.min_straight", sv, sc, u)
        _show_resolved(ev, "end_point_definition", *self.epd, u)


class RoutePage(_Page):
    def __init__(self, state):
        super().__init__(state, "Route & bends", "Edit points and radii in the bend table "
                         "below (XYZ, LRA or Legs). Z is up; P0 is end 1.")
        f, lay = card("Build")
        form = QFormLayout()
        self.clr = NumberField("Bend radius (CLR) used for new bends and 'apply to all'")
        self.clr.set_value(0.75)
        form.addRow("CLR for new bends", self.clr)
        lay.addLayout(form)
        grid = QGridLayout()
        add = QPushButton("Add leg")
        add.setToolTip("Append a 6 in leg turned 90° from the last leg (Ctrl+L)")
        rem = QPushButton("Remove last leg")
        rem.setToolTip("Delete the last point")
        allr = QPushButton("Apply CLR to all")
        allr.setToolTip("Set every bend to the CLR above")
        rev = QPushButton("Reverse ends")
        rev.setToolTip("Describe the same tube from the other end (swaps end 1 and end 2)")
        for i, b in enumerate((add, rem, allr, rev)):
            grid.addWidget(b, i // 2, i % 2)
        lay.addLayout(grid)
        self.lay.addWidget(f)
        add.clicked.connect(self.add_leg)
        rem.clicked.connect(self._remove)
        allr.clicked.connect(self._apply_all)
        rev.clicked.connect(self._reverse)

        f, lay = card("Conventions")
        form = QFormLayout()
        self.rdir = QComboBox()
        self.rdir.addItems(["CW", "CCW"])
        self.rdir.setToolTip("Which rotation direction is shown as positive")
        self.rview = QComboBox()
        self.rview.addItem("looking toward end 2", "toward_end2")
        self.rview.addItem("looking toward end 1", "toward_end1")
        self.rview.setToolTip("Viewpoint for judging CW / CCW")
        form.addRow("Rotation + =", self.rdir)
        form.addRow("viewed", self.rview)
        self.sb = QCheckBox("Apply springback (shop table)")
        self.sb.setToolTip("Show the bender angle = design angle + springback in the LRA table")
        form.addRow("", self.sb)
        self.clear = NumberField("Extra clearance required between parts of the tube "
                                 "(0 = touching is the limit)")
        form.addRow("Interference clearance", self.clear)
        lay.addLayout(form)
        self.lay.addWidget(f)
        self.finish()

        self.rdir.activated.connect(lambda _: self._settings(
            rotation_direction=self.rdir.currentText()))
        self.rview.activated.connect(lambda _: self._settings(
            rotation_viewpoint=self.rview.currentData()))
        self.sb.toggled.connect(lambda on: self._settings(springback_enabled=on))
        self.clear.committed.connect(lambda v: self._settings(interference_clearance=max(v, 0.0)))

    def _settings(self, **kw) -> None:
        self.change(replace(self.p, settings=replace(self.p.settings, **kw)), "Change settings")

    def _clr(self) -> float:
        return self.clr._value or 0.75

    def add_leg(self) -> None:
        r = self.p.route
        pts = [list(p) for p in r.points]
        a, b = (pts[-2], pts[-1])
        d = [b[i] - a[i] for i in range(3)]
        n = math.sqrt(sum(c * c for c in d)) or 1.0
        d = [c / n for c in d]
        turn = [-d[1], d[0], 0.0] if abs(d[2]) < 0.99 else [1.0, 0.0, 0.0]
        tn = math.sqrt(sum(c * c for c in turn))
        new = tuple(b[i] + 6.0 * turn[i] / tn for i in range(3))
        route = TubeRoute(tuple(map(tuple, pts)) + (new,), r.radii + (self._clr(),))
        self.change(self.p.with_route(route), "Add leg")

    def _remove(self) -> None:
        r = self.p.route
        if len(r.points) <= 2:
            return
        self.change(self.p.with_route(TubeRoute(r.points[:-1], r.radii[:-1])), "Remove leg")

    def _apply_all(self) -> None:
        r = self.p.route
        self.change(self.p.with_route(TubeRoute(r.points, (self._clr(),) * len(r.radii))),
                    "Apply CLR to all bends")

    def _reverse(self) -> None:
        r = self.p.route
        self.change(replace(self.p, route=TubeRoute(tuple(reversed(r.points)),
                                                    tuple(reversed(r.radii))),
                            end1=self.p.end2, end2=self.p.end1), "Reverse ends")

    def refresh(self, ev: Evaluation) -> None:
        s = self.p.settings
        self.clr.set_value(self._clr(), s.display_unit)
        self.clear.set_value(s.interference_clearance, s.display_unit)
        for w, setter in ((self.rdir, lambda: self.rdir.setCurrentText(s.rotation_direction)),
                          (self.rview, lambda: self.rview.setCurrentIndex(
                              self.rview.findData(s.rotation_viewpoint))),
                          (self.sb, lambda: self.sb.setChecked(s.springback_enabled))):
            w.blockSignals(True)
            setter()
            w.blockSignals(False)


class CheckPage(_Page):
    def __init__(self, state):
        super().__init__(state, "Check", "Results and everything that needs attention. "
                         "Click a warning in the bottom panel to see its calculation.")
        f, lay = card("Results")
        self.grid = QFormLayout()
        self.vals = {}
        for k, tip in (("Bends", "Number of non-zero bends"),
                       ("Centerline length", "Σ straights + Σ R·θ"),
                       ("Developed length", "Centerline with shop arc factor / per-bend adjust"),
                       ("Cut length", "Developed + end allowances"),
                       ("Errors", ""), ("Warnings", ""), ("Self-interference", ""),
                       ("Release drawing", "Allowed only with no errors and no unverified "
                                           "or missing data")):
            v = QLabel("—")
            v.setToolTip(tip)
            v.setWordWrap(True)
            self.grid.addRow(k, v)
            self.vals[k] = v
        lay.addLayout(self.grid)
        self.lay.addWidget(f)
        self.finish()

    def refresh(self, ev: Evaluation) -> None:
        a, u = ev.analysis, self.unit()
        v = self.vals
        if a.ok:
            v["Bends"].setText(str(sum(not b.is_zero for b in a.bends)))
            v["Centerline length"].setText(f"{fmt_num(to_display(a.centerline_length, u))} {u}")
            v["Developed length"].setText(f"{fmt_num(to_display(a.developed_length, u))} {u}")
            cut = f"{fmt_num(to_display(a.cut_length, u))} {u}"
            v["Cut length"].setText(cut if ev.cut_length_complete
                                    else f"{cut}  (INCOMPLETE: allowance missing)")
        else:
            for k in ("Bends", "Centerline length", "Developed length", "Cut length"):
                v[k].setText("geometry error")
        errs = [i for i in ev.issues if i.severity == Severity.ERROR]
        warns = [i for i in ev.issues if i.severity == Severity.WARNING]
        v["Errors"].setText(str(len(errs)))
        v["Warnings"].setText(str(len(warns)))
        if not ev.interference_checked:
            v["Self-interference"].setText("checking…")
        else:
            hits = [i for i in ev.issues if i.code == "SELF_INTERFERENCE"]
            skipped = [i for i in ev.issues if i.code == "INTERFERENCE_NOT_CHECKED"]
            v["Self-interference"].setText(f"{len(hits)} contact(s)" if hits else
                                           "not checked" if skipped else "clear")
        reasons = []
        if errs:
            reasons.append("errors")
        if ev.flagged:
            reasons.append(f"{len(ev.flagged)} unverified/missing data value(s)")
        if ev.project.route_origin == "image" and not ev.project.image_confirmed:
            reasons.append("image dimensions not confirmed")
        v["Release drawing"].setText("allowed" if ev.releasable else
                                     "blocked: " + ", ".join(reasons or ["checking"]))


class DrawingPage(_Page):
    FIELDS = (("part_number", "Part number"), ("title", "Title"), ("revision", "Revision"),
              ("drawn_by", "Drawn by"), ("checked_by", "Checked by"),
              ("general_tolerances", "General tolerances"), ("cleanliness", "Cleanliness note"),
              ("proof_test", "Proof-test note"))

    def __init__(self, state):
        super().__init__(state, "Drawing", "Title block, notes and revisions, then export "
                         "PDF / DXF / PNG / CSV (Ctrl+E).")
        f, lay = card("Export")
        self.status = QLabel()
        self.status.setWordWrap(True)
        lay.addWidget(self.status)
        row = QHBoxLayout()
        self.export_btn = QPushButton("Export drawing…")
        self.export_btn.setObjectName("Primary")
        self.export_btn.setToolTip("PDF, DXF, PNG and CSV on ANSI A, B or D (Ctrl+E)")
        self.dev_btn = QPushButton("Approved deviations…")
        self.dev_btn.setToolTip("Replace a data value for this project with an approved "
                                "deviation (printed on the drawing)")
        row.addWidget(self.export_btn)
        row.addWidget(self.dev_btn)
        lay.addLayout(row)
        self.lay.addWidget(f)
        f, lay = card("Title block & notes")
        form = QFormLayout()
        self.edits = {}
        for key, label in self.FIELDS:
            e = QLineEdit()
            e.setToolTip(f"{label} (printed on the drawing)")
            e.editingFinished.connect(lambda key=key, e=e: self._meta(key, e.text()))
            form.addRow(label, e)
            self.edits[key] = e
        lay.addLayout(form)
        self.lay.addWidget(f)
        f, lay = card("Revisions")
        lay.addWidget(muted("One per line: REV | DESCRIPTION | DATE | BY (last 4 shown)"))
        self.revisions = QPlainTextEdit()
        self.revisions.setToolTip("Revision history, e.g. A | Initial release | 2026-10-18 | JS")
        self.revisions.setFixedHeight(90)
        self.revisions.installEventFilter(self)
        lay.addWidget(self.revisions)
        self.lay.addWidget(f)
        self.lay.addWidget(muted("Design aid only. All geometry must be verified and approved "
                                 "per your organization's engineering and quality process "
                                 "before fabrication."))
        self.finish()

    def _meta(self, key: str, text: str) -> None:
        if self.p.meta.get(key, "") == text:
            return
        meta = dict(self.p.meta)
        meta[key] = text
        self.change(replace(self.p, meta=meta), f"Edit {key}")

    def eventFilter(self, obj, event):  # noqa: N802 - commit revisions on focus-out
        if obj is getattr(self, "revisions", None) and event.type() == QEvent.FocusOut:
            text = "\n".join("|".join(c.strip() for c in ln.split("|"))
                             for ln in self.revisions.toPlainText().splitlines() if ln.strip())
            self._meta("revisions", text)
        return super().eventFilter(obj, event)

    def refresh(self, ev: Evaluation) -> None:
        for key, e in self.edits.items():
            if not e.hasFocus():
                e.setText(self.p.meta.get(key, ""))
        if not self.revisions.hasFocus():
            self.revisions.setPlainText("\n".join(
                " | ".join(ln.split("|")) for ln in self.p.meta.get("revisions", "").splitlines()))
        if ev.releasable:
            self.status.setText("<b style='color:#1E7D32'>Releasable</b>: no errors and all "
                                "data verified.")
        elif not ev.interference_checked:
            self.status.setText("Checking…")
        else:
            from ...drawing.layout import release_reasons
            self.status.setText("<b style='color:#C62828'>Will be watermarked NOT FOR "
                                "FABRICATION</b>: " + "; ".join(release_reasons(ev)))


class Wizard(QWidget):
    stepChanged = Signal(int)

    def __init__(self, state: DocumentState, parent: QWidget = None):
        super().__init__(parent)
        self.steps = QListWidget()
        self.steps.setObjectName("Steps")
        self.steps.addItems(STEPS)
        self.steps.setFixedHeight(5 * 40)
        self.stack = QStackedWidget()
        self.pages = [TubePage(state), EndsPage(state), RoutePage(state), CheckPage(state),
                      DrawingPage(state)]
        for p in self.pages:
            self.stack.addWidget(p)
        self.steps.currentRowChanged.connect(self.stack.setCurrentIndex)
        self.steps.currentRowChanged.connect(self.stepChanged)
        nav = QHBoxLayout()
        self.back = QPushButton("Back")
        self.next = QPushButton("Next")
        self.next.setObjectName("Primary")
        self.back.clicked.connect(lambda: self.go(self.steps.currentRow() - 1))
        self.next.clicked.connect(lambda: self.go(self.steps.currentRow() + 1))
        nav.addWidget(self.back)
        nav.addStretch(1)
        nav.addWidget(self.next)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 10, 6, 10)
        lay.addWidget(self.steps)
        lay.addWidget(self.stack, 1)
        lay.addLayout(nav)
        self.steps.setCurrentRow(0)

    def go(self, i: int) -> None:
        if 0 <= i < len(self.pages):
            self.steps.setCurrentRow(i)

    def refresh(self, ev: Evaluation) -> None:
        for p in self.pages:
            p.refresh(ev)
        i = self.steps.currentRow()
        self.back.setEnabled(i > 0)
        self.next.setEnabled(i < len(self.pages) - 1)
