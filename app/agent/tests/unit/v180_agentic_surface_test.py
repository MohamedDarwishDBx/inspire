"""Agent page surface: experience option, the briefing and render_answer grounding, using stubs (no workspace)."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402

PAGE = {"id": "p", "title": "Loss", "records": {"label": "unit", "tier": "tier", "reasons": "why", "columns": [
    {"column": "category", "label": "Category"}, {"column": "value", "label": "Loss"}]},
    "charts": [{"id": "trend", "title": "Loss trend"}], "kpis": [{"id": "loss", "label": "Total loss"}], "questions": ["Where is the loss?"]}


class Shell:
    def __init__(self, decides=True, rows=None):
        self.rows, self._decides = rows or {}, decides
        self.pages = {"p": PAGE}

    def page(self, ident):
        return self.pages[ident]

    def workspace(self, headers):
        return (None, "who")

    def decides(self, page):
        return self._decides

    def readable_versions(self, ws, page, keys):
        return {k: self.rows[k] for k in keys if k in self.rows}

    def list_records(self, headers, page, data):
        self.last = data
        return {"total": len(self.rows), "rows": [dict(v, _inspire_key=k) for k, v in self.rows.items()]}


ROWS = {"r1": {"unit": "Unit 7", "category": "North", "value": "900", "value_at_stake": 900, "tier": "A", "why": "late", "status": "open", "_inspire_status": "open"},
        "r2": {"unit": "Unit 8", "category": "South", "value": "40", "value_at_stake": 40, "tier": "B", "why": "small", "status": "open"}}


def agent(shell):
    a = shell_agent.Agent.__new__(shell_agent.Agent)
    a.shell = shell
    return a


def test_an_app_without_the_choice_is_classic_ui():
    assert shell_core.experience_of(None) == "ui"
    assert shell_core.experience_of({"decisions": True}) == "ui"
    assert shell_core.experience_of({"experience": "nonsense"}) == "ui"


def test_the_three_choices_are_kept():
    for choice in ("agentic", "ui", "both"):
        assert shell_core.experience_of({"experience": choice}) == choice


def test_the_briefing_takes_the_top_records_in_the_list_order_and_grounds_them():
    shell = Shell(rows=ROWS)
    out = agent(shell).briefing({}, "p")
    assert out["total"] == 2
    assert [t["record_key"] for t in out["tickets"]] == ["r1", "r2"]
    assert out["tickets"][0]["label"] == "Unit 7"
    assert out["tickets"][0]["why"] == "late"
    assert out["actions"] == list(shell_agent.ACTIONS)
    assert "Where is the loss?" in out["chips"]
    assert shell.last["limit"] == shell_agent.BRIEF_ROWS
    assert "sort" not in shell.last


def test_a_briefing_without_permission_to_decide_offers_no_actions():
    out = agent(Shell(decides=False, rows=ROWS)).briefing({}, "p")
    assert out["actions"] == []


def test_render_answer_grounds_tickets_and_table_rows_in_the_real_record():
    ag = agent(Shell(rows=ROWS))
    job = {"page": PAGE, "ws": None, "headers": {}}
    turn = shell_agent.Turn("who", "p")
    raw = [{"type": "ticket", "record_key": "r1", "label": "made up", "value_at_stake": "$1"},
           {"type": "table", "columns": ["category", "value"], "record_keys": ["r1", "r2"]}]
    result = ag.tool_render_answer(turn, job, {"blocks": raw})
    ticket, table = turn.blocks
    assert ticket["label"] == "Unit 7"
    assert ticket["value_at_stake"] == "900"
    assert table["rows"] == [{"record_key": "r1", "category": "North", "value": "900"}, {"record_key": "r2", "category": "South", "value": "40"}]
    assert job["rendered"] is True and result["rendered"] == 2


def test_render_answer_offers_actions_only_when_the_person_can_decide():
    ag = agent(Shell(decides=False, rows=ROWS))
    turn = shell_agent.Turn("who", "p")
    ag.tool_render_answer(turn, {"page": PAGE, "ws": None, "headers": {}}, {"blocks": [{"type": "actions", "record_keys": ["r1"], "actions": ["done"]}]})
    assert turn.blocks == []


def test_a_turn_carries_its_blocks_to_the_page():
    turn = shell_agent.Turn("who", "p")
    turn.blocks = [{"type": "text", "markdown": "hi"}]
    assert turn.view()["blocks"] == [{"type": "text", "markdown": "hi"}]


def test_named_keys_walks_carousels_and_dedupes():
    raw = [{"type": "carousel", "items": [{"record_key": "r1"}, {"record_key": "r2"}]}, {"type": "actions", "record_keys": ["r1"]}]
    assert shell_agent.named_keys(raw) == ["r1", "r2"]


def test_an_experience_the_shell_does_not_offer_is_a_load_problem():
    assert shell_core.experience_problems({"experience": "chat"}) == ["the App experience 'chat' is not one of agentic, ui, both"]
    assert shell_core.experience_problems({"experience": "both"}) == []
    assert shell_core.experience_problems({}) == []
