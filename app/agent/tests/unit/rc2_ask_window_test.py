import datetime
import datetime as dt
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_sql  # noqa: E402
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


def test_a_stale_as_of_rewrites_the_window_into_explicit_dates_for_genie():
    assert shell_agent.genie_question(LIVE_QUESTION, "2024-05-17", TODAY) == "What is the total sales between 2024-04-18 and 2024-05-17?"


def test_this_month_and_last_week_map_to_the_page_boundaries():
    assert shell_agent.explicit_question("Sales this month?", datetime.date(2024, 5, 17)) == "Sales between 2024-05-01 and 2024-05-17?"
    assert shell_agent.explicit_question("Sales last week?", datetime.date(2024, 5, 17)) == "Sales between 2024-05-06 and 2024-05-12?"
    assert shell_agent.explicit_question("Sales today?", datetime.date(2024, 5, 17)) == "Sales on 2024-05-17?"


def test_last_n_months_uses_the_same_start_as_the_page_preset():
    preset = {p["id"]: p for p in shell_sql.preset_ranges("month", "2024-01-05", "2024-05-17")}["3m"]
    sent = shell_agent.explicit_question("Sales in the last 3 months?", datetime.date(2024, 5, 17))
    assert sent == f"Sales between {preset['from']} and {preset['to']}?"


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
    assert sent == ["What is the total sales between 2024-04-18 and 2024-05-17?"], sent
    assert turn["answer"].endswith("Counted over the last 30 days of data, to 2024-05-17.")


def test_fresh_data_must_exclude_the_window_note_and_keeps_the_question(tmp_path):
    llm = FakeLLM([tool_call("ask_genie", {"question": LIVE_QUESTION}), said("Total sales were 0.")], related=topic_of)
    s, ws, _made = agent_shell(tmp_path, ws=_HighWorkspace(TODAY, llm=llm))
    s.now = lambda: dt.datetime(2026, 11, 15, tzinfo=dt.timezone.utc)
    turn = ask(s, LIVE_QUESTION, view={"filters": {}}, visible=[])
    sent = [entry[1] for entry in ws.genie if len(entry) == 3]
    # 219a7ffbe (REQ-269, REQ-330): every Genie answer now ends with its counted line, so only the window note is excluded here.
    assert sent == [LIVE_QUESTION] and "of data, to" not in turn["answer"]
