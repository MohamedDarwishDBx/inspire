"""The registry builds the values and bodies every action writes, and refuses what it cannot write (fail-pre/pass-post)."""
import datetime
import os
import sys

import pytest

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_actions  # noqa: E402
import shell_agent  # noqa: E402
import shell_core  # noqa: E402
import shell_sql  # noqa: E402

TODAY = datetime.date(2026, 11, 15)


def test_the_target_setting_name_matches_the_shell():
    assert shell_actions.TARGET_SETTING == shell_core.KPI_TARGET_SETTING


def test_done_snooze_assign_write_the_status_the_work_page_writes():
    assert shell_actions.record_values("done", {}, TODAY) == {"action_status": shell_sql.DONE}
    assert shell_actions.record_values("snooze", {"until": "2026-12-01"}, TODAY) == {"snooze_until": "2026-12-01"}
    assert shell_actions.record_values("assign", {"owner": " Ana "}, TODAY) == {"action_owner": "Ana"}


def test_not_an_issue_needs_a_reason_and_writes_the_dismissed_status():
    with pytest.raises(ValueError, match="reason"):
        shell_actions.record_values("not_an_issue", {}, TODAY)
    assert shell_actions.record_values("not_an_issue", {"reason": "seasonal"}, TODAY) == {
        "action_status": shell_sql.DISMISSED, "dismiss_reason": "seasonal"}


def test_override_sets_a_status_with_the_reason_and_refuses_an_unknown_status():
    out = shell_actions.record_values("override", {"status": shell_sql.IN_PROGRESS, "reason": "waiting on supplier"}, TODAY)
    assert out == {"action_status": shell_sql.IN_PROGRESS, "action_note": "waiting on supplier"}
    dismissed = shell_actions.record_values("override", {"status": shell_sql.DISMISSED, "reason": "not a fault"}, TODAY)
    assert dismissed["dismiss_reason"] == "not a fault"
    with pytest.raises(ValueError, match="sets a status"):
        shell_actions.record_values("override", {"status": "Maybe", "reason": "x"}, TODAY)
    with pytest.raises(ValueError, match="reason"):
        shell_actions.record_values("override", {"status": shell_sql.IN_PROGRESS}, TODAY)


def test_add_note_writes_the_action_note_and_needs_text():
    assert shell_actions.record_values("add_note", {"note": "call back Tuesday"}, TODAY) == {"action_note": "call back Tuesday"}
    with pytest.raises(ValueError):
        shell_actions.record_values("add_note", {"note": "  "}, TODAY)


def test_skip_writes_nothing_and_is_a_record_action():
    assert shell_actions.REGISTRY["skip"].writes is False
    assert shell_actions.REGISTRY["skip"].scope == shell_actions.RECORD


def test_set_target_is_a_number_on_the_target_setting_route():
    body = shell_actions.app_body("set_target", "p", {"value": "42.5"})
    assert body == {"page": "p", "name": shell_actions.TARGET_SETTING, "value": 42.5}
    assert shell_actions.REGISTRY["set_target"].route == "settings/save"
    with pytest.raises(ValueError, match="number"):
        shell_actions.app_body("set_target", "p", {"value": "lots"})


def test_create_alert_needs_what_it_watches_and_a_schedule():
    with pytest.raises(ValueError, match="watches"):
        shell_actions.app_body("create_alert", "p", {"schedule": "daily"})
    body = shell_actions.app_body("create_alert", "p", {"watch": {"what": "loss"}, "schedule": "daily"})
    assert body == {"page": "p", "watch": {"what": "loss"}, "schedule": "daily", "paused": False}
    assert shell_actions.REGISTRY["create_alert"].route == "alerts/save"


def test_run_again_posts_the_page_to_the_run_route():
    assert shell_actions.app_body("run_again", "p", {}) == {"page": "p"}
    assert shell_actions.REGISTRY["run_again"].route == "settings/run"


def test_an_unknown_action_is_refused_everywhere():
    with pytest.raises(ValueError):
        shell_actions.action_of("delete_everything")
    with pytest.raises(ValueError):
        shell_actions.app_body("done", "p", {})


def test_the_agent_action_values_come_from_the_registry():
    assert shell_agent.action_values("done", {}) == {"action_status": shell_sql.DONE}
    assert shell_agent.action_values("skip", {}) == {}
    assert shell_agent.action_values("assign", {"owner": "Ana", "note": "urgent"}) == {"action_owner": "Ana", "note": "urgent"}


class Shell:
    def __init__(self):
        self.pages = {"p": {"id": "p", "records": {"label": "unit"}}}

    def page(self, ident):
        return self.pages[ident]

    def app_change_refusal(self, headers, page, action):
        return ""


def test_an_app_action_confirm_card_names_its_route_and_writes_nothing_itself():
    agent = shell_agent.Agent.__new__(shell_agent.Agent)
    agent.shell = Shell()
    card = agent.app_confirm(agent.shell.page("p"), "run_again", {})
    assert card["route"] == "settings/run" and card["body"] == {"page": "p"} and card["label"] == "Run again"


def test_propose_app_action_puts_a_confirm_card_on_the_turn():
    agent = shell_agent.Agent.__new__(shell_agent.Agent)
    agent.shell = Shell()
    turn = shell_agent.Turn("who", "p")
    out = agent.tool_propose_app_action(turn, {"page": agent.shell.page("p"), "headers": {}}, {"action": "set_target", "value": 10})
    assert turn.confirm["route"] == "settings/save" and turn.confirm["body"]["value"] == 10.0
    assert "nothing is changed" in out["waiting"]


def test_a_skip_confirm_card_has_no_route_and_no_body():
    class Versions(Shell):
        def readable_versions(self, ws, page, keys):
            return {k: {"unit": "U1", "valid_from_us": 1, "_inspire_status": "New", "action_status": "New"} for k in keys}

    agent = shell_agent.Agent.__new__(shell_agent.Agent)
    agent.shell = Versions()
    agent.shell.now = lambda: datetime.datetime(2026, 11, 15, tzinfo=datetime.timezone.utc)
    agent.shell.status_choices = lambda page: ()
    card = agent.confirm_for(agent.shell.page("p"), None, "skip", ["r1"], {})
    assert card["route"] is None and card["body"] is None and "Nothing is written" in card["note"]
