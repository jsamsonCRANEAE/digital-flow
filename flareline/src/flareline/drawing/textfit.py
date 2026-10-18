"""Text measuring and wrapping with Helvetica metrics (what the PDF uses).

Text size is the font size in inches. Characters outside Windows-1252 (what
the PDF base fonts can show) are replaced so nothing silently disappears.
"""
from __future__ import annotations

from reportlab.pdfbase.pdfmetrics import stringWidth

REPLACE = {"θ": "theta", "Σ": "sum", "→": "->", "≈": "~", "≤": "<=", "≥": ">=", "×": "x",
           "·": "-"}


def safe(s: str) -> str:
    for a, b in REPLACE.items():
        s = s.replace(a, b)
    return s.encode("cp1252", errors="replace").decode("cp1252")


def text_width(s: str, size_in: float, bold: bool = False) -> float:
    font = "Helvetica-Bold" if bold else "Helvetica"
    return stringWidth(safe(s), font, size_in * 72) / 72


def wrap(s: str, size_in: float, width_in: float, bold: bool = False) -> list[str]:
    words, lines, cur = safe(s).split(" "), [], ""
    for w in words:
        trial = f"{cur} {w}" if cur else w
        if text_width(trial, size_in, bold) <= width_in or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:  # hard-break anything still too long (e.g. hashes)
        while text_width(ln, size_in, bold) > width_in and len(ln) > 1:
            cut = len(ln)
            while cut > 1 and text_width(ln[:cut], size_in, bold) > width_in:
                cut -= 1
            out.append(ln[:cut])
            ln = ln[cut:]
        out.append(ln)
    return out or [""]
