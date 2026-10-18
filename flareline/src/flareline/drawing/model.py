"""Drawing primitives in sheet inches (origin bottom-left, y up).

A Sheet is a flat list of primitives that every backend (PDF, DXF paper
space, PNG) renders the same way. Every Text that shows a number carries a
`ref`: the trace key, resolved-input name or project field it came from, so
the calculation record can list it and tests can prove nothing is untraced.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

Pt = tuple[float, float]

# layers double as DXF layer names
L_BORDER, L_TUBE, L_CENTER, L_TEXT, L_TABLE, L_WATERMARK, L_CONSTR = (
    "BORDER", "TUBE", "CENTERLINE", "TEXT", "TABLES", "WATERMARK", "CONSTRUCTION")


@dataclass(frozen=True)
class Line:
    a: Pt
    b: Pt
    width: float = 0.01      # inches
    layer: str = L_BORDER
    dash: Optional[tuple[float, ...]] = None   # inches on/off
    color: str = "#000000"


@dataclass(frozen=True)
class Polyline:
    points: tuple[Pt, ...]
    width: float = 0.01
    layer: str = L_TUBE
    dash: Optional[tuple[float, ...]] = None
    color: str = "#000000"
    closed: bool = False


@dataclass(frozen=True)
class Circle:
    center: Pt
    radius: float
    width: float = 0.01
    layer: str = L_CENTER
    fill: Optional[str] = None
    color: str = "#000000"


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float
    width: float = 0.01
    layer: str = L_BORDER
    fill: Optional[str] = None
    color: str = "#000000"


@dataclass(frozen=True)
class Text:
    pos: Pt
    text: str
    height: float = 0.1      # cap height in inches
    anchor: str = "left"     # left | center | right
    bold: bool = False
    layer: str = L_TEXT
    rotation: float = 0.0    # degrees
    color: str = "#000000"
    ref: str = ""            # where the number(s) in this text come from


@dataclass
class Sheet:
    width: float
    height: float
    size: str                # "A" | "B" | "D"
    items: list = field(default_factory=list)
    number: int = 1
    of: int = 1

    def add(self, *items) -> None:
        self.items.extend(items)

    def texts(self) -> list[Text]:
        return [i for i in self.items if isinstance(i, Text)]


PAPER = {"A": (11.0, 8.5), "B": (17.0, 11.0), "D": (34.0, 22.0)}   # landscape, inches
