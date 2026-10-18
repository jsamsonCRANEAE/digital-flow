"""GUI behaviour: drives the real main window (no 3D unless FLARELINE_GUI_3D=1).

Skipped when PySide6 is not installed. Runs headless with Qt's offscreen platform.
"""
import math
import os
import statistics
import time

import pytest

pytest.importorskip("PySide6")
if not os.environ.get("FLARELINE_GUI_3D"):
    os.environ["FLARELINE_NO_3D"] = "1"
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QCoreApplication  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from flareline.app import theme  # noqa: E402
from flareline.app.mainwindow import MainWindow, sample_files  # noqa: E402
from flareline.app.state import DocumentState  # noqa: E402
from flareline.data import load_dataset  # noqa: E402
from flareline.project import Project, TubeSpec  # noqa: E402
from flareline.project.model import load  # noqa: E402


@pytest.fixture(scope="module")
def app():
    QCoreApplication.setOrganizationName("FlareLine-test")
    QCoreApplication.setApplicationName("FlareLine-test")
    return QApplication.instance() or QApplication([])


@pytest.fixture
def win(app, tmp_path, monkeypatch):
    monkeypatch.setattr(DocumentState, "app_dir", staticmethod(lambda: tmp_path))
    state = DocumentState(load_dataset(), load(sample_files()[0]))   # simple 90
    w = MainWindow(state, theme.apply(app, "light"))
    w.show()
    state.refresh()
    yield w
    state.undo.setClean()
    w.close()


def cell(w, r, c):
    return w.table.table.item(r, c)


def edit(w, r, c, text):
    cell(w, r, c).setText(text)


def test_gu01_opens_sample_and_flags_placeholder_data(win):
    """GU-01 the simple-90 sample opens: 3 points, bend 90.00°, banner up on placeholder data."""
    assert win.table.table.rowCount() == 3
    assert cell(win, 1, 5).text() == "90.00"
    assert not win.banner.isHidden()
    assert "NOT FOR FABRICATION" in win.banner.text()


def test_gu02_xyz_edit_updates_everything_and_undoes(win):
    """GU-02 editing P2 Y from 6 to 10 changes the route and developed length (+4.0000),
    then Ctrl+Z restores the exact original value and Ctrl+Y re-applies it."""
    st = win.state
    before = st.evaluation.analysis.developed_length
    edit(win, 2, 2, "10")
    assert st.project.route.points[2][1] == 10.0
    assert st.evaluation.analysis.developed_length == pytest.approx(before + 4.0, abs=1e-12)
    st.undo.undo()
    assert st.project.route.points[2][1] == 6.0
    st.undo.redo()
    assert st.project.route.points[2][1] == 10.0


def test_gu03_lra_feed_edit_moves_downstream_geometry(win):
    """GU-03 in LRA mode, increasing feed Y1 by 1 moves P1 and P2 by 1 along +X and adds
    exactly 1 to the developed length."""
    st = win.state
    before = st.evaluation.analysis.developed_length
    p1 = st.project.route.points[1]
    win.table.set_mode("LRA")
    y1 = float(cell(win, 0, 1).text())
    edit(win, 0, 1, f"{y1 + 1}")
    assert st.project.route.points[1][0] == pytest.approx(p1[0] + 1, abs=1e-9)
    assert st.evaluation.analysis.developed_length == pytest.approx(before + 1, abs=1e-9)


def test_gu04_mm_display_does_not_change_model(win):
    """GU-04 switching to mm shows 8 in as 203.2000 mm; the stored point is still 8.0 in."""
    from dataclasses import replace
    st = win.state
    st.change(replace(st.project, settings=replace(st.project.settings, display_unit="mm")),
              "mm")
    assert cell(win, 1, 1).text() == "203.2000"
    assert st.project.route.points[1][0] == 8.0


def test_gu05_bad_input_reverts(win):
    """GU-05 typing text into a number cell reverts it and adds no undo step."""
    n = win.state.undo.count()
    edit(win, 1, 1, "abc")
    assert cell(win, 1, 1).text() == "8.0000"
    assert win.state.undo.count() == n


def test_gu06_explain_shows_formula(win):
    """GU-06 selecting the bend angle cell shows its formula in the Explain panel."""
    win.table.table.setCurrentCell(1, 5)
    html = win.explain.toPlainText()
    assert "theta = atan2(|u x v|, u . v)" in html
    assert "full precision" in html


def test_gu07_wizard_size_change_resolves_new_od(win):
    """GU-07 choosing -5 in step 1 resolves OD 0.3125 (DERIVED from the dash number)."""
    page = win.wizard.pages[0]
    page.dash.setCurrentIndex(page.dash.findData(5))
    page.dash.activated.emit(page.dash.currentIndex())
    assert win.state.evaluation.resolved["od"].value == 0.3125


def test_gu08_add_and_remove_leg(win):
    """GU-08 Add leg appends a 6 in leg at 90°; Remove last leg takes it away again."""
    route = win.state.project.route
    win.wizard.pages[2].add_leg()
    r2 = win.state.project.route
    assert len(r2.points) == 4
    assert math.dist(r2.points[2], r2.points[3]) == pytest.approx(6.0, abs=1e-12)
    win.wizard.pages[2]._remove()
    assert win.state.project.route == route


def test_gu09_error_geometry_shown_not_crashing(win):
    """GU-09 moving P2 onto P1 (zero-length leg) shows an ERROR and keeps the table usable."""
    edit(win, 2, 1, "8")
    edit(win, 2, 2, "0")
    codes = [i.code for i in win.state.evaluation.issues]
    assert "ZERO_LENGTH_LEG" in codes
    assert win.table.table.rowCount() == 3


def test_gu10_save_and_reopen(win, tmp_path):
    """GU-10 save writes the project, clears the unsaved mark, and reopening is identical."""
    edit(win, 2, 2, "7.25")
    assert win.state.dirty and win.windowTitle().startswith("Untitled *")
    path = tmp_path / "t.flareline.json"
    win.state.save(path)
    assert not win.state.dirty
    saved = win.state.project
    win.state.open(path)
    assert win.state.project == saved


def test_gu11_rotation_convention_display(win):
    """GU-11 with CCW display, the LRA B of the 3D sample shows the opposite sign."""
    from dataclasses import replace
    st = win.state
    st.replace(load(sample_files()[2]))
    win.table.set_mode("LRA")
    cw = float(cell(win, 1, 2).text())
    st.change(replace(st.project, settings=replace(st.project.settings,
                                                   rotation_direction="CCW")), "ccw")
    assert float(cell(win, 1, 2).text()) == -cw


def test_gu12_twenty_bend_update_under_100ms(win):
    """GU-12 a 20-bend tube: edit -> evaluated -> every panel (no 3D) updated, median < 100 ms."""
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from test_development import _twenty_bend_route
    st = win.state
    st.replace(Project(tube=TubeSpec(4, "cres304", 0.035), route=_twenty_bend_route()))
    times = []
    for i in range(10):
        p = st.project.route.points[10]
        t0 = time.perf_counter()
        st.change(st.project.with_route(st.project.route.with_point(10, (p[0], p[1], p[2] + 0.01))),
                  "bench")
        times.append((time.perf_counter() - t0) * 1000)
    assert statistics.median(times) < 100, times


# -- standards data editor ------------------------------------------------------------

@pytest.fixture
def editor(app, tmp_path):
    import shutil
    from flareline.app.widgets.data_editor import DataEditorDialog
    from flareline.data import default_data_dir
    d = tmp_path / "data"
    shutil.copytree(default_data_dir(), d)
    dlg = DataEditorDialog(d, user="J. Tester")
    yield dlg
    dlg.close()


@pytest.mark.parametrize("kind, text, value", [
    ("number", "0.875", 0.875), ("number", "", None),
    ("numbers", "0.035, 0.049", [0.035, 0.049]), ("numbers", "", []),
    ("points", "0:0; 90:3", [[0.0, 0.0], [90.0, 3.0]]),
    ("bool", "yes", True), ("bool", "No", False), ("text", " AMS 5567 ", "AMS 5567"),
])
def test_de01_value_parsing(kind, text, value):
    """DE-01 what the user types becomes the right JSON value, and formats back."""
    from flareline.app.widgets.data_editor import format_value, parse_value
    assert parse_value(kind, text) == value
    assert parse_value(kind, format_value(kind, value)) == value


def test_de02_enter_verify_and_log(editor):
    """DE-02 entering a min CLR then verifying the row: data reloads VERIFIED, the change
    log names the user and reason, and the grid shows the new status."""
    editor.show_table("as33611_bend_radius")
    editor.apply_value(0, "min_clr", "0.875", "entered from licensed copy")
    editor.verify_row(0, standard="SAE AS33611", revision="TEST", table_ref="T-1",
                      date_entered="2026-10-18", reason="checked")
    row = editor.ds.table("as33611_bend_radius").rows[0]
    assert row.values["min_clr"] == 0.875 and row.provenance.status.value == "VERIFIED"
    from flareline.data import read_changelog
    log = read_changelog(editor.directory)
    assert [r["user"] for r in log] == ["J. Tester", "J. Tester"]
    assert log[0]["reason"] == "entered from licensed copy"
    status_col = editor.grid.columnCount() - 5
    assert editor.grid.item(0, status_col).text() == "VERIFIED"


def test_de03_verify_refused_when_values_missing(editor):
    """DE-03 verifying a row with an empty required value is refused; nothing is written."""
    from flareline.data import DataError, read_changelog
    editor.show_table("as4330_flare")
    with pytest.raises(DataError):
        editor.verify_row(0, standard="SAE AS4330", revision="X", table_ref="T",
                          date_entered="2026-10-18", reason="r")
    assert read_changelog(editor.directory) == []


def test_de04_note_edit_and_verify(editor):
    """DE-04 the flare end-point note can be written and verified; an empty note cannot."""
    from flareline.data import DataError
    editor.show_table("as4330_flare")
    with pytest.raises(DataError):
        editor.set_note("end_point_definition", "  ", True, "r")
    editor.set_note("end_point_definition", "TEST definition", True, "from drawing practice")
    m = editor.ds.table("as4330_flare").meta["end_point_definition"]
    assert m["text"] == "TEST definition" and m["status"] == "VERIFIED"
    assert m["entered_by"] == "J. Tester"


def test_de05_bad_value_rejected(editor):
    """DE-05 text in a number field is refused before anything is written."""
    editor.show_table("as33611_bend_radius")
    with pytest.raises(ValueError):
        editor.apply_value(0, "min_clr", "about one inch", "r")


def test_gu13_lra_marks_column(win):
    """GU-13 hand-bender marks in the LRA table, simple 90 (legs 8/6, R 0.75, T 0.75):
    bend starts at 7.2500 and ends at 7.25 + 0.75*pi/2 = 8.4281 from P0."""
    win.table.set_mode("LRA")
    assert cell(win, 0, 6).text() == "7.2500 – 8.4281"
