"""REQ-403: a Grouping on a joined column is written back into the notebook and read as the person's pick.

Live shape (W12 build B2, use case N02-U04): the person picked accounts.segment, a column of a joined table. The Grouping
carried the discovery candidates too (product, paymentMethod, accounts.segment), and the notebook's group_by default came
back as all, so the repair could not write the pick back and the build was refused.
"""
import pytest

PICK = "accounts.segment"
CANDIDATES = ["product", "paymentMethod"]
CHOICES = ["all", "product", "paymentMethod", PICK]


def fill(default, choices=CHOICES):
    return {"status": "built", "changes": [], "widgets": [
        {"name": "group_by", "default": default, "type": "dropdown", "choices": list(choices)}]}


def cells_with(text):
    return [{"cell_type": "code", "source": [text + "\n"], "metadata": {}, "outputs": [], "execution_count": None}]


def plan_for(agent_ns, chosen, candidates=CANDIDATES):
    return agent_ns["implement_grouping_plan"]("Anomaly Detection", candidates, chosen, "", [], "person")


def test_a_picked_joined_column_is_the_whole_grouping(agent_ns):
    plan = plan_for(agent_ns, PICK)
    assert (plan["applies"], plan["default"], plan["columns"]) == (True, PICK, [PICK]), plan


def test_a_multi_column_pick_keeps_exactly_the_picked_columns(agent_ns):
    plan = plan_for(agent_ns, f"paymentMethod, {PICK}")
    assert plan["columns"] == ["paymentMethod", PICK], plan


def test_without_a_pick_the_discovery_candidates_still_form_the_grouping(agent_ns):
    plan = plan_for(agent_ns, "")
    assert plan["columns"] == CANDIDATES, plan


def test_the_build_instruction_and_the_refusal_name_only_the_pick(agent_ns):
    plan = plan_for(agent_ns, PICK)
    rule = agent_ns["genie_grouping_rule"]({"columns": plan["columns"], "time_column": plan["time_column"]})
    assert f"from `{PICK}`" in rule and "`product`" not in rule and "`paymentMethod`" not in rule, rule
    refusal = agent_ns["implement_choice_refusal"]({"columns": plan["columns"]}, ["the grouping from all to product"])
    assert refusal.startswith(f"could not group by {PICK}: "), refusal


def test_the_repair_writes_the_plan_into_a_declaration_whatever_literal_the_report_named(agent_ns):
    cells = cells_with(f'dbutils.widgets.dropdown("group_by", "product", {CHOICES!r}, "Grouping")')
    assert agent_ns["implement_widget_default_patch"](cells, "group_by", "all", PICK, any_literal=True) is True
    assert f'dropdown("group_by", "{PICK}"' in "".join(cells[0]["source"]), cells


def test_the_repair_writes_every_declaration_of_the_widget(agent_ns):
    cells = [
        {"cell_type": "code", "source": ['dbutils.widgets.text("group_by", "all", "Grouping")\n'], "metadata": {}},
        {"cell_type": "code", "source": ['dbutils.widgets.text("group_by", "all", "Grouping again")\n'], "metadata": {}},
    ]
    assert agent_ns["implement_widget_default_patch"](cells, "group_by", "all", PICK, any_literal=True) is True
    assert all(f'"group_by", "{PICK}"' in "".join(cell["source"]) for cell in cells), cells


def test_a_numeric_range_keeps_the_strict_match_on_the_reported_value_and_one_declaration(agent_ns):
    twice = [
        {"cell_type": "code", "source": ["dbutils.widgets.text('min_rows', '0', 'Rows')\n"], "metadata": {}},
        {"cell_type": "code", "source": ["dbutils.widgets.text('min_rows', '0', 'Rows again')\n"], "metadata": {}},
    ]
    assert agent_ns["implement_widget_default_patch"](twice, "min_rows", "0", "1") is False, "two declarations stay refused (must-keep)"
    once = cells_with("dbutils.widgets.text('min_rows', '5', 'Rows')")
    assert agent_ns["implement_widget_default_patch"](once, "min_rows", "0", "1") is False, "a literal other than the reported one stays refused"


def test_the_repair_leaves_undeclared_and_prefixed_widgets_alone(agent_ns):
    cells = cells_with('dbutils.widgets.text("group_by_extra", "all", "Other")')
    assert agent_ns["implement_widget_default_patch"](cells, "group_by", "all", PICK, any_literal=True) is False
    assert '"group_by_extra", "all"' in "".join(cells[0]["source"]), cells


def test_a_joined_pick_written_back_is_accepted_by_the_guard_end_to_end(agent_ns):
    core = [{"name": "group_by", "default": PICK}]
    pinned = agent_ns["implement_choice_pinned"](core, None)
    drifted = fill("all")
    fixes = agent_ns["implement_widget_default_fixes"](drifted, core, pinned)
    assert [(w["name"], held, planned) for w, held, planned in fixes] == [("group_by", "all", PICK)], fixes
    cells = cells_with('dbutils.widgets.dropdown("group_by", "all", ' + repr(CHOICES) + ', "Grouping")')
    assert agent_ns["implement_widget_default_patch"](cells, "group_by", "all", PICK, any_literal=True) is True
    drifted["widgets"][0]["default"] = PICK
    assert agent_ns["implement_choice_changes"]([drifted], pinned) == [], "the written-back pick is not a change (must-pass)"


def test_a_pick_the_dropdown_cannot_hold_is_still_refused(agent_ns):
    core = [{"name": "group_by", "default": PICK}]
    pinned = agent_ns["implement_choice_pinned"](core, None)
    no_pick = fill("all", choices=["all", "product", "paymentMethod"])
    assert agent_ns["implement_widget_default_fixes"](no_pick, core, pinned) == [], "not restorable (must-exclude)"
    assert agent_ns["implement_choice_changes"]([no_pick], pinned), "the swap stays refused (must-keep)"


@pytest.mark.parametrize("vibe_name,held,expected_problem", [
    ("Accounts.Segment", "accounts.segment", ""),
    ("accounts.segment", "all", "the Grouping is all, not accounts.segment"),
])
def test_the_grouping_default_check_compares_the_joined_column_like_the_repair(agent_ns, vibe_name, held, expected_problem):
    widgets = [{"name": "group_by", "default": held}]
    assert agent_ns["implement_grouping_default_problem"](vibe_name, widgets) == expected_problem
