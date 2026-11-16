"""REQ-183 (live rebuild of a use case on rc7): the Grouping Inspire planned, paymentMethod, never reached
the run. Genie wrote dbutils.widgets.dropdown("group_by", "all", ...), a valid choice, and the App's widget-default repair skipped every
dropdown, so each run read "all" with no error and grouped every record into 1 group. The repeat stop compares refusal texts exactly, and
the refusal text carries the run's id, so the same fault was sent back to Genie in rounds 2 and 3 instead of stopping after round 2.
Offline, through the real widget repair, the widget reader, the grouping proof check and the round loop."""
from unittest.mock import MagicMock

import pytest

from v140_implement_test import VALID, _FakeRunner, _fill, _flow_inspire
from v218_mvp_crashes_test import _repairing

PLANNED = "paymentMethod"
LIVE_RUN = "11111111-2222-4333-8444-555555555555"
LIVE_REFUSAL = (f"run {LIVE_RUN} ran with the Grouping paymentMethod, but its records were grouped by all into 1 group")
CHOICES = ["all", "product", "paymentMethod"]


def _grouping_notebook(default="all", kind="dropdown"):
    if kind == "dropdown":
        call = f'dbutils.widgets.dropdown("group_by", "{default}", ["all", "product", "paymentMethod"], "Grouping")\n'
    else:
        call = f'dbutils.widgets.text("group_by", "{default}", "Grouping")\n'
    genie = {"cell_type": "code", "metadata": {}, "source": [
        "try:\n", "    " + call, "except Exception:\n", "    pass\n",
        'group_by = dbutils.widgets.get("group_by").strip()\n']}
    owned = {"cell_type": "code", "source": ['dbutils.widgets.text("result_table", "main.inspire.out")\n'],
             "metadata": {"application/vnd.databricks.v1+cell": {"title": "Run controls (Inspire, do not edit)"}}}
    return {"cells": [genie, owned], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}


def _grouping_fill(default="all", kind="dropdown", choices=None):
    widget = {"name": "group_by", "type": kind, "default": default, "allowed": "", "label": "Grouping"}
    if kind == "dropdown":
        widget["choices"] = list(CHOICES if choices is None else choices)
    return {"widgets": [widget, {"name": "result_table", "type": "text", "default": "main.inspire.out", "allowed": ""},
                        {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["preview", "full"], "allowed": ""}],
            "changes": []}


CORE = [{"name": "group_by", "default": PLANNED, "allowed": ""}, {"name": "result_table", "default": "main.inspire.out", "allowed": ""}]


def test_a_grouping_genie_wrote_another_valid_default_for_is_set_back_to_the_planned_one(agent_ns):
    inst, written = _repairing(agent_ns, _grouping_notebook("all"))
    fill = _grouping_fill("all")
    repaired = inst._implement_repair_widget_defaults("N01-U01", "/W/nb", fill, CORE)
    assert repaired and repaired[0].startswith("group_by from all to paymentMethod"), repaired
    assert len(written) == 1, "the notebook is imported with the planned default"
    genie = "".join(written[0]["cells"][0]["source"])
    assert 'dbutils.widgets.dropdown("group_by", "paymentMethod", ["all", "product", "paymentMethod"], "Grouping")' in genie
    assert fill["widgets"][0]["default"] == PLANNED
    assert agent_ns["validate_genie_fill_result"](fill, ["result_table", "group_by"]) == []


def test_a_text_grouping_widget_with_another_default_is_set_to_the_planned_one_too(agent_ns):
    fixes = agent_ns["implement_widget_default_fixes"](_grouping_fill("all", kind="text"), CORE)
    assert [(w["name"], old, new) for w, old, new in fixes] == [("group_by", "all", PLANNED)]
    inst, written = _repairing(agent_ns, _grouping_notebook("all", kind="text"))
    assert inst._implement_repair_widget_defaults("N01-U01", "/W/nb", _grouping_fill("all", kind="text"), CORE)
    assert 'dbutils.widgets.text("group_by", "paymentMethod", "Grouping")' in "".join(written[0]["cells"][0]["source"])


def test_a_grouping_already_at_the_plan_or_a_plan_a_dropdown_cannot_hold_is_left_alone(agent_ns):
    assert agent_ns["implement_widget_default_fixes"](_grouping_fill(PLANNED), CORE) == [], "a default already at the plan is not touched"
    multi = [{"name": "group_by", "default": "region, country", "allowed": ""}]
    assert agent_ns["implement_widget_default_fixes"](_grouping_fill("all", choices=["all", "region"]), multi) == [], (
        "a planned Grouping that is not one of the dropdown's choices cannot be set on it")
    assert agent_ns["implement_widget_default_fixes"](_grouping_fill("all"), [{"name": "group_by", "default": "", "allowed": ""}]) == [], (
        "no plan means the Grouping is not Inspire's to set")


def test_the_widget_a_run_reads_carries_the_planned_grouping_and_the_proof_check_follows_it(agent_ns, monkeypatch):
    inst, written = _repairing(agent_ns, _grouping_notebook("all"))
    inst._implement_repair_widget_defaults("N01-U01", "/W/nb", _grouping_fill("all"), CORE)
    genie = "".join(written[0]["cells"][0]["source"])

    class Widgets:
        def __init__(self):
            self.declared = {}

        def dropdown(self, name, default, choices, label=""):
            self.declared.setdefault(name, str(default))

        def text(self, name, default, label=""):
            self.declared.setdefault(name, str(default))

        def get(self, name):
            if name not in self.declared:
                raise RuntimeError(f"No input widget named {name}")
            return self.declared[name]

    widgets = Widgets()
    monkeypatch.setitem(agent_ns, "dbutils", type("D", (), {"widgets": widgets})())
    exec(genie, {"dbutils": type("D", (), {"widgets": widgets})()})
    read = agent_ns["inspire_widget"]("group_by", "all")
    assert read == PLANNED, f"the run reads the Grouping the App checks it against, not the notebook's old default: {read!r}"
    record = {"mode": "columns", "group_by": [PLANNED], "groups": 2}
    assert agent_ns["implement_grouping_proof_problems"](record, read, "r-proof") == []


def test_the_live_refusal_is_what_a_run_that_read_all_produces(agent_ns):
    record = {"mode": "all", "group_by": "all", "groups": 1}
    assert agent_ns["implement_grouping_proof_problems"](record, PLANNED, LIVE_RUN) == [LIVE_REFUSAL]


def test_a_refusal_that_only_names_another_run_is_the_same_refusal_for_the_repeat_stop(agent_ns):
    first = LIVE_REFUSAL.replace(LIVE_RUN, "66666666-7777-4888-8999-aaaaaaaaaaaa")
    history = [{"error": first, "kind": "rebuild_with_error"}]
    assert agent_ns["implement_repeated_rebuild"](history, LIVE_REFUSAL) is True
    other = LIVE_REFUSAL.replace("grouped by all", "grouped by product")
    assert agent_ns["implement_repeated_rebuild"](history, other.replace(LIVE_RUN, "11111111-2222-4333-8444-555555555555")) is False, (
        "a refusal whose groups differ is a different fault and is sent back")
    retry = [{"error": first, "kind": "retry", "by": "model"}]
    assert agent_ns["implement_repeated_retry"](retry, LIVE_REFUSAL) is True


def test_a_grouping_refusal_repeated_with_new_run_ids_stops_after_the_round_it_repeats_in(agent_ns, monkeypatch):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 233}, 3, 4)] * 3)
    runs = iter(["66666666-7777-4888-8999-aaaaaaaaaaaa", LIVE_RUN, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"])

    def gates(*_args, **_kwargs):
        run = next(runs)
        return [agent_ns["implement_gate"]("notebook", [f"run {run} ran with the Grouping paymentMethod, but its records were grouped by "
                                                        "all into 1 group"], "group by paymentMethod", "groups ignore the Grouping",
                                           "groups ignore the Grouping")]

    monkeypatch.setattr(inst, "_implement_preview_gates", gates, raising=False)
    inst.logger = MagicMock()
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, True)
    assert len(runner.prompts) == 2, "round 2 repeats round 1's refusal under a new run id, so no third Genie round is sent"
    assert any("[REPEAT-REFUSAL STOP]" in str(c) for c in inst.logger.warning.call_args_list)
    assert outcome.get("gate_problems"), "the repeated refusal is still reported as not fixed"


def test_the_repeat_key_keeps_the_text_and_drops_only_the_ids(agent_ns):
    key = agent_ns["implement_repeat_key"]
    assert key(LIVE_REFUSAL) == key(LIVE_REFUSAL.replace(LIVE_RUN, "66666666-7777-4888-8999-aaaaaaaaaaaa"))
    assert key(LIVE_REFUSAL) != key(LIVE_REFUSAL.replace("all into 1 group", "product into 4 groups")), "the groups stay part of the key"
