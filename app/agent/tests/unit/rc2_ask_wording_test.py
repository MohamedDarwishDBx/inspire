import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
from rc2_ask_scope_test import FULL_SOURCES, SALES, SCOPE_SOURCES, forecast_page, forecast_shell  # noqa: E402
from v211_genie_agent_test import FakeLLM, ask, said  # noqa: E402

SALES_QUESTION = "How many sales transactions are there in total?"


def test_a_genie_count_over_all_rows_gets_no_scope_note(tmp_path):
    result = {"sql": "SELECT COUNT(*) AS transactions FROM inspire_kinds_rc7._inspire.sales_transactions", "rows": [{"transactions": 3333}]}
    assert shell_agent.genie_note("There are 3,333 sales transactions in total.", result) == ""
    assert "every row of every run" not in shell_agent.genie_note("3,333", result)


def test_a_genie_count_that_disagrees_with_the_page_says_across_all_rows_in_plain_words(tmp_path):
    item = {"label": "Transactions failing", "value": 120.0, "counts": "", "scope": "Region: East"}
    result = {"sql": "SELECT COUNT(*) AS n FROM inspire_kinds_rc7._inspire.sales_transactions", "rows": [{"n": 3333}]}
    clashes, _notes = shell_agent.number_scopes("Transactions failing 120 for Region: East; 3,333 in total.", SALES_QUESTION,
                                                [item], [dict(result, question="How many?")])
    text = " ".join(clashes)
    assert "across all rows" in text and "every row" not in text and "SELECT" not in text


def test_a_refusal_names_what_it_can_answer_with_examples_from_the_scope(tmp_path):
    llm = FakeLLM([said("ok")], related=lambda body: False)
    s = forecast_shell(tmp_path, llm, SCOPE_SOURCES)
    turn = ask(s, "What is the weather in Paris?", page=forecast_page()["id"])
    assert turn["refused"] is True and turn["answer"].startswith(shell_agent.OFF_TOPIC)
    lines = [line for line in turn["answer"].split("\n") if line.startswith("- ")]
    assert 2 <= len(lines) <= shell_agent.SCOPE_EXAMPLES, turn["answer"]
    assert any("sales transactions" in line for line in lines), "an example names the source table in words"
    assert all(line.endswith("?") for line in lines)
    assert turn["answer"].split("\n")[0].startswith(shell_agent.OFF_TOPIC + " I can answer")


def test_the_examples_come_from_the_scope_measure_table_and_column():
    sources = [{"tables": [SALES], "columns": ["franchise", "TotalPrice", "store_code"]}]
    examples = shell_agent.scope_examples(sources, [{"label": "Transactions failing a control"}])
    assert examples == ["How many transactions failing a control are there?", "How many sales transactions are there in total?",
                         "Which franchise has the most sales transactions?"]
    assert shell_agent.scope_examples([], []) == []
    assert shell_agent.refusal_text([]) == shell_agent.OFF_TOPIC + " Ask about this use case's data, its page or its records."


def test_a_refusal_with_no_scope_still_says_what_to_ask():
    text = shell_agent.refusal_text(shell_agent.scope_examples([], []))
    assert text.startswith(shell_agent.OFF_TOPIC) and "Ask about this use case" in text


@pytest.mark.parametrize("question", ["What is the weather in Paris?", "What is the weather in Paris last month?"])
def test_the_weather_must_exclude_still_refuses_and_never_answers(tmp_path, question):
    llm = FakeLLM([said("A has 4.")], related=lambda body: False)
    s = forecast_shell(tmp_path, llm, FULL_SOURCES)
    turn = ask(s, question, page=forecast_page()["id"])
    assert turn["refused"] is True and turn["answer"].startswith(shell_agent.OFF_TOPIC)
    assert llm.main_calls() == []
