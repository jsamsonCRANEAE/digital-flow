"""Main window: wizard | 3D | 2D across the top, bend table and warnings below."""
from __future__ import annotations

import time
from dataclasses import replace
from importlib import resources
from pathlib import Path

from PySide6.QtCore import QSettings, Qt
from PySide6.QtGui import QAction, QKeySequence, QShortcut
from PySide6.QtWidgets import (QDockWidget, QFileDialog, QLabel, QMainWindow, QMessageBox,
                               QSplitter, QTabWidget, QVBoxLayout, QWidget)

from .. import __version__
from ..project import Project, ProjectError
from ..project.model import load as load_project
from . import theme
from .state import DocumentState
from .widgets.bend_table import BendTable
from .widgets.common import fmt_num, to_display
from .widgets.howto import HowTo
from .widgets.issues import Banner, ExplainPanel, IssuesList
from .widgets.view2d import View2D
from .widgets.view3d import View3D
from .widgets.wizard import Wizard

DISCLAIMER = ("Design aid only. All geometry must be verified and approved per your "
              "organization's engineering and quality process before fabrication.")
FILE_FILTER = "FlareLine project (*.flareline.json);;JSON (*.json)"


def sample_files() -> list[Path]:
    d = Path(str(resources.files("flareline.samples")))
    return sorted(d.glob("*.flareline.json"))


class MainWindow(QMainWindow):
    def __init__(self, state: DocumentState, tokens, theme_mode: str = "system"):
        super().__init__()
        self.state, self.tokens, self.theme_mode = state, tokens, theme_mode
        self.last_update_ms = 0.0
        self.setWindowTitle("FlareLine")
        self.resize(1600, 980)

        self.banner = Banner()
        self.wizard = Wizard(state)
        self.view3d = View3D(tokens)
        self.view2d = View2D(tokens)
        self.table = BendTable()
        self.issues = IssuesList()
        self.explain = ExplainPanel()

        top = QSplitter(Qt.Horizontal)
        top.addWidget(self.wizard)
        top.addWidget(_padded(self.view3d))
        top.addWidget(_padded(self.view2d))
        top.setSizes([380, 640, 560])
        self.tabs = QTabWidget()
        self.tabs.addTab(self.issues, "Warnings")
        self.tabs.addTab(self.explain, "Explain")
        bottom = QSplitter(Qt.Horizontal)
        bottom.addWidget(_padded(self.table))
        bottom.addWidget(_padded(self.tabs))
        bottom.setSizes([900, 700])
        main = QSplitter(Qt.Vertical)
        main.addWidget(top)
        main.addWidget(bottom)
        main.setSizes([620, 340])
        central = QWidget()
        lay = QVBoxLayout(central)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(self.banner)
        lay.addWidget(main, 1)
        self.setCentralWidget(central)

        self.howto = QDockWidget("How to", self)
        self.howto.setWidget(HowTo())
        self.howto.setObjectName("HowTo")
        self.addDockWidget(Qt.RightDockWidgetArea, self.howto)
        self.howto.hide()

        self.status_len = QLabel()
        self.status_data = QLabel()
        self.statusBar().addWidget(self.status_len, 1)
        self.statusBar().addPermanentWidget(self.status_data)

        self._menus()
        self._shortcuts()

        state.evaluated.connect(self.on_evaluated)
        state.pathChanged.connect(self._title)
        self.table.routeEdited.connect(lambda r, t: state.change(state.project.with_route(r), t))
        for src in (self.table.explain, self.issues.explain, self.view2d.explain):
            src.connect(self._explain)
        self.wizard.stepChanged.connect(lambda _: state.evaluation and
                                        self.wizard.refresh(state.evaluation))
        self.wizard.pages[4].export_btn.clicked.connect(self.export_drawing)
        self.wizard.pages[4].dev_btn.clicked.connect(self.edit_deviations)
        self._title()

    # -- updates ---------------------------------------------------------------------
    def on_evaluated(self, ev) -> None:
        t0 = time.perf_counter()
        self.banner.show_evaluation(ev)
        self.wizard.refresh(ev)
        self.table.show_evaluation(ev)
        self.issues.show_evaluation(ev)
        self.explain.set_evaluation(ev)
        self.view2d.show_evaluation(ev)
        self.view3d.show_evaluation(ev)
        a, u = ev.analysis, ev.project.settings.display_unit
        if a.ok:
            cut = f"{fmt_num(to_display(a.cut_length, u))} {u}"
            if not ev.cut_length_complete:
                cut += " (incomplete)"
            self.status_len.setText(f"Developed {fmt_num(to_display(a.developed_length, u))} {u}"
                                    f"   ·   Cut {cut}")
        else:
            self.status_len.setText("Geometry error: see Warnings")
        self.status_data.setText(f"Data {ev.dataset_version} · {ev.dataset_sha256[:12]}   ")
        self.audit_act.blockSignals(True)
        self.audit_act.setChecked(ev.project.settings.audit_log)
        self.audit_act.blockSignals(False)
        self.last_update_ms = (time.perf_counter() - t0) * 1000 + self.state.last_eval_ms

    def _explain(self, keys: list[str]) -> None:
        self.explain.show_keys(keys)
        if keys:
            self.tabs.setCurrentWidget(self.explain)

    def _title(self) -> None:
        name = self.state.path.name if self.state.path else "Untitled"
        self.setWindowTitle(f"{name}{' *' if self.state.dirty else ''} — FlareLine {__version__}")

    # -- menus ---------------------------------------------------------------------------
    def _menus(self) -> None:
        mb = self.menuBar()
        f = mb.addMenu("&File")
        self._act(f, "&New", QKeySequence.New, self.new_project)
        self._act(f, "&Open…", QKeySequence.Open, self.open_project)
        samples = f.addMenu("Open &sample")
        for p in sample_files():
            label = p.name.removesuffix(".flareline.json").replace("_", " ").title()
            self._act(samples, label, None, lambda _=False, p=p: self.open_sample(p))
        f.addSeparator()
        self._act(f, "&Save", QKeySequence.Save, self.save)
        # QKeySequence.SaveAs has no binding on Windows, so name the keys
        self._act(f, "Save &as…", QKeySequence("Ctrl+Shift+S"), self.save_as)
        f.addSeparator()
        self._act(f, "&Export drawing…", QKeySequence("Ctrl+E"), self.export_drawing)
        f.addSeparator()
        self.audit_act = self._act(f, "Write audit log", None, self._toggle_audit)
        self.audit_act.setCheckable(True)
        f.addSeparator()
        self._act(f, "&Quit", QKeySequence.Quit, self.close)

        e = mb.addMenu("&Edit")
        undo = self.state.undo.createUndoAction(self, "&Undo")
        undo.setShortcut(QKeySequence.Undo)
        redo = self.state.undo.createRedoAction(self, "&Redo")
        redo.setShortcuts([QKeySequence.Redo, QKeySequence("Ctrl+Y")])
        e.addAction(undo)
        e.addAction(redo)
        e.addSeparator()
        self._act(e, "Add &leg", QKeySequence("Ctrl+L"), self.wizard.pages[2].add_leg)

        v = mb.addMenu("&View")
        for mode in ("system", "light", "dark"):
            self._act(v, f"{mode.title()} theme", None, lambda _=False, m=mode: self.set_theme(m))
        v.addSeparator()
        for name, key in (("Bend table: XYZ", "Ctrl+Shift+X"), ("Bend table: LRA", "Ctrl+Shift+L"),
                          ("Bend table: Legs", "Ctrl+Shift+G")):
            mode = name.split(": ")[1]
            self._act(v, name, QKeySequence(key), lambda _=False, m=mode: self.table.set_mode(m))
        v.addSeparator()
        self._act(v, "How to", QKeySequence("F1"), self.toggle_howto)

        tl = mb.addMenu("&Tools")
        self._act(tl, "Standards && shop &data…", QKeySequence("Ctrl+D"), self.edit_data)
        self._act(tl, "Approved &deviations…", None, self.edit_deviations)

        h = mb.addMenu("&Help")
        self._act(h, "How to", None, self.toggle_howto)
        self._act(h, "Save &quick-start guide (PDF)…", None, self.save_quickstart)
        self._act(h, "About FlareLine", None, self.about)

    def _act(self, menu, text, shortcut, slot) -> QAction:
        a = QAction(text, self)
        if shortcut is not None:
            a.setShortcut(shortcut)
        a.triggered.connect(slot)
        menu.addAction(a)
        return a

    def _shortcuts(self) -> None:
        for i in range(5):
            QShortcut(QKeySequence(f"Ctrl+{i + 1}"), self, lambda i=i: self.wizard.go(i))
        for key, fn in (("F", self.view3d.fit), ("0", lambda: self.view3d.view("iso")),
                        ("1", lambda: self.view3d.view("front")),
                        ("2", lambda: self.view3d.view("top")),
                        ("3", lambda: self.view3d.view("right")),
                        ("M", self.view3d.buttons["Measure"].toggle),
                        ("S", self.view3d.buttons["Section"].toggle)):
            sc = QShortcut(QKeySequence(key), self.view3d, fn)
            sc.setContext(Qt.WidgetWithChildrenShortcut)

    # -- actions -------------------------------------------------------------------------
    def _confirm_discard(self) -> bool:
        if not self.state.dirty:
            return True
        r = QMessageBox.question(self, "Unsaved changes", "Save changes first?",
                                 QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if r == QMessageBox.Save:
            return self.save()
        return r == QMessageBox.Discard

    def new_project(self) -> None:
        if self._confirm_discard():
            self.state.replace(Project(route=Project().route))

    def open_project(self) -> None:
        if not self._confirm_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Open project", "", FILE_FILTER)
        if path:
            self._open(Path(path))

    def open_sample(self, p: Path) -> None:
        if self._confirm_discard():
            try:
                self.state.replace(load_project(p), None)  # untitled: never overwrite a sample
            except ProjectError as e:
                QMessageBox.critical(self, "Cannot open sample", str(e))

    def _open(self, path: Path) -> None:
        try:
            self.state.open(path)
        except (ProjectError, OSError, ValueError) as e:
            QMessageBox.critical(self, "Cannot open project", str(e))

    def save(self) -> bool:
        if self.state.path is None:
            return self.save_as()
        self.state.save()
        return True

    def save_as(self) -> bool:
        path, _ = QFileDialog.getSaveFileName(self, "Save project", "untitled.flareline.json",
                                              FILE_FILTER)
        if not path:
            return False
        if not path.endswith(".json"):
            path += ".flareline.json"
        self.state.save(Path(path))
        return True

    def _toggle_audit(self, on: bool) -> None:
        p = self.state.project
        self.state.change(replace(p, settings=replace(p.settings, audit_log=on)),
                          "Toggle audit log")

    def set_theme(self, mode: str) -> None:
        from PySide6.QtWidgets import QApplication
        self.theme_mode = mode
        self.tokens = theme.apply(QApplication.instance(), mode)
        for w in (self.view2d, self.view3d):
            w.tokens = self.tokens
        if self.view3d.plotter:
            self.view3d.plotter.set_background(self.tokens.view_bg)
        QSettings().setValue("theme", mode)
        self.state.refresh()

    def edit_data(self) -> None:
        from ..data import default_data_dir, load_dataset
        from .widgets.data_editor import DataEditorDialog
        d = self.state.dataset.directory
        if d.resolve() == default_data_dir().resolve():
            QMessageBox.warning(self, "Read-only data", "FlareLine is running on the shipped "
                                "placeholder data because your data set failed to load. Fix "
                                "or restore the data folder first.")
            return
        dlg = DataEditorDialog(d, parent=self)

        def reload():
            self.state.dataset = load_dataset(d)
            self.state.refresh()
        dlg.dataChanged.connect(reload)
        dlg.exec()

    def export_drawing(self) -> None:
        from ..project import evaluate
        from .widgets.export_dialog import ExportDialog
        ev = evaluate(self.state.project, self.state.dataset)  # full check, incl. interference
        ExportDialog(ev, self.state.dataset, self.state.path, self.state.audit_path(),
                     self).exec()

    def edit_deviations(self) -> None:
        from .widgets.deviations import DeviationsDialog
        dlg = DeviationsDialog(self.state.evaluation, self)
        if dlg.exec() and dlg.result_project is not None:
            self.state.change(dlg.result_project, "Edit approved deviations")

    def save_quickstart(self) -> None:
        from ..drawing.quickstart import write_quickstart
        path, _ = QFileDialog.getSaveFileName(self, "Save quick-start guide",
                                              "FlareLine_quick_start.pdf", "PDF (*.pdf)")
        if path:
            write_quickstart(path)

    def toggle_howto(self) -> None:
        self.howto.setVisible(not self.howto.isVisible())

    def about(self) -> None:
        QMessageBox.information(self, "About FlareLine",
                                f"FlareLine {__version__}\n\n{DISCLAIMER}\n\n"
                                "Fully offline: no network calls, no telemetry.")

    def closeEvent(self, e):  # noqa: N802
        if self._confirm_discard():
            if self.view3d.plotter:
                self.view3d.plotter.close()
            e.accept()
        else:
            e.ignore()


def _padded(w: QWidget) -> QWidget:
    box = QWidget()
    lay = QVBoxLayout(box)
    lay.setContentsMargins(10, 10, 10, 10)
    lay.addWidget(w)
    return box
