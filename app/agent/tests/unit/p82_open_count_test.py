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
NAMES = {"record_key", "action_status", "held_back", "data_quality_flag", "is_current", "change_source", "snooze_until"}

# key, status, held_back, data_quality_flag, is_current, change_source, snooze_until
# The snoozed row is the one-row difference REQ-224 found: the scope line counted it as open, the Work list did not.
ROWS = [
    ("open_ok", None, False, "ok", True, "run", None),
    ("open_new", "New", False, "ok", True, "run", None),
    ("open_snoozed_past", "New", False, "ok", True, "run", "2026-11-14"),
    ("snoozed_future", "New", False, "ok", True, "run", "2026-11-20"),
    ("held_ok", "New", True, "ok", True, "run", None),
    ("done_ok", "Done", False, "ok", True, "run", None),
    ("no_pair", "New", False, "no candidate pair", True, "run", None),
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
    db.execute("CREATE TABLE src (record_key, action_status, held_back, data_quality_flag, is_current, change_source, snooze_until)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?, ?, ?, ?, ?)", ROWS)
    return db


def _scope_row(db):
    sql, items = shell_sql.scope_counts_query(PAGE, NAMES, TODAY)
    sql = sql.replace("`cat`.`sch`.`results`", "src").replace("cat.sch.results", "src")
    sql = sql.replace("AS STRING)", "AS TEXT)").replace("AS DATE)", "AS TEXT)")  # sqlite has no DATE; ISO text compares the same way
    values = {p["name"]: p["value"] for p in items}
    cur = db.execute(sql.replace(" LIMIT 1", ""), values)
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, cur.fetchone()))


def _open_keys(db):
    """The Work tab's Open list: the list's own predicate (window_conditions), checked and held rows left out."""
    params = shell_sql._Params()
    today = params.add(TODAY, "DATE")
    where = " AND ".join(shell_sql.window_conditions({"window": "all"}, params, True, today, "c", True))
    db.execute("DROP VIEW IF EXISTS temp.c")
    db.execute("CREATE TEMP VIEW c AS SELECT record_key AS _inspire_key, COALESCE(action_status, 'New') AS _inspire_status, "
               "held_back AS _inspire_held, CAST(NULL AS TEXT) AS _inspire_due, snooze_until AS _inspire_snooze, "
               "CAST(0 AS INTEGER) AS _inspire_joined, CAST(("
               + shell_facts.flagged_ok_sql(["data_quality_flag"]) +
               ") AS INTEGER) AS _inspire_ok, CAST(NULL AS TEXT) AS _inspire_flag FROM src WHERE is_current AND change_source <> 'delete'")
    values = {p["name"]: p["value"] for p in params.items}
    return [r[0] for r in db.execute(f"SELECT _inspire_key FROM c WHERE {where} ORDER BY 1", values)]


def test_the_open_count_is_the_work_list_open_rows_when_a_snoozed_row_is_in_the_scope():
    # Before the fix the scope counted 3 open (the snoozed row included) while the Work list showed 2.
    db = _db()
    assert _open_keys(db) == ["open_new", "open_ok", "open_snoozed_past"]
    assert _scope_row(db)["open_"] == len(_open_keys(db)) == 3


def test_a_snoozed_row_waits_for_its_date_and_is_named_apart_in_the_scope_line():
    row = _scope_row(_db())
    assert row["snoozed_"] == 1
    assert "snoozed_future" not in _open_keys(_db())


def test_done_rows_stay_separate_from_open_and_never_join_the_open_count():
    db = _db()
    row = _scope_row(db)
    assert "done_ok" not in _open_keys(db)
    assert row["closed_"] == 1 and row["open_"] == 3, "Done is its own count, not open work"
    assert (row["open_"], row["held_"], row["closed_"], row["snoozed_"], row["unchecked"]) == (3, 1, 1, 1, 1)


def test_the_scope_line_names_snoozed_rows_only_when_there_are_some():
    text = shell_sql.scope_counts_text([{"open_": 3, "held_": 1, "closed_": 1, "unchecked": 1, "snoozed_": 1}])
    assert text == ("Scope: 6 checked records, 3 open, 1 held back, 1 done or closed. 1 snoozed until a later date. "
                    "1 could not be checked and are never open work.")
    assert shell_sql.scope_counts_text([{"open_": 2, "held_": 0, "closed_": 0, "unchecked": 0, "snoozed_": 0}]) == (
        "Scope: 2 checked records, 2 open, 0 held back, 0 done or closed. 0 could not be checked and are never open work.")


def test_the_genie_scope_fact_counts_only_the_open_work_scope(agent_ns):
    cols = {c.lower(): "STRING" for c in ("data_quality_flag", "held_back", "action_status", "snooze_until")}
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", cols)
    # Genie used to count any ok, unheld row, so Done, Dismissed and Could not fix rows were counted as open (182 vs 157).
    assert "with action_status is 'New' or 'In progress' (NULL counts as New) and held_back = FALSE and " in fact
    assert "snooze_until is empty or on or before CURRENT_DATE() and data_quality_flag = 'ok'." in fact
    assert "the records already done, dismissed or could not be fixed (action_status Done, Dismissed or Could not fix)" in fact
    assert "the records snoozed until a later date" in fact
    assert "give the open count first, then the total as 'N flagged, M still open'." in fact
    assert "answer it with that number first and say that it is the records that need action." in fact
    assert not any(ch in fact for ch in "–—"), "no dashes in Genie-facing text"


def test_the_genie_open_statuses_are_the_app_open_statuses(agent_ns):
    # Drift guard: the notebook text names the open statuses by hand, so it must match the App's own list.
    assert set(shell_facts.OPEN_STATUSES) == {"New", "In progress"}
    cols = {c.lower(): "STRING" for c in ("data_quality_flag", "action_status")}
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", cols)
    for status in shell_facts.OPEN_STATUSES:
        assert f"'{status}'" in fact


def test_a_genie_fact_without_a_status_column_adds_no_status_rule(agent_ns):
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", {"data_quality_flag": "STRING"})
    assert "action_status" not in fact and "snooze_until" not in fact
    assert "with data_quality_flag = 'ok'." in fact
