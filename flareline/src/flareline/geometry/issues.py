"""Warnings and errors raised by the geometry engine and validation checks."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Severity(str, Enum):
    ERROR = "error"      # geometry cannot be made / is not physically possible
    WARNING = "warning"  # violates a limit; engineering review required
    INFO = "info"        # worth knowing, not a problem by itself


@dataclass(frozen=True)
class Issue:
    severity: Severity
    code: str
    message: str
    location: str = ""                      # e.g. "bend 2", "segment 0", "end 1"
    trace_keys: tuple[str, ...] = field(default=())

    def __str__(self) -> str:
        loc = f" [{self.location}]" if self.location else ""
        return f"{self.severity.value.upper()} {self.code}{loc}: {self.message}"
