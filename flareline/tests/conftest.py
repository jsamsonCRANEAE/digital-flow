"""Writes a human-readable test report: pytest --report=docs/TEST_REPORT.md"""
import datetime
import platform

import numpy
import pytest

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
