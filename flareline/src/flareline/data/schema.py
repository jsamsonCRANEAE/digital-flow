"""Standards / shop data tables: format, provenance and validation.

Every table is one JSON file:

    {
      "schema": "flareline-table/1",
      "table": "<name>",            # must match the file name
      "title": "...", "standard": "SAE AS33611", "supersedes": "MS33611",
      "key_fields": ["dash", "material_id"],      # required in every row key
      "optional_key_fields": ["wall"],            # null in a row = applies to any
      "fields": {"min_clr": {"kind": "number", "unit": "in",
                             "required": true, "description": "..."}},
      "meta": {...},                              # table-level text, e.g. definitions
      "rows": [{"key": {...}, "values": {...}, "provenance": {...}}]
    }

Provenance per row: standard, revision, table_ref, date_entered, entered_by,
status, basis. A row may only be VERIFIED when revision, table_ref,
date_entered and entered_by are filled in and every required value is set.
"""
from __future__ import annotations

import datetime
import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional

TABLE_SCHEMA = "flareline-table/1"
MANIFEST_SCHEMA = "flareline-data/1"


class DataError(ValueError):
    """A data file is malformed or breaks a provenance rule."""


class Status(str, Enum):
    VERIFIED = "VERIFIED"                                    # entered from a licensed source
    DERIVED = "DERIVED"                                      # follows from a definition (basis given)
    DEFAULT = "DEFAULT"                                      # neutral default, e.g. no correction
    UNVERIFIED_STD = "UNVERIFIED – REPLACE FROM STANDARD"
    UNVERIFIED_SHOP = "UNVERIFIED – REPLACE FROM SHOP DATA"
    USER_INPUT = "USER INPUT"                                # project-level value or override
    MISSING = "MISSING"                                      # resolution found no value

    @property
    def trusted(self) -> bool:
        return self in (Status.VERIFIED, Status.DERIVED, Status.DEFAULT, Status.USER_INPUT)


FILE_STATUSES = {Status.VERIFIED, Status.DERIVED, Status.DEFAULT,
                 Status.UNVERIFIED_STD, Status.UNVERIFIED_SHOP}
KINDS = {"number", "numbers", "points", "text", "bool"}


@dataclass(frozen=True)
class Provenance:
    status: Status
    standard: Optional[str] = None
    revision: Optional[str] = None
    table_ref: Optional[str] = None
    date_entered: Optional[str] = None
    entered_by: Optional[str] = None
    basis: Optional[str] = None

    def describe(self) -> str:
        parts = [self.standard or "(no source)"]
        parts.append(f"rev {self.revision}" if self.revision else "rev ?")
        if self.table_ref:
            parts.append(self.table_ref)
        if self.basis:
            parts.append(f"basis: {self.basis}")
        return ", ".join(parts)

    def to_json(self) -> dict:
        return {"status": self.status.value, "standard": self.standard,
                "revision": self.revision, "table_ref": self.table_ref,
                "date_entered": self.date_entered, "entered_by": self.entered_by,
                "basis": self.basis}


@dataclass(frozen=True)
class FieldDef:
    name: str
    kind: str
    unit: str
    required: bool
    description: str


@dataclass(frozen=True)
class Row:
    index: int
    key: Mapping[str, Any]
    values: Mapping[str, Any]
    provenance: Provenance

    def key_text(self) -> str:
        return ", ".join(f"{k}={_key_display(k, v)}" for k, v in self.key.items())


def _key_display(k: str, v: Any) -> str:
    if v is None:
        return "any"
    if k == "dash":
        return f"-{v}"
    return str(v)


@dataclass(frozen=True)
class Table:
    name: str
    title: str
    standard: Optional[str]
    supersedes: Optional[str]
    key_fields: tuple[str, ...]
    optional_key_fields: tuple[str, ...]
    fields: Mapping[str, FieldDef]
    meta: Mapping[str, Any]
    rows: tuple[Row, ...]
    sha256: str = ""
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def lookup(self, **key) -> Optional[Row]:
        """Most specific row matching `key`. Optional key fields that are null in
        a row match anything; a row naming the value beats a row that does not."""
        best, best_score = None, -1
        for row in self.rows:
            if any(row.key.get(k) != key.get(k) for k in self.key_fields):
                continue
            score, ok = 0, True
            for k in self.optional_key_fields:
                rv = row.key.get(k)
                if rv is None:
                    continue
                if not _key_equal(rv, key.get(k)):
                    ok = False
                    break
                score += 1
            if ok and score > best_score:
                best, best_score = row, score
        return best


def _key_equal(a: Any, b: Any) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        try:
            return b is not None and math.isclose(float(a), float(b), abs_tol=1e-9)
        except (TypeError, ValueError):
            return False
    return a == b


# -- parsing / validation ------------------------------------------------------

def _err(where: str, msg: str) -> DataError:
    return DataError(f"{where}: {msg}")


def _check_value(where: str, fd: FieldDef, v: Any) -> None:
    if v is None:
        return
    num = (int, float)
    if fd.kind == "number":
        if isinstance(v, bool) or not isinstance(v, num) or not math.isfinite(v):
            raise _err(where, f"{fd.name} must be a number or null")
    elif fd.kind == "numbers":
        if not isinstance(v, list) or not all(
                isinstance(x, num) and not isinstance(x, bool) for x in v):
            raise _err(where, f"{fd.name} must be a list of numbers")
    elif fd.kind == "points":
        if not isinstance(v, list) or not all(
                isinstance(p, list) and len(p) == 2 and
                all(isinstance(x, num) and not isinstance(x, bool) for x in p) for p in v):
            raise _err(where, f"{fd.name} must be a list of [x, y] pairs")
    elif fd.kind == "text":
        if not isinstance(v, str):
            raise _err(where, f"{fd.name} must be text or null")
    elif fd.kind == "bool":
        if not isinstance(v, bool):
            raise _err(where, f"{fd.name} must be true, false or null")


def _is_set(v: Any) -> bool:
    return v is not None and v != [] and v != ""


def parse_provenance(where: str, p: Mapping[str, Any], fields: Mapping[str, FieldDef],
                     values: Mapping[str, Any]) -> Provenance:
    try:
        status = Status(p.get("status"))
    except ValueError:
        raise _err(where, f"unknown provenance status {p.get('status')!r}") from None
    if status not in FILE_STATUSES:
        raise _err(where, f"status {status.value!r} is not allowed in a data file")
    prov = Provenance(status, p.get("standard"), p.get("revision"), p.get("table_ref"),
                      p.get("date_entered"), p.get("entered_by"), p.get("basis"))
    if prov.date_entered is not None:
        try:
            datetime.date.fromisoformat(prov.date_entered)
        except ValueError:
            raise _err(where, "date_entered must be YYYY-MM-DD") from None
    if status == Status.VERIFIED:
        missing = [n for n in ("standard", "revision", "table_ref", "date_entered", "entered_by")
                   if not getattr(prov, n)]
        missing += [f.name for f in fields.values() if f.required and not _is_set(values.get(f.name))]
        if missing:
            raise _err(where, "VERIFIED row is missing: " + ", ".join(missing))
    if status in (Status.DERIVED, Status.DEFAULT) and not prov.basis:
        raise _err(where, f"{status.value} row needs a basis")
    return prov


def parse_table(doc: Mapping[str, Any], expected_name: str, sha256: str = "") -> Table:
    where = f"{expected_name}.json"
    if doc.get("schema") != TABLE_SCHEMA:
        raise _err(where, f"schema must be {TABLE_SCHEMA!r}")
    if doc.get("table") != expected_name:
        raise _err(where, f"table name {doc.get('table')!r} does not match the file name")
    key_fields = tuple(doc.get("key_fields", ()))
    opt_fields = tuple(doc.get("optional_key_fields", ()))
    fields: dict[str, FieldDef] = {}
    for name, fd in doc.get("fields", {}).items():
        if fd.get("kind") not in KINDS:
            raise _err(where, f"field {name} has unknown kind {fd.get('kind')!r}")
        fields[name] = FieldDef(name, fd["kind"], fd.get("unit", "-"),
                                bool(fd.get("required", False)), fd.get("description", ""))
    rows, seen = [], set()
    for i, r in enumerate(doc.get("rows", [])):
        rw = f"{where} row {i}"
        key = dict(r.get("key", {}))
        for k in key_fields:
            if key.get(k) is None:
                raise _err(rw, f"key field {k} is required")
        unknown = set(key) - set(key_fields) - set(opt_fields)
        if unknown:
            raise _err(rw, f"unknown key fields {sorted(unknown)}")
        for k in opt_fields:
            key.setdefault(k, None)
        values = dict(r.get("values", {}))
        unknown = set(values) - set(fields)
        if unknown:
            raise _err(rw, f"unknown value fields {sorted(unknown)}")
        for name, fd in fields.items():
            values.setdefault(name, None)
            _check_value(rw, fd, values[name])
        ident = tuple((k, key[k]) for k in key_fields + opt_fields)
        if ident in seen:
            raise _err(rw, "duplicate key")
        seen.add(ident)
        prov = parse_provenance(rw, r.get("provenance", {}), fields, values)
        rows.append(Row(i, key, values, prov))
    return Table(expected_name, doc.get("title", expected_name), doc.get("standard"),
                 doc.get("supersedes"), key_fields, opt_fields, fields,
                 dict(doc.get("meta", {})), tuple(rows), sha256, doc)
