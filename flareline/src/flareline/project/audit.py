"""Optional audit log: one JSON line per evaluation with every resolved input
(value, status, source), every calculated value (formula + inputs) and every
issue, tied to the project content and data set hashes. Local file only."""
from __future__ import annotations

import datetime
import getpass
import hashlib
import json
from pathlib import Path

from .. import __version__
from .model import to_json


class AuditLog:
    def __init__(self, path: Path | str, user: str | None = None):
        self.path = Path(path)
        self.user = user if user is not None else _user()

    def record(self, ev, event: str = "evaluate") -> dict:
        project_json = json.dumps(to_json(ev.project), sort_keys=True)
        rec = {
            "time_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "event": event,
            "user": self.user,
            "app_version": __version__,
            "project_sha256": hashlib.sha256(project_json.encode()).hexdigest(),
            "dataset_version": ev.dataset_version,
            "dataset_sha256": ev.dataset_sha256,
            "inputs": {k: {"value": r.value, "unit": r.unit, "status": r.status.value,
                           "source": r.describe()} for k, r in ev.resolved.items()},
            "calculations": ev.analysis.traces.to_records(),
            "issues": [{"severity": i.severity.value, "code": i.code, "message": i.message,
                        "location": i.location} for i in ev.issues],
        }
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return rec


def _user() -> str:
    try:
        return getpass.getuser()
    except Exception:  # no login name available (service accounts, some containers)
        return "unknown"


def read_audit_log(path: Path | str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line]
