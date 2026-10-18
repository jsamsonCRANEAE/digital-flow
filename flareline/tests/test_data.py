"""Standards data files: loading, provenance rules, lookup, hashing, editing."""
import json
import shutil

import pytest

from flareline.data import (DataEditor, DataError, Status, default_data_dir, load_dataset,
                            read_changelog)


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    shutil.copytree(default_data_dir(), d)
    return d


def edit_json(path, fn):
    doc = json.loads(path.read_text(encoding="utf-8"))
    fn(doc)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")


def test_dt01_shipped_data_has_no_standards_values():
    """DT-01 the shipped data set loads, and no standards table holds a number:
    every AS4330 / AS33611 / J514 / shop-limit value is null and UNVERIFIED."""
    ds = load_dataset()
    for name in ("as4330_flare", "as33611_bend_radius", "j514_reference", "shop_limits",
                 "tube_walls"):
        for row in ds.table(name).rows:
            assert row.provenance.status in (Status.UNVERIFIED_STD, Status.UNVERIFIED_SHOP)
            assert all(v in (None, []) for v in row.values.values()), (name, row.index)


def test_dt02_only_dash_definition_is_derived():
    """DT-02 tube OD is the one filled value: OD = dash/16 (e.g. -5 -> 0.3125), DERIVED with a basis."""
    t = load_dataset().table("tube_sizes")
    assert [r.key["dash"] for r in t.rows] == [4, 5, 6, 8, 10, 12, 16, 20, 24, 32]
    row = t.lookup(dash=5)
    assert row.values["od"] == 0.3125 and row.provenance.status == Status.DERIVED
    assert "dash / 16" in row.provenance.basis


def test_dt03_standards_referenced_are_current():
    """DT-03 tables cite AS4330 (supersedes MS33584) and AS33611 (supersedes MS33611)."""
    ds = load_dataset()
    assert (ds.table("as4330_flare").standard, ds.table("as4330_flare").supersedes) == \
        ("SAE AS4330", "MS33584")
    assert (ds.table("as33611_bend_radius").standard,
            ds.table("as33611_bend_radius").supersedes) == ("SAE AS33611", "MS33611")
    assert ds.table("j514_reference").standard == "SAE J514"


def test_dt04_verified_row_needs_full_provenance(data_dir):
    """DT-04 a row marked VERIFIED without revision / table / date / entered_by is refused."""
    def f(doc):
        doc["rows"][0]["values"]["min_clr"] = 1.0
        doc["rows"][0]["provenance"]["status"] = "VERIFIED"
    edit_json(data_dir / "as33611_bend_radius.json", f)
    with pytest.raises(DataError, match="VERIFIED row is missing: revision"):
        load_dataset(data_dir)


def test_dt05_verified_row_needs_required_values(data_dir):
    """DT-05 a row with full provenance but an empty required value cannot be VERIFIED."""
    def f(doc):
        doc["rows"][0]["provenance"].update(status="VERIFIED", revision="X", table_ref="Table 1",
                                            date_entered="2026-10-18", entered_by="JS")
    edit_json(data_dir / "as33611_bend_radius.json", f)
    with pytest.raises(DataError, match="min_clr"):
        load_dataset(data_dir)


@pytest.mark.parametrize("mutate, message", [
    (lambda d: d["rows"][0]["values"].update(min_clr="1.0"), "must be a number"),
    (lambda d: d["rows"][0]["values"].update(bogus=1), "unknown value fields"),
    (lambda d: d["rows"][1]["key"].update(dash=4, material_id="cres304"), "duplicate key"),
    (lambda d: d["rows"][0]["provenance"].update(status="OK"), "unknown provenance status"),
    (lambda d: d["rows"][0]["provenance"].update(date_entered="18/10/2026"), "YYYY-MM-DD"),
    (lambda d: d.update(table="other"), "does not match"),
])
def test_dt06_malformed_tables_rejected(data_dir, mutate, message):
    """DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected."""
    edit_json(data_dir / "as33611_bend_radius.json", mutate)
    with pytest.raises(DataError, match=message):
        load_dataset(data_dir)


def test_dt07_lookup_prefers_most_specific_row(data_dir):
    """DT-07 a wall-specific AS33611 row beats the any-wall row; other walls fall back."""
    def f(doc):
        doc["rows"].append({"key": {"dash": 4, "material_id": "cres304", "wall": 0.035},
                            "values": {}, "provenance": {"status": "UNVERIFIED – REPLACE FROM STANDARD"}})
    edit_json(data_dir / "as33611_bend_radius.json", f)
    t = load_dataset(data_dir).table("as33611_bend_radius")
    assert t.lookup(dash=4, material_id="cres304", wall=0.035).key["wall"] == 0.035
    assert t.lookup(dash=4, material_id="cres304", wall=0.049).key["wall"] is None
    assert t.lookup(dash=7, material_id="cres304", wall=None) is None


def test_dt08_hash_changes_with_any_edit(data_dir):
    """DT-08 the data set SHA-256 is stable on reload and changes if any file changes."""
    h1 = load_dataset(data_dir).sha256
    assert load_dataset(data_dir).sha256 == h1
    edit_json(data_dir / "j514_reference.json", lambda d: d.update(title="changed"))
    assert load_dataset(data_dir).sha256 != h1


def test_dt09_editor_logs_and_verifies(data_dir):
    """DT-09 editing a value and verifying the row writes both changes to CHANGELOG.jsonl
    with user, reason, before/after and file hashes; the loaded row is VERIFIED."""
    ed = DataEditor(data_dir, user="J. Samson")
    ed.set_value("as33611_bend_radius", 0, "min_clr", 0.875, reason="test entry")
    ed.mark_verified("as33611_bend_radius", 0, standard="SAE AS33611", revision="TEST",
                     table_ref="Table TEST", date_entered="2026-10-18", reason="checked")
    row = load_dataset(data_dir).table("as33611_bend_radius").rows[0]
    assert row.values["min_clr"] == 0.875 and row.provenance.status == Status.VERIFIED
    log = read_changelog(data_dir)
    assert [r["action"] for r in log] == ["set_value", "mark_verified"]
    assert log[0]["user"] == "J. Samson" and log[0]["before"]["values"].get("min_clr") is None
    assert log[0]["sha256_after"] == log[1]["sha256_before"]


def test_dt10_editor_refuses_invalid_verify_and_writes_nothing(data_dir):
    """DT-10 verifying a row with an empty required value is refused and the file is untouched."""
    before = (data_dir / "as33611_bend_radius.json").read_bytes()
    with pytest.raises(DataError):
        DataEditor(data_dir, "JS").mark_verified(
            "as33611_bend_radius", 0, standard="SAE AS33611", revision="X",
            table_ref="T1", date_entered="2026-10-18", reason="r")
    assert (data_dir / "as33611_bend_radius.json").read_bytes() == before
    assert read_changelog(data_dir) == []


def test_dt11_editing_a_verified_value_unverifies_it(data_dir):
    """DT-11 changing a value on a VERIFIED row drops it back to UNVERIFIED."""
    ed = DataEditor(data_dir, "JS")
    ed.set_value("as33611_bend_radius", 0, "min_clr", 1.0, "entry")
    ed.mark_verified("as33611_bend_radius", 0, standard="SAE AS33611", revision="X",
                     table_ref="T1", date_entered="2026-10-18", reason="r")
    ed.set_value("as33611_bend_radius", 0, "min_clr", 1.25, "typo fix")
    row = load_dataset(data_dir).table("as33611_bend_radius").rows[0]
    assert row.provenance.status == Status.UNVERIFIED_STD


def test_dt12_new_dash_size_by_data_only(data_dir):
    """DT-12 adding a -3 size needs only a data-file row (no code change)."""
    edit_json(data_dir / "tube_sizes.json", lambda d: d["rows"].append(
        {"key": {"dash": 3}, "values": {"od": 0.1875},
         "provenance": {"status": "DERIVED", "basis": "OD = dash / 16 in"}}))
    assert load_dataset(data_dir).table("tube_sizes").lookup(dash=3).values["od"] == 0.1875
