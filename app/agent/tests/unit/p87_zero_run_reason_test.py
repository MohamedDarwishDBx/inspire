"""REQ-297 (P87 round 3): a use case whose latest run checked records and wrote no result row says so plainly, in every App language,
through the REQ-270 KPI reason path. It never shows 'Not recorded' or 'No rows match these filters' for that run.

Live cause: the walker's WA App (inspire-fwa-batch-a-walk-fraud) read its result table, which held 0 rows, so every KPI said
'No rows match these filters' and the value read 'Not recorded'. Its run summary had the records it checked and no Act now or Review."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

PAGE = {"id": "n01_u01", "layout": "records_table", "result_table": "main.s.results",
        "kpis": [{"id": "exceptions", "label": "Exceptions", "dataset": "rows", "expression": "COUNT(*)", "format": "integer"}]}
EMPTY_SHOWN = {"now": None, "before": None}
CLEAN_RUN = {"records": 583, "act_now_records": 0, "review_records": 0}


def test_a_zero_result_kpi_of_a_run_that_checked_records_says_what_it_did(tmp_path):
    # fails before the fix: kpi_missing had no checked reason, so the value stayed blank with 'No rows match these filters'
    shown = shell_sql.kpi_missing(PAGE, EMPTY_SHOWN, 0, "", shell_sql.zero_run_checked(CLEAN_RUN))
    assert shown["now"] == 0
    assert shown["empty"]["en"] == "This run checked 583 records and found nothing to act on"
    assert "No rows match" not in str(shown) and "Not recorded" not in str(shown)


def test_the_reason_is_in_every_app_language_with_the_count_filled_in():
    reasons = shell_sql.kpi_empty_text(PAGE, checked=583)
    languages = shell_sql.kinds_registry()["tour"]["languages"]
    assert set(reasons) == {lang["code"] for lang in languages.values()}
    assert all("583" in text and "{checked}" not in text for text in reasons.values()), reasons


def test_a_run_with_a_flagged_record_is_not_a_zero_result():
    # must-exclude: Act now or Review records exist, so the zero is not 'found nothing to act on'
    for flagged in ({"act_now_records": 2, "review_records": 0}, {"act_now_records": 0, "review_records": 1}):
        assert shell_sql.zero_run_checked(dict(CLEAN_RUN, **flagged)) is None, flagged


def test_a_run_that_checked_no_record_or_has_no_summary_keeps_the_old_reason():
    # must-exclude: nothing was checked, or no run has written a summary: the REQ-270 wording stays
    assert shell_sql.zero_run_checked(dict(CLEAN_RUN, records=0)) is None
    assert shell_sql.zero_run_checked(None) is None
    shown = shell_sql.kpi_missing(PAGE, EMPTY_SHOWN, 0, "", None)
    assert shown["now"] is None and shown["empty"]["en"] == "No rows match these filters"


def test_a_missing_count_in_the_summary_is_not_read_as_nothing_found():
    assert shell_sql.zero_run_checked({"records": 583, "act_now_records": None, "review_records": 0}) is None


def test_a_kpi_with_rows_behind_it_is_a_measured_value_and_is_not_touched():
    shown = {"now": 0, "before": None}
    assert shell_sql.kpi_missing(PAGE, shown, 4, "", 583) == shown
