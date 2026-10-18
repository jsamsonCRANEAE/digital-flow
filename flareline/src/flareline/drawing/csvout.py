"""CSV bend table: full double precision (repr), one row per point.

Header lines start with '#' and carry the part, data set fingerprint, units,
conventions and the release status, so a CSV can't be mistaken for a
released table.
"""
from __future__ import annotations

import csv
import datetime
from pathlib import Path

from .. import __version__
from ..geometry.formats import route_to_lra
from ..project import Evaluation
from .layout import release_reasons

COLUMNS = ["point", "x_in", "y_in", "z_in", "clr_in", "bend_deg", "rotation_deg",
           "straight_to_next_in", "leg_to_next_in", "mark_start_in", "mark_end_in"]


def write_csv(ev: Evaluation, path: Path | str) -> None:
    p, a = ev.project, ev.analysis
    conv = p.settings.rotation_convention
    lra = route_to_lra(a) if a.ok else None
    reasons = release_reasons(ev)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(f"# FlareLine {__version__} bend table; exported "
                 f"{datetime.date.today().isoformat()}\n")
        fh.write(f"# part {p.meta.get('part_number', '')} rev {p.meta.get('revision', '')}\n")
        fh.write(f"# data set {ev.dataset_version} sha256 {ev.dataset_sha256}\n")
        fh.write(f"# units: inches, degrees; full precision (not rounded). Z up. "
                 f"rotation {conv.label}; bend 1 rotation from reference plane\n")
        fh.write("# status: " + ("RELEASABLE" if ev.releasable else
                                  "NOT FOR FABRICATION - " + "; ".join(reasons)) + "\n")
        if a.ok:
            fh.write(f"# developed_in {a.developed_length!r}; cut_in {a.cut_length!r}"
                     f"{'' if ev.cut_length_complete else ' (INCOMPLETE: end allowance missing)'}\n")
        w = csv.writer(fh)
        w.writerow(COLUMNS)
        n = len(p.route.points)
        for i, pt in enumerate(p.route.points):
            interior = 0 < i < n - 1
            row = [f"P{i}", *(repr(float(c)) for c in pt),
                   repr(p.route.radii[i - 1]) if interior else ""]
            if a.ok and interior:
                b = a.bend(i)
                row += [repr(b.angle_deg),
                        repr(conv.to_display(lra.steps[i - 1].rotation_deg))]
            else:
                row += ["", ""]
            if a.ok and i < n - 1:
                row += [repr(a.segments[i].straight), repr(a.segments[i].leg)]
            else:
                row += ["", ""]
            if a.ok and interior:
                row += [repr(a.bend(i).mark_start), repr(a.bend(i).mark_end)]
            else:
                row += ["", ""]
            w.writerow(row)
