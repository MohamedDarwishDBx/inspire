"""REQ-181: a zero-exception controls run publishes its App. On the monitor and triage layout a Drivers chart is optional, and a
Drivers chart that reads a companion table instead of the business output table is not kept (Genie picked the companion signal
table because the output table's rule groups hold zero money at stake). The decision queue still requires a Drivers chart that
reads the output table, and a Drivers chart on the output table is kept, offline."""
import copy
import json
import os

import pytest

pytest.importorskip("sqlglot")

from v140_implement_test import _app_shell  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLE = os.path.join(ROOT, "agent", "app_shell", "examples", "monitor_triage.json")
RESULT = "main.inspire.controls_out"
SIGNAL = f"{RESULT}__signal"
ACCOUNTS = "main.finance.accounts"


def _monitor_page():
    """The controls-testing page of the live run: by_rule is the Drivers chart Genie marked, and it reads the signal companion."""
    with open(EXAMPLE, encoding="utf-8") as handle:
        page = json.load(handle)
    text = json.dumps(page).replace("main.finance.billing_out__signal", SIGNAL).replace("main.finance.billing_out", RESULT)
    page = json.loads(text)
    page["result_table"] = RESULT
    for chart in page["charts"]:
        if chart["id"] == "by_rule":
            chart["driver"] = True
            chart["dataset"] = "signal"
    return page


def _allowed():
    return [RESULT, SIGNAL, ACCOUNTS]


def _check(ns, tmp_path, page, drivers_optional=True):
    shell_sql = _app_shell(ns, tmp_path)[1]["shell_sql"]
    return ns["implement_app_page_problems"](page, shell_sql, _allowed(), False, drivers_optional=drivers_optional)


def test_a_monitor_page_whose_drivers_chart_reads_the_companion_table_is_not_refused(agent_ns, tmp_path):
    page = _monitor_page()
    assert [p for p in _check(agent_ns, tmp_path, page) if "Drivers" in p] == []
    assert page["charts"][[c["id"] for c in page["charts"]].index("by_rule")].get("driver") is False


def test_a_monitor_drivers_chart_on_the_output_table_is_kept_as_a_driver(agent_ns, tmp_path):
    page = _monitor_page()
    for chart in page["charts"]:
        if chart["id"] == "by_rule":
            chart["dataset"] = "open_items"
    assert [p for p in _check(agent_ns, tmp_path, page) if "Drivers" in p] == []
    assert [c["id"] for c in page["charts"] if c.get("driver") is True] == ["by_rule"]


def test_a_decision_queue_page_still_refuses_a_drivers_chart_off_the_output_table(agent_ns, tmp_path):
    page = _monitor_page()
    page["layout"] = "decision_queue"
    problems = _check(agent_ns, tmp_path, page)
    assert [p for p in problems if p.startswith("Drivers chart by_rule reads dataset signal, which does not read the business output table")
            and f"`{RESULT}`" in p] != []


def test_a_dashboard_page_on_the_monitor_layout_still_refuses_a_drivers_chart_off_the_output_table(agent_ns, tmp_path):
    page = _monitor_page()
    problems = _check(agent_ns, tmp_path, page, drivers_optional=False)
    assert [p for p in problems if p.startswith("Drivers chart by_rule reads dataset signal")] != []
    assert next(c for c in page["charts"] if c["id"] == "by_rule")["driver"] is True


def test_the_clearing_does_not_touch_a_monitor_chart_that_is_not_a_driver(agent_ns, tmp_path):
    page = _monitor_page()
    before = copy.deepcopy([c for c in page["charts"] if c["id"] != "by_rule"])
    _check(agent_ns, tmp_path, page)
    assert [c for c in page["charts"] if c["id"] != "by_rule"] == before


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
