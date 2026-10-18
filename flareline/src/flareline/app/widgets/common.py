"""Small shared widgets."""
from __future__ import annotations

import math
from typing import Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QFrame, QLabel, QLineEdit, QVBoxLayout, QWidget

from ...data.schema import Status
from ...geometry.units import from_mm, to_mm


def to_display(inches: float, unit: str) -> float:
    return to_mm(inches) if unit == "mm" else inches


def from_display(value: float, unit: str) -> float:
    return from_mm(value) if unit == "mm" else value


def fmt_num(value: Optional[float], places: int = 4) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    return f"{value:.{places}f}"


def parse_number(text: str) -> Optional[float]:
    try:
        v = float(text.strip().replace(",", "."))
    except ValueError:
        return None
    return v if math.isfinite(v) else None


class NumberField(QLineEdit):
    """Length / number entry that commits on Enter or focus-out. Shows the
    display unit; emits the value converted back to inches, unrounded."""
    committed = Signal(float)

    def __init__(self, tooltip: str, unit_kind: str = "length", parent: QWidget = None):
        super().__init__(parent)
        self.unit_kind = unit_kind        # "length" | "angle" | "plain"
        self.unit = "in"
        self._value: Optional[float] = None
        self.setToolTip(tooltip)
        self.editingFinished.connect(self._commit)

    def set_value(self, inches: Optional[float], unit: str = "in") -> None:
        self.unit = unit
        self._value = inches
        if inches is None:
            self.setText("")
        elif self.unit_kind == "length":
            self.setText(fmt_num(to_display(inches, unit)))
        elif self.unit_kind == "angle":
            self.setText(fmt_num(inches, 2))
        else:
            self.setText(repr(inches))

    def _commit(self) -> None:
        v = parse_number(self.text())
        if v is None:
            self.set_value(self._value, self.unit)  # revert bad input
            return
        if self.unit_kind == "length":
            v = from_display(v, self.unit)
        # unchanged text must not create an undo step or lose precision
        if self._value is not None and self.text() == self._shown(self._value):
            return
        self._value = v
        self.committed.emit(v)

    def _shown(self, inches: float) -> str:
        if self.unit_kind == "length":
            return fmt_num(to_display(inches, self.unit))
        if self.unit_kind == "angle":
            return fmt_num(inches, 2)
        return repr(inches)


STATUS_STYLE = {
    "ok": ("#1E7D32", "#E3F3E5"),
    "default": ("#47607A", "#E6EDF4"),
    "user": ("#5B3FA8", "#EDE7FB"),
    "bad": ("#FFFFFF", "#C62828"),
}


def status_kind(status: Status, missing: bool) -> str:
    if missing or not status.trusted:
        return "bad"
    if status == Status.USER_INPUT:
        return "user"
    if status == Status.DEFAULT:
        return "default"
    return "ok"


class Chip(QLabel):
    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.setObjectName("Chip")
        self.setAlignment(Qt.AlignCenter)

    def set_status(self, status: Status, missing: bool, tooltip: str = "") -> None:
        kind = status_kind(status, missing)
        fg, bg = STATUS_STYLE[kind]
        text = "MISSING" if missing else {"bad": "UNVERIFIED", "user": "USER INPUT",
                                          "default": "DEFAULT"}.get(kind, status.value)
        self.setText(text)
        self.setStyleSheet(f"color: {fg}; background: {bg};")
        self.setToolTip(tooltip)


def card(title: str = "", parent: QWidget = None) -> tuple[QFrame, QVBoxLayout]:
    f = QFrame(parent)
    f.setObjectName("Card")
    lay = QVBoxLayout(f)
    lay.setContentsMargins(14, 12, 14, 12)
    lay.setSpacing(8)
    if title:
        h = QLabel(title)
        h.setObjectName("H2")
        lay.addWidget(h)
    return f, lay


def muted(text: str) -> QLabel:
    lab = QLabel(text)
    lab.setObjectName("Muted")
    lab.setWordWrap(True)
    return lab
