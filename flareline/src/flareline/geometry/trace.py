"""Calculation traceability.

Every number the engine produces is recorded as a Trace: its value, the
formula used and the inputs that went into it. The GUI shows these when a
dimension is clicked; the audit log writes them out verbatim.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator, Mapping, Union

InputValue = Union[float, int, str, tuple]


@dataclass(frozen=True)
class Trace:
    key: str
    value: float
    unit: str  # "in", "deg", "rad" or "-"
    formula: str
    inputs: Mapping[str, InputValue]
    description: str
    source: str = "calculated"  # "calculated" | "user input" | "data file"

    def to_record(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "unit": self.unit,
            "formula": self.formula,
            "inputs": {k: _plain(v) for k, v in self.inputs.items()},
            "description": self.description,
            "source": self.source,
        }


def _plain(v: InputValue):
    if isinstance(v, tuple):
        return [float(x) for x in v]
    return v


@dataclass
class TraceBook:
    _items: dict[str, Trace] = field(default_factory=dict)

    def add(self, key: str, value: float, unit: str, formula: str,
            inputs: Mapping[str, InputValue], description: str,
            source: str = "calculated") -> float:
        self._items[key] = Trace(key, float(value), unit, formula, dict(inputs),
                                 description, source)
        return float(value)

    def __getitem__(self, key: str) -> Trace:
        return self._items[key]

    def __contains__(self, key: str) -> bool:
        return key in self._items

    def __iter__(self) -> Iterator[Trace]:
        return iter(self._items.values())

    def __len__(self) -> int:
        return len(self._items)

    def to_records(self) -> list[dict]:
        return [t.to_record() for t in self._items.values()]
