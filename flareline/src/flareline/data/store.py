"""Loading the data set, hashing it, and editing it with a change log.

A data set is a directory holding dataset.json (the manifest) plus one JSON
file per table. The SHA-256 of every file and of the whole set are computed
on load; the set hash is printed on drawings so a drawing can be tied to the
exact data that produced it.

The app never edits data files in place silently: DataEditor writes the file
atomically and appends a record to CHANGELOG.jsonl (who, when, why, before,
after, file hashes).
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import os
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, Mapping, Optional

from .schema import MANIFEST_SCHEMA, DataError, Status, Table, parse_table

REQUIRED_TABLES = ("tube_sizes", "materials", "tube_walls", "as4330_flare",
                   "as33611_bend_radius", "j514_reference", "shop_limits", "shop_bending")
CHANGELOG = "CHANGELOG.jsonl"


def default_data_dir() -> Path:
    return Path(str(resources.files("flareline.data") / "defaults"))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Dataset:
    directory: Path
    version: str
    description: str
    tables: Mapping[str, Table]
    sha256: str              # hash over every table file, in manifest order

    def table(self, name: str) -> Table:
        return self.tables[name]

    @property
    def short_hash(self) -> str:
        return self.sha256[:12]


def load_dataset(directory: Optional[Path | str] = None) -> Dataset:
    d = Path(directory) if directory is not None else default_data_dir()
    manifest_path = d / "dataset.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise DataError(f"{manifest_path}: data set manifest not found") from None
    except json.JSONDecodeError as e:
        raise DataError(f"{manifest_path}: not valid JSON ({e})") from None
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise DataError(f"dataset.json: schema must be {MANIFEST_SCHEMA!r}")
    names = list(manifest.get("tables", []))
    missing = [t for t in REQUIRED_TABLES if t not in names]
    if missing:
        raise DataError(f"dataset.json: required tables missing: {missing}")
    tables: dict[str, Table] = {}
    set_hash = hashlib.sha256()
    for name in names:
        path = d / f"{name}.json"
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            raise DataError(f"{path}: table file not found") from None
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise DataError(f"{path.name}: not valid JSON ({e})") from None
        file_hash = _sha256(raw)
        set_hash.update(f"{name}:{file_hash}\n".encode())
        tables[name] = parse_table(doc, name, file_hash)
    return Dataset(d, str(manifest.get("dataset_version", "?")),
                   str(manifest.get("description", "")), tables, set_hash.hexdigest())


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


class DataEditor:
    """Edits one data set directory. Every change is validated, written
    atomically and logged; an edit that would leave an invalid table is refused
    and nothing is written."""

    def __init__(self, directory: Path | str, user: str):
        if not user.strip():
            raise ValueError("an editor needs a user name for the change log")
        self.directory = Path(directory)
        self.user = user

    def _load(self, table: str) -> tuple[dict, bytes]:
        raw = (self.directory / f"{table}.json").read_bytes()
        return json.loads(raw.decode("utf-8")), raw

    def _write(self, table: str, doc: dict, before_raw: bytes, change: dict) -> None:
        new_raw = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        parse_table(doc, table)  # refuse to write anything invalid
        path = self.directory / f"{table}.json"
        tmp = path.with_suffix(".json.tmp")
        tmp.write_bytes(new_raw)
        os.replace(tmp, path)
        record = {"time_utc": _now(), "user": self.user, "table": table,
                  "sha256_before": _sha256(before_raw), "sha256_after": _sha256(new_raw),
                  **change}
        with open(self.directory / CHANGELOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _row(self, doc: dict, index: int) -> dict:
        rows = doc.get("rows", [])
        if not 0 <= index < len(rows):
            raise IndexError(f"row {index} out of range")
        return rows[index]

    def set_value(self, table: str, row: int, field: str, value: Any, reason: str) -> None:
        """Change one value. The row drops back to UNVERIFIED (from standard or
        shop, matching the table) unless it is re-verified."""
        doc, raw = self._load(table)
        before = copy.deepcopy(self._row(doc, row))
        r = self._row(doc, row)
        if field not in doc.get("fields", {}):
            raise KeyError(f"{table} has no field {field!r}")
        r.setdefault("values", {})[field] = value
        prov = r.setdefault("provenance", {})
        if prov.get("status") == Status.VERIFIED.value:
            prov["status"] = (Status.UNVERIFIED_SHOP if table.startswith("shop_")
                              else Status.UNVERIFIED_STD).value
        self._write(table, doc, raw, {"action": "set_value", "row": row, "field": field,
                                      "reason": reason, "before": before, "after": r})

    def mark_verified(self, table: str, row: int, *, standard: str, revision: str,
                      table_ref: str, date_entered: str, reason: str) -> None:
        """Record the source and mark a row VERIFIED. Refused unless every
        required value is filled in."""
        doc, raw = self._load(table)
        before = copy.deepcopy(self._row(doc, row))
        r = self._row(doc, row)
        r["provenance"] = {"status": Status.VERIFIED.value, "standard": standard,
                           "revision": revision, "table_ref": table_ref,
                           "date_entered": date_entered, "entered_by": self.user,
                           "basis": r.get("provenance", {}).get("basis")}
        self._write(table, doc, raw, {"action": "mark_verified", "row": row,
                                      "reason": reason, "before": before, "after": r})


    def set_meta(self, table: str, key: str, text: str, *, verified: bool, reason: str) -> None:
        """Edit a table note (e.g. the flare end-point definition). Verifying a note
        records who and when; an empty note cannot be verified."""
        doc, raw = self._load(table)
        meta = doc.setdefault("meta", {})
        if key not in meta:
            raise KeyError(f"{table} has no note {key!r}")
        before = copy.deepcopy(meta[key])
        text = text.strip() or None
        if verified and not text:
            raise DataError(f"{table} note {key}: an empty note cannot be verified")
        meta[key]["text"] = text
        if verified:
            meta[key].update(status=Status.VERIFIED.value, entered_by=self.user,
                             date_entered=datetime.date.today().isoformat())
        else:
            meta[key]["status"] = (Status.UNVERIFIED_SHOP if table.startswith("shop_")
                                   else Status.UNVERIFIED_STD).value
        self._write(table, doc, raw, {"action": "set_meta", "key": key, "reason": reason,
                                      "before": before, "after": meta[key]})


def read_changelog(directory: Path | str) -> list[dict]:
    path = Path(directory) / CHANGELOG
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
