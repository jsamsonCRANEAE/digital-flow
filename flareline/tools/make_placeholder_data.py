"""Regenerate the shipped placeholder data set (src/flareline/data/defaults).

Contains NO standards values. Every standards/shop number is null and every
row is marked UNVERIFIED. The only values filled in are:
  * tube OD per dash size: OD = dash / 16 in (dash-number definition), DERIVED
  * material display names
  * shop_bending defaults: arc factor 1.0, adjust 0.0, no springback (DEFAULT,
    i.e. pure centerline development, no correction)

Usage:  python tools/make_placeholder_data.py [output_dir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DASH_SIZES = [4, 5, 6, 8, 10, 12, 16, 20, 24, 32]
MATERIALS = [
    ("cres304", "304 CRES"),
    ("cres316", "316 CRES"),
    ("cres21-6-9", "21-6-9 CRES"),
    ("al6061-t6", "6061-T6 Aluminum"),
    ("ti-3al-2.5v", "Ti-3Al-2.5V"),
    ("in625", "Inconel 625"),
]
UNV_STD = "UNVERIFIED – REPLACE FROM STANDARD"
UNV_SHOP = "UNVERIFIED – REPLACE FROM SHOP DATA"


def prov(status, standard=None, basis=None):
    return {"status": status, "standard": standard, "revision": None, "table_ref": None,
            "date_entered": None, "entered_by": None, "basis": basis}


def num(unit, description, required=True):
    return {"kind": "number", "unit": unit, "required": required, "description": description}


def table(name, title, standard, supersedes, key_fields, optional_key_fields, fields, rows,
          meta=None):
    return {"schema": "flareline-table/1", "table": name, "title": title,
            "standard": standard, "supersedes": supersedes, "key_fields": key_fields,
            "optional_key_fields": optional_key_fields, "fields": fields,
            "meta": meta or {}, "rows": rows}


def meta_text(description, status=UNV_STD):
    return {"text": None, "status": status, "description": description}


def build() -> dict[str, dict]:
    t = {}
    t["tube_sizes"] = table(
        "tube_sizes", "Tube sizes", None, None, ["dash"], [],
        {"od": num("in", "Tube outside diameter")},
        [{"key": {"dash": d}, "values": {"od": d / 16},
          "provenance": prov("DERIVED", basis="Dash-number definition: OD = dash / 16 in")}
         for d in DASH_SIZES])

    t["materials"] = table(
        "materials", "Tube materials", None, None, ["material_id"], [],
        {"name": {"kind": "text", "unit": "-", "required": True,
                  "description": "Display name"},
         "material_spec": {"kind": "text", "unit": "-", "required": True,
                           "description": "Tube material specification your drawings call out"},
         "condition": {"kind": "text", "unit": "-", "required": False,
                       "description": "Temper / condition, if the spec needs one"},
         "flaring_permitted": {"kind": "bool", "unit": "-", "required": True,
                               "description": "Whether your organization permits 37° flaring "
                                              "of this material"}},
        [{"key": {"material_id": m}, "values": {"name": n}, "provenance": prov(UNV_STD)}
         for m, n in MATERIALS])

    t["tube_walls"] = table(
        "tube_walls", "Wall thickness options", None, None, ["dash", "material_id"], [],
        {"walls": {"kind": "numbers", "unit": "in", "required": True,
                   "description": "Wall thicknesses available for this size and material"}},
        [{"key": {"dash": d, "material_id": m}, "values": {"walls": []},
          "provenance": prov(UNV_STD)} for d in DASH_SIZES for m, _ in MATERIALS])

    t["as4330_flare"] = table(
        "as4330_flare", "37° flared tube ends", "SAE AS4330", "MS33584",
        ["dash"], ["material_id", "wall"],
        {"end_allowance": num("in", "Stock from the end reference point to the cut end that "
                                    "is needed to form the flare; added to the cut length. "
                                    "Record whether it comes from the standard or from your "
                                    "flaring process."),
         "flare_diameter_min": num("in", "Flare diameter, minimum, as tabulated"),
         "flare_diameter_max": num("in", "Flare diameter, maximum, as tabulated"),
         "flare_angle_nominal_deg": num("deg", "Flare angle, nominal, as specified"),
         "flare_angle_tol_deg": num("deg", "Flare angle tolerance (±), as specified"),
         "notes": {"kind": "text", "unit": "-", "required": False,
                   "description": "Other requirements to repeat on the flare detail"}},
        [{"key": {"dash": d}, "values": {}, "provenance": prov(UNV_STD, "SAE AS4330")}
         for d in DASH_SIZES],
        meta={"end_point_definition": meta_text(
            "Exactly where the tube end point (P0 / Pn) sits on the flare, per your standard "
            "or drawing practice. Printed on every drawing.")})

    t["as33611_bend_radius"] = table(
        "as33611_bend_radius", "Tube bend radii", "SAE AS33611", "MS33611",
        ["dash", "material_id"], ["wall"],
        {"min_clr": num("in", "Minimum centerline bend radius"),
         "standard_clr": num("in", "Standard / preferred CLR, if tabulated", required=False)},
        [{"key": {"dash": d, "material_id": m}, "values": {},
          "provenance": prov(UNV_STD, "SAE AS33611")}
         for d in DASH_SIZES for m, _ in MATERIALS],
        meta={"organization_rule": meta_text(
            "Any organizational rule that further limits CLR (e.g. by wall/OD ratio)")})

    t["j514_reference"] = table(
        "j514_reference", "37° flare fitting reference geometry (reference only)", "SAE J514",
        None, ["dash"], [],
        {"nut_hex_across_flats": num("in", "Nut hex across flats"),
         "nut_length": num("in", "Nut overall length"),
         "sleeve_length": num("in", "Sleeve overall length", required=False),
         "envelope_od": num("in", "Largest fitting diameter, for clearance checks"),
         "envelope_length": num("in", "Fitting length behind the end point, for clearance")},
        [{"key": {"dash": d}, "values": {}, "provenance": prov(UNV_STD, "SAE J514")}
         for d in DASH_SIZES])

    t["shop_limits"] = table(
        "shop_limits", "Bender and end-prep limits (shop data)", "Shop data", None,
        ["dash"], ["material_id"],
        {"min_straight_between_bends": num("in", "Shortest straight the bender can clamp "
                                                 "between bends"),
         "min_end_straight_flare37": num("in", "Shortest end straight for the flaring tool, "
                                               "nut and sleeve (37° flare end)"),
         "min_end_straight_plain": num("in", "Shortest end straight for a plain / cut end"),
         "min_end_straight_flareless": num("in", "Shortest end straight for a flareless end",
                                           required=False),
         "bender_die_clrs": {"kind": "numbers", "unit": "in", "required": False,
                             "description": "CLRs of the bend dies you have for this size"}},
        [{"key": {"dash": d}, "values": {}, "provenance": prov(UNV_SHOP, "Shop data")}
         for d in DASH_SIZES])

    t["shop_bending"] = table(
        "shop_bending", "Length correction and springback (shop data)", "Shop data", None,
        ["material_id"], ["dash"],
        {"arc_length_factor": num("-", "Multiplies R·θ for each bend (1.0 = centerline)"),
         "per_bend_adjust": num("in", "Length added per bend (0.0 = none)"),
         "springback_points": {"kind": "points", "unit": "deg", "required": False,
                               "description": "[design angle, springback] pairs, linearly "
                                              "interpolated"}},
        [{"key": {"material_id": m},
          "values": {"arc_length_factor": 1.0, "per_bend_adjust": 0.0, "springback_points": []},
          "provenance": prov("DEFAULT", "Shop data",
                             basis="No correction: pure centerline development and no "
                                   "springback. Replace with test-bend results.")}
         for m, _ in MATERIALS])
    return t


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    tables = build()
    manifest = {"schema": "flareline-data/1", "dataset_version": "0.1.0-placeholder",
                "description": "PLACEHOLDER data set: no standards values. Fill every "
                               "UNVERIFIED row from your licensed standards and shop data.",
                "tables": list(tables)}
    (out / "dataset.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                                      encoding="utf-8")
    for name, doc in tables.items():
        (out / f"{name}.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n",
                                          encoding="utf-8")
    print(f"wrote {len(tables)} tables to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else
         Path(__file__).resolve().parents[1] / "src" / "flareline" / "data" / "defaults")
