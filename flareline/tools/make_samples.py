"""Regenerate the sample projects in src/flareline/samples.

Wall (0.035 in) and CLR (0.75 in) are EXAMPLE user inputs for demonstration,
not standards values; each sample says so in its title block notes.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from flareline.geometry import TubeRoute  # noqa: E402
from flareline.project import Project, TubeSpec, save  # noqa: E402

NOTE = "SAMPLE: wall and CLR are example inputs, not standards values"
TUBE = TubeSpec(dash=4, material_id="cres304", wall=0.035, wall_from_data=False)
CLR = 0.75

SAMPLES = {
    "1_simple_90": ("Simple 90°", [(0, 0, 0), (8, 0, 0), (8, 6, 0)]),
    "2_s_offset": ("S-offset, 45° x 2", [(0, 0, 0), (6, 0, 0), (9, 3, 0), (15, 3, 0)]),
    "3_compound_to_panel": ("3D compound bend to pressure panel",
                            [(0, 0, 0), (5, 0, 0), (5, 0, 6), (9, 4, 8), (9, 4, 12)]),
}


def main(out: Path) -> None:
    for name, (title, pts) in SAMPLES.items():
        p = Project(tube=TUBE, route=TubeRoute.uniform(pts, CLR),
                    meta={"part_number": f"SAMPLE-{name[0]}", "title": title,
                          "revision": "-", "notes": NOTE})
        save(p, out / f"{name}.flareline.json")
        print("wrote", name)


if __name__ == "__main__":
    main(Path(__file__).resolve().parents[1] / "src" / "flareline" / "samples")
