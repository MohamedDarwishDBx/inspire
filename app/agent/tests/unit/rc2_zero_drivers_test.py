"""REQ-181: a zero-exception controls run publishes its App, and a refusal Genie cannot fix stops after one repeat.

Driven through the real App round (`_implement_app` with the real Genie loop, a file-writing runner and the App check and deploy
stubbed), offline. On the monitor and triage layout a Drivers chart is optional, so a Drivers mark on a chart that reads a companion
table is cleared and the App publishes in one round. On the decision queue a Drivers chart must read the output table, and when Genie
sends back the same refusal it was given the round before, the deterministic repairs run once and the build stops without a third
round. Each refused page is logged with its message and the page as checked."""
import copy
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _FileRunner, _app_flow, _app_shell  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLE = os.path.join(ROOT, "agent", "app_shell", "examples", "monitor_triage.json")
RESULT = "main.inspire.controls_out"
SIGNAL = f"{RESULT}__signal"
ACCOUNTS = "main.finance.accounts"
ALLOWED = [RESULT, SIGNAL, ACCOUNTS]


def _monitor_page(by_rule_dataset="signal", driver=True):
    """The controls-testing page of the live run: by_rule is the Drivers chart Genie marked on the signal companion table."""
    with open(EXAMPLE, encoding="utf-8") as handle:
        text = handle.read()
    page = json.loads(text.replace("main.finance.billing_out__signal", SIGNAL).replace("main.finance.billing_out", RESULT))
    page["result_table"] = RESULT
    for chart in page["charts"]:
        if chart["id"] == "by_rule":
            chart["dataset"] = by_rule_dataset
            chart["driver"] = driver
    return page


def _app_round(ns, tmp_path, pages, layout="monitor_triage"):
    """Run `_implement_app` for `pages`, one Genie round each, and return (error, runner, deployed, flow)."""
    inst, context, seen = _app_flow(ns, tmp_path, write=False, assets={"genie_space": "g1"})
    inst.__dict__.pop("_implement_genie_loop", None)
    context.update(app_layout=layout, result_table=RESULT, allowed=list(ALLOWED))
    pages = list(pages) + [pages[-1]] * (3 - len(pages))  # a refused round is followed by the next Genie round, as in the build
    runner = _FileRunner([{"exit": 0} for _ in pages], [{"page.json": json.dumps(page)} for page in pages])
    error = None
    try:
        inst._implement_app(context, runner)
    except Exception as caught:  # the test reads the class and message of what stopped the build
        error = caught
    return error, runner, seen["deployed"], inst


def test_a_monitor_app_whose_drivers_chart_reads_the_companion_table_publishes_in_one_round(agent_ns, tmp_path):
    error, runner, deployed, _inst = _app_round(agent_ns, tmp_path, [_monitor_page()])
    assert error is None, str(error)
    assert len(runner.seen) == 1, "the first round's page is accepted, with no second Genie round"
    assert len(deployed) == 1
    page = json.loads(deployed[0][1]["pages/n01_u01.json"])
    assert next(c for c in page["charts"] if c["id"] == "by_rule").get("driver") is False


def test_a_monitor_app_settles_only_the_drivers_mark_and_keeps_every_other_chart_as_written(agent_ns, tmp_path):
    written = _monitor_page()
    error, _runner, deployed, _inst = _app_round(agent_ns, tmp_path, [written])
    assert error is None, str(error)
    page = json.loads(deployed[0][1]["pages/n01_u01.json"])
    expected = copy.deepcopy(written)
    for chart in expected["charts"]:
        if chart["id"] == "by_rule":
            chart["driver"] = False
    assert [c for c in page["charts"]] == [c for c in expected["charts"]]


def test_a_monitor_app_keeps_a_drivers_chart_that_reads_the_output_table(agent_ns, tmp_path):
    error, runner, deployed, _inst = _app_round(agent_ns, tmp_path, [_monitor_page(by_rule_dataset="open_items")])
    assert error is None, str(error)
    assert len(runner.seen) == 1
    page = json.loads(deployed[0][1]["pages/n01_u01.json"])
    assert [c["id"] for c in page["charts"] if c.get("driver") is True] == ["by_rule"]


def test_a_decision_queue_app_refused_with_the_same_problems_twice_stops_without_a_third_round(agent_ns, tmp_path):
    refused = _monitor_page()
    refused["layout"] = "decision_queue"
    error, runner, deployed, _inst = _app_round(agent_ns, tmp_path, [refused, refused, refused], layout="decision_queue")
    assert isinstance(error, agent_ns["ImplementRepeatRefusal"]), type(error).__name__
    assert "Drivers chart by_rule reads dataset signal, which does not read the business output table" in str(error)
    assert len(runner.seen) == 2, "the second round repeats the first round's refusal, so no third Genie round runs"
    assert deployed == []


def test_a_refusal_that_changes_between_rounds_is_not_stopped(agent_ns, tmp_path):
    broken = _monitor_page(by_rule_dataset="missing")
    error, runner, deployed, _inst = _app_round(agent_ns, tmp_path, [broken, _monitor_page()])
    assert error is None, str(error)
    assert len(runner.seen) == 2 and len(deployed) == 1


def test_the_build_attempts_do_not_rebuild_after_a_repeat_refusal(agent_ns, tmp_path):
    refused = _monitor_page()
    refused["layout"] = "decision_queue"
    inst, context, seen = _app_flow(agent_ns, tmp_path, write=False, assets={"genie_space": "g1"})
    inst.__dict__.pop("_implement_genie_loop", None)
    attempts = []

    def one_locked(target, key, inflight):
        attempts.append(1)
        raise agent_ns["ImplementRepeatRefusal"]("page.json does not fit the App: Drivers chart by_rule reads dataset signal")

    inst._implement_one_locked = one_locked
    inst._implement_notebook_undo = lambda uc_id, inflight: None
    inst._implement_failed = lambda uc_id, key, message, *args, **kwargs: message
    result = inst._implement_attempts({"uc_id": "N01-U01"}, "N01-U01", (5150, "N01-U01", 2))
    assert len(attempts) == 1, "a repeat refusal is not sent to a second build attempt"
    assert agent_ns["IMPLEMENT_REPEAT_REFUSAL_STOP"] in str(result)


def test_each_refused_page_is_logged_with_its_message_and_the_page_as_checked(agent_ns, tmp_path):
    refused = _monitor_page()
    refused["layout"] = "decision_queue"
    _error, _runner, _deployed, inst = _app_round(agent_ns, tmp_path, [refused, refused], layout="decision_queue")
    messages = [text for _level, text in inst.logger.records]
    lines = [m for m in messages if "[REFUSED-PAGE]" in m]
    assert len(lines) == 2, "one [REFUSED-PAGE] record per refused round"
    assert "Drivers chart by_rule reads dataset signal" in lines[0]
    assert '"by_rule"' in lines[0] and '"result_table"' in lines[0], "the page as checked is in the log"
    assert any("[REPEAT-REFUSAL STOP]" in m for m in messages)


def test_the_app_prompt_asks_for_drivers_only_on_the_decision_queue_and_the_dashboard(agent_ns, tmp_path):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    brief = agent_ns["implement_drivers_brief"]
    optional = brief("app", "monitor_triage", RESULT, shell_sql, {})
    assert optional.startswith("- Drivers: optional on the Monitor and triage layout") and f"`{RESULT}` directly" in optional
    assert "at least 1 chart" not in optional
    required_queue = brief("app", shell_sql.DEFAULT_LAYOUT, RESULT, shell_sql, {})
    assert "at least 1 chart that shows what drives this use case's result" in required_queue
    assert "the dashboard draws the Drivers charts" not in required_queue
    required_dash = brief("dashboard", "monitor_triage", RESULT, shell_sql, {"dashboard": True})
    assert "at least 1 chart that shows what drives this use case's result" in required_dash
    assert "the dashboard draws the Drivers charts in its own Drivers section" in required_dash
