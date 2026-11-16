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

TODAY = "2026-11-15"
PAGE = {"result_table": "cat.sch.results"}
NAMES = {"record_key", "action_status", "held_back", "data_quality_flag", "is_current", "change_source"}

# key, status, held_back, data_quality_flag, is_current, change_source
ROWS = [
    ("open_ok", None, False, "ok", True, "run"),
    ("open_new", "New", False, "ok", True, "run"),
    ("held_ok", "New", True, "ok", True, "run"),
    ("done_ok", "Done", False, "ok", True, "run"),
    ("no_pair", "New", False, "no candidate pair", True, "run"),
    ("no_flag", "In progress", False, None, True, "run"),
    ("old_version", "New", False, "ok", False, "run"),
]


class CountIf:
    """sqlite has no COUNT_IF; the App's SQL runs on Databricks, this stands in for it in the fixture only."""
    def __init__(self):
        self.n = 0

    def step(self, value):
        self.n += 1 if value else 0

    def finalize(self):
        return self.n


def _db():
    db = sqlite3.connect(":memory:")
    db.create_aggregate("COUNT_IF", 1, CountIf)
    db.execute("CREATE TABLE src (record_key, action_status, held_back, data_quality_flag, is_current, change_source)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?, ?, ?, ?)", ROWS)
    return db


def _scope_row(db):
    sql, items = shell_sql.scope_counts_query(PAGE, NAMES, TODAY)
    sql = sql.replace("`cat`.`sch`.`results`", "src").replace("cat.sch.results", "src")
    sql = sql.replace("AS STRING)", "AS TEXT)")  # sqlite reads an unknown STRING type as numeric; Databricks STRING is text
    values = {p["name"]: p["value"] for p in items}
    cur = db.execute(sql.replace(" LIMIT 1", ""), values)
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, cur.fetchone()))


def _open_keys(db):
    """The Work tab's Open list: checked, not held back, open status, current row (the list's own predicate)."""
    params = shell_sql._Params()
    today = params.add(TODAY, "DATE")
    where = " AND ".join(shell_sql.window_conditions({"window": "all"}, params, True, today, "c", True))
    db.execute(f"CREATE TEMP VIEW c AS SELECT record_key AS _inspire_key, COALESCE(action_status, 'New') AS _inspire_status, "
               f"held_back AS _inspire_held, CAST(NULL AS TEXT) AS _inspire_due, CAST(NULL AS TEXT) AS _inspire_snooze, "
               f"CAST(0 AS INTEGER) AS _inspire_joined, CAST(({shell_facts.flagged_ok_sql(['data_quality_flag'])}) AS INTEGER) AS _inspire_ok, "
               f"CAST(NULL AS TEXT) AS _inspire_flag FROM src WHERE is_current AND change_source <> 'delete'")
    values = {p["name"]: p["value"] for p in params.items}
    return [r[0] for r in db.execute(f"SELECT _inspire_key FROM c WHERE {where} ORDER BY 1", values)]


def test_the_scope_counts_split_checked_rows_and_leave_the_unchecked_and_old_rows_out():
    row = _scope_row(_db())
    assert (row["open_"], row["held_"], row["closed_"], row["unchecked"]) == (2, 1, 1, 2)


def test_the_scope_line_states_checked_split_and_unchecked_in_plain_words():
    text = shell_sql.scope_counts_text([{"open_": 2, "held_": 1, "closed_": 1, "unchecked": 2}])
    assert text == ("Scope: 4 checked records, 2 open, 1 held back, 1 done or closed. "
                    "2 could not be checked and are never open work.")


def test_the_open_count_agrees_with_the_open_list_on_one_fixture():
    db = _db()
    assert _scope_row(db)["open_"] == len(_open_keys(db)) == 2


def test_a_held_back_checked_row_never_counts_as_open():
    db = _db()
    assert "held_ok" not in _open_keys(db)
    assert _scope_row(db)["held_"] == 1 and _scope_row(db)["open_"] == 2


def test_without_the_quality_flag_there_is_no_scope_count():
    assert shell_sql.scope_counts_query(PAGE, NAMES - {"data_quality_flag"}, TODAY) is None


PAGE_DS = dict(PAGE, datasets=[{"name": "records", "sql": "SELECT * FROM `cat`.`sch`.`results`"},
                               {"name": "churn", "sql": "SELECT * FROM `cat`.`sch`.`churn_out`"}])


def test_a_plain_row_count_of_the_result_table_gets_the_scope_line():
    assert shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "records", "expression": "COUNT(*)"})
    assert shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "records", "expression": "COUNT(DISTINCT `record_key`)"})


def test_a_count_of_something_else_or_any_other_measure_gets_no_scope_line():
    assert not shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "churn", "expression": "COUNT(*)"}), "another table"
    assert not shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "records", "expression": "SUM(`value`)"}), "a sum"
    assert not shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "records", "expression": "COUNT(*) / 2"}), "a ratio"
    assert not shell_sql.kpi_counts_result_rows(PAGE_DS, {"dataset": "missing", "expression": "COUNT(*)"}), "no such dataset"
