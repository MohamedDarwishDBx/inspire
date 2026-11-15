"""P85 round 2 (REQ-287, D-FIRSTREAD): the publish stores each date filter's default range in the page spec, and the App's first load uses it
instead of waiting on a MIN/MAX scan of the table's dates. Without a stored range the first load scans as before, offline."""
import datetime
import json

from v141_app_shell_test import PAGE, call, shell

RUN_DATE = {"run_date": {"low": "2024-01-05", "high": "2026-10-15"}}


def _page_with(range_=RUN_DATE):
    return dict(PAGE, default_range=range_) if range_ is not None else dict(PAGE)


def _bounds_sql(sql_log):
    return [sql for sql, _params, _limit in sql_log if "MIN(COALESCE(TRY_CAST(" in sql]


def test_the_publish_stores_the_iso_bounds_of_each_date_filter_and_no_others(agent_ns):
    meta = {"filters": [{"id": "run_date", "type": "date_range", "low": datetime.date(2024, 1, 5), "high": "2026-10-15T00:00:00"},
                        {"id": "category", "type": "multi_select", "low": None, "high": None},
                        {"id": "empty_dates", "type": "date_range", "low": None, "high": None}]}
    assert agent_ns["implement_default_ranges"](meta) == RUN_DATE


def test_the_deploy_writes_the_stored_range_into_each_page_spec_it_read_and_leaves_the_rest(agent_ns):
    files = {"pages/n01_u05.json": json.dumps(PAGE), "pages/other.json": json.dumps({"id": "other"}), "settings.json": "{}"}
    out = agent_ns["implement_app_default_ranges"](files, "pages", {"n01_u05": {"run_date": RUN_DATE["run_date"]}})
    assert json.loads(out["pages/n01_u05.json"])["default_range"] == {"run_date": RUN_DATE["run_date"]}
    assert out["pages/other.json"] == files["pages/other.json"] and out["settings.json"] == "{}"
    assert "default_range" not in json.loads(files["pages/n01_u05.json"]), "the input files are not changed"


def test_the_first_defaults_read_uses_the_stored_range_and_never_waits_on_the_scan(tmp_path):
    s, sp_ws, _user_ws, _made = shell(tmp_path, pages=[_page_with()])
    scheduled = []
    s.prefetch = lambda *jobs: scheduled.extend(jobs)
    status, out = call(s, "GET", "defaults", query={"page": PAGE["id"]})
    assert status == 200
    assert _bounds_sql(sp_ws.sql) == [], "the first load ran the MIN/MAX scan of the dates inline"
    assert out["range"]["run_date"] == {"preset": "12m", "from": "2025-11-01", "to": "2026-10-15"}
    assert scheduled, "the scan is refreshed in the background after the first load"
    for job in scheduled:
        job()
    assert len(_bounds_sql(sp_ws.sql)) == 1, "the background refresh reads the dates from the table, once"


def test_the_filter_bar_of_a_stored_page_reads_its_bounds_without_the_scan(tmp_path):
    s, sp_ws, _user_ws, _made = shell(tmp_path, pages=[_page_with()])
    s.prefetch = lambda *jobs: None
    status, out = call(s, "GET", "filters", query={"page": PAGE["id"]})
    assert status == 200
    assert _bounds_sql(sp_ws.sql) == []
    run_date = next(f for f in out["filters"] if f["id"] == "run_date")
    assert (run_date["low"], run_date["high"]) == ("2024-01-05", "2026-10-15")


def test_a_page_without_a_stored_range_scans_its_dates_as_before(tmp_path):
    s, sp_ws, _user_ws, _made = shell(tmp_path, pages=[_page_with(None)])
    status, out = call(s, "GET", "defaults", query={"page": PAGE["id"]})
    assert status == 200
    assert len(_bounds_sql(sp_ws.sql)) == 1
    assert out["range"]["run_date"] == {"preset": "12m", "from": "2025-11-01", "to": "2026-10-15"}


def test_a_stored_range_missing_one_date_filter_falls_back_to_the_scan(tmp_path):
    page = dict(PAGE, filters=PAGE["filters"] + [{"id": "second_date", "type": "date_range", "label": "Second", "grain": "month",
                                                  "default": "12m", "columns": {"trend": "as_of_date"}}])
    s, sp_ws, _user_ws, _made = shell(tmp_path, pages=[dict(page, default_range=RUN_DATE)])
    call(s, "GET", "defaults", query={"page": PAGE["id"]})
    assert len(_bounds_sql(sp_ws.sql)) == 1, "a partly stored range is never used: the scan reads every date filter"
