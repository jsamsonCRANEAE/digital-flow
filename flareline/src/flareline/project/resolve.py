"""Resolve every value a project needs from the data set (or a user override),
keeping where each one came from.

A value is *flagged* when it is missing or its row is UNVERIFIED. Flagged
values that the calculation actually uses drive the red banner and the
UNVERIFIED-DATA warnings; drawings with flagged values cannot be released.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from ..data.schema import Row, Status, Table
from ..data.store import Dataset
from ..geometry.issues import Issue, Severity
from .model import END_TYPE_LABELS, Project

OVERRIDABLE = {
    "min_clr": ("Minimum CLR", "in"),
    "min_straight_between_bends": ("Minimum straight between bends", "in"),
    "end1.allowance": ("End 1 allowance", "in"),
    "end2.allowance": ("End 2 allowance", "in"),
    "end1.min_straight": ("End 1 minimum straight", "in"),
    "end2.min_straight": ("End 2 minimum straight", "in"),
    "arc_length_factor": ("Arc length factor", "-"),
    "per_bend_adjust": ("Per-bend length adjust", "in"),
    "springback_points": ("Springback table", "deg"),
}


@dataclass(frozen=True)
class Resolved:
    name: str
    label: str
    value: Any
    unit: str
    status: Status
    source: str      # human-readable: standard, revision, table, or the override reason
    ref: str = ""    # data location: "<table> row <n>: <key>"

    @property
    def missing(self) -> bool:
        return self.value is None or self.value == []

    @property
    def flagged(self) -> bool:
        return self.missing or not self.status.trusted

    def describe(self) -> str:
        where = f" [{self.ref}]" if self.ref else ""
        return f"{self.source}{where}"


def _key_text(key: dict) -> str:
    return ", ".join(f"{k}={'-' + str(v) if k == 'dash' else v}" for k, v in key.items())


def _from_table(name: str, label: str, unit: str, table: Table, field: str,
                **key) -> Resolved:
    row: Optional[Row] = table.lookup(**key)
    if row is None:
        return Resolved(name, label, None, unit, Status.MISSING,
                        f"{table.title}: no row for {_key_text(key)}", table.name)
    ref = f"{table.name} row {row.index}: {row.key_text()}"
    value = row.values.get(field)
    status = row.provenance.status
    if value is None or value == []:
        return Resolved(name, label, None, unit, Status.MISSING,
                        f"{row.provenance.describe()} ({status.value}; value not entered)", ref)
    return Resolved(name, label, value, unit, status, row.provenance.describe(), ref)


def _user(name: str, label: str, unit: str, value: Any, reason: str) -> Resolved:
    return Resolved(name, label, value, unit, Status.USER_INPUT, f"user input: {reason}")


def resolve(project: Project, ds: Dataset) -> tuple[dict[str, Resolved], list[Issue]]:
    t = project.tube
    issues: list[Issue] = []
    res: dict[str, Resolved] = {}
    mat_key = dict(dash=t.dash, material_id=t.material_id, wall=t.wall)

    # tube OD
    res["od"] = _from_table("od", "Tube OD", "in", ds.table("tube_sizes"), "od", dash=t.dash)
    if res["od"].status == Status.MISSING:
        issues.append(Issue(Severity.ERROR, "UNKNOWN_SIZE",
                            f"dash size -{t.dash} is not in the tube size table"))

    # material
    mat_row = ds.table("materials").lookup(material_id=t.material_id)
    if mat_row is None:
        issues.append(Issue(Severity.ERROR, "UNKNOWN_MATERIAL",
                            f"material {t.material_id!r} is not in the materials table"))
    else:
        res["material_spec"] = _from_table("material_spec", "Material specification", "-",
                                           ds.table("materials"), "material_spec",
                                           material_id=t.material_id)

    # wall
    if t.wall is None:
        issues.append(Issue(Severity.WARNING, "WALL_NOT_SET", "tube wall thickness not set"))
    elif t.wall_from_data:
        r = _from_table("wall", "Wall", "in", ds.table("tube_walls"), "walls",
                        dash=t.dash, material_id=t.material_id)
        if r.missing or not any(abs(w - t.wall) < 1e-9 for w in r.value):
            issues.append(Issue(Severity.WARNING, "WALL_NOT_IN_DATA",
                                f"wall {t.wall} is not in the wall table for this size/material"))
            res["wall"] = Resolved("wall", "Wall", t.wall, "in", Status.MISSING,
                                   "wall picked from data but not found there", r.ref)
        else:
            res["wall"] = Resolved("wall", "Wall", t.wall, "in", r.status, r.source, r.ref)
    else:
        res["wall"] = _user("wall", "Wall", "in", t.wall, "wall entered in project")

    # bend radius limit
    res["min_clr"] = _from_table("min_clr", "Minimum CLR", "in",
                                 ds.table("as33611_bend_radius"), "min_clr", **mat_key)
    res["min_straight_between_bends"] = _from_table(
        "min_straight_between_bends", "Minimum straight between bends", "in",
        ds.table("shop_limits"), "min_straight_between_bends",
        dash=t.dash, material_id=t.material_id)

    # ends
    for n, end in ((1, project.end1), (2, project.end2)):
        a_name, s_name = f"end{n}.allowance", f"end{n}.min_straight"
        a_label, s_label = f"End {n} allowance", f"End {n} minimum straight"
        if end == "flare37":
            res[a_name] = _from_table(a_name, a_label, "in", ds.table("as4330_flare"),
                                      "end_allowance", **mat_key)
            res[s_name] = _from_table(s_name, s_label, "in", ds.table("shop_limits"),
                                      "min_end_straight_flare37",
                                      dash=t.dash, material_id=t.material_id)
        elif end == "plain":
            res[a_name] = Resolved(a_name, a_label, 0.0, "in", Status.DERIVED,
                                   "plain cut end: no forming allowance")
            res[s_name] = _from_table(s_name, s_label, "in", ds.table("shop_limits"),
                                      "min_end_straight_plain",
                                      dash=t.dash, material_id=t.material_id)
        else:  # flareless placeholder
            issues.append(Issue(Severity.INFO, "FLARELESS_PLACEHOLDER",
                                f"end {n} is a flareless placeholder: allowance and "
                                f"fitting geometry are not modelled", f"end {n}"))
            res[a_name] = Resolved(a_name, a_label, None, "in", Status.MISSING,
                                   "flareless end allowance not modelled")
            res[s_name] = _from_table(s_name, s_label, "in", ds.table("shop_limits"),
                                      "min_end_straight_flareless",
                                      dash=t.dash, material_id=t.material_id)

    if "flare37" in (project.end1, project.end2):
        meta = ds.table("as4330_flare").meta.get("end_point_definition", {})
        text = meta.get("text")
        res["end_point_definition"] = Resolved(
            "end_point_definition", "End point definition (on flare)", text, "-",
            Status(meta.get("status", Status.UNVERIFIED_STD.value)) if text else Status.MISSING,
            "SAE AS4330 data file, table note", "as4330_flare meta")
        if mat_row is not None:
            permitted = mat_row.values.get("flaring_permitted")
            if permitted is None:
                issues.append(Issue(Severity.WARNING, "FLARING_NOT_CONFIRMED",
                                    f"flaring of {mat_row.values.get('name')} is not "
                                    f"confirmed in the materials table"))
            elif permitted is False:
                issues.append(Issue(Severity.ERROR, "FLARING_NOT_PERMITTED",
                                    f"the materials table says {mat_row.values.get('name')} "
                                    f"may not be flared"))

    # length correction and springback
    bend = ds.table("shop_bending")
    for name, label, unit in (("arc_length_factor", "Arc length factor", "-"),
                              ("per_bend_adjust", "Per-bend length adjust", "in")):
        res[name] = _from_table(name, label, unit, bend, name,
                                material_id=t.material_id, dash=t.dash)
    if project.settings.springback_enabled:
        res["springback_points"] = _from_table("springback_points", "Springback table", "deg",
                                               bend, "springback_points",
                                               material_id=t.material_id, dash=t.dash)

    # user overrides win, and are always visible
    for name, ov in project.overrides.items():
        if name not in OVERRIDABLE:
            issues.append(Issue(Severity.WARNING, "UNKNOWN_OVERRIDE",
                                f"override {name!r} is not a recognised value; ignored"))
            continue
        label, unit = OVERRIDABLE[name]
        if name == "springback_points" and not project.settings.springback_enabled:
            continue
        res[name] = _user(name, label, unit, ov.value, ov.reason or "no reason given")
        issues.append(Issue(Severity.INFO, "USER_OVERRIDE",
                            f"{label} = {ov.value} entered by user"
                            f"{' (' + ov.entered_by + ')' if ov.entered_by else ''}: "
                            f"{ov.reason or 'no reason given'}"))

    # provenance findings
    for r in res.values():
        if r.missing:
            issues.append(Issue(Severity.WARNING, "MISSING_DATA",
                                f"{r.label}: no value. {r.describe()}"))
        elif not r.status.trusted:
            issues.append(Issue(Severity.WARNING, "UNVERIFIED_DATA",
                                f"{r.label} = {r.value} is {r.status.value}. {r.describe()}"))
        elif r.status == Status.DEFAULT:
            issues.append(Issue(Severity.INFO, "DEFAULT_DATA",
                                f"{r.label} = {r.value} is a default ({r.source})"))

    if project.route_origin == "image" and not project.image_confirmed:
        issues.append(Issue(Severity.WARNING, "IMAGE_APPROXIMATE",
                            "APPROXIMATE – FROM IMAGE: confirm every dimension before release"))
    return res, issues


def end_label(end: str) -> str:
    return END_TYPE_LABELS[end]
