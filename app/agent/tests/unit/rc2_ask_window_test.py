import datetime as dt
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, ask, said, tool_call, topic_of, agent_shell  # noqa: E402

LIVE_QUESTION = "What is the total sales in the last 30 days?"
TODAY = "2026-11-15"


class _HighWorkspace(AgentWorkspace):
    def __init__(self, high, **kwargs):
        super().__init__(**kwargs)
        self.high = high

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "high_0 AS high" in sql:
            return {"columns": [], "rows": [{"low": "2024-01-05", "high": self.high}], "truncated": False}
        return super().run_sql(warehouse, sql, params, limit)


def test_a_stale_as_of_anchors_the_genie_question_to_the_data_not_today():
    sent = shell_agent.genie_question(LIVE_QUESTION, "2024-05-17", TODAY)
    assert sent.startswith(LIVE_QUESTION) and "from 2024-05-17" in sent and "not from today" in sent


def test_fresh_data_leaves_the_genie_question_and_the_note_unchanged():
    assert shell_agent.genie_question(LIVE_QUESTION, TODAY, TODAY) == LIVE_QUESTION
    assert shell_agent.window_note(LIVE_QUESTION, TODAY, TODAY) == ""


def test_a_question_with_no_relative_window_is_never_changed():
    assert shell_agent.genie_question("Which franchise sold the most?", "2024-05-17", TODAY) == "Which franchise sold the most?"
    assert shell_agent.window_note("Which franchise sold the most?", "2024-05-17", TODAY) == ""


def test_the_note_says_the_window_of_data_in_plain_words():
    assert shell_agent.window_note(LIVE_QUESTION, "2024-05-17", TODAY) == "Counted over the last 30 days of data, to 2024-05-17."
    assert shell_agent.window_phrase("Sales this month and last week?") == "this month"


def test_a_stale_page_answers_genie_over_the_data_window_and_says_so(tmp_path):
    llm = FakeLLM([tool_call("ask_genie", {"question": LIVE_QUESTION}), said("Total sales were 0.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=_HighWorkspace("2024-05-17", llm=llm))
    s.now = lambda: dt.datetime(2026, 11, 15, tzinfo=dt.timezone.utc)
    turn = ask(s, LIVE_QUESTION, view={"filters": {}}, visible=[])
    sent = [entry[1] for entry in ws.genie if len(entry) == 3]
    assert sent and "from 2024-05-17" in sent[0] and sent[0].startswith(LIVE_QUESTION), sent
    assert turn["answer"].endswith("Counted over the last 30 days of data, to 2024-05-17.")


def test_fresh_data_must_exclude_the_window_note_and_keeps_the_question(tmp_path):
    llm = FakeLLM([tool_call("ask_genie", {"question": LIVE_QUESTION}), said("Total sales were 0.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=_HighWorkspace(TODAY, llm=llm))
    s.now = lambda: dt.datetime(2026, 11, 15, tzinfo=dt.timezone.utc)
    turn = ask(s, LIVE_QUESTION, view={"filters": {}}, visible=[])
    sent = [entry[1] for entry in ws.genie if len(entry) == 3]
    assert sent == [LIVE_QUESTION] and "Counted over" not in turn["answer"]
