import datetime
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

NOW = datetime.datetime(2026, 11, 4, 10, 30, tzinfo=datetime.timezone.utc)
TODAY = "2026-11-04"

# key, status, held_back, data_quality_flag. The flag is the notebook contract: 'ok' means the row was evaluated.
ROWS = [
    ("open_ok", "New", False, "ok"),
    ("held_ok", "New", True, "ok"),
    ("no_pair", "New", False, "no candidate pair"),
    ("unreadable", "In progress", False, None),
    ("done_ok", "Done", False, "ok"),
]


def _db():
    """The c CTE of the App: the current rows with the ok expression the notebook writes into the App's SQL (one source)."""
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE src (`record_key`, `action_status`, `held_back`, `data_quality_flag`)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?, ?)", ROWS)
    ok = shell_facts.flagged_ok_sql(["data_quality_flag"])
    db.execute("CREATE TABLE c AS SELECT `record_key` AS `_inspire_key`, `action_status` AS `_inspire_status`, "
               "CAST(NULL AS TEXT) AS `_inspire_snooze`, `held_back` AS `_inspire_held`, CAST(NULL AS TEXT) AS `_inspire_due`, "
               "CAST(0 AS INTEGER) AS `_inspire_joined`, "
               f"CAST(({ok}) AS INTEGER) AS `_inspire_ok` FROM src")
    return db


def _open_keys(db, checked=True):
    params = shell_sql._Params()
    today = params.add(TODAY, "DATE")
    where = " AND ".join(shell_sql.window_conditions({"window": "all"}, params, True, today, "c", checked))
    values = {p["name"]: p["value"] for p in params.items}
    return [row[0] for row in db.execute(f"SELECT `_inspire_key` FROM c WHERE {where} ORDER BY `_inspire_key`", values)]


def test_a_row_whose_flag_is_not_ok_is_not_open_work_and_an_ok_row_stays_open():
    db = _db()
    keys = _open_keys(db)
    assert "no_pair" not in keys, "a row the notebook could not check is not open work"
    assert "unreadable" not in keys, "a row with no flag is not open work"
    assert "open_ok" in keys, "an ok, not held back, open row is still open work"


def test_a_held_back_ok_row_is_not_open_work():
    assert "held_ok" not in _open_keys(_db())


def test_a_done_ok_row_is_not_open_work_because_it_is_closed():
    assert "done_ok" not in _open_keys(_db())


def test_without_a_flag_column_every_open_non_held_row_stays_open_as_before():
    db = _db()
    assert _open_keys(db, checked=False) == ["no_pair", "open_ok", "unreadable"]


def test_the_open_count_leaves_unchecked_rows_out_of_open_and_names_them_apart_from_held_back():
    rows = [{"v": "New", "c": None, "l": 1, "n": 1, "m": 0, "u": 1},  # ok, listed
            {"v": "New", "c": None, "l": 0, "n": 2, "m": 0, "u": 1},  # held back or snoozed, checked
            {"v": "New", "c": None, "l": 0, "n": 3, "m": 0, "u": 0},  # could not be checked
            {"v": "Done", "c": None, "l": 0, "n": 4, "m": 0, "u": 1}]
    out = shell_sql.status_counts_of(rows)
    assert out["open"] == 1, "only the ok, not held back row is Open"
    assert out["watch"] == 2, "held back or snoozed rows are on watch"
    assert out["unchecked"] == 3, "rows the notebook could not check are counted apart"
    assert out["open"] + out["watch"] + out["unchecked"] == 6


def test_the_count_and_the_list_share_the_ok_predicate_and_the_ok_expression_is_the_one_source():
    params = shell_sql._Params()
    listed = shell_sql.window_conditions({"window": "all"}, params, True, "DATE_X", "f", True)
    assert "COALESCE(f.`_inspire_ok`, FALSE)" in listed
    assert shell_sql.flagged_ok_sql(["data_quality_flag"]) == "`data_quality_flag` = 'ok'"
    assert shell_sql.flagged_ok_sql(["held_back"]) == "TRUE"
    assert shell_sql.flagged_ok_sql(["data_quality_flag"], ()) == shell_sql.flagged_ok_sql(["data_quality_flag"])
