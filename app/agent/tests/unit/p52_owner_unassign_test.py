"""REQ-223 (c) / P52: clearing the owner unassigns the record, and the Unassigned focus list and card count it."""
import datetime
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

PAGE = {"records": {}}
# key, owner after the write: a cleared owner is '' (the UI sends action_owner ''), a never-owned record is NULL
ROWS = [("cleared", ""), ("never_owned", None), ("blank", "   "), ("kept", "sam@example.com")]
UNASSIGNED = "NULLIF(TRIM(`_inspire_owner`), '') IS NULL"


def test_clearing_the_owner_writes_an_empty_owner_that_the_validator_accepts():
    assert shell_sql.action_values({"action_owner": ""})["action_owner"] == ""


def test_the_unassigned_focus_list_includes_the_cleared_record():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE c (`_inspire_key`, `_inspire_owner`)")
    db.executemany("INSERT INTO c VALUES (?, ?)", ROWS)
    params = shell_sql._Params()
    clauses = shell_sql.focus_conditions(PAGE, {"focus": "unassigned"}, {"checked": False, "table": "t"}, params)
    owner = next(c for c in clauses if "_inspire_owner" in c)
    assert owner.replace("c.", "") == UNASSIGNED
    keys = [r[0] for r in db.execute(f"SELECT `_inspire_key` FROM c WHERE {owner.replace('c.', '')} ORDER BY `_inspire_key`")]
    assert keys == ["blank", "cleared", "never_owned"]


def test_the_unassigned_card_counts_the_cleared_record_like_the_list_does():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE kv (`record_key`, `_t_owner`)")
    db.executemany("INSERT INTO kv VALUES (?, ?)", ROWS)
    assert db.execute(f"SELECT COUNT(*) FROM kv WHERE {UNASSIGNED.replace('_inspire_owner', '_t_owner')}").fetchone()[0] == 3
    names = {"action_owner", "record_key", "is_current", "change_source", "valid_from", "action_status"}
    sql = shell_sql.trends_query(PAGE | {"result_table": "c.s.t"}, names, datetime.datetime(2026, 11, 15), datetime.date(2026, 11, 9))[0]
    assert "NULLIF(TRIM(`_t_owner`), '') IS NULL" in sql
