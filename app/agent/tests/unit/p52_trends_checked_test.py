"""REQ-224 residual / P52: the Dashboard trend cards count open work only where the Fix-this lists do, so a card number matches its list.

A row the notebook could not check (data_quality_flag is not 'ok') is never open work: the Open tab and the focus lists exclude it.
"""
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import datetime  # noqa: E402

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

PAGE = {"result_table": "catalog.schema.result", "records": {}}
NOW = datetime.datetime(2026, 11, 15, 12, 0, 0)
SINCE = datetime.date(2026, 11, 9)
NAMES = {"record_key", "action_status", "action_due", "action_owner", "valid_from", "valid_to", "is_current", "change_source",
         "data_quality_flag", "run_id", "joined_at"}
# record_key, status, flag, owner
ROWS = [
    ("ok_open", "New", "ok", "amr"),
    ("unchecked_open", "New", "no candidate pair", None),
    ("unchecked_unowned", "In progress", "missing amount", ""),
    ("ok_unowned", "New", "ok", None),
    ("unchecked_done", "Done", "no candidate pair", None),
]


def _sql():
    return shell_sql.trends_query(PAGE, NAMES, NOW, SINCE)[0]


def _ok_expression():
    return shell_facts.flagged_ok_sql(["data_quality_flag"])


def test_the_open_counts_are_built_only_from_rows_the_notebook_checked():
    sql = _sql()
    assert "AND `_t_ok`" in sql, "the open-count CTE must keep only checked rows"
    assert "AND v.`_t_ok`" in sql, "the open-per-run trend must keep only checked rows"
    assert "AND `_t_ok` THEN 1 ELSE 0 END" in sql, "the still-open flag must keep only checked rows"


def test_the_checked_flag_is_the_one_expression_the_lists_use():
    assert _ok_expression() in _sql()


def test_without_a_flag_column_every_row_is_checked_so_nothing_is_dropped():
    sql = shell_sql.trends_query(PAGE, NAMES - {"data_quality_flag"}, NOW, SINCE)[0]
    assert "COALESCE((TRUE), FALSE) AS `_t_ok`" in sql


def test_the_flag_expression_drops_unchecked_open_rows_and_keeps_checked_ones():
    # Same expression the trend CTE embeds, evaluated on the same rows: the open count the cards show.
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE kv (`record_key`, `_t_status`, `data_quality_flag`, `action_owner`)")
    db.executemany("INSERT INTO kv VALUES (?, ?, ?, ?)", ROWS)
    ok = f"COALESCE(({_ok_expression()}), FALSE)"
    open_ok = db.execute(f"SELECT `record_key` FROM kv WHERE `_t_status` IN ('New', 'In progress') AND {ok} ORDER BY `record_key`").fetchall()
    assert [r[0] for r in open_ok] == ["ok_open", "ok_unowned"]
    unowned = db.execute(f"SELECT COUNT(*) FROM kv WHERE `_t_status` IN ('New', 'In progress') AND {ok} "
                         "AND NULLIF(TRIM(`action_owner`), '') IS NULL").fetchone()[0]
    assert unowned == 1, "the unowned card must not count the unchecked unowned row"


def test_the_card_count_matches_the_focus_list_for_the_same_rows():
    # The Fix-this focus list for unassigned uses checked_sql over the same predicate; the card must agree with it.
    params = shell_sql._Params()
    conditions = shell_sql.focus_conditions(PAGE, {"focus": "unassigned"}, {"checked": True, "table": "t"}, params)
    assert shell_sql.checked_sql("c") in conditions
    assert "NULLIF(TRIM(c.`_inspire_owner`), '') IS NULL" in conditions
