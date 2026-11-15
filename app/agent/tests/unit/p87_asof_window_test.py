"""P87 round 2 (REQ-290, D-AUTO): a money window counts back from the data's own last date, not from today, when the page stores its
default range at publish (P85). The walker's only run is dated 2024-05-17 and its 12-month window counted back from today, so the
window held no rows and the builder had to switch the date filters to all. A historical as-of must never show an empty window."""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from money_currency_split_test import PAGE  # noqa: E402

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

# the WA App (inspire-fwa-batch-a-walk-fraud) reads its own data dates: the only run is dated 2024-05-17, two years before the walk
TWO_YEARS_AGO = dt.date(2024, 5, 17)
WINDOWED = dict(PAGE, money={"currency": "per_currency", "window": {"periods": 12}})


def _stored(page, high):
    return dict(page, default_range={"ticket_month": {"low": "2023-01-01", "high": high.isoformat()}})


def test_a_two_year_old_as_of_window_counts_back_from_the_data_not_today():
    # fails before the fix: the lookback read current_date() only, so the stored as-of never reached the money window
    sql, _ = shell_sql.kpi_query(_stored(WINDOWED, TWO_YEARS_AGO), "exposure", {})
    assert f"DATE '{TWO_YEARS_AGO.isoformat()}'" in sql, sql
    assert "add_months(date_trunc('month', LEAST(current_date(), DATE" in sql, sql


def test_the_window_anchor_is_capped_at_today_for_a_stored_range_in_the_future():
    future = dt.date.today() + dt.timedelta(days=40)
    assert shell_facts.window_anchor(_stored(WINDOWED, future), "rows", "event_month") == \
        f"LEAST(current_date(), DATE '{future.isoformat()}')"


def test_a_page_with_no_stored_range_still_counts_back_from_today():
    # must-exclude: pages published before P85 keep today's anchor, unchanged
    sql, _ = shell_sql.kpi_query(WINDOWED, "exposure", {})
    assert "add_months(date_trunc('month', current_date()), -12)" in sql, sql


def test_a_malformed_stored_high_falls_back_to_today():
    page = dict(WINDOWED, default_range={"ticket_month": {"low": "2023-01-01", "high": "not a date"}})
    assert shell_facts.window_anchor(page, "rows", "event_month") == "current_date()"
