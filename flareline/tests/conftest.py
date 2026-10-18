"""Writes a human-readable test report: pytest --report=docs/TEST_REPORT.md"""
import datetime
import platform

import json
import shutil

import numpy
import pytest

from flareline.data import DataEditor, default_data_dir

_rows: list[tuple[str, str, str]] = []


def pytest_addoption(parser):
    parser.addoption("--report", default=None, help="write a Markdown test report here")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call" or (rep.when == "setup" and rep.outcome != "passed"):
        doc = (item.function.__doc__ or "").strip().replace("\n", " ")
        doc = " ".join(doc.split())
        param = f" `[{item.callspec.id}]`" if hasattr(item, "callspec") else ""
        _rows.append((item.module.__name__, doc + param, rep.outcome.upper()))


def pytest_sessionfinish(session, exitstatus):
    path = session.config.getoption("--report")
    if not path:
        return
    passed = sum(r[2] == "PASSED" for r in _rows)
    lines = [
        "# FlareLine geometry engine: test report",
        "",
        f"- Date (UTC): {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M}",
        f"- Python {platform.python_version()} on {platform.system()} {platform.machine()}, "
        f"numpy {numpy.__version__}, pytest {pytest.__version__}",
        f"- Result: **{passed} / {len(_rows)} passed**",
        "",
        "Each case states its hand calculation in the description. Expected values in the",
        "tests are literals or closed forms (e.g. tan 22.5 = sqrt2 - 1), not engine output.",
        "",
        "| # | Module | Case (hand calculation) | Result |",
        "|---|--------|-------------------------|--------|",
    ]
    for n, (mod, doc, res) in enumerate(_rows, 1):
        lines.append(f"| {n} | {mod.removeprefix('test_')} | {doc.replace('|', '/')} | {res} |")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


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
