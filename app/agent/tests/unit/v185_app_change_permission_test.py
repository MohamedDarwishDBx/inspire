"""The agent offers an app change only to a person the change's own route would let make it (fail-pre/pass-post)."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402

PAGE = {"id": "p", "records": {"label": "unit"}}


class Shell:
    """Stands in for the App shell: each check answers from a table the test sets."""

    def __init__(self, refusals):
        self.refusals = refusals

    def app_change_refusal(self, headers, page, action):
        return self.refusals.get(action, "")


def agent(refusals):
    ag = shell_agent.Agent.__new__(shell_agent.Agent)
    ag.shell = Shell(refusals)
    return ag


def job(ag):
    return {"page": PAGE, "headers": {}, "ws": None}


def test_a_person_who_cannot_change_the_app_is_never_offered_those_changes():
    ag = agent({"set_target": "Sign in so the App can record who changed the setting", "create_alert": "alerts are off"})
    assert ag.offered_app_actions(job(ag)) == ["run_again"]


def test_a_person_who_can_change_everything_is_offered_all_three():
    ag = agent({})
    assert ag.offered_app_actions(job(ag)) == ["set_target", "create_alert", "run_again"]


def test_propose_refuses_an_unoffered_change_even_if_the_planner_asks_for_it():
    ag = agent({"set_target": "not yours to change"})
    turn = shell_agent.Turn("who", "p")
    try:
        ag.tool_propose_app_action(turn, job(ag), {"action": "set_target", "value": 10})
    except ValueError as error:
        assert "cannot make that change" in str(error)
    else:
        raise AssertionError("an unoffered change must not reach the confirm card")
    assert turn.confirm is None


def test_propose_builds_the_card_for_an_offered_change():
    ag = agent({})
    turn = shell_agent.Turn("who", "p")
    ag.app_confirm = lambda page, action, raw: {"action": action, "route": "settings/run", "body": {"page": "p"}}
    ag.tool_propose_app_action(turn, job(ag), {"action": "run_again"})
    assert turn.confirm["route"] == "settings/run"


def test_the_setting_route_and_the_offer_share_one_refusal():
    import inspect
    assert "setting_refusal(" in inspect.getsource(shell_core.Shell.setting_change)
    assert "setting_refusal(" in inspect.getsource(shell_core.Shell.app_change_refusal)
