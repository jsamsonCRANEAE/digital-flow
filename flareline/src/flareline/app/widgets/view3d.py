"""Live 3D view: hollow tube (OD and wall), centerline, vertices, contacts.

Standard views for Z up: Front looks along +Y, Top looks down -Z, Right looks
along -X. The section toggle cuts the tube on the plane through its center
normal to Y, showing the wall.
"""
from __future__ import annotations

import os

import numpy as np
from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QToolButton, QVBoxLayout, QWidget

from ...geometry.centerline import sample_centerline
from ...project import Evaluation

try:  # 3D is optional: the app still works (2D, table, checks) without OpenGL
    if os.environ.get("FLARELINE_NO_3D"):
        raise ImportError("3D disabled by FLARELINE_NO_3D")
    import pyvista as pv
    from pyvistaqt import QtInteractor
    pv.global_theme.allow_empty_mesh = True   # persistent actors start empty
    HAVE_3D = True
except Exception as _e:  # noqa: BLE001 - any VTK/GL import failure
    HAVE_3D = False
    _WHY = str(_e)


class View3D(QWidget):
    measured = Signal(float)

    def __init__(self, tokens, parent: QWidget = None):
        super().__init__(parent)
        self.tokens = tokens
        self.ev: Evaluation | None = None
        self.section = False
        self._measure_pts: list[np.ndarray] = []

        bar = QHBoxLayout()
        title = QLabel("3D")
        title.setObjectName("H2")
        bar.addWidget(title)
        bar.addStretch(1)
        self.buttons: dict[str, QToolButton] = {}
        for name, tip in (("Fit", "Fit the tube in view (F)"), ("Iso", "Isometric view (0)"),
                          ("Front", "Front view, looking along +Y (1)"),
                          ("Top", "Top view, looking down -Z (2)"),
                          ("Right", "Right view, looking along -X (3)"),
                          ("Measure", "Click two points on the tube to measure (M)"),
                          ("Section", "Cut the tube to show the wall (S)")):
            b = QToolButton(text=name)
            b.setToolTip(tip)
            b.setCheckable(name in ("Measure", "Section"))
            bar.addWidget(b)
            self.buttons[name] = b
        self.readout = QLabel()
        self.readout.setObjectName("Muted")

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(bar)
        if HAVE_3D:
            self.plotter = QtInteractor(self)
            self.plotter.set_background(tokens.view_bg)
            self.plotter.add_axes(line_width=2, labels_off=False)
            lay.addWidget(self.plotter.interactor, 1)
            self.buttons["Fit"].clicked.connect(self.fit)
            self.buttons["Iso"].clicked.connect(lambda: self.view("iso"))
            self.buttons["Front"].clicked.connect(lambda: self.view("front"))
            self.buttons["Top"].clicked.connect(lambda: self.view("top"))
            self.buttons["Right"].clicked.connect(lambda: self.view("right"))
            self.buttons["Section"].toggled.connect(self._toggle_section)
            self.buttons["Measure"].toggled.connect(self._toggle_measure)
            self._first = True
            self._data: dict = {}
            self._actors: dict = {}
            self._labels = None
            self._label_prop = None
        else:
            self.plotter = None
            msg = QLabel(f"3D view unavailable on this machine ({_WHY}).\n"
                         "2D view, bend table and all checks still work.")
            msg.setWordWrap(True)
            lay.addWidget(msg, 1)
            for b in self.buttons.values():
                b.setEnabled(False)
        lay.addWidget(self.readout)

    # -- views --------------------------------------------------------------------
    def fit(self) -> None:
        if self.plotter:
            self.plotter.reset_camera()
            self.plotter.render()

    def view(self, which: str) -> None:
        if not self.plotter:
            return
        {"iso": self.plotter.view_isometric,
         # view_vector places the camera on that side, so it looks the opposite way
         "front": lambda: self.plotter.view_vector((0, -1, 0), viewup=(0, 0, 1)),
         "top": lambda: self.plotter.view_vector((0, 0, 1), viewup=(0, 1, 0)),
         "right": lambda: self.plotter.view_vector((1, 0, 0), viewup=(0, 0, 1))}[which]()
        self.plotter.reset_camera()
        self.plotter.render()

    def _toggle_section(self, on: bool) -> None:
        self.section = on
        if self.ev:
            self.show_evaluation(self.ev)

    def _toggle_measure(self, on: bool) -> None:
        self._measure_pts = []
        if on:
            self.plotter.enable_point_picking(callback=self._picked, show_message=False,
                                              left_clicking=True, show_point=True,
                                              color=self.tokens.accent)
            self.readout.setText("Measure: click two points on the tube")
        else:
            self.plotter.disable_picking()
            self.plotter.remove_actor("measure", render=True)
            self.readout.setText("")

    def _picked(self, point) -> None:
        if point is None:
            return
        self._measure_pts.append(np.asarray(point, dtype=float))
        if len(self._measure_pts) == 2:
            a, b = self._measure_pts
            d = float(np.linalg.norm(b - a))
            self.plotter.add_mesh(pv.Line(a, b), color=self.tokens.accent, line_width=3,
                                  name="measure")
            self.readout.setText(f"Measured {d:.4f} in (picked on the surface; approximate)")
            self.measured.emit(d)
            self._measure_pts = []

    # -- content ------------------------------------------------------------------
    # Actors are created once and their data replaced in place on every edit:
    # re-creating actors costs far more than the geometry itself.
    def _actor(self, name: str, **kw):
        if name not in self._data:
            self._data[name] = pv.PolyData()
            self._actors[name] = self.plotter.add_mesh(self._data[name], name=name, **kw)
        return self._data[name]

    def _set(self, name: str, mesh, **kw) -> None:
        target = self._actor(name, **kw)
        if mesh is None or mesh.n_points == 0:
            self._actors[name].SetVisibility(False)
            return
        target.copy_from(mesh)
        self._actors[name].SetVisibility(True)

    def show_evaluation(self, ev: Evaluation) -> None:
        self.ev = ev
        if not self.plotter:
            return
        p, t = self.plotter, self.tokens
        a = ev.analysis
        od_r, wall_r = ev.resolved.get("od"), ev.resolved.get("wall")
        od = None if od_r is None or od_r.missing else float(od_r.value)
        wall = None if wall_r is None or wall_r.missing else float(wall_r.value)
        pts = np.array(ev.project.route.points, dtype=float)
        tube_kw = dict(color=t.tube, specular=0.4, smooth_shading=False)

        outer = inner = line = None
        if a.ok and all(s.straight >= -1e-9 for s in a.segments):
            radius = (od or 0.25) / 2
            # straights need no subdivision for display; arcs are true circles at 6 deg
            cl = sample_centerline(a, max_piece=1e9, max_chord_deg=6.0)
            line = pv.lines_from_points(cl.points)
            if self.section:
                view_dir = np.subtract(p.camera.focal_point, p.camera.position)
                r_in = max(radius - wall, 1e-4) if wall else radius * 0.85
                outer, inner = half_tube(cl.points, radius, r_in, view_dir)
            else:
                outer = line.tube(radius=radius, n_sides=24, capping=False)
        self._set("tube", outer, **tube_kw)
        self._actors["tube"].prop.interpolation = "gouraud"   # tube filter supplies normals
        self._set("tube_in", inner, color="#C9A227", smooth_shading=False)  # cut wall faces
        ok_line = line is not None
        self._set("centerline", line if ok_line else pv.lines_from_points(pts),
                  color=t.centerline, line_width=1.5)
        self._actors["centerline"].prop.color = t.centerline if ok_line else t.error
        self._actors["centerline"].prop.line_width = 1.5 if ok_line else 3
        contacts = np.array([c.location for c in ev.contacts]) if ev.contacts else None
        self._set("contacts", pv.PolyData(contacts) if contacts is not None else None,
                  color=t.error, point_size=16, render_points_as_spheres=True)
        self._set("vertices", pv.PolyData(pts), color=t.accent, point_size=9,
                  render_points_as_spheres=True)
        labels = pv.PolyData(pts)
        labels.point_data["names"] = np.array([f" P{i}" for i in range(len(pts))])
        if self._labels is None:
            from vtkmodules.vtkRenderingCore import vtkActor2D
            from vtkmodules.vtkRenderingLabel import vtkLabeledDataMapper
            self._labels = pv.PolyData()
            self._labels.copy_from(labels)
            mapper = vtkLabeledDataMapper()
            mapper.SetInputData(self._labels)
            mapper.SetLabelModeToLabelFieldData()
            mapper.SetFieldDataName("names")
            tp = mapper.GetLabelTextProperty()
            tp.SetFontSize(13)
            tp.SetBold(True)
            tp.SetShadow(False)
            tp.SetColor(pv.Color(t.text).float_rgb)
            actor = vtkActor2D()
            actor.SetMapper(mapper)
            p.add_actor(actor, name="labels", reset_camera=False)
            self._label_prop = tp
        else:
            self._labels.copy_from(labels)
            self._label_prop.SetColor(pv.Color(t.text).float_rgb)
        if self._first:
            self.view("iso")
            self._first = False
        p.render()


def half_tube(points: np.ndarray, r_out: float, r_in: float, view_dir, n_arc: int = 13):
    """Lengthwise cut-away of a tube along a centerline polyline.

    Returns (shell, cut_faces): the far half of the outer and inner surfaces,
    and the two flat wall faces exposed by the cut."""
    P = np.asarray(points, dtype=float)
    n = len(P)
    t = np.gradient(P, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    v = np.asarray(view_dir, dtype=float)
    v = v / np.linalg.norm(v)
    e = v - (t @ v)[:, None] * t                       # away-from-viewer, normal to tube
    norms = np.linalg.norm(e, axis=1)
    fallback = np.cross(t, [0.0, 0.0, 1.0])
    fallback[np.linalg.norm(fallback, axis=1) < 1e-6] = [1.0, 0.0, 0.0]
    e = np.where(norms[:, None] > 1e-6, e, fallback)
    e /= np.linalg.norm(e, axis=1, keepdims=True)
    b = np.cross(t, e)
    phi = np.linspace(-np.pi / 2, np.pi / 2, n_arc)
    ring = np.cos(phi)[None, :, None] * e[:, None, :] + np.sin(phi)[None, :, None] * b[:, None, :]
    outer = P[:, None, :] + r_out * ring                 # (n, n_arc, 3)
    inner = P[:, None, :] + r_in * ring

    def strip(a: np.ndarray, c: np.ndarray) -> np.ndarray:
        """Quads joining polyline a[i] to c[i] along the tube (both shape (n, 3))."""
        i = np.arange(n - 1)
        return np.column_stack([np.full(n - 1, 4), i, i + 1, n + i + 1, n + i]), np.vstack([a, c])

    def surface(grid: np.ndarray) -> pv.PolyData:
        idx = np.arange(n * n_arc).reshape(n, n_arc)
        q = np.column_stack([np.full((n - 1) * (n_arc - 1), 4),
                             idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(),
                             idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()])
        return pv.PolyData(grid.reshape(-1, 3), q.ravel())

    shell = surface(outer).merge(surface(inner))
    cuts = []
    for k in (0, n_arc - 1):
        faces, pts = strip(outer[:, k], inner[:, k])
        cuts.append(pv.PolyData(pts, faces.ravel()))
    shell = shell.compute_normals(auto_orient_normals=False, consistent_normals=False)
    return shell, cuts[0].merge(cuts[1])
