# FlareLine

A tube bend and 37° flare design aid for rigid tube assemblies used in test
systems: GSE, test stands and pressure panels.

> **Design aid only.** All geometry must be verified and approved per your
> organization's engineering and quality process before fabrication.

FlareLine runs fully offline. It makes no network calls and has no telemetry.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Geometry engine + tests | **done** |
| 2 | Standards data files (AS4330 / AS33611 / J514) + validation wiring | next |
| 3 | GUI shell, live 3D / 2D views | |
| 4 | Drawing export (PDF / DXF / PNG / CSV) | |
| 5 | Image trace mode | |
| 6 | Packaging (.exe), tutorial, polish | |

## Layout

```
flareline/
  src/flareline/geometry/   pure calculation, no GUI and no I/O
    route.py         TubeRoute: XYZ points + CLR per bend
    analysis.py      angles, tangents, arcs, straights, rotations, lengths, traces
    formats.py       XYZ <-> LRA (YBC) <-> leg-length conversions
    centerline.py    dense centerline sampling (arcs are true circles)
    interference.py  self-interference check
    validation.py    limit checks -> warnings / errors
    springback.py    springback table
    trace.py         formula + inputs record for every calculated number
    units.py         display formatting (the only place values are rounded)
  tests/             known-answer and property tests
  docs/              CONVENTIONS.md, TEST_REPORT.md
```

## Running the tests

```
python -m venv .venv
.venv\Scripts\activate            (Windows)   or   source .venv/bin/activate
pip install -e .[test]
pytest --report=docs/TEST_REPORT.md
```

See `docs/CONVENTIONS.md` for every geometric convention the engine uses.
