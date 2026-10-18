"""Standards / shop data editor.

Every change goes through DataEditor: validated, written atomically, and
logged to CHANGELOG.jsonl with the user's name and a reason. Editing a value
on a VERIFIED row drops it back to UNVERIFIED; "Mark row verified" asks for
the standard, revision, table/figure and date, and is refused while any
required value is empty.
"""
from __future__ import annotations

import datetime
from pathlib import Path
from typing import Any, Optional

from PySide6.QtCore import QSettings, Qt, Signal
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (QAbstractItemView, QDialog, QDialogButtonBox, QFormLayout,
                               QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit,
                               QListWidget, QMessageBox, QPushButton, QSplitter, QTableWidget,
                               QTableWidgetItem, QTabWidget, QTextBrowser, QVBoxLayout, QWidget)

from ...data import DataEditor, DataError, Status, load_dataset, read_changelog
from ...data.schema import Table
from .common import muted

STATUS_BG = {Status.VERIFIED: "#E3F3E5", Status.DERIVED: "#E3F3E5", Status.DEFAULT: "#E6EDF4"}


# -- value text <-> JSON value --------------------------------------------------------

def format_value(kind: str, v: Any) -> str:
    if v is None or v == []:
        return ""
    if kind == "numbers":
        return ", ".join(repr(float(x)) for x in v)
    if kind == "points":
        return "; ".join(f"{a!r}:{b!r}" for a, b in v)
    if kind == "bool":
        return "yes" if v else "no"
    return repr(float(v)) if kind == "number" else str(v)


def parse_value(kind: str, text: str) -> Any:
    """Parse what the user typed. Blank means 'no value'. Raises ValueError."""
    t = text.strip()
    if not t:
        return [] if kind in ("numbers", "points") else None
    if kind == "number":
        return float(t)
    if kind == "numbers":
        return [float(x) for x in t.replace(";", ",").split(",") if x.strip()]
    if kind == "points":
        pts = []
        for pair in t.split(";"):
            if pair.strip():
                a, b = pair.replace(",", ":").split(":")
                pts.append([float(a), float(b)])
        return pts
    if kind == "bool":
        low = t.lower()
        if low in ("yes", "y", "true", "1"):
            return True
        if low in ("no", "n", "false", "0"):
            return False
        raise ValueError("enter yes or no (or leave blank)")
    return t


KIND_HINT = {"number": "a number (inches unless the column says otherwise)",
             "numbers": "numbers separated by commas, e.g. 0.035, 0.049",
             "points": "angle:springback pairs separated by ';', e.g. 0:0; 90:3",
             "bool": "yes or no", "text": "text"}


class VerifyDialog(QDialog):
    def __init__(self, table: Table, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Mark row verified")
        form = QFormLayout(self)
        self.standard = QLineEdit(table.standard or "")
        self.revision = QLineEdit()
        self.table_ref = QLineEdit()
        self.date = QLineEdit(datetime.date.today().isoformat())
        self.reason = QLineEdit()
        for w, tip in ((self.standard, "Standard or source document"),
                       (self.revision, "Revision of that document you read the values from"),
                       (self.table_ref, "Table or figure number"),
                       (self.date, "Date entered, YYYY-MM-DD"),
                       (self.reason, "Why / reference, e.g. checked against licensed copy")):
            w.setToolTip(tip)
        form.addRow(muted("Record exactly where these values came from. All fields are "
                          "required; the row is refused if any required value is empty."))
        form.addRow("Standard", self.standard)
        form.addRow("Revision", self.revision)
        form.addRow("Table / figure", self.table_ref)
        form.addRow("Date entered", self.date)
        form.addRow("Reason", self.reason)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        form.addRow(bb)

    def values(self) -> dict:
        return dict(standard=self.standard.text().strip(), revision=self.revision.text().strip(),
                    table_ref=self.table_ref.text().strip(), date_entered=self.date.text().strip(),
                    reason=self.reason.text().strip() or "verified")


class DataEditorDialog(QDialog):
    dataChanged = Signal()

    def __init__(self, directory: Path, user: Optional[str] = None, parent: QWidget = None):
        super().__init__(parent)
        self.setWindowTitle("Standards and shop data")
        self.resize(1250, 720)
        self.directory = Path(directory)
        self.user = user
        self.ds = load_dataset(self.directory)
        self.current: Optional[Table] = None
        self._loading = False

        self.tables = QListWidget()
        self.tables.setMaximumWidth(260)
        for t in self.ds.tables.values():
            self.tables.addItem(t.name)
        self.title = QLabel()
        self.title.setObjectName("H2")
        self.source = muted("")
        self.grid = QTableWidget()
        self.grid.setAlternatingRowColors(False)
        self.grid.setSelectionMode(QAbstractItemView.SingleSelection)
        self.grid.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.grid.itemChanged.connect(self._edited)
        verify = QPushButton("Mark row verified…")
        verify.setObjectName("Primary")
        verify.setToolTip("Record the standard, revision, table and date for the selected row")
        verify.clicked.connect(self._verify_selected)
        notes = QPushButton("Table notes…")
        notes.setToolTip("Edit table notes such as the flare end-point definition")
        notes.clicked.connect(self._edit_notes)
        self.hint = muted("Click a cell to edit. Blank = no value. Every change asks for a "
                          "reason and is logged.")

        right = QWidget()
        rl = QVBoxLayout(right)
        rl.addWidget(self.title)
        rl.addWidget(self.source)
        rl.addWidget(self.grid, 1)
        bar = QHBoxLayout()
        bar.addWidget(self.hint, 1)
        bar.addWidget(notes)
        bar.addWidget(verify)
        rl.addLayout(bar)
        split = QSplitter()
        split.addWidget(self.tables)
        split.addWidget(right)
        split.setSizes([240, 1000])

        self.log = QTextBrowser()
        tabs = QTabWidget()
        tabs.addTab(split, "Tables")
        tabs.addTab(self.log, "Change log")
        lay = QVBoxLayout(self)
        lay.addWidget(muted(f"Data folder: {self.directory}"))
        lay.addWidget(tabs, 1)
        close = QDialogButtonBox(QDialogButtonBox.Close)
        close.rejected.connect(self.reject)
        lay.addWidget(close)

        self.tables.currentRowChanged.connect(lambda i: self.show_table(
            list(self.ds.tables)[i]))
        self.tables.setCurrentRow(0)
        self._show_log()

    # -- user ------------------------------------------------------------------------
    def ensure_user(self) -> Optional[str]:
        if self.user:
            return self.user
        saved = str(QSettings().value("user_name", ""))
        name, ok = QInputDialog.getText(self, "Your name",
                                        "Name for the change log (who entered or verified data):",
                                        text=saved)
        if not ok or not name.strip():
            return None
        self.user = name.strip()
        QSettings().setValue("user_name", self.user)
        return self.user

    # -- display ---------------------------------------------------------------------
    def show_table(self, name: str) -> None:
        self._loading = True
        t = self.ds.table(name)
        self.current = t
        self.title.setText(t.title)
        src = t.standard or "—"
        if t.supersedes:
            src += f" (supersedes {t.supersedes})"
        self.source.setText(f"Source: {src}. Required fields marked *. "
                            f"Units: " + ", ".join(f"{f.name} {f.unit}" for f in t.fields.values()
                                                   if f.unit != "-"))
        keys = list(t.key_fields) + list(t.optional_key_fields)
        fields = list(t.fields.values())
        headers = keys + [f.name + (" *" if f.required else "") for f in fields] + \
            ["status", "revision", "table", "entered", "by"]
        self.grid.clear()
        self.grid.setColumnCount(len(headers))
        self.grid.setHorizontalHeaderLabels(headers)
        self.grid.setRowCount(len(t.rows))
        for r, row in enumerate(t.rows):
            bg = QColor(STATUS_BG.get(row.provenance.status, "#FDECEA"))
            cells = [("-" + str(row.key[k]) if k == "dash" else
                      "any" if row.key.get(k) is None else str(row.key[k]), False, None)
                     for k in keys]
            cells += [(format_value(f.kind, row.values.get(f.name)), True, f) for f in fields]
            p = row.provenance
            cells += [(p.status.value, False, None), (p.revision or "", False, None),
                      (p.table_ref or "", False, None), (p.date_entered or "", False, None),
                      (p.entered_by or "", False, None)]
            for c, (text, editable, fd) in enumerate(cells):
                it = QTableWidgetItem(text)
                it.setBackground(QBrush(bg))
                it.setForeground(QBrush(QColor("#1B1F24")))
                if not editable:
                    it.setFlags(it.flags() & ~Qt.ItemIsEditable)
                else:
                    it.setToolTip(f"{fd.description}\nEnter {KIND_HINT[fd.kind]}")
                self.grid.setItem(r, c, it)
        self.grid.resizeColumnsToContents()
        self._loading = False

    def _show_log(self) -> None:
        rows = read_changelog(self.directory)[::-1]
        if not rows:
            self.log.setHtml("<p>No changes yet.</p>")
            return
        html = ["<table cellpadding='4'><tr><th>When (UTC)</th><th>Who</th><th>Table</th>"
                "<th>Action</th><th>Row / field</th><th>Reason</th></tr>"]
        for r in rows:
            row = r.get('row')
            where = f"{'row ' + str(row + 1) if row is not None else 'note'} {r.get('field', r.get('key', ''))}"
            html.append(f"<tr><td>{r['time_utc']}</td><td>{r['user']}</td><td>{r['table']}</td>"
                        f"<td>{r['action']}</td><td>{where}</td><td>{r.get('reason', '')}</td></tr>")
        self.log.setHtml("".join(html) + "</table>")

    def _reload(self, select: Optional[str] = None) -> None:
        self.ds = load_dataset(self.directory)
        self.show_table(select or self.current.name)
        self._show_log()
        self.dataChanged.emit()

    # -- edits (also called directly by tests) -------------------------------------------
    def apply_value(self, row: int, field: str, text: str, reason: str) -> None:
        fd = self.current.fields[field]
        value = parse_value(fd.kind, text)
        DataEditor(self.directory, self.user).set_value(self.current.name, row, field, value,
                                                        reason)
        self._reload()

    def verify_row(self, row: int, **info) -> None:
        DataEditor(self.directory, self.user).mark_verified(self.current.name, row, **info)
        self._reload()

    def set_note(self, key: str, text: str, verified: bool, reason: str) -> None:
        DataEditor(self.directory, self.user).set_meta(self.current.name, key, text,
                                                       verified=verified, reason=reason)
        self._reload()

    # -- interactive handlers ------------------------------------------------------------
    def _field_at(self, col: int) -> Optional[str]:
        t = self.current
        i = col - len(t.key_fields) - len(t.optional_key_fields)
        names = list(t.fields)
        return names[i] if 0 <= i < len(names) else None

    def _edited(self, item: QTableWidgetItem) -> None:
        if self._loading:
            return
        field = self._field_at(item.column())
        if field is None:
            return
        if self.ensure_user() is None:
            self.show_table(self.current.name)
            return
        reason, ok = QInputDialog.getText(self, "Reason for change",
                                          f"{self.current.name} row {item.row()} {field}: "
                                          f"why are you changing this?")
        if not ok or not reason.strip():
            self.show_table(self.current.name)
            return
        try:
            self.apply_value(item.row(), field, item.text(), reason.strip())
        except (ValueError, DataError) as e:
            QMessageBox.warning(self, "Not saved", str(e))
            self.show_table(self.current.name)

    def _verify_selected(self) -> None:
        row = self.grid.currentRow()
        if row < 0:
            QMessageBox.information(self, "Select a row", "Select the row to verify first.")
            return
        if self.ensure_user() is None:
            return
        dlg = VerifyDialog(self.current, self)
        if dlg.exec() != QDialog.Accepted:
            return
        try:
            self.verify_row(row, **dlg.values())
        except (DataError, ValueError) as e:
            QMessageBox.warning(self, "Not verified", str(e))

    def _edit_notes(self) -> None:
        t = self.current
        if not t.meta:
            QMessageBox.information(self, "No notes", "This table has no notes.")
            return
        if self.ensure_user() is None:
            return
        key = next(iter(t.meta)) if len(t.meta) == 1 else QInputDialog.getItem(
            self, "Table note", "Note:", list(t.meta), 0, False)[0]
        m = t.meta[key]
        text, ok = QInputDialog.getMultiLineText(self, key, m.get("description", ""),
                                                 m.get("text") or "")
        if not ok:
            return
        verified = QMessageBox.question(
            self, "Verify note", "Mark this note VERIFIED (checked against the standard)?",
            QMessageBox.Yes | QMessageBox.No) == QMessageBox.Yes
        reason, ok = QInputDialog.getText(self, "Reason", "Reason for change:")
        if not ok or not reason.strip():
            return
        try:
            self.set_note(key, text, verified, reason.strip())
        except (DataError, ValueError) as e:
            QMessageBox.warning(self, "Not saved", str(e))
