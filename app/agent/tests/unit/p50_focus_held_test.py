"""REQ-224 / P50: focus tabs (Dashboard "Fix this" lists) keep held-back rows; they still leave out rows the notebook could not check."""
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

TODAY = "2026-11-04"

# key, status, held_back, owner, due, data_quality_flag
ROWS = [
    ("open_ok", "New", False, "", "2026-10-01", "ok"),
    ("held_ok", "New", True, "", "2026-10-01", "ok"),
    ("unchecked", "New", False, "", "2026-10-01", "no candidate pair"),
    ("fresh_held", "New", True, "", "2026-12-01", "ok"),
]


def _db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE src (`record_key`, `action_status`, `held_back`, `action_owner`, `action_due`, `data_quality_flag`)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?, ?, ?, ?)", ROWS)
    ok = shell_facts.flagged_ok_sql(["data_quality_flag"])
    db.execute("CREATE TABLE c AS SELECT `record_key` AS `_inspire_key`, `action_status` AS `_inspire_status`, "
               "`held_back` AS `_inspire_held`, `action_owner` AS `_inspire_owner`, `action_due` AS `_inspire_due`, "
               "CAST(0 AS INTEGER) AS `_inspire_joined`, "
               f"CAST(({ok}) AS INTEGER) AS `_inspire_ok` FROM src")
    return db


def _focus_keys(focus_name):
    params = shell_sql._Params()
    context = {"held": True, "checked": True, "table": "t"}
    focus = {"focus": focus_name, "today": TODAY, "before_us": 0}
    where = " AND ".join(shell_sql.focus_conditions({}, focus, context, params))
    values = {p["name"]: p["value"] for p in params.items}
    rows = _db().execute(f"SELECT `_inspire_key` FROM c WHERE {where} ORDER BY `_inspire_key`", values)
    return [row[0] for row in rows]


def test_an_overdue_focus_tab_lists_a_held_back_row_as_the_dashboard_counts_it():
    assert "held_ok" in _focus_keys("overdue")


def test_an_overdue_focus_tab_still_leaves_out_a_row_the_notebook_could_not_check():
    keys = _focus_keys("overdue")
    assert "unchecked" not in keys
    assert "open_ok" in keys


def test_the_overdue_focus_keeps_only_rows_past_due():
    assert "fresh_held" not in _focus_keys("overdue")


def test_an_unassigned_focus_tab_lists_a_held_back_row_with_no_owner():
    assert "held_ok" in _focus_keys("unassigned")


def test_the_focus_condition_names_no_held_filter():
    params = shell_sql._Params()
    context = {"held": True, "checked": True}
    out = shell_sql.focus_conditions({}, {"focus": "overdue", "today": TODAY, "before_us": 0}, context, params)
    assert not any("_inspire_held" in clause for clause in out)
    assert any("_inspire_ok" in clause for clause in out)
