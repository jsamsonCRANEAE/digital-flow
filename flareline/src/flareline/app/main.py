"""Application entry point: python -m flareline.app"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PySide6.QtCore import QCoreApplication, QSettings, QTimer
from PySide6.QtWidgets import QApplication, QMessageBox

from ..data import DataError, default_data_dir, load_dataset
from ..project.model import load as load_project
from . import theme
from .mainwindow import DISCLAIMER, MainWindow, sample_files
from .state import DocumentState


def user_data_dir() -> Path:
    """The editable data set lives in the user's app-data folder, copied from the
    shipped placeholders on first run, so updates never overwrite entered data."""
    d = DocumentState.app_dir() / "data"
    if not (d / "dataset.json").exists():
        shutil.copytree(default_data_dir(), d, dirs_exist_ok=True)
    return d


def run(argv: list[str] | None = None, show_disclaimer: bool = True) -> int:
    argv = sys.argv if argv is None else argv
    QCoreApplication.setOrganizationName("FlareLine")
    QCoreApplication.setApplicationName("FlareLine")
    app = QApplication.instance() or QApplication(argv)
    mode = str(QSettings().value("theme", "system"))
    tokens = theme.apply(app, mode)

    try:
        ds = load_dataset(user_data_dir())
    except DataError as e:
        QMessageBox.critical(None, "Data set error",
                             f"Your data set could not be loaded:\n\n{e}\n\n"
                             "FlareLine will use the shipped placeholder data (every "
                             "standards value missing) until this is fixed.")
        ds = load_dataset()

    samples = sample_files()
    project = load_project(samples[0]) if samples else None
    state = DocumentState(ds, project)
    win = MainWindow(state, tokens, mode)
    win.show()
    if len(argv) > 1 and Path(argv[1]).exists():
        win._open(Path(argv[1]))
    else:
        state.refresh()
    if show_disclaimer:
        QTimer.singleShot(0, lambda: QMessageBox.warning(win, "FlareLine", DISCLAIMER))
    return app.exec()


if __name__ == "__main__":
    sys.exit(run())
