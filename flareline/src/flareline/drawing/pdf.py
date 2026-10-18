"""PDF backend (ReportLab). One page per sheet, vector, base-14 fonts only."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfgen.canvas import Canvas

from .. import __version__
from .model import Circle, Line, Polyline, Rect, Sheet, Text
from .textfit import safe

PT = 72.0


def write_pdf(sheets: list[Sheet], path: Path | str, title: str = "") -> None:
    first = sheets[0]
    c = Canvas(str(path), pagesize=(first.width * PT, first.height * PT), invariant=1)
    c.setTitle(title or "FlareLine drawing")
    c.setCreator(f"FlareLine {__version__}")
    c.setAuthor("")
    for sheet in sheets:
        c.setPageSize((sheet.width * PT, sheet.height * PT))
        for item in sheet.items:
            _draw(c, item)
        c.showPage()
    c.save()


def _stroke(c: Canvas, item) -> None:
    c.setStrokeColor(HexColor(item.color))
    c.setLineWidth(max(item.width * PT, 0.1))
    dash = getattr(item, "dash", None)
    c.setDash([d * PT for d in dash] if dash else [])


def _draw(c: Canvas, it) -> None:
    if isinstance(it, Line):
        _stroke(c, it)
        c.setLineCap(0)
        c.line(it.a[0] * PT, it.a[1] * PT, it.b[0] * PT, it.b[1] * PT)
    elif isinstance(it, Polyline):
        if len(it.points) < 2:
            return
        _stroke(c, it)
        c.setLineCap(1)
        c.setLineJoin(1)
        p = c.beginPath()
        p.moveTo(it.points[0][0] * PT, it.points[0][1] * PT)
        for x, y in it.points[1:]:
            p.lineTo(x * PT, y * PT)
        if it.closed:
            p.close()
        c.drawPath(p, stroke=1, fill=0)
    elif isinstance(it, Rect):
        _stroke(c, it)
        if it.fill:
            c.setFillColor(HexColor(it.fill))
        c.rect(it.x * PT, it.y * PT, it.w * PT, it.h * PT, stroke=1, fill=1 if it.fill else 0)
    elif isinstance(it, Circle):
        _stroke(c, it)
        if it.fill:
            c.setFillColor(HexColor(it.fill))
        c.circle(it.center[0] * PT, it.center[1] * PT, it.radius * PT, stroke=1,
                 fill=1 if it.fill else 0)
    elif isinstance(it, Text):
        c.saveState()
        c.setFillColor(HexColor(it.color))
        if it.layer == "WATERMARK" and it.height > 0.5:
            c.setFillAlpha(0.18)
        c.setFont("Helvetica-Bold" if it.bold else "Helvetica", it.height * PT)
        c.translate(it.pos[0] * PT, it.pos[1] * PT)
        if it.rotation:
            c.rotate(it.rotation)
        s = safe(it.text)
        {"left": c.drawString, "center": c.drawCentredString,
         "right": c.drawRightString}[it.anchor](0, 0, s)
        c.restoreState()
