"""2D drawing export: PDF, DXF, PNG, CSV from one drawing model."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from ..data.store import Dataset
from ..project import Evaluation
from .layout import DrawingInfo, build_drawing, release_reasons

FORMATS = ("pdf", "dxf", "png", "csv")


@dataclass(frozen=True)
class ExportResult:
    files: tuple[Path, ...]
    info: DrawingInfo


def export(ev: Evaluation, ds: Dataset, base: Path | str, formats: Iterable[str] = FORMATS,
           size: str = "B", date: Optional[str] = None, audit=None) -> ExportResult:
    """Write the requested formats next to `base` (no extension). A drawing that is
    not releasable is still written, watermarked NOT FOR FABRICATION."""
    base = Path(base)
    formats = [f.lower() for f in formats]
    unknown = set(formats) - set(FORMATS)
    if unknown:
        raise ValueError(f"unknown formats: {sorted(unknown)}")
    sheets, info = build_drawing(ev, ds, size, date)
    out: list[Path] = []
    title = f"{ev.project.meta.get('part_number', '')} {ev.project.meta.get('title', '')}".strip()
    if "pdf" in formats:
        from .pdf import write_pdf
        write_pdf(sheets, base.with_suffix(".pdf"), title)
        out.append(base.with_suffix(".pdf"))
    if "dxf" in formats:
        from .dxf import write_dxf
        write_dxf(ev, sheets[0], base.with_suffix(".dxf"))
        out.append(base.with_suffix(".dxf"))
    if "png" in formats:
        from .png import write_png
        write_png(sheets[0], base.with_suffix(".png"))
        out.append(base.with_suffix(".png"))
    if "csv" in formats:
        from .csvout import write_csv
        path = base.parent / (base.name + "_bend_table.csv")
        write_csv(ev, path)
        out.append(path)
    if audit is not None:
        audit.record(ev, event="export:" + ",".join(formats) + f":{size}:"
                     + ("released" if info.releasable else "NOT FOR FABRICATION"))
    return ExportResult(tuple(out), info)


__all__ = ["DrawingInfo", "ExportResult", "FORMATS", "build_drawing", "export",
           "release_reasons"]
