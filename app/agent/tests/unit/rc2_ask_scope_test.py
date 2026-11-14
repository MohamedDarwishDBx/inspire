import copy
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402
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
