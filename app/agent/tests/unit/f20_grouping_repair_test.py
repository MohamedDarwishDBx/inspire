"""REQ-349: a repair that writes a different group_by default is restored to the planned Grouping, not refused.

Live shape (rehearsal build, use case "Flag Franchise Sales Slumps"): the plan pinned the Grouping `paymentMethod` over the columns
`product, paymentMethod` (coarse to fine), the source was filtered to a Row Group (`paymentMethod in (visa, amex)`), and Genie wrote the
dropdown default `all`. No preview round raised a grouping error; the guard refused the default before the restore could write the plan
back, so the build ended failed with a refusal that did not say why the default could not be kept.
"""
import json
import os

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "dbx_inspire_ai_agent.ipynb")

GROUPING = {"columns": ["product", "paymentMethod"], "one_model": False}
CORE = [{"name": "group_by", "default": "paymentMethod", "allowed": "product, paymentMethod"}]
CHOICES = ["all", "product", "paymentMethod"]
DROPDOWN_LINE = 'dbutils.widgets.dropdown("group_by", "all", ["all", "product", "paymentMethod"], "Grouping")'


def fill(widgets):
    return {"status": "built", "changes": [], "widgets": [
        {"name": n, "default": d, "type": "dropdown", "choices": list(CHOICES)} for n, d in widgets]}


def cells_with(text):
    return [{"cell_type": "code", "source": [text + "\n"], "metadata": {}, "outputs": [], "execution_count": None}]


def test_a_group_by_default_written_away_from_the_plan_is_restored_before_the_guard(agent_ns):
    fixes = agent_ns["implement_widget_default_fixes"](fill([("group_by", "all")]), CORE)
    assert [(w["name"], held, planned) for w, held, planned in fixes] == [("group_by", "all", "paymentMethod")], fixes
    cells = cells_with(DROPDOWN_LINE)
    assert agent_ns["implement_widget_default_patch"](cells, "group_by", "all", "paymentMethod")
    assert 'dropdown("group_by", "paymentMethod"' in "".join(cells[0]["source"]), cells
    restored = fill([("group_by", "paymentMethod")])
    pinned = agent_ns["implement_choice_pinned"](CORE, None)
    assert agent_ns["implement_choice_changes"]([restored], pinned) == [], "the restored plan is not a change (must-pass)"


def test_the_repair_loop_restores_the_default_before_the_guard_reads_the_fill():
    import json as _json
    with open(NOTEBOOK, encoding="utf-8") as handle:
        nb = _json.load(handle)
    source = "".join("".join(c["source"]) for c in nb["cells"] if c.get("cell_type") == "code")
    repair = source.index("self._implement_repair_widget_defaults(uc_id, notebook_path, fill, core_widgets)")
    guard = source.index("moved = implement_choice_changes([fill], implement_choice_pinned(core_widgets")
    assert repair < guard, "the planned default must be written back before the guard refuses a pinned choice (REQ-349)"


def test_the_refusal_names_the_real_reason_it_could_not_keep_the_grouping(agent_ns):
    unset = agent_ns["implement_widget_default_fixes"](fill([("group_by", "all")]), [{"name": "group_by", "default": "paymentMethod"}])
    reason = agent_ns["implement_default_restore_reason"](unset)
    assert reason.startswith("the group_by widget default is all, and Inspire could not write paymentMethod back into the notebook")
    moved = ["the grouping from paymentMethod to all", reason]
    text = agent_ns["implement_choice_refusal"](GROUPING, moved)
    assert text.startswith("could not group by product, paymentMethod: a repair tried to change it"), text
    assert "the group_by widget default is all" in text and "could not write paymentMethod back" in text, text
    assert text.endswith("change the grouping on the Run page"), text


def test_a_grouping_that_cannot_be_put_back_is_still_refused(agent_ns):
    # The planned value is not a dropdown choice, so no restore is possible: the real swap must stay refused (must-keep).
    bad_core = [{"name": "group_by", "default": "region", "allowed": "product, paymentMethod"}]
    fixes = agent_ns["implement_widget_default_fixes"](fill([("group_by", "all")]), bad_core)
    assert fixes == [], "a plan outside the choices is not restored (must-exclude)"
    pinned = agent_ns["implement_choice_pinned"](bad_core, None)
    moved = agent_ns["implement_choice_changes"]([fill([("group_by", "all")])], pinned)
    assert moved, "a real grouping swap that cannot be restored is refused (must-keep)"
    assert "could not group by" in agent_ns["implement_choice_refusal"](GROUPING, moved)


def test_a_scope_swap_is_still_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, {"chosen": {"scope": "recent", "days": 30}})
    moved = agent_ns["implement_choice_changes"]([fill([("run_scope", "all")])], pinned)
    assert moved and moved[0].startswith("the scope from recent to all"), moved
