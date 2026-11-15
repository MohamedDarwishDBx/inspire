"""REQ-327: a date filter (and a choice filter) whose column holds no dates (no values) in the shown data is a note, never a publish
failure. A date filter reads its bounds, its scope probe and its own WHERE through one date expression (TRY_CAST), over the same
datasets, so the publish check and the control judge the same column. A failure only remains when the scope holds dates that the
bounds did not return: a read bug, not a data fact."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import copy  # noqa: E402

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, ShapedWorkspace, app_dir  # noqa: E402

TIMESTAMP_PAGE = copy.deepcopy(PAGE)
TIMESTAMP_PAGE["filters"][0]["columns"] = {"trend": "pickup_ts"}
STRING_PAGE = copy.deepcopy(PAGE)
STRING_PAGE["filters"][0]["columns"] = {"trend": "trip_date"}
FORECAST_PAGE = copy.deepcopy(PAGE)
FORECAST_PAGE["datasets"][0]["sql"] = "SELECT forecast_date, value FROM main.s.forecast_rows"
FORECAST_PAGE["filters"][0]["columns"] = {"trend": "forecast_date"}


def _with_page(tmp_path, page, shape):
    ws = ShapedWorkspace(shape)
    shell = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                             user_factory=lambda h, t: ws)
    return shell, ws


def _findings(tmp_path, page, shape):
    shell, ws = _with_page(tmp_path, page, shape)
    return shell.checked({}), ws


def _bounds(low, high):
    return lambda sql: [{"low": low, "high": high}] if "low_0 AS low" in sql else None


def _rows_in_scope(n_rows, n_values):
    def shape(sql):
        if sql.startswith("SELECT SUM(n_rows)"):
            return [{"n_rows": n_rows, "n_values": n_values}]
        return None
    return shape


def _no_dated_bounds(n_rows, n_values):
    def shape(sql):
        if "low_0 AS low" in sql:
            return [{"low": None, "high": None}]
        return _rows_in_scope(n_rows, n_values)(sql)
    return shape


def _texts(found, kind=None):
    return [text for k, text in found if kind is None or k == kind]


def test_a_date_filter_over_a_timestamp_publishes_and_reads_its_bounds_as_dates(tmp_path):
    found, ws = _findings(tmp_path, TIMESTAMP_PAGE, _bounds("2024-01-05", "2026-10-15"))
    assert not any("run_date" in text for text in _texts(found, shell_core.CHECK_FAILED)), found
    bounds_sql = next(sql for sql, _params, _limit in ws.sql if "low_0 AS low" in sql)
    assert "TRY_CAST(`pickup_ts` AS DATE)" in bounds_sql


def test_a_date_filter_over_a_string_date_reads_bounds_and_its_where_with_the_same_date_expression():
    bounds_sql, _params = shell_sql.bounds_query(STRING_PAGE, "run_date")
    scope_sql, _scope_params = shell_sql.filter_scope_query(STRING_PAGE, "run_date")
    where_sql, _where_params = shell_sql.chart_query(STRING_PAGE, "loss_trend", {"run_date": {"from": "2024-01-01", "to": "2024-02-01"}})
    assert "TRY_CAST(`trip_date` AS DATE)" in bounds_sql
    assert "TRY_CAST(`trip_date` AS DATE)" in scope_sql
    assert "COALESCE(TRY_CAST(`trip_date` AS DATE)" in where_sql and " BETWEEN " in where_sql, "a string that is not a date reads as NULL, never as a query error"


def test_a_date_filter_over_a_forecast_table_reads_the_forecast_rows_it_shows(tmp_path):
    bounds_sql, _params = shell_sql.bounds_query(FORECAST_PAGE, "run_date")
    scope_sql, _scope_params = shell_sql.filter_scope_query(FORECAST_PAGE, "run_date")
    assert "main.s.forecast_rows" in bounds_sql and "main.s.forecast_rows" in scope_sql, "bounds and scope read the page's own dataset"
    found, _ws = _findings(tmp_path, FORECAST_PAGE, _bounds("2026-11-01", "2027-03-31"))
    assert not any("run_date" in text for text in _texts(found, shell_core.CHECK_FAILED)), "forecast dates after today still publish"


def test_a_date_column_with_no_dates_in_its_rows_is_a_note_not_a_failure(tmp_path):
    found, _ws = _findings(tmp_path, PAGE, _no_dated_bounds(n_rows=9, n_values=0))
    assert not any("run_date" in text for text in _texts(found, shell_core.CHECK_FAILED)), found
    notes = [text for text in _texts(found, shell_core.CHECK_NOTE) if "run_date" in text]
    assert len(notes) == 1 and "has no values that read as dates in its 9 rows" in notes[0], found


def test_a_date_filter_whose_scope_is_empty_stays_a_note(tmp_path):
    found, _ws = _findings(tmp_path, PAGE, _no_dated_bounds(n_rows=0, n_values=0))
    assert not any("run_date" in text for text in _texts(found, shell_core.CHECK_FAILED)), found
    assert any("run_date" in text and "zero matches" in text for text in _texts(found, shell_core.CHECK_NOTE)), found


def test_dates_in_scope_that_the_bounds_did_not_return_stay_a_failure(tmp_path):
    found, _ws = _findings(tmp_path, PAGE, _no_dated_bounds(n_rows=9, n_values=4))
    failed = [text for text in _texts(found, shell_core.CHECK_FAILED) if "run_date" in text]
    assert failed == ["page n01_u05: date filter run_date found no dates although 4 of its 9 rows hold one"], found


def test_a_choice_filter_whose_column_holds_no_values_is_a_note_not_a_failure(tmp_path):
    def shape(sql):
        if sql.startswith("SELECT v FROM"):
            return []
        return _rows_in_scope(n_rows=9, n_values=0)(sql)

    found, _ws = _findings(tmp_path, PAGE, shape)
    assert not any("filter category" in text for text in _texts(found, shell_core.CHECK_FAILED)), found
    assert any("filter category" in text and "has no values to pick in its 9 rows" in text for text in _texts(found, shell_core.CHECK_NOTE)), found


def test_a_choice_filter_with_values_its_options_did_not_return_stays_a_failure(tmp_path):
    def shape(sql):
        if sql.startswith("SELECT v FROM"):
            return []
        return _rows_in_scope(n_rows=9, n_values=3)(sql)

    found, _ws = _findings(tmp_path, PAGE, shape)
    failed = [text for text in _texts(found, shell_core.CHECK_FAILED) if "filter category" in text]
    assert failed == ["page n01_u05: filter category found no values to pick although 3 of its 9 rows hold one"], found


def test_the_bounds_and_the_scope_probe_read_one_expression_over_the_same_datasets():
    bounds_sql, _params = shell_sql.bounds_query(TIMESTAMP_PAGE, "run_date")
    scope_sql, _scope_params = shell_sql.filter_scope_query(TIMESTAMP_PAGE, "run_date")
    trend_sql = shell_sql._dataset(TIMESTAMP_PAGE, "trend")
    assert trend_sql in bounds_sql and trend_sql in scope_sql
    assert "TRY_CAST(`pickup_ts` AS DATE)" in bounds_sql and "TRY_CAST(`pickup_ts` AS DATE)" in scope_sql
    assert "records" not in scope_sql, "a date filter's scope reads only the datasets its bounds read"
