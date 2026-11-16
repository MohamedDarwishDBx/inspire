import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

THROUGH = "2016-02-07"
FORECAST_PAGE = {"id": "n02_u01", "layout": "forecast_cockpit", "result_table": "main.s.results",
                 "datasets": [{"name": "series", "sql": "SELECT * FROM main.s.results__series"}],
                 "kpis": [{"id": "next_day", "label": "Trips forecast next day", "dataset": "series", "expression": "COUNT(*)",
                           "format": "integer"}]}
PLAIN_PAGE = dict(FORECAST_PAGE, layout="records_table")
EMPTY_SHOWN = {"now": 0, "before": None}


def test_a_zero_with_no_rows_behind_it_says_why_and_shows_no_number_on_a_forecast_page():
    shown = shell_sql.kpi_missing(FORECAST_PAGE, EMPTY_SHOWN, 0, THROUGH)
    assert shown["now"] is None
    assert shown["empty"]["en"] == "No forecast yet: the forecast starts after the last date in the data (2016-02-07)"


def test_a_zero_with_no_rows_behind_it_says_the_data_ends_on_a_date_on_any_other_page():
    shown = shell_sql.kpi_missing(PLAIN_PAGE, EMPTY_SHOWN, 0, THROUGH)
    assert shown["now"] is None
    assert shown["empty"]["en"] == "No rows for these dates: the data ends on 2016-02-07"


def test_a_zero_with_no_known_last_date_still_says_why():
    assert shell_sql.kpi_missing(FORECAST_PAGE, EMPTY_SHOWN, 0, "")["empty"]["en"] == "No forecast yet for these dates"
    assert shell_sql.kpi_missing(PLAIN_PAGE, EMPTY_SHOWN, 0, "")["empty"]["en"] == "No rows match these filters"


def test_the_reason_is_carried_in_every_app_language_with_the_date_filled_in_and_a_translated_forecast_reason():
    reasons = shell_sql.kpi_empty_text(FORECAST_PAGE, THROUGH)
    languages = shell_sql.kinds_registry()["tour"]["languages"]
    assert set(reasons) == {lang["code"] for lang in languages.values()}
    assert "2016-02-07" in reasons["en"] and "{through}" not in reasons["en"]
    assert reasons["fr"].startswith("Pas encore de prévision") and "2016-02-07" in reasons["fr"]
    assert reasons["ar"] != reasons["en"] and "2016-02-07" in reasons["ar"]


def test_a_reason_without_a_date_has_no_placeholder_left_in_any_language():
    for page in (FORECAST_PAGE, PLAIN_PAGE):
        for text in shell_sql.kpi_empty_text(page, "").values():
            assert "{through}" not in text


def test_a_measured_zero_with_rows_behind_it_stays_a_zero_with_no_reason():
    assert shell_sql.kpi_missing(FORECAST_PAGE, EMPTY_SHOWN, 12, THROUGH) == EMPTY_SHOWN


def test_a_number_that_is_not_zero_or_a_currency_split_is_left_alone():
    assert shell_sql.kpi_missing(FORECAST_PAGE, {"now": 41, "before": None}, 0, THROUGH) == {"now": 41, "before": None}
    split = {"now": None, "before": None, "by_currency": [{"currency": "USD", "now": None}]}
    assert shell_sql.kpi_missing(FORECAST_PAGE, split, 0, THROUGH) == split


def test_the_missing_check_runs_only_for_a_zero_or_missing_value():
    assert shell_sql.kpi_needs_rows_check(EMPTY_SHOWN) is True
    assert shell_sql.kpi_needs_rows_check({"now": None, "before": None}) is True
    assert shell_sql.kpi_needs_rows_check({"now": 3, "before": None}) is False
    assert shell_sql.kpi_needs_rows_check({"now": None, "by_currency": [{"currency": "USD"}]}) is False


def test_the_rows_check_counts_the_kpi_dataset_under_the_same_filters_as_the_kpi():
    sql, params = shell_sql.kpi_rows_query(FORECAST_PAGE, "next_day", {})
    assert sql.startswith("SELECT COUNT(*) AS n FROM (")
    assert "main.s.results__series" in sql
    assert sql.endswith("LIMIT 1")


def test_page_data_gives_a_zero_kpi_with_no_rows_behind_it_a_reason_and_keeps_a_measured_zero(tmp_path, monkeypatch):
    # the wiring: page_data asks each zero KPI how many rows sit behind it, and the answer decides the reason
    from v141_app_shell_test import PAGE, app_dir, ShapedWorkspace  # noqa: E402
    import shell_core  # noqa: E402

    kpi, measured = PAGE["kpis"][0], PAGE["kpis"][1]
    seen_rows = {kpi["id"]: 0, measured["id"]: 9}
    monkeypatch.setattr(shell_core.shell_sql, "kpi_rows_query",
                        lambda page, ident, values: (f"SELECT COUNT(*) AS n FROM (SELECT 1) AS d WHERE {ident} LIMIT 1", []))

    def shape(sql):
        if "COUNT(*) AS n" in sql:
            return [{"n": seen_rows.get(sql.rsplit("WHERE ", 1)[1].split(" LIMIT")[0], 9)}]
        if "'now' AS period" in sql:
            return [{"period": "now", "value": 0}]
        return None

    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[PAGE]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    out = s.page_data({}, PAGE["id"], {})
    assert out["kpis"][kpi["id"]]["now"] is None
    assert out["kpis"][kpi["id"]]["empty"]["en"].startswith(("No rows", "No forecast"))
    assert out["kpis"][measured["id"]]["now"] == 0 and "empty" not in out["kpis"][measured["id"]]
