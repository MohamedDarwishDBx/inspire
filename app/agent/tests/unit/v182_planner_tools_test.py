"""Planner block tools: each puts a validated block on the answer; draft_email reuses the draft route and never sends."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402

PAGE = {"id": "p", "title": "Loss", "records": {"label": "unit", "columns": [{"column": "category", "label": "Category"}, {"column": "value", "label": "Loss"}]},
        "charts": [{"id": "trend", "title": "Loss trend"}], "result_table": "main.t"}
ROWS = {"r1": {"unit": "Unit 7", "category": "North", "value": "900"}, "r2": {"unit": "Unit 8", "category": "South", "value": "40"}}


class Shell:
    def __init__(self, decides=True):
        self._decides = decides

    def readable_versions(self, ws, page, keys):
        return {k: ROWS[k] for k in keys if k in ROWS}

    def decides(self, page):
        return self._decides


def agent(decides=True):
    a = shell_agent.Agent.__new__(shell_agent.Agent)
    a.shell = Shell(decides)
    return a


def job(page=PAGE):
    return {"page": page, "ws": None, "headers": {}}


def test_show_chart_puts_the_page_chart_on_the_answer_and_refuses_an_unknown_one():
    ag, turn = agent(), shell_agent.Turn("w", "p")
    assert ag.tool_show_chart(turn, job(), {"chart_id": "made_up"})["shown"] is False
    assert turn.blocks == []
    assert ag.tool_show_chart(turn, job(), {"chart_id": "trend"})["shown"] is True
    assert turn.blocks == [{"type": "chart", "chart_id": "trend", "title": "Loss trend", "highlight_keys": []}]


def test_show_table_grounds_rows_in_the_records_and_keeps_only_page_columns():
    ag, turn = agent(), shell_agent.Turn("w", "p")
    out = ag.tool_show_table(turn, job(), {"columns": ["category", "invented"], "record_keys": ["r1", "nope"]})
    table = turn.blocks[0]
    assert table["columns"] == ["category"]
    assert table["rows"] == [{"record_key": "r1", "category": "North"}]
    assert out["rows"] == 1


def test_choose_needs_two_options_and_then_each_option_carries_its_question():
    ag, turn = agent(), shell_agent.Turn("w", "p")
    assert ag.tool_choose(turn, job(), {"prompt": "Which?", "options": [{"id": "a", "label": "A"}]})["shown"] is False
    ag.tool_choose(turn, job(), {"prompt": "Which?", "options": [{"id": "a", "label": "A", "ask": "Show A"}, {"id": "b", "label": "B"}]})
    assert turn.blocks[0]["type"] == "choice" and turn.blocks[0]["options"][0]["ask"] == "Show A"


def test_draft_email_reuses_the_draft_route_and_only_shows_the_draft():
    ag, turn = agent(), shell_agent.Turn("w", "p")
    calls = []

    def draft(headers, data):
        calls.append(data)
        return {"subject": "Unit 7 invoices", "body": "Hi, please check Unit 7.", "text": "", "source": "template", "note": ""}

    ag.draft = draft
    out = ag.tool_draft_email(turn, job(), {"record_keys": ["r1"], "to_label": "Ana"})
    assert calls == [{"page": "p", "record_keys": ["r1"]}], "it calls the same route the Work page calls"
    assert turn.blocks == [{"type": "email", "to_label": "Ana", "subject": "Unit 7 invoices", "body": "Hi, please check Unit 7.", "copyable": True}]
    assert out["shown"] is True and out["source"] == "template"


def test_draft_email_is_not_offered_without_permission_to_decide_or_without_records():
    ag = agent(decides=False)
    assert "draft_email" not in ag.show_tools(PAGE)
    assert "show_table" in ag.show_tools(PAGE)
    assert "show_chart" in ag.show_tools(PAGE)
    assert "show_chart" not in ag.show_tools({"id": "p"})
    assert "choose" in ag.show_tools({"id": "p"})


def test_the_block_tools_are_in_the_tool_specs():
    for name in ("show_chart", "show_table", "choose", "draft_email", "propose_app_action", "render_answer"):
        assert name in shell_agent.TOOLS, name


def test_a_kind_picks_the_page_chart_of_that_kind_and_says_when_there_is_none():
    ag, turn = agent(), shell_agent.Turn("w", "p")
    page = dict(PAGE, charts=[{"id": "trend", "title": "Trend", "type": "line"}, {"id": "spread", "title": "Spread", "type": "control"}])
    ag.tool_show_chart(turn, job(page), {"kind": "outlier"})
    assert turn.blocks[0]["chart_id"] == "spread"
    ag.tool_show_chart(turn, job(page), {"kind": "forecast"})
    assert turn.blocks[1]["chart_id"] == "trend"
    out = ag.tool_show_chart(turn, job(page), {"kind": "segment"})
    assert out["shown"] is False and "no segment chart" in out["problems"][0]
