"""Project model and its JSON file format.

A project holds design inputs only: the tube spec, end types, route, settings
and any user overrides of data-file values. Everything else is recalculated
from these plus the data set. Floats are written with repr() precision, so
save -> load reproduces every value bit for bit.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Mapping, Optional

from ..geometry.formats import RotationConvention
from ..geometry.route import TubeRoute

FORMAT = "flareline-project"
SCHEMA_VERSION = 1
END_TYPES = ("flare37", "plain", "flareless")
END_TYPE_LABELS = {"flare37": "37° single flare", "plain": "Plain / cut",
                   "flareless": "Flareless (placeholder)"}


class ProjectError(ValueError):
    pass


@dataclass(frozen=True)
class TubeSpec:
    dash: int = 4
    material_id: str = "cres304"
    wall: Optional[float] = None
    wall_from_data: bool = False   # True: picked from the tube_walls table


@dataclass(frozen=True)
class Override:
    """A user-entered value replacing a data-file value, with the reason."""
    value: Any
    reason: str
    entered_by: str = ""
    date: str = ""


@dataclass(frozen=True)
class Settings:
    rotation_direction: str = "CW"
    rotation_viewpoint: str = "toward_end2"
    display_unit: str = "in"            # "in" | "mm"
    springback_enabled: bool = False
    interference_clearance: float = 0.0
    audit_log: bool = False

    @property
    def rotation_convention(self) -> RotationConvention:
        return RotationConvention(self.rotation_direction, self.rotation_viewpoint)


@dataclass(frozen=True)
class Project:
    tube: TubeSpec = TubeSpec()
    end1: str = "flare37"
    end2: str = "flare37"
    route: TubeRoute = TubeRoute(((0.0, 0.0, 0.0), (10.0, 0.0, 0.0)), ())
    route_origin: str = "manual"        # "manual" | "image"
    image_confirmed: bool = False       # every image-derived dimension confirmed
    settings: Settings = Settings()
    overrides: Mapping[str, Override] = field(default_factory=dict)
    meta: Mapping[str, str] = field(default_factory=dict)  # part number, title, ...

    def __post_init__(self) -> None:
        for end in (self.end1, self.end2):
            if end not in END_TYPES:
                raise ProjectError(f"unknown end type {end!r}")
        if self.route_origin not in ("manual", "image"):
            raise ProjectError(f"unknown route origin {self.route_origin!r}")
        self.settings.rotation_convention  # validates the convention

    def with_route(self, route: TubeRoute) -> "Project":
        return replace(self, route=route)


# -- JSON ------------------------------------------------------------------------

def to_json(p: Project) -> dict:
    s = p.settings
    return {
        "format": FORMAT,
        "schema_version": SCHEMA_VERSION,
        "meta": dict(p.meta),
        "tube": {"dash": p.tube.dash, "material_id": p.tube.material_id,
                 "wall": p.tube.wall, "wall_from_data": p.tube.wall_from_data},
        "ends": {"end1": p.end1, "end2": p.end2},
        "route": {"points": [list(pt) for pt in p.route.points],
                  "clr": list(p.route.radii),
                  "origin": p.route_origin, "image_confirmed": p.image_confirmed},
        "settings": {"rotation_direction": s.rotation_direction,
                     "rotation_viewpoint": s.rotation_viewpoint,
                     "display_unit": s.display_unit,
                     "springback_enabled": s.springback_enabled,
                     "interference_clearance": s.interference_clearance,
                     "audit_log": s.audit_log},
        "overrides": {k: {"value": o.value, "reason": o.reason,
                          "entered_by": o.entered_by, "date": o.date}
                      for k, o in p.overrides.items()},
    }


def from_json(doc: Mapping[str, Any]) -> Project:
    if doc.get("format") != FORMAT:
        raise ProjectError("not a FlareLine project file")
    ver = doc.get("schema_version")
    if not isinstance(ver, int):
        raise ProjectError("project file has no schema version")
    if ver > SCHEMA_VERSION:
        raise ProjectError(f"project file schema {ver} is newer than this app "
                           f"supports ({SCHEMA_VERSION}); update FlareLine")
    try:
        t, r, st = doc["tube"], doc["route"], doc.get("settings", {})
        return Project(
            tube=TubeSpec(int(t["dash"]), str(t["material_id"]),
                          None if t.get("wall") is None else float(t["wall"]),
                          bool(t.get("wall_from_data", False))),
            end1=doc["ends"]["end1"], end2=doc["ends"]["end2"],
            route=TubeRoute(tuple(tuple(pt) for pt in r["points"]), tuple(r["clr"])),
            route_origin=r.get("origin", "manual"),
            image_confirmed=bool(r.get("image_confirmed", False)),
            settings=Settings(**{k: st[k] for k in Settings.__dataclass_fields__ if k in st}),
            overrides={k: Override(o["value"], o.get("reason", ""), o.get("entered_by", ""),
                                   o.get("date", ""))
                       for k, o in doc.get("overrides", {}).items()},
            meta={str(k): str(v) for k, v in doc.get("meta", {}).items()},
        )
    except (KeyError, TypeError) as e:
        raise ProjectError(f"project file is incomplete or malformed: {e}") from None


def save(p: Project, path: Path | str) -> None:
    Path(path).write_text(json.dumps(to_json(p), indent=2, ensure_ascii=False) + "\n",
                          encoding="utf-8")


def load(path: Path | str) -> Project:
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ProjectError(f"project file is not valid JSON: {e}") from None
    return from_json(doc)
