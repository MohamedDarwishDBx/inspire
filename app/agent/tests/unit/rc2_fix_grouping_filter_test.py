"""REQ-191: a Grouping column the decision list does not show never gets a column filter.

Live defect (scratch App inspire-kinds-rc7, N01-U02, spec v5): the planned Grouping paymentMethod was set on the group_by widget,
and the App acceptance run at its default filters failed on the decision list's column filter paymentMethod:
[UNRESOLVED_COLUMN.WITH_SUGGESTION] ... Did you mean one of the following? [method, entity_id, as_of_date, action_status, held_back].
The results table holds no paymentMethod column, so the filter's distinct-values query could never run.

Root cause: shell_sql.list_column_filters added one multi_select filter for every grouping entry, falling back to the grouping
name when the decision list did not show that column. The explicit column filters are already checked against the shown
columns (shell_sql.column_filter_problems); the grouping filters bypassed that contract.

Contract after the fix: a grouping filter exists only for a column the decision list shows, matched case-insensitively.
"""
import copy
import os
import sys

import pytest

from v161_app_column_filters_test import returns_page

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402


def with_grouping(page, names):
    out = copy.deepcopy(page)
    grouping = shell_sql.page_grouping(out, names)
    if grouping:
        out["grouping"] = grouping
    return out


def filter_columns(page):
    return [f["column"] for f in shell_sql.list_column_filters(page)]


def grouping_columns(page):
    return [f["column"] for f in shell_sql.list_column_filters(page) if f.get("grouping")]


# --- fail-pre on the live shape: the Grouping paymentMethod is not a column of the decision list -------------------------------

def test_req191_live_grouping_column_missing_from_the_decision_list_gets_no_column_filter():
    page = with_grouping(returns_page(), ["paymentMethod"])
    assert "paymentMethod" not in filter_columns(page)
    assert grouping_columns(page) == []


def test_req191_the_distinct_values_query_is_never_built_for_a_grouping_column_the_list_lacks():
    page = with_grouping(returns_page(), ["paymentMethod"])
    with pytest.raises(KeyError, match="paymentMethod"):
        shell_sql.column_options_query(page, None, "paymentMethod")


def test_req191_the_page_column_filters_the_checks_read_hold_no_grouping_for_a_missing_column():
    page = with_grouping(returns_page(), ["paymentMethod"])
    assert "paymentMethod" not in [f["column"] for f in shell_sql.page_column_filters(page)["list"]]


def test_req191_the_grouping_is_still_named_on_the_page_for_the_run_label():
    page = with_grouping(returns_page(), ["paymentMethod"])
    assert page["grouping"] == {"mode": "columns", "group_by": [{"column": "paymentMethod", "label": "PaymentMethod"}]}


# --- must-exclude: a grouping column the list shows still gets its filter ------------------------------------------------------

def test_req191_a_shown_grouping_column_still_gets_its_filter_with_the_list_label():
    page = with_grouping(returns_page(), ["channel"])
    found = [f for f in shell_sql.list_column_filters(page) if f["column"] == "channel"]
    assert len(found) == 1 and found[0]["grouping"] is True and found[0]["type"] == "multi_select"
    assert found[0]["label"] == shell_sql.list_shown(page["records"])["channel"][0]


def test_req191_grouping_names_match_the_shown_columns_case_insensitively():
    page = with_grouping(returns_page(), ["Channel", "RETURN_REASON"])
    assert grouping_columns(page) == ["channel", "return_reason"]


def test_req191_mixed_grouping_keeps_the_shown_column_and_drops_only_the_missing_one():
    page = with_grouping(returns_page(), ["channel", "paymentMethod", "return_reason"])
    assert grouping_columns(page) == ["channel", "return_reason"]
    assert "paymentMethod" not in filter_columns(page)
    assert shell_sql.column_options_query(page, None, "channel")  # a real column still builds its values query


def test_req191_an_explicit_list_filter_on_a_shown_column_is_not_duplicated_by_the_grouping():
    page = with_grouping(returns_page(), ["channel"])
    assert filter_columns(page).count("channel") == 1


# --- sweep: every dataset-backed filter the decision list offers is a column the list shows ------------------------------------

@pytest.mark.parametrize("names", [[], ["channel"], ["paymentMethod"], ["product", "paymentMethod"], ["all"], ["channel", "product"]])
def test_req191_sweep_every_list_filter_column_is_shown_or_is_an_action_filter(names):
    page = with_grouping(returns_page(), names) if names else returns_page()
    shown = shell_sql.list_shown(page["records"])
    for f in shell_sql.list_column_filters(page, actions=True):
        if f.get("action"):
            continue
        assert f["column"] in shown or f["column"].lower() in {c.lower() for c in shown}, f
