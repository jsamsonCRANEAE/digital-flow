"""Live 2D orthographic view (top / front / side) with clickable dimensions.

Same viewpoints as the 3D view buttons: Front shows X right / Z up (looking
along +Y), Top shows X right / Y up (looking down -Z), Side shows Y right /
Z up (looking along -X). Leg lengths and bend callouts are true 3D values,
not projected lengths, and are labelled as such.
"""
from __future__ import annotations

import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QComboBox, QGraphicsItem, QGraphicsScene, QGraphicsSimpleTextItem,
                               QGraphicsView, QHBoxLayout, QLabel, QVBoxLayout, QWidget)

from ...geometry.centerline import sample_centerline
from ...project import Evaluation
from .common import fmt_num, to_display

PROJECTIONS = {
    "Top (X-Y)": ((1, 0, 0), (0, 1, 0)),
    "Front (X-Z)": ((1, 0, 0), (0, 0, 1)),
    "Side (Y-Z)": ((0, 1, 0), (0, 0, 1)),
}


class _Label(QGraphicsSimpleTextItem):
    def __init__(self, text: str, keys: list[str], on_click, colour: QColor, bold=False):
        super().__init__(text)
        self.keys, self.on_click = keys, on_click
        self.setFlag(QGraphicsItem.ItemIgnoresTransformations)
        f = QFont()
        f.setPointSizeF(8.5)
        f.setBold(bold)
        self.setFont(f)
        self.setBrush(colour)
        if keys:
            self.setCursor(Qt.PointingHandCursor)
            self.setToolTip("Click to see how this was calculated")

    def mousePressEvent(self, e):  # noqa: N802 (Qt naming)
        if self.keys:
            self.on_click(self.keys)
        super().mousePressEvent(e)


class View2D(QWidget):
    explain = Signal(list)

    def __init__(self, tokens, parent: QWidget = None):
        super().__init__(parent)
        self.tokens = tokens
        self.ev: Evaluation | None = None
        bar = QHBoxLayout()
        title = QLabel("2D")
        title.setObjectName("H2")
        bar.addWidget(title)
        bar.addStretch(1)
        self.proj = QComboBox()
        self.proj.addItems(list(PROJECTIONS))
        self.proj.setToolTip("Orthographic projection shown")
        self.proj.currentIndexChanged.connect(lambda _: self.ev and self.show_evaluation(self.ev))
        bar.addWidget(self.proj)

        self.scene = QGraphicsScene(self)
        self.view = _ZoomView(self.scene)
        self.view.setRenderHint(QPainter.Antialiasing)
        self.note = QLabel("Dimensions are true 3D lengths, not projected. Click one to see "
                           "its formula.")
        self.note.setObjectName("Muted")
        self.note.setWordWrap(True)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(bar)
        lay.addWidget(self.view, 1)
        lay.addWidget(self.note)

    def set_projection(self, name: str) -> None:
        self.proj.setCurrentText(name)

    def show_evaluation(self, ev: Evaluation) -> None:
        self.ev = ev
        t = self.tokens
        self.scene.clear()
        self.scene.setBackgroundBrush(QColor(t.view_bg))
        h, v = (np.array(a, dtype=float) for a in PROJECTIONS[self.proj.currentText()])

        def to2(p) -> QPointF:
            p = np.asarray(p, dtype=float)
            return QPointF(float(p @ h), -float(p @ v))   # screen y grows downward

        a, unit = ev.analysis, ev.project.settings.display_unit
        pts = ev.project.route.points
        od_r = ev.resolved.get("od")
        od = 0.25 if od_r is None or od_r.missing else float(od_r.value)
        click = self.explain.emit

        # tube outline (true arcs) and centerline
        if a.ok and all(s.straight >= -1e-9 for s in a.segments):
            cl = sample_centerline(a, max_piece=1e9, max_chord_deg=3.0).points  # arcs only
        else:
            cl = np.array(pts, dtype=float)
        path = QPainterPath(to2(cl[0]))
        for p in cl[1:]:
            path.lineTo(to2(p))
        tube_pen = QPen(QColor(t.tube))
        tube_pen.setWidthF(od)
        tube_pen.setCapStyle(Qt.FlatCap)
        tube_pen.setJoinStyle(Qt.RoundJoin)
        tube_item = self.scene.addPath(path, tube_pen)
        tube_item.setOpacity(0.45)
        cl_pen = QPen(QColor(t.centerline if a.ok else t.error))
        cl_pen.setCosmetic(True)
        cl_pen.setWidthF(1.4)
        self.scene.addPath(path, cl_pen)

        # construction legs between intersection points
        leg_pen = QPen(QColor(t.text_muted))
        leg_pen.setCosmetic(True)
        leg_pen.setStyle(Qt.DashLine)
        legs = QPainterPath(to2(pts[0]))
        for p in pts[1:]:
            legs.lineTo(to2(p))
        self.scene.addPath(legs, leg_pen)

        text_col, accent = QColor(t.text), QColor(t.accent)
        r_px = 3.5
        for i, p in enumerate(pts):
            q = to2(p)
            dot = self.scene.addEllipse(QRectF(-r_px, -r_px, 2 * r_px, 2 * r_px),
                                        QPen(Qt.NoPen), accent)
            dot.setFlag(QGraphicsItem.ItemIgnoresTransformations)
            dot.setPos(q)
            lab = _Label(f"P{i}", [], click, text_col, bold=True)
            lab.setPos(q)
            self.scene.addItem(lab)
            if a.ok and 0 < i < len(pts) - 1:
                b = a.bend(i)
                txt = f"B{i} {b.angle_deg:.2f}° R{fmt_num(to_display(b.clr, unit))}"
                bl = _Label(txt, [f"bend{i}.angle_deg", f"bend{i}.angle", f"bend{i}.tangent", f"bend{i}.arc"],
                            click, accent)
                bl.setPos(q)
                self.scene.addItem(bl)
                _offset(bl, 0, 14)
        if a.ok:
            for s in a.segments:
                mid = (np.asarray(pts[s.index], float) + np.asarray(pts[s.index + 1], float)) / 2
                lab = _Label(f"L{s.index} {fmt_num(to_display(s.leg, unit))}",
                             [f"seg{s.index}.leg", f"seg{s.index}.straight"], click, text_col)
                lab.setPos(to2(mid))
                self.scene.addItem(lab)
                _offset(lab, 4, -16)
        summary = (f"{'Developed' if a.ok else 'Geometry error'}"
                   + (f" {fmt_num(to_display(a.developed_length, unit))} {unit}" if a.ok else ""))
        self.note.setText(f"{summary} · dimensions are true 3D lengths, not projected · "
                          f"click one to see its formula")
        # fit to the geometry only: screen-size labels report huge scene rects
        geo = path.boundingRect().united(legs.boundingRect())
        m = od / 2
        self.view.set_geometry_rect(geo.adjusted(-m, -m, m, m))


def _offset(item: QGraphicsItem, dx_px: float, dy_px: float) -> None:
    """Shift a transformation-ignoring label by screen pixels."""
    item.setTransform(item.transform().translate(dx_px, dy_px))


class _ZoomView(QGraphicsView):
    def __init__(self, scene):
        super().__init__(scene)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self._user_zoomed = False
        self._geo = QRectF()

    def wheelEvent(self, e):  # noqa: N802
        f = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
        self.scale(f, f)
        self._user_zoomed = True


    def mouseDoubleClickEvent(self, e):  # noqa: N802
        self._user_zoomed = False
        self.fit()

    def set_geometry_rect(self, rect: QRectF) -> None:
        self._geo = rect
        self.fit()

    def resizeEvent(self, e):  # noqa: N802
        super().resizeEvent(e)
        self.fit()

    def fit(self) -> None:
        rect = self._geo
        if self._user_zoomed or (rect.width() == 0 and rect.height() == 0):
            return
        # room for labels: 15% margin plus a minimum so a straight tube still shows
        m = max(rect.width(), rect.height()) * 0.15 + 0.5
        self.fitInView(rect.adjusted(-m, -m, m, m), Qt.KeepAspectRatio)
