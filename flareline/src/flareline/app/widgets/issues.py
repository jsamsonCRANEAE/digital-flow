"""Red banner, warnings list and the explain panel (formula + inputs for any number)."""
from __future__ import annotations

import html
import math

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (QHeaderView, QLabel, QTextBrowser, QTreeWidget, QTreeWidgetItem,
                               QWidget)

from ...geometry.issues import Severity
from ...project import BANNER_TITLE, Evaluation

SEV_COLOUR = {Severity.ERROR: "#C62828", Severity.WARNING: "#B26A00", Severity.INFO: "#47607A"}
SEV_ORDER = {Severity.ERROR: 0, Severity.WARNING: 1, Severity.INFO: 2}


class Banner(QLabel):
    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.setObjectName("Banner")
        self.setWordWrap(True)
        self.hide()

    def show_evaluation(self, ev: Evaluation) -> None:
        if not ev.show_banner:
            self.hide()
            return
        names = [r.label for r in ev.flagged]
        shown = ", ".join(names[:4]) + (f" and {len(names) - 4} more" if len(names) > 4 else "")
        self.setText(f"⚠  {BANNER_TITLE}  ·  {len(names)} value(s): {shown}")
        self.setToolTip("\n".join(ev.banner_lines))
        self.show()


class IssuesList(QTreeWidget):
    explain = Signal(list)

    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.setColumnCount(4)
        self.setHeaderLabels(["Severity", "Check", "Where", "Message"])
        self.setRootIsDecorated(False)
        self.setAlternatingRowColors(True)
        self.setWordWrap(True)
        h = self.header()
        for i in range(3):
            h.setSectionResizeMode(i, QHeaderView.ResizeToContents)
        h.setSectionResizeMode(3, QHeaderView.Stretch)
        self.currentItemChanged.connect(
            lambda it, _: self.explain.emit(it.data(0, Qt.UserRole) if it else []))

    def show_evaluation(self, ev: Evaluation) -> None:
        self.clear()
        for i in sorted(ev.issues, key=lambda i: SEV_ORDER[i.severity]):
            it = QTreeWidgetItem([i.severity.value.upper(), i.code, i.location, i.message])
            it.setForeground(0, QBrush(QColor(SEV_COLOUR[i.severity])))
            it.setToolTip(3, i.message)
            it.setData(0, Qt.UserRole, list(i.trace_keys))
            self.addTopLevelItem(it)
        if not ev.interference_checked:
            it = QTreeWidgetItem(["…", "CHECKING", "", "self-interference check pending"])
            it.setData(0, Qt.UserRole, [])
            self.addTopLevelItem(it)

    def counts(self, ev: Evaluation) -> dict[Severity, int]:
        out = {s: 0 for s in Severity}
        for i in ev.issues:
            out[i.severity] += 1
        return out


def _fmt(v) -> str:
    if isinstance(v, float):
        return "—" if math.isnan(v) else f"{v:.10g}"
    if isinstance(v, (list, tuple)):
        return "(" + ", ".join(_fmt(x) for x in v) + ")"
    return html.escape(str(v))


class ExplainPanel(QTextBrowser):
    """Shows how a number was produced: formula, inputs (full precision),
    and the source of any data value."""

    def __init__(self, parent: QWidget = None):
        super().__init__(parent)
        self.ev: Evaluation | None = None
        self.keys: list[str] = []
        self.setOpenLinks(False)
        self.show_keys([])

    def set_evaluation(self, ev: Evaluation) -> None:
        self.ev = ev
        self.show_keys(self.keys)

    def show_keys(self, keys: list[str]) -> None:
        self.keys = list(keys)
        if not keys or self.ev is None:
            self.setHtml("<p style='color:#6B7480'>Select a number in the bend table, the 2D "
                         "view or a warning to see the formula and inputs that produced it.</p>")
            return
        parts = []
        for k in keys:
            if k.startswith("resolved:"):
                r = self.ev.resolved.get(k.split(":", 1)[1])
                if r is None:
                    continue
                parts.append(f"<h3>{html.escape(r.label)}</h3><p><b>Value:</b> "
                             f"{_fmt(r.value)} {r.unit}<br><b>Status:</b> {r.status.value}<br>"
                             f"<b>Source:</b> {html.escape(r.describe())}</p>")
                continue
            if k not in self.ev.analysis.traces:
                continue
            t = self.ev.analysis.traces[k]
            rows = "".join(f"<tr><td>{html.escape(n)}</td><td>{_fmt(v)}</td></tr>"
                           for n, v in t.inputs.items())
            parts.append(
                f"<h3>{html.escape(t.description)}</h3>"
                f"<p><b>{html.escape(t.formula)}</b> = {_fmt(t.value)} {t.unit}</p>"
                + (f"<table cellspacing='0' cellpadding='3'>{rows}</table>" if rows else "")
                + f"<p style='color:#6B7480'>key {html.escape(k)} · source: "
                  f"{html.escape(t.source)} · full precision, not rounded</p>")
        self.setHtml("".join(parts) or "<p>No calculation recorded for this cell (it is an input).</p>")
