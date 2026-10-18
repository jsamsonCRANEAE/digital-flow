"""One call from a project + data set to everything the UI shows: resolved
inputs with provenance, the bend analysis, every warning, and the red banner."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional

from ..data.store import Dataset
from ..geometry.analysis import DevelopmentOptions, RouteAnalysis, TubeSection, analyze
from ..geometry.interference import Contact, check_self_interference
from ..geometry.issues import Issue, Severity
from ..geometry.springback import SpringbackTable
from ..geometry.validation import CheckLimits, validate
from .model import Project
from .resolve import Resolved, resolve

BANNER_TITLE = "UNVERIFIED OR MISSING DATA IN USE – NOT FOR FABRICATION"


@dataclass(frozen=True)
class Evaluation:
    project: Project
    dataset_version: str
    dataset_sha256: str
    resolved: Mapping[str, Resolved]
    analysis: RouteAnalysis
    issues: tuple[Issue, ...]
    cut_length_complete: bool
    interference_checked: bool = True
    contacts: tuple[Contact, ...] = ()

    @property
    def flagged(self) -> list[Resolved]:
        return [r for r in self.resolved.values() if r.flagged]

    @property
    def show_banner(self) -> bool:
        return bool(self.flagged)

    @property
    def banner_lines(self) -> list[str]:
        return [f"{r.label}: {'MISSING' if r.missing else r.status.value}" for r in self.flagged]

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == Severity.ERROR]

    @property
    def releasable(self) -> bool:
        """A final (non-watermarked) drawing needs no errors, no flagged data
        and, for image-derived geometry, every dimension confirmed."""
        image_ok = self.project.route_origin != "image" or self.project.image_confirmed
        return (self.analysis.ok and self.interference_checked and not self.errors
                and not self.flagged and image_ok)


def _num(r: Optional[Resolved]) -> Optional[float]:
    return None if r is None or r.missing else float(r.value)


def evaluate(project: Project, ds: Dataset, audit=None,
             check_interference: bool = True) -> Evaluation:
    res, issues = resolve(project, ds)
    od, wall = _num(res.get("od")), _num(res.get("wall"))
    fa1, fa2 = _num(res.get("end1.allowance")), _num(res.get("end2.allowance"))
    factor = _num(res.get("arc_length_factor"))
    adjust = _num(res.get("per_bend_adjust"))

    options = DevelopmentOptions(
        arc_length_factor=1.0 if factor is None else factor,
        per_bend_adjust=0.0 if adjust is None else adjust,
        end1_allowance=fa1 or 0.0, end2_allowance=fa2 or 0.0,
        end1_allowance_source=res["end1.allowance"].describe(),
        end2_allowance_source=res["end2.allowance"].describe())
    section = TubeSection(od, wall) if od is not None and wall is not None else None
    analysis = analyze(project.route, options, section)

    complete = fa1 is not None and fa2 is not None
    for n, fa in ((1, fa1), (2, fa2)):
        if fa is None:
            issues.append(Issue(Severity.WARNING, "CUT_LENGTH_INCOMPLETE",
                                f"cut length excludes the end {n} allowance (no value)",
                                f"end {n}", (f"end{n}.allowance",)))

    sb = None
    sbr = res.get("springback_points")
    if sbr is not None and not sbr.missing:
        sb = SpringbackTable(tuple(tuple(p) for p in sbr.value), enabled=True,
                             source=sbr.describe())

    limits = CheckLimits(
        od=od, min_clr=_num(res.get("min_clr")),
        min_clr_source=res["min_clr"].source,
        min_straight_between_bends=_num(res.get("min_straight_between_bends")),
        min_end_straight_end1=_num(res.get("end1.min_straight")),
        min_end_straight_end2=_num(res.get("end2.min_straight")),
        min_end_straight_source=res["end1.min_straight"].source,
        interference_clearance=project.settings.interference_clearance,
        check_interference=check_interference)
    inter = None
    if check_interference and od is not None and analysis.ok:
        inter = check_self_interference(analysis, od, project.settings.interference_clearance)
    # LIMIT_NOT_SET duplicates the MISSING_DATA warnings above, which also say why
    issues += [i for i in validate(analysis, limits, sb, inter) if i.code != "LIMIT_NOT_SET"]

    ev = Evaluation(project, ds.version, ds.sha256, res, analysis, tuple(issues), complete,
                    check_interference, inter.contacts if inter else ())
    if audit is not None:
        audit.record(ev)
    return ev
