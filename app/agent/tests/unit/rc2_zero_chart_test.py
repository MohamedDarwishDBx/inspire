"""REQ-192: a zero-result N01-U01 rebuild (v7, on b53dcdb64) was refused because the uniform-chart check read the chart measure
'Amount at stake' as not money. Genie wrote its format as a plain number next to a tested-records count (569), so the rule-finds-nothing
test checked every measure, the count read as an exception, and each flat chart (by_age, aging_buckets, by_rule) was sent back.
The check must accept a flat stake chart when the whole scope has no stake exception, must still reject it when the scope has one,
and the empty-data checks (a one-group chart, a chart or table with zero matches under a row minimum) must be zero-state aware."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from v141_app_shell_test import PAGE, ShapedWorkspace, app_dir  # noqa: E402

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

CURRENCY = {"label": "Amount at stake", "expression": "SUM(value)", "format": "currency", "currency": "USD"}
PLAIN_STAKE = {"label": "Amount at stake", "expression": "SUM(value)", "format": "number"}
TESTED = {"label": "Records tested", "expression": "COUNT(*)", "format": "integer"}
LIVE_IDS = ["by_age", "aging_buckets", "by_rule"]


def _page(y, ids=LIVE_IDS):
    chart = next(c for c in PAGE["charts"] if c["id"] == "by_category")
    return dict(PAGE, charts=[dict(chart, id=i, type="bar", y=[dict(m) for m in y]) for i in ids])


def _shape(page, unfiltered_money, tested=569.0, groups=("18-30", "31-60")):
    """Chart queries return one row per group. The unfiltered rule query (no WHERE) returns unfiltered_money for money measures;
    the default-filter query returns 0 for money. The tested count is nonzero and differs across the groups, as the live charts did."""
    unfiltered = {shell_sql.chart_query(page, c["id"], {})[0] for c in page["charts"]}

    def shape(sql):
        if "GROUP BY" not in sql or "low_0 AS low" in sql or "SUM(y0) OVER" in sql:
            return None
        money = unfiltered_money if sql in unfiltered else 0.0
        return [{"x": g, "y0": money, "y1": tested - i} for i, g in enumerate(groups)]

    return shape


def _problems(tmp_path, page, shape):
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s.check({})


def _ranks_nothing(problems):
    return [p for p in problems if "ranks nothing" in p]


# --- the live shape: a plain-number stake measure beside the tested count, zero everywhere, no exception in the scope ---

def test_live_zero_result_shape_with_plain_stake_publishes(tmp_path):
    # fails before the fix: the tested count (569) read as an exception, so each flat chart was sent back
    page = _page([PLAIN_STAKE, TESTED])
    assert _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=0.0))) == []


def test_live_zero_result_shape_with_currency_stake_still_publishes(tmp_path):
    page = _page([CURRENCY, TESTED])
    assert _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=0.0))) == []


def test_plain_stake_with_an_exception_in_the_scope_stays_strict(tmp_path):
    # must-exclude: 7 at stake exists in the whole scope while the default filters show 0, so the flat charts are still sent back
    page = _page([PLAIN_STAKE, TESTED])
    flat = _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=7.0)))
    assert len(flat) == 3 and all("gives every group the same Amount at stake (0)" in p for p in flat), flat


def test_currency_stake_with_an_exception_in_the_scope_stays_strict(tmp_path):
    page = _page([CURRENCY, TESTED])
    flat = _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=7.0)))
    assert len(flat) == 3 and all("gives every group the same Amount at stake (0)" in p for p in flat), flat


def test_stake_worded_count_with_an_exception_in_the_scope_stays_strict(tmp_path):
    # must-exclude for the label rule: 'Late shipments at stake' is a count of exceptions, not the tested records
    late = {"label": "Late shipments at stake", "expression": "COUNT(*)", "format": "integer"}
    page = _page([late, TESTED])
    flat = _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=7.0)))
    assert len(flat) == 3 and all("gives every group the same Late shipments at stake (0)" in p for p in flat), flat


def test_stake_worded_count_with_no_exception_in_the_scope_publishes(tmp_path):
    late = {"label": "Late shipments at stake", "expression": "COUNT(*)", "format": "integer"}
    page = _page([late, TESTED])
    assert _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=0.0))) == []


def test_tested_count_alone_is_not_a_stake_measure():
    # the label rule does not turn a tested-records count into a stake measure
    assert shell_sql.stake_measure(TESTED) is False
    assert shell_sql.stake_measure(PLAIN_STAKE) is True
    assert shell_sql.stake_measure(CURRENCY) is True
    assert shell_sql.stake_measure({"label": "Late shipments at stake", "format": "integer"}) is True


# --- empty-data checks: a one-group chart with zero stake and no exception in the scope ---

def _one_group(tmp_path, unfiltered_money):
    page = _page([CURRENCY, TESTED], ids=["by_age"])
    page = dict(page, charts=page["charts"] + [dict(page["charts"][0], id=i) for i in ("aging_buckets", "by_rule")])
    return _problems(tmp_path, page, _shape(page, unfiltered_money=unfiltered_money, groups=("18-30",)))


def test_a_one_group_zero_chart_whose_rule_finds_nothing_is_not_sent_back(tmp_path):
    # fails before the fix: a one-row zero chart was sent back as 'draws one group' even though the zero result is the true picture
    problems = _one_group(tmp_path, unfiltered_money=0.0)
    assert [p for p in problems if "draws one group" in p] == [], problems


def test_a_one_group_chart_with_an_exception_in_the_scope_is_still_sent_back(tmp_path):
    problems = _one_group(tmp_path, unfiltered_money=7.0)
    one = [p for p in problems if "draws one group" in p]
    assert len(one) == 3 and all("chart a column with 2 or more values" in p for p in one), problems


# --- empty-data checks: a chart with zero matches under a row minimum ---

def test_a_zero_match_chart_under_a_row_minimum_is_held_not_short(tmp_path, monkeypatch):
    page = _page([CURRENCY, TESTED], ids=["by_age", "aging_buckets", "by_rule"])

    def zero(sql):
        return [] if "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql else None

    monkeypatch.setattr(shell_sql, "row_minimums", lambda p: [("triage_queue", 3, ("chart", "by_age"))])
    problems = _problems(tmp_path, page, zero)
    assert [p for p in problems if "shows at least 3 rows" in p] == [], problems
    assert [p for p in problems if "returned no rows" in p] == [], problems


def test_a_chart_under_a_row_minimum_with_rows_in_its_scope_is_still_short(tmp_path, monkeypatch):
    # must-exclude: the whole scope holds rows, so a chart that shows fewer than its minimum at the default filters is still short
    page = _page([CURRENCY, TESTED], ids=["by_age", "aging_buckets", "by_rule"])

    def shape(sql):
        if "GROUP BY" not in sql or "low_0 AS low" in sql or "SUM(y0) OVER" in sql:
            return None
        return [{"x": "18-30", "y0": 7.0, "y1": 2.0}]

    monkeypatch.setattr(shell_sql, "row_minimums", lambda p: [("triage_queue", 3, ("chart", "by_age"))])
    problems = _problems(tmp_path, page, shape)
    assert any("shows at least 3 rows" in p and "chart by_age returned 1" in p for p in problems), problems


def test_zero_matches_with_a_plain_stake_chart_fail_no_check(tmp_path):
    # zero matches everywhere (the whole scope is empty): no chart, KPI or table fails the App, and the zero result is a note
    page = _page([PLAIN_STAKE, TESTED])

    def empty(sql):
        return [] if "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql else None

    problems = _problems(tmp_path, page, empty)
    assert [p for p in problems if "returned no rows" in p or "ranks nothing" in p or "draws one group" in p] == [], problems
