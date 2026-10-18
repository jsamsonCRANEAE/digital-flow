"""Tools > Approved deviations: replace a data value for this project only.

A deviation needs a value, the approval reference / reason and who approved
it. It is marked USER INPUT, listed in Warnings, and printed in the drawing
notes. Use only with your organization's approved deviation process.
"""
from __future__ import annotations

import datetime
from dataclasses import replace

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QHeaderView, QMessageBox,
                               QTableWidget, QTableWidgetItem, QVBoxLayout)

from ...project import OVERRIDABLE, Evaluation, Override, Project
from .common import muted, parse_number

EDITABLE = [k for k in OVERRIDABLE if k != "springback_points"]   # numbers only
COLS = ["Value", "Data value (status)", "Deviation value", "Approval ref / reason",
        "Approved by", "Date"]


class DeviationsDialog(QDialog):
    def __init__(self, ev: Evaluation, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Approved deviations")
        self.ev = ev
        self.result_project: Project | None = None
        lay = QVBoxLayout(self)
        lay.addWidget(muted(
            "Replace a data-file value for this project only, e.g. an approved deviation to "
            "the minimum bend radius. Every deviation needs a value, an approval reference "
            "and who approved it. It is shown as USER INPUT, listed in Warnings and printed "
            "in the drawing notes. Clear the value to remove it. Lengths are in inches."))
        self.table = QTableWidget(len(EDITABLE), len(COLS))
        self.table.setHorizontalHeaderLabels(COLS)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        overrides = ev.project.overrides
        for r, name in enumerate(EDITABLE):
            label, unit = OVERRIDABLE[name]
            res = ev.resolved.get(name)
            data = "not used" if res is None else (
                "missing" if res.missing else f"{res.value} {unit if unit != '-' else ''}")
            if res is not None:
                data += f" ({res.status.value})"
            ov = overrides.get(name)
            cells = [f"{label} ({unit})", data,
                     "" if ov is None else repr(ov.value), "" if ov is None else ov.reason,
                     "" if ov is None else ov.entered_by, "" if ov is None else ov.date]
            for c, text in enumerate(cells):
                it = QTableWidgetItem(text)
                if c < 2:
                    it.setFlags(it.flags() & ~Qt.ItemIsEditable)
                self.table.setItem(r, c, it)
        lay.addWidget(self.table)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._ok)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)
        self.resize(1000, 420)

    def collect(self) -> Project:
        """Validate the grid and return the project with its new overrides."""
        new = {k: v for k, v in self.ev.project.overrides.items() if k not in EDITABLE}
        for r, name in enumerate(EDITABLE):
            text = self.table.item(r, 2).text().strip()
            if not text:
                continue
            value = parse_number(text)
            label = OVERRIDABLE[name][0]
            if value is None:
                raise ValueError(f"{label}: '{text}' is not a number")
            reason = self.table.item(r, 3).text().strip()
            by = self.table.item(r, 4).text().strip()
            if not reason or not by:
                raise ValueError(f"{label}: a deviation needs an approval reference and who "
                                 f"approved it")
            date = self.table.item(r, 5).text().strip() or datetime.date.today().isoformat()
            new[name] = Override(value, reason, by, date)
        return replace(self.ev.project, overrides=new)

    def _ok(self) -> None:
        try:
            self.result_project = self.collect()
        except ValueError as e:
            QMessageBox.warning(self, "Not saved", str(e))
            return
        self.accept()
