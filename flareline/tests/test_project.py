"""Projects: file format, data resolution with provenance, banner, audit log."""
import json
import math
import shutil

import pytest

from flareline.data import DataEditor, Status, default_data_dir, load_dataset
from flareline.geometry import TubeRoute
from flareline.project import (AuditLog, Override, Project, ProjectError, Settings, TubeSpec,
                               evaluate, from_json, load, read_audit_log, save, to_json)

ROUTE = TubeRoute.uniform([(0, 0, 0), (10, 0, 0), (10, 10, 0), (10, 10, 10)], 0.75)


def project(**kw):
    base = dict(tube=TubeSpec(4, "cres304", 0.035), route=ROUTE)
    base.update(kw)
    return Project(**base)


def codes(ev, sev=None):
    return [i.code for i in ev.issues if sev is None or i.severity.value == sev]


@pytest.fixture
def filled_dir(tmp_path):
    """Placeholder data with the -4 / 304 rows filled in and VERIFIED using
    TEST values (not standards values) to exercise the trusted path."""
    d = tmp_path / "data"
    shutil.copytree(default_data_dir(), d)
    ed = DataEditor(d, "test")
    v = dict(standard="TEST", revision="T", table_ref="T-1", date_entered="2026-10-18",
             reason="test")
    ed.set_value("as33611_bend_radius", 0, "min_clr", 0.5, "test")
    ed.mark_verified("as33611_bend_radius", 0, **v)
    for f, val in (("end_allowance", 0.1), ("flare_diameter_min", 0.3),
                   ("flare_diameter_max", 0.31), ("flare_angle_nominal_deg", 37.0),
                   ("flare_angle_tol_deg", 0.5)):
        ed.set_value("as4330_flare", 0, f, val, "test")
    ed.mark_verified("as4330_flare", 0, **v)
    for f, val in (("min_straight_between_bends", 0.5), ("min_end_straight_flare37", 1.0),
                   ("min_end_straight_plain", 0.5)):
        ed.set_value("shop_limits", 0, f, val, "test")
    ed.mark_verified("shop_limits", 0, **v)
    ed.set_value("materials", 0, "material_spec", "TEST-SPEC", "test")
    ed.set_value("materials", 0, "flaring_permitted", True, "test")
    ed.mark_verified("materials", 0, **v)
    path = d / "as4330_flare.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["meta"]["end_point_definition"].update(text="TEST point", status="VERIFIED")
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return d


def test_pj01_save_load_round_trip_is_exact(tmp_path):
    """PJ-01 save -> load reproduces every float bit for bit (1/3, pi) and all settings."""
    p = project(route=TubeRoute(((0, 0, 0), (1 / 3, 0, 0), (1 / 3, math.pi, 0)), (0.7,)),
                settings=Settings(rotation_direction="CCW", rotation_viewpoint="toward_end1",
                                  display_unit="mm", springback_enabled=True),
                overrides={"min_clr": Override(0.6, "engineering deviation ED-1", "JS")},
                meta={"part_number": "TEST-001"})
    save(p, tmp_path / "p.flareline.json")
    assert load(tmp_path / "p.flareline.json") == p


def test_pj02_schema_version_checks():
    """PJ-02 files from a newer schema, or missing format / version, are refused."""
    doc = to_json(project())
    with pytest.raises(ProjectError, match="newer"):
        from_json({**doc, "schema_version": 99})
    with pytest.raises(ProjectError, match="schema version"):
        from_json({k: v for k, v in doc.items() if k != "schema_version"})
    with pytest.raises(ProjectError, match="not a FlareLine"):
        from_json({**doc, "format": "x"})


def test_pj03_placeholder_data_shows_banner_and_blocks_release():
    """PJ-03 on placeholder data the banner lists every missing value actually used,
    the cut length is marked incomplete and the design is not releasable."""
    ev = evaluate(project(), load_dataset())
    assert ev.show_banner and not ev.releasable and not ev.cut_length_complete
    flagged = {r.name for r in ev.flagged}
    assert {"min_clr", "end1.allowance", "end2.allowance", "end1.min_straight",
            "end2.min_straight", "min_straight_between_bends",
            "end_point_definition"} <= flagged
    assert "FLARING_NOT_CONFIRMED" in codes(ev)
    assert "LIMIT_NOT_SET" not in codes(ev)  # replaced by MISSING_DATA, which cites the row


def test_pj04_geometry_still_solves_without_standards_data():
    """PJ-04 missing data never blocks the geometry: legs 10/10/10, two 90 deg bends at
    R = 0.75 (T = 0.75): developed = 30 - 4T + 2R(pi/2) = 27 + 0.75pi = 29.35619449."""
    ev = evaluate(project(), load_dataset())
    assert ev.analysis.ok
    assert ev.analysis.developed_length == pytest.approx(27 + 0.75 * math.pi, abs=1e-9)


def test_pj05_verified_data_flows_into_checks_and_cut_length(filled_dir):
    """PJ-05 with verified test rows: no banner; cut = developed + 0.1 + 0.1;
    the AS33611 min CLR (test 0.5) is enforced with its source named."""
    ds = load_dataset(filled_dir)
    ev = evaluate(project(), ds)
    assert not ev.show_banner, ev.banner_lines
    assert ev.cut_length_complete
    assert ev.analysis.cut_length == pytest.approx(ev.analysis.developed_length + 0.2, abs=1e-12)
    assert ev.releasable
    tight = evaluate(project(route=ROUTE.with_radius(1, 0.4)), ds)
    w = [i for i in tight.issues if i.code == "CLR_BELOW_MIN"]
    assert w and "TEST, rev T, T-1" in w[0].message


def test_pj06_override_is_user_input_and_visible(filled_dir):
    """PJ-06 a min-CLR override replaces the data value, is marked USER INPUT with its reason,
    and is listed as INFO so it shows on the drawing notes."""
    ev = evaluate(project(overrides={"min_clr": Override(0.3, "ED-42 approved", "JS")}),
                  load_dataset(filled_dir))
    r = ev.resolved["min_clr"]
    assert r.value == 0.3 and r.status == Status.USER_INPUT and "ED-42" in r.source
    assert "USER_OVERRIDE" in codes(ev, "info")
    assert "UNKNOWN_OVERRIDE" in codes(evaluate(project(overrides={"od": Override(1, "x")}),
                                                load_dataset(filled_dir)))


def test_pj07_end_types(filled_dir):
    """PJ-07 plain end: allowance 0 (DERIVED); flareless end: placeholder INFO, allowance
    missing and cut length incomplete."""
    ds = load_dataset(filled_dir)
    ev = evaluate(project(end2="plain"), ds)
    assert ev.resolved["end2.allowance"].value == 0.0
    assert ev.resolved["end2.allowance"].status == Status.DERIVED
    ev = evaluate(project(end2="flareless"), ds)
    assert "FLARELESS_PLACEHOLDER" in codes(ev) and not ev.cut_length_complete
    with pytest.raises(ProjectError):
        project(end1="weld")


def test_pj08_flaring_not_permitted_is_error(filled_dir):
    """PJ-08 a material marked flaring_permitted = false with a 37° end -> ERROR."""
    DataEditor(filled_dir, "t").set_value("materials", 0, "flaring_permitted", False, "policy")
    ev = evaluate(project(), load_dataset(filled_dir))
    assert "FLARING_NOT_PERMITTED" in codes(ev, "error") and not ev.releasable


def test_pj09_image_route_needs_confirmation(filled_dir):
    """PJ-09 an image-derived route is APPROXIMATE and not releasable until confirmed."""
    ds = load_dataset(filled_dir)
    ev = evaluate(project(route_origin="image"), ds)
    assert "IMAGE_APPROXIMATE" in codes(ev) and not ev.releasable
    assert evaluate(project(route_origin="image", image_confirmed=True), ds).releasable


def test_pj10_audit_log_records_inputs_calcs_and_hashes(tmp_path):
    """PJ-10 the audit log line holds the data set hash, each input's status/source,
    every traced calculation and every issue."""
    log = AuditLog(tmp_path / "audit.jsonl", user="tester")
    ds = load_dataset()
    evaluate(project(), ds, audit=log)
    rec = read_audit_log(tmp_path / "audit.jsonl")[0]
    assert rec["dataset_sha256"] == ds.sha256 and rec["user"] == "tester"
    assert rec["inputs"]["min_clr"]["status"] == "MISSING"
    assert any(c["key"] == "bend1.tangent" and c["formula"] == "T = R * tan(theta / 2)"
               for c in rec["calculations"])
    assert any(i["code"] == "MISSING_DATA" for i in rec["issues"])


def test_pj11_wall_from_data_must_exist(filled_dir):
    """PJ-11 a wall marked 'from data' that the wall table does not list is flagged."""
    ev = evaluate(project(tube=TubeSpec(4, "cres304", 0.035, wall_from_data=True)),
                  load_dataset(filled_dir))
    assert "WALL_NOT_IN_DATA" in codes(ev) and ev.resolved["wall"].flagged


def test_pj12_springback_from_shop_table(filled_dir):
    """PJ-12 springback on with an empty shop table -> MISSING; with test points (0,0),(90,3)
    a 120 deg bend outside the table warns SPRINGBACK_EXTRAPOLATED."""
    ds = load_dataset(filled_dir)
    ev = evaluate(project(settings=Settings(springback_enabled=True)), ds)
    assert ev.resolved["springback_points"].missing
    DataEditor(filled_dir, "t").set_value("shop_bending", 0, "springback_points",
                                          [[0, 0], [90, 3]], "test bends")
    c = math.cos(2 * math.pi / 3), math.sin(2 * math.pi / 3)
    r = TubeRoute.uniform([(0, 0, 0), (5, 0, 0), (5 + 5 * c[0], 5 * c[1], 0)], 0.75)
    ev = evaluate(project(route=r, settings=Settings(springback_enabled=True)),
                  load_dataset(filled_dir))
    assert "SPRINGBACK_EXTRAPOLATED" in codes(ev)


def test_pj13_unknown_material_and_size():
    """PJ-13 a material or dash size missing from the data is an ERROR, not a crash."""
    ds = load_dataset()
    assert "UNKNOWN_MATERIAL" in codes(evaluate(project(tube=TubeSpec(4, "unobtainium", 0.035)), ds))
    assert "UNKNOWN_SIZE" in codes(evaluate(project(tube=TubeSpec(7, "cres304", 0.035)), ds))


def test_pj14_entered_but_unverified_value_is_used_and_flagged(filled_dir):
    """PJ-14 a value typed into a row that is not yet VERIFIED is used in the check (CLR 0.4 <
    0.6 warns) but is flagged: red banner, UNVERIFIED_DATA warning, not releasable."""
    DataEditor(filled_dir, "t").set_value("as33611_bend_radius", 0, "min_clr", 0.6, "draft")
    ev = evaluate(project(route=ROUTE.with_radius(1, 0.4)), load_dataset(filled_dir))
    r = ev.resolved["min_clr"]
    assert r.value == 0.6 and r.status == Status.UNVERIFIED_STD and r.flagged
    assert "CLR_BELOW_MIN" in codes(ev) and "UNVERIFIED_DATA" in codes(ev)
    assert ev.show_banner and "Minimum CLR: UNVERIFIED – REPLACE FROM STANDARD" in ev.banner_lines
    assert not ev.releasable
