"""REQ-224 / P50: the 'Could not be checked' Work tab lists open-status rows the notebook did not evaluate, with their own reason."""
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

PAGE = {"records": {}}
# key, status, data_quality_flag
ROWS = [
    ("ok_new", "New", "ok"),
    ("no_pair_new", "New", "no candidate pair"),
    ("no_flag_progress", "In progress", None),
    ("no_pair_done", "Done", "no candidate pair"),
]


def _db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE src (`record_key`, `action_status`, `data_quality_flag`)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?)", ROWS)
    ok = shell_facts.flagged_ok_sql(["data_quality_flag"])
    db.execute("CREATE TABLE c AS SELECT `record_key` AS `_inspire_key`, `action_status` AS `_inspire_status`, "
               f"`data_quality_flag` AS `_inspire_flag`, CAST(({ok}) AS INTEGER) AS `_inspire_ok` FROM src")
    return db


def _keys(context):
    params = shell_sql._Params()
    where = " AND ".join(shell_sql.unchecked_conditions(PAGE, context, params))
    values = {p["name"]: p["value"] for p in params.items}
    return [row[0] for row in _db().execute(f"SELECT `_inspire_key` FROM c WHERE {where} ORDER BY `_inspire_key`", values)]


def test_the_tab_lists_open_rows_the_notebook_could_not_check_and_nothing_else():
    assert _keys({"checked": True}) == ["no_flag_progress", "no_pair_new"]


def test_an_ok_open_row_is_never_on_the_tab():
    assert "ok_new" not in _keys({"checked": True})


def test_a_closed_row_is_never_on_the_tab():
    assert "no_pair_done" not in _keys({"checked": True})


def test_without_a_flag_column_the_tab_is_empty_rather_than_an_error():
    assert _keys({"checked": False}) == []


def test_the_tab_request_is_a_filter_so_the_whole_list_fast_path_is_off():
    request = {"search": "", "mine": False, "unowned": False, "due_within": None, "changed": False, "ai": {}, "columns": {}, "window": None,
               "exclude": [], "choice": None, "focus": None, "unchecked": True}
    assert shell_sql.unfiltered({}, request) is False
    assert shell_sql.unfiltered({}, dict(request, unchecked=False)) is True


def test_the_reason_column_rides_with_the_windowed_join_only_when_the_flag_exists():
    with_flag = shell_sql._window_extra({"checked": True})
    assert any("`_inspire_flag`" in clause for clause in with_flag)
    assert not any("_inspire_flag" in clause for clause in shell_sql._window_extra({"checked": False}))


def test_the_tab_request_must_be_true_or_false():
    try:
        shell_sql.list_request(PAGE, {"unchecked": "yes"}, {"actions": True, "checked": True, "table": "t", "join": "record_key",
                                                              "windowed": False, "held": False, "tier": None, "money": False,
                                                              "floor": None, "ai": [], "categories": None, "summary": None}, None)
    except ValueError as err:
        assert "unchecked takes true or false" in str(err)
    else:
        raise AssertionError("a non-boolean unchecked must be refused")
