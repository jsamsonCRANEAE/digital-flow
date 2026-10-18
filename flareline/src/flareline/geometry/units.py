"""Units and display formatting.

The model is always inches (float64). Rounding happens only here, at display.
"""
from __future__ import annotations

MM_PER_INCH = 25.4  # exact by definition
LINEAR_PLACES = 4
ANGLE_PLACES = 2


def to_mm(inches: float) -> float:
    return inches * MM_PER_INCH


def from_mm(mm: float) -> float:
    return mm / MM_PER_INCH


def fmt_len(inches: float, unit: str = "in", places: int = LINEAR_PLACES) -> str:
    if unit == "mm":
        return f"{to_mm(inches):.{places}f} mm"
    if unit == "in":
        return f"{inches:.{places}f} in"
    raise ValueError(f"unknown unit {unit!r}")


def fmt_angle(degrees: float, places: int = ANGLE_PLACES) -> str:
    return f"{degrees:.{places}f}°"
