"""PNG backend: renders sheet 1 with Qt's painter (needs PySide6)."""
from __future__ import annotations

from pathlib import Path

from .model import Circle, Line, Polyline, Rect, Sheet, Text
from .textfit import safe

_APP = None


def write_png(sheet: Sheet, path: Path | str, dpi: int = 150) -> tuple[int, int]:
    from PySide6.QtCore import QPointF, QRectF, Qt
    from PySide6.QtGui import (QColor, QFont, QGuiApplication, QImage, QPainter, QPainterPath,
                               QPen)
    global _APP
    if QGuiApplication.instance() is None:   # allow use outside the app
        import os

        from PySide6.QtWidgets import QApplication
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        # a full QApplication, so widgets still work if the app starts later
        _APP = QApplication([])              # kept alive for the process
    w, h = round(sheet.width * dpi), round(sheet.height * dpi)
    img = QImage(w, h, QImage.Format_RGB32)
    img.fill(QColor("#FFFFFF"))
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.TextAntialiasing)

    def pt(x, y):
        return QPointF(x * dpi, (sheet.height - y) * dpi)

    def pen(it):
        pe = QPen(QColor(it.color))
        pe.setWidthF(max(it.width * dpi, 0.6))
        dash = getattr(it, "dash", None)
        if dash:
            pe.setDashPattern([max(d / max(it.width, 1e-3), 0.5) for d in dash])
        pe.setCapStyle(Qt.RoundCap if isinstance(it, Polyline) else Qt.FlatCap)
        pe.setJoinStyle(Qt.RoundJoin)
        return pe

    for it in sheet.items:
        if isinstance(it, Line):
            p.setPen(pen(it))
            p.drawLine(pt(*it.a), pt(*it.b))
        elif isinstance(it, Polyline) and len(it.points) >= 2:
            p.setPen(pen(it))
            pp = QPainterPath(pt(*it.points[0]))
            for q in it.points[1:]:
                pp.lineTo(pt(*q))
            p.setBrush(Qt.NoBrush)
            p.drawPath(pp)
        elif isinstance(it, Rect):
            p.setPen(pen(it))
            p.setBrush(QColor(it.fill) if it.fill else Qt.NoBrush)
            p.drawRect(QRectF(pt(it.x, it.y + it.h), pt(it.x + it.w, it.y)))
        elif isinstance(it, Circle):
            p.setPen(pen(it))
            p.setBrush(QColor(it.fill) if it.fill else Qt.NoBrush)
            p.drawEllipse(pt(*it.center), it.radius * dpi, it.radius * dpi)
        elif isinstance(it, Text):
            f = QFont(["Helvetica", "Arial", "DejaVu Sans"])
            f.setPixelSize(max(round(it.height * dpi), 1))
            f.setBold(it.bold)
            p.setFont(f)
            colour = QColor(it.color)
            if it.layer == "WATERMARK" and it.height > 0.5:
                colour.setAlphaF(0.18)
            p.setPen(colour)
            p.save()
            p.translate(pt(*it.pos))
            p.rotate(-it.rotation)
            s = safe(it.text)
            tw = p.fontMetrics().horizontalAdvance(s)
            dx = {"left": 0, "center": -tw / 2, "right": -tw}[it.anchor]
            p.drawText(QPointF(dx, 0), s)
            p.restore()
    p.end()
    if not img.save(str(path), "PNG"):
        raise OSError(f"could not write {path}")
    return w, h
