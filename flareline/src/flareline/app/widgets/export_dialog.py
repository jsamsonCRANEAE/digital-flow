"""File > Export drawing: choose sheet size, formats and where to save."""
from __future__ import annotations

import re
from pathlib import Path

from PySide6.QtCore import QSettings
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog,
                               QFormLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
                               QPushButton, QVBoxLayout)

from ...drawing import FORMATS, export, release_reasons
from ...project import AuditLog, Evaluation
from .common import muted

FORMAT_LABELS = {"pdf": "PDF drawing (sheet 1 + calculation record)",
                 "dxf": "DXF (3D centerline in model space, sheet in paper space)",
                 "png": "PNG of sheet 1 (for a quick message)",
                 "csv": "CSV bend table (full precision)"}


def default_name(ev: Evaluation, path: Path | None) -> str:
    pn = ev.project.meta.get("part_number", "").strip()
    rev = ev.project.meta.get("revision", "").strip()
    name = pn or (path.name.removesuffix(".flareline.json") if path else "flareline_drawing")
    if rev and rev != "-":
        name += f"_rev{rev}"
    return re.sub(r"[^\w.-]+", "_", name)


class ExportDialog(QDialog):
    def __init__(self, ev: Evaluation, dataset, project_path: Path | None, audit_path: Path,
                 parent=None):
        super().__init__(parent)
        self.setWindowTitle("Export drawing")
        self.ev, self.ds, self.audit_path = ev, dataset, audit_path
        self.written: list[Path] = []
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.size = QComboBox()
        for s, label in (("A", "ANSI A  (11 × 8.5 in)"), ("B", "ANSI B  (17 × 11 in)"),
                         ("D", "ANSI D  (34 × 22 in)")):
            self.size.addItem(label, s)
        self.size.setCurrentIndex(1)
        self.size.setToolTip("Sheet size, landscape. B is the most legible for most tubes")
        form.addRow("Sheet", self.size)
        self.checks = {}
        for f in FORMATS:
            cb = QCheckBox(FORMAT_LABELS[f])
            cb.setChecked(True)
            self.checks[f] = cb
            form.addRow("" if f != "pdf" else "Formats", cb)
        folder = QSettings().value("export_dir", str(project_path.parent if project_path
                                                     else Path.home()))
        self.folder = QLineEdit(str(folder))
        self.folder.setToolTip("Folder the files are written to")
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        row = QHBoxLayout()
        row.addWidget(self.folder, 1)
        row.addWidget(browse)
        form.addRow("Folder", row)
        self.name = QLineEdit(default_name(ev, project_path))
        self.name.setToolTip("File name without extension")
        form.addRow("File name", self.name)
        lay.addLayout(form)

        reasons = release_reasons(ev)
        if reasons:
            status = QLabel("<b style='color:#C62828'>Will be watermarked NOT FOR FABRICATION:"
                            "</b><br>" + "<br>".join("• " + r for r in reasons))
        else:
            status = QLabel("<b style='color:#1E7D32'>Releasable:</b> no errors, all data "
                            "verified. Approvals on the title block are left blank for "
                            "signature.")
        status.setWordWrap(True)
        lay.addWidget(status)
        lay.addWidget(muted("Design aid only. All geometry must be verified and approved per "
                            "your organization's engineering and quality process before "
                            "fabrication."))
        bb = QDialogButtonBox(QDialogButtonBox.Cancel)
        go = bb.addButton("Export", QDialogButtonBox.AcceptRole)
        go.setObjectName("Primary")
        bb.accepted.connect(self._export)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)
        self.resize(620, 0)

    def _browse(self) -> None:
        d = QFileDialog.getExistingDirectory(self, "Export folder", self.folder.text())
        if d:
            self.folder.setText(d)

    def run_export(self) -> list[Path]:
        formats = [f for f, cb in self.checks.items() if cb.isChecked()]
        if not formats:
            raise ValueError("choose at least one format")
        folder = Path(self.folder.text())
        folder.mkdir(parents=True, exist_ok=True)
        name = self.name.text().strip() or "flareline_drawing"
        audit = AuditLog(self.audit_path) if self.ev.project.settings.audit_log else None
        res = export(self.ev, self.ds, folder / name, formats, self.size.currentData(),
                     audit=audit)
        QSettings().setValue("export_dir", str(folder))
        self.written = list(res.files)
        return self.written

    def _export(self) -> None:
        existing = [p for p in self._targets() if p.exists()]
        if existing and QMessageBox.question(
                self, "Replace files?", "These files exist and will be replaced:\n"
                + "\n".join(p.name for p in existing)) != QMessageBox.Yes:
            return
        try:
            files = self.run_export()
        except (OSError, ValueError) as e:
            QMessageBox.critical(self, "Export failed", str(e))
            return
        QMessageBox.information(self, "Exported", "Written:\n" + "\n".join(str(f) for f in files))
        self.accept()

    def _targets(self) -> list[Path]:
        base = Path(self.folder.text()) / (self.name.text().strip() or "flareline_drawing")
        out = []
        for f, cb in self.checks.items():
            if cb.isChecked():
                out.append(base.parent / (base.name + "_bend_table.csv") if f == "csv"
                           else base.with_suffix("." + f))
        return out
