"""Drawing export: traceability, watermark, scale, and each output format re-read."""
import csv
import math
import re

import pytest

pytest.importorskip("reportlab")
pytest.importorskip("ezdxf")

from flareline.data import load_dataset  # noqa: E402
from flareline.drawing import FORMATS, build_drawing, export  # noqa: E402
from flareline.drawing.layout import SCALES  # noqa: E402
from flareline.drawing.model import PAPER, Polyline, Text  # noqa: E402
from flareline.drawing.textfit import text_width  # noqa: E402
from flareline.geometry import TubeRoute  # noqa: E402
from flareline.project import AuditLog, Override, Project, TubeSpec, evaluate, read_audit_log  # noqa: E402

ROUTE = TubeRoute.uniform([(0, 0, 0), (5, 0, 0), (5, 0, 6), (9, 4, 8), (9, 4, 12)], 0.75)
DATE = "2026-10-18"


def project(**kw):
    base = dict(tube=TubeSpec(4, "cres304", 0.035), route=ROUTE,
                meta={"part_number": "TEST-123", "title": "Test tube", "revision": "A",
                      "revisions": "A|Initial|2026-10-18|JT"})
    base.update(kw)
    return Project(**base)


@pytest.fixture
def placeholder_ev():
    ds = load_dataset()
    return evaluate(project(), ds), ds


def texts(sheet, ref=None):
    return [t for t in sheet.texts() if ref is None or ref in t.ref.split(",")]


def test_dr01_every_number_on_the_drawing_is_traceable(placeholder_ev):
    """DR-01 rule 4: every text on sheet 1 that contains a digit names its source
    (trace key, input, data row, project field or a static label)."""
    ev, ds = placeholder_ev
    sheets, _ = build_drawing(ev, ds, "B", DATE)
    untraced = [t.text for t in sheets[0].texts() if re.search(r"\d", t.text) and not t.ref]
    assert untraced == []


def test_dr02_bend_table_matches_engine(placeholder_ev):
    """DR-02 bend table cells are the engine values rounded for display only:
    straight S0 = 5 - 0.75 = 4.2500; bend 2 = 70.53°; B2 = -135.00; B1 (from ref) = 90.00."""
    ev, ds = placeholder_ev
    s = build_drawing(ev, ds, "B", DATE)[0][0]
    assert [t.text for t in texts(s, "seg0.straight")] == ["4.2500"]
    assert [t.text for t in texts(s, "bend2.angle_deg")] == ["70.53"]
    assert [t.text for t in texts(s, "bend2.rotation_deg")] == ["-135.00"]
    assert [t.text for t in texts(s, "bend1.rotation_from_ref_deg")] == ["90.00"]
    assert [t.text for t in texts(s, "input:P4.z")] == ["12.0000"]


def test_dr03_watermark_when_not_releasable(placeholder_ev):
    """DR-03 placeholder data -> NOT FOR FABRICATION watermark with reasons on sheet 1."""
    ev, ds = placeholder_ev
    sheets, info = build_drawing(ev, ds, "B", DATE)
    assert not info.releasable and info.reasons
    wm = [t.text for t in sheets[0].texts() if t.layer == "WATERMARK"]
    assert "NOT FOR FABRICATION" in wm


def test_dr04_no_watermark_when_releasable(filled_dir):
    """DR-04 verified test data, no errors -> releasable, no watermark layer at all."""
    ds = load_dataset(filled_dir)
    ev = evaluate(project(), ds)
    assert ev.releasable, [i.code for i in ev.issues]
    sheets, info = build_drawing(ev, ds, "B", DATE)
    assert info.releasable
    assert not [t for t in sheets[0].texts() if t.layer == "WATERMARK"]


@pytest.mark.parametrize("size", ["A", "B", "D"])
def test_dr05_standard_scale_and_everything_on_the_sheet(placeholder_ev, size):
    """DR-05 for A, B and D: the ortho scale is a standard scale, and every line and
    text lies inside the sheet."""
    ev, ds = placeholder_ev
    sheets, info = build_drawing(ev, ds, size, DATE)
    assert info.scale_label in {f"{n}:{d}" for n, d in SCALES}
    W, H = PAPER[size]
    for it in sheets[0].items:
        if isinstance(it, Polyline):
            assert all(0 <= x <= W and 0 <= y <= H for x, y in it.points)
        if isinstance(it, Text) and not it.rotation:
            x0 = {"left": 0, "center": 0.5, "right": 1}[it.anchor]
            width = text_width(it.text, it.height, it.bold)
            assert -1e-6 <= it.pos[0] - x0 * width and it.pos[0] + (1 - x0) * width <= W + 1e-6
            assert 0 <= it.pos[1] <= H


def test_dr06_coincident_points_share_a_label(placeholder_ev):
    """DR-06 P1 and P2 project onto the same spot in the top view: one label 'P1, P2'."""
    ev, ds = placeholder_ev
    labels = [t.text for t in build_drawing(ev, ds, "B", DATE)[0][0].texts()
              if t.ref == "label:point"]
    assert "P1, P2" in labels and "P0, P1" in labels


def test_dr07_pdf(placeholder_ev, tmp_path):
    """DR-07 PDF: one page per sheet, B size 17x11 in, key text present."""
    from pypdf import PdfReader
    ev, ds = placeholder_ev
    res = export(ev, ds, tmp_path / "t", ["pdf"], "B", DATE)
    r = PdfReader(str(res.files[0]))
    assert len(r.pages) == res.info.sheets >= 2
    box = r.pages[0].mediabox
    assert (float(box.width), float(box.height)) == (17 * 72, 11 * 72)
    text = r.pages[0].extract_text()
    for s in ("TEST-123", "NOT FOR FABRICATION", ev.dataset_sha256[:16], "SAE AS33611",
              "BEND TABLE", "DESIGN AID ONLY"):
        assert s in text, s
    assert "CALCULATION RECORD" in r.pages[1].extract_text()


def test_dr08_dxf_true_size_centerline(placeholder_ev, tmp_path):
    """DR-08 DXF model space holds the true-size 3D centerline: total length of LINEs + ARCs
    equals the engine centerline length, arc radii equal CLR, and arc ends sit on the
    tangent points (all to 1e-9 in). Paper space holds the sheet."""
    import ezdxf
    ev, ds = placeholder_ev
    res = export(ev, ds, tmp_path / "t", ["dxf"], "B", DATE)
    doc = ezdxf.readfile(str(res.files[0]))
    ents = [e for e in doc.modelspace() if e.dxf.layer == "TUBE_CENTERLINE_3D"]
    lines = [e for e in ents if e.dxftype() == "LINE"]
    arcs = [e for e in ents if e.dxftype() == "ARC"]
    a = ev.analysis
    assert len(arcs) == 3 and len(lines) == 4
    total = sum((e.dxf.end - e.dxf.start).magnitude for e in lines)
    for arc, b in zip(arcs, a.bends):
        assert arc.dxf.radius == pytest.approx(b.clr, abs=1e-12)
        sweep = (arc.dxf.end_angle - arc.dxf.start_angle) % 360
        assert sweep == pytest.approx(b.angle_deg, abs=1e-9)
        total += math.radians(sweep) * arc.dxf.radius
        assert tuple(arc.start_point) == pytest.approx(b.tangent_point_in, abs=1e-9)
        assert tuple(arc.end_point) == pytest.approx(b.tangent_point_out, abs=1e-9)
    assert total == pytest.approx(a.centerline_length, abs=1e-9)
    sheet_text = [e.dxf.text for e in doc.layouts.get("SHEET") if e.dxftype() == "TEXT"]
    assert "TEST-123" in sheet_text


def test_dr09_csv_full_precision(placeholder_ev, tmp_path):
    """DR-09 CSV values parse back to exactly the engine's floats; the header carries the
    data set hash and NOT FOR FABRICATION status."""
    ev, ds = placeholder_ev
    res = export(ev, ds, tmp_path / "t", ["csv"], "B", DATE)
    lines = res.files[0].read_text(encoding="utf-8").splitlines()
    header = [ln for ln in lines if ln.startswith("#")]
    assert any(ev.dataset_sha256 in ln for ln in header)
    assert any("NOT FOR FABRICATION" in ln for ln in header)
    rows = list(csv.DictReader([ln for ln in lines if not ln.startswith("#")]))
    a = ev.analysis
    assert float(rows[2]["z_in"]) == 6.0
    assert float(rows[0]["straight_to_next_in"]) == a.segments[0].straight
    assert float(rows[2]["bend_deg"]) == a.bend(2).angle_deg
    assert float(rows[1]["mark_end_in"]) == a.bend(1).mark_end


def test_dr10_png_size(placeholder_ev, tmp_path):
    """DR-10 PNG of sheet 1 at 150 dpi: B size is 2550 x 1650 px."""
    pytest.importorskip("PySide6")
    from PySide6.QtGui import QImage
    ev, ds = placeholder_ev
    res = export(ev, ds, tmp_path / "t", ["png"], "B", DATE)
    img = QImage(str(res.files[0]))
    assert (img.width(), img.height()) == (2550, 1650)


def test_dr11_deviation_and_revision_on_drawing(filled_dir):
    """DR-11 an approved deviation and the revision history are printed on sheet 1."""
    ds = load_dataset(filled_dir)
    p = project(overrides={"min_clr": Override(0.4, "ED-42 approved", "JS", "2026-10-18")})
    sheet = build_drawing(evaluate(p, ds), ds, "B", DATE)[0][0]
    alltext = " ".join(t.text for t in sheet.texts())
    assert "ED-42 APPROVED" in alltext.upper() and "MIN_CLR = 0.4" in alltext
    assert "Initial" in alltext


def test_dr12_export_is_audited(placeholder_ev, tmp_path):
    """DR-12 exporting with the audit log on records the export, formats and status."""
    ev, ds = placeholder_ev
    log = AuditLog(tmp_path / "audit.jsonl", user="t")
    export(ev, ds, tmp_path / "t", FORMATS, "A", DATE, audit=log)
    rec = read_audit_log(tmp_path / "audit.jsonl")[-1]
    assert rec["event"] == "export:pdf,dxf,png,csv:A:NOT FOR FABRICATION"


def test_dr13_millimetre_drawing(placeholder_ev):
    """DR-13 a project displayed in mm draws in mm: P4 Z = 12 in = 304.8000 mm."""
    from dataclasses import replace
    ev, ds = placeholder_ev
    p = replace(ev.project, settings=replace(ev.project.settings, display_unit="mm"))
    sheet = build_drawing(evaluate(p, ds), ds, "B", DATE)[0][0]
    assert [t.text for t in texts(sheet, "input:P4.z")] == ["304.8000"]
    assert "MILLIMETERS" in [t.text for t in sheet.texts()]
