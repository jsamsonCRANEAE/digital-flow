"""Small, explicit 3D vector helpers (double precision, no rounding).

All functions take and return numpy float64 arrays of shape (3,).
"""
from __future__ import annotations

import math

import numpy as np

# Lengths below this (inches) are treated as zero. Far below any
# manufacturing tolerance, far above float64 noise for tube-sized numbers.
EPS_LENGTH = 1e-9
# Angles below this (radians) are treated as zero.
EPS_ANGLE = 1e-9

X_AXIS = np.array([1.0, 0.0, 0.0])
Y_AXIS = np.array([0.0, 1.0, 0.0])
Z_AXIS = np.array([0.0, 0.0, 1.0])


def vec(x: float, y: float, z: float) -> np.ndarray:
    return np.array([x, y, z], dtype=np.float64)


def as_vec(p) -> np.ndarray:
    return np.asarray(p, dtype=np.float64).reshape(3)


def norm(v: np.ndarray) -> float:
    return float(math.sqrt(float(v @ v)))


def unit(v: np.ndarray) -> np.ndarray:
    n = norm(v)
    if n < EPS_LENGTH:
        raise ValueError("cannot normalise a zero-length vector")
    return v / n


def angle_between(u: np.ndarray, v: np.ndarray) -> float:
    """Unsigned angle in [0, pi]. atan2 form stays accurate near 0 and pi,
    where acos(u.v) loses precision."""
    return math.atan2(norm(np.cross(u, v)), float(u @ v))


def signed_angle(a: np.ndarray, b: np.ndarray, axis: np.ndarray) -> float:
    """Angle from a to b about `axis` by the right-hand rule, in (-pi, pi].

    a and b are expected to be perpendicular to axis."""
    ang = math.atan2(float(np.cross(a, b) @ axis), float(a @ b))
    return normalize_angle(ang)


def normalize_angle(ang: float) -> float:
    """Wrap to (-pi, pi]; an exact half turn is reported as +pi."""
    ang = math.remainder(ang, 2.0 * math.pi)
    if ang <= -math.pi + 1e-12:
        ang = math.pi
    return ang


def rotate(v: np.ndarray, axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues rotation of v about unit `axis` by `angle` (right-hand rule)."""
    k = unit(axis)
    c, s = math.cos(angle), math.sin(angle)
    return v * c + np.cross(k, v) * s + k * float(k @ v) * (1.0 - c)


def perpendicular_reference(d: np.ndarray) -> np.ndarray:
    """Reference bend-plane normal for a leg direction d (Z-up convention).

    +Z projected perpendicular to d; if d is vertical, +Y is used instead.
    """
    for ref in (Z_AXIS, Y_AXIS):
        p = ref - d * float(ref @ d)
        if norm(p) > 1e-6:
            return unit(p)
    raise ValueError("no perpendicular reference found")  # unreachable for unit d
