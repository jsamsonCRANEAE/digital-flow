"""In-app How-to panel."""
from PySide6.QtWidgets import QTextBrowser

HOWTO = """
<h2>How to use FlareLine</h2>
<p><b>Design aid only.</b> All geometry must be verified and approved per your organization's
engineering and quality process before fabrication.</p>
<h3>1 · Tube spec</h3>
<p>Pick the dash size, material and wall. The chips show where each value came from:
<span style='color:#1E7D32'>VERIFIED</span>, <span style='color:#5B3FA8'>USER INPUT</span>,
<span style='color:#47607A'>DEFAULT</span>, or
<span style='color:#C62828'>UNVERIFIED / MISSING</span>. A red banner stays up while any
unverified or missing value is in use.</p>
<h3>2 · Ends</h3>
<p>37° flare, plain/cut, or flareless (placeholder). The end point sits at the flare, and the
allowance (stock from the end point to the cut end) is added to the cut length.</p>
<h3>3 · Route &amp; bends</h3>
<p>Edit the bend table at the bottom. <b>XYZ</b>: intersection points (Z up, P0 = end 1).
<b>LRA</b>: Y = straight between tangent points, B = rotation, C = bend angle.
<b>Legs</b>: point-to-point lengths. All three stay in sync. Shaded cells are calculated.</p>
<h3>4 · Check</h3>
<p>Errors (red) mean the tube cannot be made as drawn: overlapping bends, a bend running past
the end, a radius at or below OD/2, or the tube touching itself. Warnings (amber) mean a limit
or a data value needs attention.</p>
<h3>Explain any number</h3>
<p>Select a cell in the table, a dimension in the 2D view, or a warning. The Explain tab shows
the formula and the full-precision inputs that produced it.</p>
<h3>Standards data</h3>
<p>Tools → Standards &amp; shop data (Ctrl+D): enter values, give a reason, then
<b>Mark row verified</b> with the standard, revision, table and date. Every change is logged.</p>
<h3>Bend marks</h3>
<p>The LRA table's <b>Marks from P0</b> column gives the start and end of each bend along the
developed tube, from the P0 end point.</p>
<h3>Views</h3>
<p>3D: drag to orbit, middle-drag or Shift-drag to pan, wheel or right-drag to zoom. <b>F</b> fit,
<b>0</b> iso, <b>1</b> front, <b>2</b> top, <b>3</b> right, <b>M</b> measure,
<b>S</b> section. 2D: wheel to zoom, drag to pan, double-click to fit.</p>
<h3>Keys</h3>
<p>Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+Z undo · Ctrl+Y redo ·
Ctrl+L add leg · Ctrl+D standards data · Ctrl+1…5 wizard steps · F1 this panel ·
Esc closes dialogs. Full guide: docs/USER_GUIDE.md.</p>
<h3>Files</h3>
<p>Projects are readable JSON (<code>.flareline.json</code>). Autosave runs every minute
while there are unsaved changes. Nothing leaves this computer: FlareLine makes no network
calls.</p>
"""


class HowTo(QTextBrowser):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setHtml(HOWTO)
