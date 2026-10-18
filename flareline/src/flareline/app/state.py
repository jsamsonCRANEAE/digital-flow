"""Document state shared by every panel.

The project is immutable, so undo / redo is just swapping snapshots. Every
change is evaluated at once without the self-interference check (a few ms),
and again with it 150 ms after the last change, so typing stays responsive.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from PySide6.QtCore import QObject, QStandardPaths, QTimer, Signal
from PySide6.QtGui import QUndoCommand, QUndoStack

from ..data.store import Dataset
from ..project import AuditLog, Evaluation, Project, evaluate, load, save

FULL_CHECK_DELAY_MS = 150
AUTOSAVE_MS = 60_000


class _Snapshot(QUndoCommand):
    def __init__(self, state: "DocumentState", before: Project, after: Project, text: str):
        super().__init__(text)
        self.state, self.before, self.after = state, before, after

    def redo(self) -> None:
        self.state._apply(self.after)

    def undo(self) -> None:
        self.state._apply(self.before)


class DocumentState(QObject):
    evaluated = Signal(object)          # Evaluation (fast or full)
    projectReplaced = Signal()          # new / open: panels reload all fields
    pathChanged = Signal()

    def __init__(self, dataset: Dataset, project: Optional[Project] = None):
        super().__init__()
        self.dataset = dataset
        self.project = project or Project()
        self.path: Optional[Path] = None
        self.undo = QUndoStack(self)
        self.undo.cleanChanged.connect(lambda _: self.pathChanged.emit())
        self.evaluation: Optional[Evaluation] = None
        self.last_eval_ms = 0.0
        self._full = QTimer(self, singleShot=True, interval=FULL_CHECK_DELAY_MS)
        self._full.timeout.connect(self._evaluate_full)
        self._autosave = QTimer(self, interval=AUTOSAVE_MS)
        self._autosave.timeout.connect(self.autosave)
        self._autosave.start()

    # -- editing ---------------------------------------------------------------
    def change(self, new: Project, text: str) -> None:
        """Every edit goes through here so it can be undone."""
        if new == self.project:
            return
        self.undo.push(_Snapshot(self, self.project, new, text))

    def _apply(self, project: Project) -> None:
        self.project = project
        self._evaluate_fast()

    def replace(self, project: Project, path: Optional[Path] = None) -> None:
        """New / open: not undoable, clears history."""
        self.project = project
        self.path = path
        self.undo.clear()
        self.undo.setClean()
        self.projectReplaced.emit()
        self.pathChanged.emit()
        self._evaluate_fast()

    # -- evaluation ------------------------------------------------------------
    def _evaluate_fast(self) -> None:
        t0 = time.perf_counter()
        self.evaluation = evaluate(self.project, self.dataset, check_interference=False)
        self.last_eval_ms = (time.perf_counter() - t0) * 1000
        self.evaluated.emit(self.evaluation)
        self._full.start()

    def _evaluate_full(self) -> None:
        audit = None
        if self.project.settings.audit_log:
            audit = AuditLog(self.audit_path())
        self.evaluation = evaluate(self.project, self.dataset, audit=audit)
        self.evaluated.emit(self.evaluation)

    def refresh(self) -> None:
        self._evaluate_fast()

    # -- files -------------------------------------------------------------------
    @property
    def dirty(self) -> bool:
        return not self.undo.isClean()

    def save(self, path: Optional[Path] = None) -> Path:
        target = Path(path) if path else self.path
        if target is None:
            raise ValueError("no file name")
        save(self.project, target)
        self.path = target
        self.undo.setClean()
        self.pathChanged.emit()
        return target

    def open(self, path: Path) -> None:
        self.replace(load(path), Path(path))

    @staticmethod
    def app_dir() -> Path:
        d = Path(QStandardPaths.writableLocation(QStandardPaths.AppDataLocation))
        d.mkdir(parents=True, exist_ok=True)
        return d

    def autosave_path(self) -> Path:
        name = self.path.stem if self.path else "untitled"
        d = self.app_dir() / "autosave"
        d.mkdir(exist_ok=True)
        return d / f"{name}.autosave.flareline.json"

    def audit_path(self) -> Path:
        return self.app_dir() / "audit.jsonl"

    def autosave(self) -> Optional[Path]:
        if not self.dirty:
            return None
        p = self.autosave_path()
        save(self.project, p)
        return p
