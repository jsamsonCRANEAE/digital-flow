"""List every data field that still has to be filled in from licensed
standards or shop data, generated from the data files themselves.

    python -m flareline.data.fields_report [data_dir] > STANDARDS_DATA_FIELDS.md
"""
from __future__ import annotations

import sys
from collections import defaultdict

from .schema import Status
from .store import Dataset, load_dataset


def _dash(key: dict) -> str:
    return ", ".join(f"-{v}" if k == "dash" else str(v) for k, v in key.items() if v is not None)


def report(ds: Dataset) -> str:
    out = [
        "# Standards and shop data you must fill in",
        "",
        f"Generated from data set `{ds.version}` (SHA-256 `{ds.short_hash}…`).",
        "",
        "Fill these in with the data editor, which logs every change, or directly in the JSON",
        "files. A row counts as **VERIFIED** only once every required field below is set",
        "*and* its provenance has `standard`, `revision`, `table_ref`, `date_entered` and",
        "`entered_by`. The loader refuses to load anything less.",
        "",
    ]
    total_fields = total_rows = 0
    for t in ds.tables.values():
        pending = [r for r in t.rows if r.provenance.status != Status.VERIFIED
                   and r.provenance.status != Status.DERIVED]
        meta_pending = [(k, m) for k, m in t.meta.items() if not m.get("text")]
        if not pending and not meta_pending:
            continue
        out += [f"## `{t.name}` — {t.title}", ""]
        if t.standard:
            sup = f" (supersedes {t.supersedes})" if t.supersedes else ""
            out += [f"Source: **{t.standard}**{sup}. Record the revision and table/figure.", ""]
        if all(r.provenance.status == Status.DEFAULT for r in pending):
            out += ["Shipped with neutral defaults (no correction). Replace them when you "
                    "have test-bend results.", ""]
        out += ["| Field | Unit | Required | What to enter |", "|---|---|---|---|"]
        for f in t.fields.values():
            out.append(f"| `{f.name}` | {f.unit} | {'yes' if f.required else 'if tabulated'} "
                       f"| {f.description} |")
        out.append("")
        empty = defaultdict(list)
        for r in pending:
            for f in t.fields.values():
                v = r.values.get(f.name)
                if f.required and (v is None or v == []):
                    empty[f.name].append(_dash(dict(r.key)))
        if empty:
            out += ["Rows still empty:", ""]
            for name, keys in empty.items():
                total_fields += len(keys)
                out.append(f"- `{name}` ({len(keys)}): " + "; ".join(keys))
            out.append("")
        total_rows += len(pending)
        for k, m in meta_pending:
            total_fields += 1
            out += [f"Table note `{k}`: {m.get('description', '')}", ""]
    out.insert(4, f"**{total_fields} values in {total_rows} rows are still to be entered or "
                  f"verified.**\n")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(report(load_dataset(sys.argv[1] if len(sys.argv) > 1 else None)), end="")
