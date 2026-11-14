import copy
import json
import re
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402
from shell_db import HttpError, QueryError  # noqa: E402
from v141_app_shell_test import PAGE, app_dir  # noqa: E402
from v142_edits_test import edit_page  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, Now, ask, said  # noqa: E402

# The exact live question from REQ-190 (App N01-U01, scratch App inspire-kinds-rc7, build e52705df7).
LIVE_QUESTION = "Which 5 franchises had the highest total sales last month?"
LIVE_TITLE = "Eliminate Mismatched Sales Records using Tokyo Tidbits to Prevent Losses"
SALES = "inspire_kinds_rc7._inspire.sales_transactions"
IN_SCOPE_CONTROL = "Which franchises have the most transactions failing a control?"


SALES_COLUMNS = [{"name": "franchise", "type": "STRING"}, {"name": "TotalPrice", "type": "DECIMAL(18,2)"},
                 {"name": "transaction_id", "type": "STRING"}]


def sales_page(select_star=False):
    sql = f"SELECT * FROM {SALES}" if select_star else f"SELECT franchise, TotalPrice, transaction_id FROM {SALES}"
    datasets = copy.deepcopy(PAGE["datasets"]) + [{"name": "sales", "sql": sql}]
    return edit_page(title=LIVE_TITLE, question="Which sales records mismatch the control?", datasets=datasets)


def live_shell(tmp_path, llm, select_star=False):
    ws = AgentWorkspace(llm=llm, listed=SALES_COLUMNS)
    s = shell_core.Shell(app_dir(tmp_path, DECIDE, [sales_page(select_star)]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    s.agent.executor, s.agent.sleep = Now(), lambda seconds: None
    return s


def scope_of(page=None):
    sources = shell_agent.page_sources(page or sales_page())
    known = shell_agent.topic_words(LIVE_TITLE) | shell_agent.topic_words(" ".join(
        str(x) for d in sources for x in (d.get("tables") or []) + (d.get("columns") or [])))
    tables, scoped = shell_agent.source_scope(sources)
    return known | scoped, scoped, tables


@pytest.mark.parametrize("question", [LIVE_QUESTION])
def test_a_question_the_scoped_columns_answer_is_related_by_rule_without_the_model(question):
    known, scoped, tables = scope_of()
    assert shell_agent.topic_by_rule(question, known, False, scoped, tables) == "RELATED"


def test_the_live_question_reaches_the_answer_not_the_refusal_even_when_the_model_would_say_unrelated(tmp_path):
    llm = FakeLLM([said("Franchise A led with the most sales last month.")], related=lambda body: False)
    s = live_shell(tmp_path, llm)
    turn = ask(s, LIVE_QUESTION, page=sales_page()["id"])
    assert turn["refused"] is False and turn["answer"] != shell_agent.OFF_TOPIC
    assert llm.bodies == llm.main_calls(), "the scoped columns decide the live question, so the model topic check never runs"


def test_the_live_question_is_related_when_the_scope_is_read_from_the_table_and_columns_only():
    question = "Which 5 franchises had the highest total sales last month?"
    scoped = shell_agent.identifier_words(["franchise", "TotalPrice", "sales_transactions"])
    tables = frozenset({SALES})
    assert shell_agent.topic_by_rule(question, set(), False, scoped, tables) == "RELATED"


@pytest.mark.parametrize("question", [
    "What is the weather in Paris?",
    "What is the weather in Paris last month?",
    "How many fishermen are in Paris?",
])
def test_a_question_naming_no_scoped_column_is_not_decided_by_rule(question):
    known, scoped, tables = scope_of()
    assert shell_agent.topic_by_rule(question, known, False, scoped, tables) == ""


@pytest.mark.parametrize("question", ["What is the weather in Paris?", "What is the weather in Paris last month?"])
def test_an_off_scope_question_with_no_scoped_word_is_refused_by_the_model_check(tmp_path, question):
    llm = FakeLLM([said("A has 4.")], related=lambda body: False)
    s = live_shell(tmp_path, llm)
    turn = ask(s, question, page=sales_page()["id"])
    assert turn == dict(turn, state="done", answer=shell_agent.OFF_TOPIC, refused=True, steps=[], actions=[])
    assert llm.main_calls() == [] and len(llm.bodies) == 1


@pytest.mark.parametrize("question", [
    "Which franchises are in main.retail.stores?",
    "Which 5 franchises had the highest total sales in main.retail.stores?",
])
def test_a_question_naming_a_table_outside_the_scope_is_refused_even_when_the_model_would_say_related(tmp_path, question):
    llm = FakeLLM([said("A has 4.")], related=lambda body: True)
    s = live_shell(tmp_path, llm)
    turn = ask(s, question, page=sales_page()["id"])
    assert turn == dict(turn, state="done", answer=shell_agent.OFF_TOPIC, refused=True, steps=[], actions=[])
    assert llm.main_calls() == [] and llm.bodies == []


def test_a_table_outside_the_scoped_tables_is_refused_by_rule():
    known, scoped, tables = scope_of()
    assert shell_agent.topic_by_rule("Which franchises are in main.retail.stores?", known, False, scoped, tables) == "UNRELATED"
    assert shell_agent.topic_by_rule(f"Which franchises are in {SALES}?", known, False, scoped, tables) == "RELATED"


def test_the_topic_check_names_the_source_tables_and_columns_not_only_the_title():
    system = shell_agent.TOPIC_SYSTEM
    assert "source_data" in system and "even when it does not repeat the use case title" in system
    assert "highest total sales last month" in system and "general knowledge" in system


def test_identifier_words_split_camel_case_and_underscores():
    words = shell_agent.identifier_words(["TotalPrice", "sales_transactions", "main.pricing.items"])
    assert {"total", "price", "sales", "transactions", "pricing", "items"} <= words


def test_shape_words_alone_do_not_make_a_question_on_topic():
    assert shell_agent.topic_by_rule("how many last month?", set(), False, set(), frozenset()) == ""
    assert shell_agent.topic_by_rule("Which 5 had the highest last month?", set(), False, set(), frozenset()) == ""


def test_a_select_star_dataset_gets_its_real_columns_from_the_app_read(tmp_path):
    llm = FakeLLM([said("Franchise A led with the most sales last month.")], related=lambda body: False)
    s = live_shell(tmp_path, llm, select_star=True)
    turn = ask(s, LIVE_QUESTION, page=sales_page()["id"])
    assert turn["refused"] is False and turn["answer"] != shell_agent.OFF_TOPIC
    assert llm.bodies == llm.main_calls(), "SELECT * names no columns; the App's own column read supplies franchise and TotalPrice to the rule"


def test_a_select_star_scope_holds_the_real_column_names_and_a_parsed_dataset_keeps_its_own(tmp_path):
    llm = FakeLLM([], related=lambda body: False)
    ws = AgentWorkspace(llm=llm, listed=SALES_COLUMNS)
    s = shell_core.Shell(app_dir(tmp_path, DECIDE, [sales_page(select_star=True)]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    page = sales_page(select_star=True)
    sources = shell_agent.page_sources(page)
    star = next(d for d in sources if d["dataset"] == "sales")
    assert star["columns"] == [], "SELECT * names no columns in its SQL"
    s.agent.source_columns(ws, "me", page, sources)
    assert star["columns"] == ["franchise", "TotalPrice", "transaction_id"]
    parsed = next(d for d in shell_agent.page_sources(page) if d["dataset"] != "sales" and d.get("columns"))
    before = list(parsed["columns"])
    s.agent.source_columns(ws, "me", page, sources)
    assert parsed["columns"] == before, "a dataset whose SQL names its columns is never re-read"


@pytest.mark.parametrize("question", ["What is the weather in Paris?", "What is the weather in Paris last month?"])
def test_the_weather_must_exclude_still_refuses_on_a_select_star_page(tmp_path, question):
    llm = FakeLLM([said("A has 4.")], related=lambda body: False)
    s = live_shell(tmp_path, llm, select_star=True)
    turn = ask(s, question, page=sales_page()["id"])
    assert turn == dict(turn, state="done", answer=shell_agent.OFF_TOPIC, refused=True, steps=[], actions=[])
    assert llm.main_calls() == [] and len(llm.bodies) == 1


FAILURES = [HttpError(502, "warehouse is busy"), QueryError("column read failed")]


def failing_list_columns(exc):
    def raise_it(self, ws, who, page, dataset="records"):
        raise exc
    return raise_it


@pytest.mark.parametrize("exc", FAILURES, ids=["HttpError", "QueryError"])
def test_a_failed_column_read_leaves_the_source_entry_unchanged(tmp_path, monkeypatch, exc):
    monkeypatch.setattr(shell_core.Shell, "list_columns", failing_list_columns(exc))
    llm = FakeLLM([], related=lambda body: False)
    ws = AgentWorkspace(llm=llm, listed=SALES_COLUMNS)
    s = shell_core.Shell(app_dir(tmp_path, DECIDE, [sales_page(select_star=True)]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    page = sales_page(select_star=True)
    sources = shell_agent.page_sources(page)
    before = [dict(d) for d in sources]
    s.agent.source_columns(ws, "me", page, sources)
    assert sources == before and next(d for d in sources if d["dataset"] == "sales")["columns"] == []


@pytest.mark.parametrize("exc", FAILURES, ids=["HttpError", "QueryError"])
@pytest.mark.parametrize("model_says", [True, False])
def test_the_ask_survives_a_failed_column_read_and_decides_by_the_rest(tmp_path, monkeypatch, exc, model_says):
    monkeypatch.setattr(shell_core.Shell, "list_columns", failing_list_columns(exc))
    llm = FakeLLM([said("Franchise A led with the most sales last month.")], related=lambda body: model_says)
    s = live_shell(tmp_path, llm, select_star=True)
    turn = ask(s, LIVE_QUESTION, page=sales_page()["id"])
    assert turn["state"] == "done" and "Traceback" not in json.dumps(turn) and turn.get("error") in (None, "")
    if model_says:
        assert turn["refused"] is False and turn["answer"] != shell_agent.OFF_TOPIC
    else:
        assert turn["refused"] is True and turn["answer"] == shell_agent.OFF_TOPIC
    assert llm.bodies[0]["max_tokens"] == shell_agent.TOPIC_TOKENS, "the failed read leaves the model check to decide"
    assert len(llm.bodies) == (2 if model_says else 1)


def test_a_failed_read_still_refuses_weather_with_no_exception(tmp_path, monkeypatch):
    monkeypatch.setattr(shell_core.Shell, "list_columns", failing_list_columns(HttpError(502, "busy")))
    llm = FakeLLM([said("A has 4.")], related=lambda body: False)
    s = live_shell(tmp_path, llm, select_star=True)
    turn = ask(s, "What is the weather in Paris?", page=sales_page()["id"])
    assert turn == dict(turn, state="done", answer=shell_agent.OFF_TOPIC, refused=True, steps=[], actions=[])


FORECAST_RESULT = "inspire_kinds_rc7._inspire.supply_forecast_out"
SCOPE_SOURCES = [{"table": SALES, "columns": ["franchise", "TotalPrice", "transaction_id"]}]


def forecast_page():
    """The forecast family shape: every dataset reads only the use case's result table, never a source table."""
    datasets = [{"name": d["name"], "sql": re.sub(r"FROM\s+[\w.`]+", f"FROM {FORECAST_RESULT}", d["sql"])} for d in PAGE["datasets"]]
    return edit_page(title="Plan Weekly Product Supply", question="Which supply should we plan next week?", result_table=FORECAST_RESULT,
                     datasets=datasets)


def forecast_shell(tmp_path, llm, scope_sources):
    ws = AgentWorkspace(llm=llm, listed=SALES_COLUMNS)
    settings = dict(DECIDE, scope_sources=scope_sources)
    s = shell_core.Shell(app_dir(tmp_path, settings, [forecast_page()]),
                         env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=lambda: ws, user_factory=lambda host, token: ws)
    s.agent.executor, s.agent.sleep = Now(), lambda seconds: None
    return s


SALES_QUESTION = "How many sales transactions are there in total?"


def test_a_forecast_page_question_about_the_build_source_table_is_related_with_no_model_call(tmp_path):
    llm = FakeLLM([said("There are 42 sales transactions in total.")], related=lambda body: False)
    s = forecast_shell(tmp_path, llm, SCOPE_SOURCES)
    turn = ask(s, SALES_QUESTION, page=forecast_page()["id"])
    assert turn["refused"] is False and turn["answer"] != shell_agent.OFF_TOPIC
    assert llm.bodies == llm.main_calls(), "the App's own scope sources name sales_transactions, so the rule decides with no model call"


def test_a_forecast_page_question_about_a_source_table_it_does_not_have_is_still_model_checked(tmp_path):
    llm = FakeLLM([said("ok")], related=lambda body: False)
    s = forecast_shell(tmp_path, llm, [])
    turn = ask(s, SALES_QUESTION, page=forecast_page()["id"])
    assert turn["refused"] is True and turn["answer"] == shell_agent.OFF_TOPIC


@pytest.mark.parametrize("question", ["What is the weather in Paris?", "What is the weather in Paris last month?"])
def test_the_weather_must_exclude_stays_refused_on_the_forecast_page_with_scope_sources(tmp_path, question):
    llm = FakeLLM([said("A has 4.")], related=lambda body: False)
    s = forecast_shell(tmp_path, llm, SCOPE_SOURCES)
    turn = ask(s, question, page=forecast_page()["id"])
    assert turn == dict(turn, state="done", answer=shell_agent.OFF_TOPIC, refused=True, steps=[], actions=[])
    assert llm.main_calls() == [] and len(llm.bodies) == 1


def test_the_build_writes_the_scope_views_tables_and_columns_page_independent(fresh_ns):
    scopes = {"k": {"table": SALES, "view": "v", "columns": ["franchise", "TotalPrice"]}, "bad": "not a scope"}
    assert fresh_ns["implement_app_scope_sources"](scopes) == [{"table": SALES, "columns": ["franchise", "TotalPrice"]}]
    assert fresh_ns["implement_app_scope_sources"](None) == []
