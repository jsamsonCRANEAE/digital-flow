"""Manufacturability checks against limits.

The limits come from the standards data files (min CLR per AS33611, end
straight for flare tool / nut / sleeve) or from user settings (bender clamp
and die). In Phase 1 they are plain numbers so the checks can be tested on
their own; a limit left as None is not checked and is reported as INFO.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .analysis import RouteAnalysis
from .interference import check_self_interference
from .issues import Issue, Severity
from .springback import SpringbackTable
from .units import fmt_len


@dataclass(frozen=True)
class CheckLimits:
    od: Optional[float] = None
    min_clr: Optional[float] = None
    min_clr_source: str = ""
    min_straight_between_bends: Optional[float] = None  # bender clamp / die
    min_end_straight_end1: Optional[float] = None       # flare tool + nut + sleeve
    min_end_straight_end2: Optional[float] = None
    min_end_straight_source: str = ""
    interference_clearance: float = 0.0


def validate(a: RouteAnalysis, limits: CheckLimits,
             springback: Optional[SpringbackTable] = None) -> list[Issue]:
    issues = list(a.issues)
    if not a.ok:
        return issues
    n_seg = len(a.segments)

    # -- bend radius ------------------------------------------------------------
    for b in a.bends:
        if b.is_zero:
            continue
        loc = f"bend {b.number}"
        if limits.od is not None and b.clr <= limits.od / 2:
            issues.append(Issue(Severity.ERROR, "CLR_LE_HALF_OD",
                                f"CLR {fmt_len(b.clr)} is not more than OD/2 "
                                f"({fmt_len(limits.od / 2)}): not physically possible", loc))
        elif limits.min_clr is not None and b.clr < limits.min_clr:
            src = f" ({limits.min_clr_source})" if limits.min_clr_source else ""
            issues.append(Issue(Severity.WARNING, "CLR_BELOW_MIN",
                                f"CLR {fmt_len(b.clr)} is below the minimum "
                                f"{fmt_len(limits.min_clr)}{src}", loc))

    # -- straights ------------------------------------------------------------
    for sg in a.segments:
        j = sg.index
        key = (f"seg{j}.straight",)
        is_end = j == 0 or j == n_seg - 1
        if n_seg == 1:
            continue  # straight tube: no tangent points
        if sg.straight < -1e-12:
            if is_end:
                end = 1 if j == 0 else 2
                issues.append(Issue(Severity.ERROR, "BEND_PAST_END",
                                    f"bend needs {fmt_len(-sg.straight)} more leg "
                                    f"than is available before end {end}", f"segment {j}", key))
            else:
                issues.append(Issue(Severity.ERROR, "BEND_OVERLAP",
                                    f"bends {j} and {j + 1} overlap by "
                                    f"{fmt_len(-sg.straight)} (tangent points cross)",
                                    f"segment {j}", key))
            continue
        if is_end:
            lim = limits.min_end_straight_end1 if j == 0 else limits.min_end_straight_end2
            if j == 0 and j == n_seg - 1:
                lim = None
            if lim is not None and sg.straight < lim:
                end = 1 if j == 0 else 2
                src = f" ({limits.min_end_straight_source})" if limits.min_end_straight_source else ""
                issues.append(Issue(Severity.WARNING, "END_STRAIGHT_BELOW_MIN",
                                    f"end {end} straight {fmt_len(sg.straight)} is below "
                                    f"the minimum {fmt_len(lim)}{src}", f"segment {j}", key))
        elif (limits.min_straight_between_bends is not None
              and sg.straight < limits.min_straight_between_bends):
            issues.append(Issue(Severity.WARNING, "STRAIGHT_BELOW_MIN",
                                f"straight between bends {j} and {j + 1} is "
                                f"{fmt_len(sg.straight)}, below the bender minimum "
                                f"{fmt_len(limits.min_straight_between_bends)}",
                                f"segment {j}", key))

    # -- interference -----------------------------------------------------------
    if limits.od is None:
        issues.append(Issue(Severity.INFO, "INTERFERENCE_NOT_CHECKED",
                            "tube OD not set; self-interference not checked"))
    else:
        res = check_self_interference(a, limits.od, limits.interference_clearance)
        if not res.checked:
            issues.append(Issue(Severity.INFO, "INTERFERENCE_NOT_CHECKED",
                                f"self-interference not checked: {res.reason}"))
        for c in res.contacts:
            issues.append(Issue(Severity.ERROR, "SELF_INTERFERENCE",
                                f"{c.label_a} and {c.label_b} are {fmt_len(c.distance)} "
                                f"apart on centerline; need at least {fmt_len(res.required)}",
                                f"{c.label_a} / {c.label_b}"))

    # -- springback -------------------------------------------------------------
    if springback is not None and springback.enabled:
        for b in a.bends:
            if not b.is_zero and springback.apply(b.angle_deg).extrapolated:
                issues.append(Issue(Severity.WARNING, "SPRINGBACK_EXTRAPOLATED",
                                    f"bend angle {b.angle_deg:.2f} deg is outside the "
                                    f"springback table; end value held", f"bend {b.number}"))

    # -- missing limits -----------------------------------------------------------
    for name, val in (("minimum CLR", limits.min_clr),
                      ("minimum straight between bends", limits.min_straight_between_bends),
                      ("minimum end straight (end 1)", limits.min_end_straight_end1),
                      ("minimum end straight (end 2)", limits.min_end_straight_end2)):
        if val is None:
            issues.append(Issue(Severity.INFO, "LIMIT_NOT_SET", f"{name} not set; not checked"))
    return issues
