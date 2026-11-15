"""REQ-238: a use case's own views are part of the use case in every ownership check.

A side output (vibe keep) builds its Genie Agent and its App on the versioned views <table scope view>__v<N>, and an attempt builds on
__candidate views. The Genie table check, the dataset/dashboard/alert read check and the privilege-denial owner check each asked whether
the name was in the use case's list, which held only the live names, so a v7 Genie Agent was refused as 'outside this use case'.
One helper (implement_use_case_table) answers the question for all of them: a name belongs to the use case when its root (the name
without __candidate or __v<N>) is the root of one of the use case's tables or views. Other tables, and names that only look alike, stay outside.
"""
import json

import pytest

TABLE = "main.sales.orders"
VIEW = "main.sales.orders__implement_scope"
OTHER = "other.hr.salaries"
ALLOWED = ["main.sales.orders", "main.sales.customers"]


@pytest.mark.parametrize("name", [
    "main.sales.orders", "main.sales.orders__v7", "main.sales.orders__v12", "main.sales.orders__candidate",
    "MAIN.SALES.ORDERS__V7", "`main`.`sales`.`orders`__v7",
    "main.sales.customers__v3",
])
def test_the_use_cases_own_tables_and_views_are_part_of_the_use_case(agent_ns, name):
    assert agent_ns["implement_use_case_table"](name, ALLOWED) is True


@pytest.mark.parametrize("name", [
    "other.hr.salaries", "other.hr.salaries__v7", "main.sales.orders_v7", "main.sales.orders__v7x",
    "main.sales.orders__v", "main.sales.orders__candidate2", "main.sales.ordersx__v7", "orders__v7x__v7x", "",
])
def test_names_of_another_table_or_a_lookalike_stay_outside_the_use_case(agent_ns, name):
    assert agent_ns["implement_use_case_table"](name, ALLOWED) is False


def test_a_candidate_only_allowed_list_still_admits_the_live_and_versioned_views_of_the_table(agent_ns):
    """The Genie check is given the candidate names of an attempt; the live and versioned names of the same table are its views too."""
    assert agent_ns["implement_use_case_table"]("main.sales.orders__v7", ["main.sales.orders__candidate"]) is True
    assert agent_ns["implement_use_case_table"]("main.sales.orders", ["main.sales.orders__candidate"]) is True
    assert agent_ns["implement_use_case_table"]("other.hr.salaries__v7", ["main.sales.orders__candidate"]) is False


def test_the_genie_space_check_accepts_the_versioned_view_of_its_table(agent_ns):
    space = {"title": "Orders", "data_sources": {"tables": [{"identifier": TABLE + "__v7", "column_configs": []}]},
             "config": {"sample_questions": [{"id": "a" * 32, "question": ["How many orders?"]}]}, "instructions": {},
             "benchmarks": {"questions": []}}
    errors = agent_ns["normalize_genie_space"](json.dumps(space), [TABLE])[3]
    assert not [e for e in errors if "outside this use case" in e], errors


def test_the_genie_space_check_still_refuses_a_versioned_view_of_another_table(agent_ns):
    space = {"title": "Orders", "data_sources": {"tables": [{"identifier": OTHER + "__v7", "column_configs": []}]},
             "config": {"sample_questions": [{"id": "a" * 32, "question": ["How many salaries?"]}]}, "instructions": {},
             "benchmarks": {"questions": []}}
    errors = agent_ns["normalize_genie_space"](json.dumps(space), [TABLE])[3]
    assert any(f"uses table {OTHER}__v7, which is outside this use case" in e for e in errors), errors


def test_the_sql_read_check_accepts_versioned_and_candidate_views_of_the_use_case(agent_ns):
    sql = ["SELECT SUM(amount) FROM main.sales.orders__v7 JOIN main.sales.customers__candidate c ON true",
           "SELECT * FROM main.sales.orders__candidate"]
    assert agent_ns["_implement_unknown_tables"](sql, ALLOWED) == []


def test_the_sql_read_check_still_names_a_versioned_view_of_another_table(agent_ns):
    sql = ["SELECT * FROM main.sales.orders__v7, other.hr.salaries__v7"]
    assert agent_ns["_implement_unknown_tables"](sql, ALLOWED) == ["other.hr.salaries__v7"]


def test_a_privilege_denial_on_a_versioned_view_is_the_use_cases_own_and_a_foreign_one_is_not(agent_ns):
    owned = {"main", "main.sales", "main.sales.orders"}
    own = "[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.sales.orders__v7'."
    foreign = "[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'other.hr.salaries__v7'."
    assert agent_ns["implement_privilege_denial"](own, owned) != ""
    assert agent_ns["implement_privilege_denial"](foreign, owned) == ""


def test_the_unversioned_view_name_helper_strips_only_a_trailing_suffix(agent_ns):
    root = agent_ns["implement_use_case_root"]
    assert root("main.sales.orders__v7") == "main.sales.orders"
    assert root("main.sales.orders__candidate") == "main.sales.orders"
    assert root("main.sales.orders__v7__v8") == "main.sales.orders__v7"
