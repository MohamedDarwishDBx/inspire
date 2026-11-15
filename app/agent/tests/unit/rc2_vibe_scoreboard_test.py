import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import pytest  # noqa: E402

import shell_core  # noqa: E402

# REQ-214: the vibe scoreboard must not call a split ask done from the page spec alone (a filter the served App never shows),
# nor call a chart missing when its title names the measure.

VIBE_CHART = "Add a bar chart of total sales by franchise for the last 30 days"
VIBE_FILTER = "a filter on franchise"
PAGE_ID = "n02_u01"
CHART = {"id": "franchise_sales", "type": "bar", "title": "Total sales by franchise for the last 30 days",
         "x": {"column": "franchise", "label": "Franchise"}, "y": {"column": "sales_amount", "label": "Sales"}}
UNTITLED = {"id": "other", "type": "bar", "title": "Stock on hand by site", "x": {"column": "site", "label": "Site"},
            "y": {"column": "units", "label": "Units"}}
FILTER = {"id": "franchise", "type": "multi_select", "label": "Franchise", "columns": {"sales": "franchise"}}
PAGE = {"id": PAGE_ID, "title": "Silent franchise sales monitor", "question": "Which franchises went quiet?",
        "charts": [CHART], "filters": [FILTER]}
SERVED_OK = {PAGE_ID: {"franchise": {"label": "Franchise", "problem": ""}}}


def _chart_check(value):
    return {"kind": "column", "value": value}


def _fact(agent_ns, check, page, served="absent", label="App page n02_u01"):
    kwargs = {} if served == "absent" else {"served": served}
    return agent_ns["implement_vibes_fact"](check, page, label, ("bar",), None, None, **kwargs)


def _checked(agent_ns, check, page, served="absent", chart_types=("bar",)):
    kwargs = {} if served == "absent" else {"served": served}
    ask = {"ask": VIBE_FILTER, "check": check, "keep": False, "where": ""}
    return agent_ns["implement_vibes_checked"](ask, "app:page:" + PAGE_ID, page, {}, None, None, "App page n02_u01", chart_types,
                                              None, **kwargs)


def test_a_measure_named_only_in_the_chart_title_is_done_and_names_the_chart(agent_ns):
    status, evidence = _fact(agent_ns, _chart_check("total sales"), dict(PAGE, charts=[CHART]))
    assert status == "done"
    assert "franchise_sales" not in evidence or "Total sales by franchise" in evidence
    assert "Total sales by franchise for the last 30 days" in evidence


def test_a_measure_absent_from_every_title_and_column_stays_missing(agent_ns):
    status, _ = _fact(agent_ns, _chart_check("total sales"), dict(PAGE, charts=[UNTITLED]))
    assert status == "missing"


def test_a_title_word_match_needs_whole_words(agent_ns):
    chart = dict(CHART, title="Total salesforce pipeline by franchise")
    assert _fact(agent_ns, _chart_check("total sales"), dict(PAGE, charts=[chart]))[0] == "missing"


def test_a_page_title_never_counts_as_a_chart_column(agent_ns):
    status, _ = _fact(agent_ns, _chart_check("total sales"), dict(PAGE, charts=[UNTITLED]))
    assert status == "missing"


def test_a_filter_listed_with_options_in_the_served_meta_is_done(agent_ns):
    status, evidence = _fact(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE, SERVED_OK)
    assert status == "done" and "franchise" in evidence


def test_a_filter_missing_from_the_served_meta_is_not_done_even_though_the_spec_has_it(agent_ns):
    status, evidence = _fact(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE, {PAGE_ID: {}})
    assert status == "missing"
    assert "no filter on franchise" in evidence and "none" in evidence


def test_a_filter_the_served_app_lists_with_an_error_is_not_done(agent_ns):
    served = {PAGE_ID: {"franchise": {"label": "Franchise", "problem": "it is served with an error: TABLE_OR_VIEW_NOT_FOUND"}}}
    status, evidence = _fact(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE, served)
    assert status == "missing" and "TABLE_OR_VIEW_NOT_FOUND" in evidence


def test_a_filter_on_a_page_whose_served_meta_was_not_read_is_unchecked_not_done(agent_ns):
    status, evidence = _fact(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE, {})
    assert status == "missing" and evidence.startswith(agent_ns["IMPLEMENT_VIBES_UNCHECKED"])


def test_without_a_served_source_the_spec_check_is_unchanged(agent_ns):
    assert _fact(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE)[0] == "done"


def test_split_vibe_chart_met_and_filter_missing_gives_one_unmet_the_filter(agent_ns):
    served_none_listed = {PAGE_ID: {}}
    chart = _checked(agent_ns, {"kind": "chart_type", "value": "bar"}, PAGE, served_none_listed)
    filt = _checked(agent_ns, {"kind": "filter", "value": "franchise"}, PAGE, served_none_listed)
    assert chart[0] == "done"
    assert filt[0] == "missing"
    unmet = [status for status, _evidence in (chart, filt) if status != "done"]
    assert len(unmet) == 1


def test_a_truly_missing_chart_stays_unmet_while_a_served_filter_is_met(agent_ns):
    page = dict(PAGE, charts=[UNTITLED])
    chart = _checked(agent_ns, _chart_check("total sales"), page, SERVED_OK)
    filt = _checked(agent_ns, {"kind": "filter", "value": "franchise"}, page, SERVED_OK)
    assert chart[0] == "missing"
    assert filt[0] == "done"


def test_the_served_problem_is_empty_only_for_a_filter_with_options_and_no_error():
    assert shell_core.served_filter_problem({"id": "f", "type": "multi_select", "options": ["North"]}) == ""
    assert shell_core.served_filter_problem({"id": "f", "type": "multi_select", "options": []}) == "it is served with no options"
    assert shell_core.served_filter_problem({"id": "f", "type": "multi_select", "options": ["N"], "error": "boom"}).endswith("boom")
    assert shell_core.served_filter_problem({"id": "d", "type": "date_range", "low": "2020", "high": "2026"}) == ""
    assert shell_core.served_filter_problem({"id": "d", "type": "date_range", "low": None, "high": None}) == \
        "it is served with no dates"
