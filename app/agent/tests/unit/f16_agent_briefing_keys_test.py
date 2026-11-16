"""REQ-341: the Agent page's briefing cards stay distinct when records share a label (fail-pre/pass-post).

Three records of one franchise carry the same label and differ only by their record key. The briefing must return three
tickets with three record keys, so the page can render three cards. A duplicate key (one record repeated) fails here.
"""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402

PAGE = {"id": "p", "title": "Forecast", "records": {"label": "franchise", "tier": "tier", "reasons": "why", "columns": [
    {"column": "units", "label": "Units"}]}, "charts": [], "kpis": [], "questions": []}
SAME_FRANCHISE = {
    "f1 | 2024-05-19": {"franchise": "Franchise 3000000", "units": "2", "value_at_stake": 1700, "tier": "Act now", "why": "gap", "status": "open", "_inspire_status": "open"},
    "f1 | 2024-05-20": {"franchise": "Franchise 3000000", "units": "2", "value_at_stake": 1600, "tier": "Act now", "why": "gap", "status": "open", "_inspire_status": "open"},
    "f1 | 2024-05-21": {"franchise": "Franchise 3000000", "units": "2", "value_at_stake": 1500, "tier": "Act now", "why": "gap", "status": "open", "_inspire_status": "open"},
}


class Shell:
    def __init__(self, rows):
        self.rows = rows

    def page(self, ident):
        return {**PAGE, "records": PAGE["records"]}

    def workspace(self, headers):
        return (None, "who")

    def decides(self, page):
        return True

    def list_records(self, headers, page, data):
        return {"total": len(self.rows), "rows": [dict(v, _inspire_key=k) for k, v in self.rows.items()]}


def agent(shell):
    a = shell_agent.Agent.__new__(shell_agent.Agent)
    a.shell = shell
    return a


def test_three_records_with_one_label_give_three_distinct_briefing_tickets():
    out = agent(Shell(SAME_FRANCHISE)).briefing({}, "p")
    keys = [t["record_key"] for t in out["tickets"]]
    assert len(keys) == 3
    assert len(set(keys)) == 3, "one record must not be rendered three times"
    assert keys == ["f1 | 2024-05-19", "f1 | 2024-05-20", "f1 | 2024-05-21"]
    assert {t["label"] for t in out["tickets"]} == {"Franchise 3000000"}


def test_a_row_without_a_key_is_not_turned_into_a_card():
    rows = {"": {"franchise": "Franchise 3000000", "units": "2", "value_at_stake": 1, "tier": "t", "why": "", "status": "open"}}
    out = agent(Shell(rows)).briefing({}, "p")
    assert out["tickets"] == []
