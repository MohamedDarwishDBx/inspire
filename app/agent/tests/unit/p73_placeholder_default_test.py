import copy

PLACEHOLDER = "a data value"
CORE = [{"name": "group_by", "type": "text", "default": "all", "allowed": "all or column names", "label": "Data groups"},
        {"name": "k_max", "type": "text", "default": "", "allowed": "whole number, 1 to 10", "label": "Clusters"}]


def _fill(widgets):
    return {"widgets": copy.deepcopy(widgets), "summary": "built"}


def test_a_placeholder_default_never_reaches_a_widget(agent_ns):
    """Must-exclude: Genie's fill never leaves the redacted placeholder as a widget default, so the notebook never runs with it (REQ-263, REQ-251)."""
    fill = _fill([{"name": "group_by", "type": "text", "default": PLACEHOLDER, "allowed": "all or column names", "label": "Data groups"},
                  {"name": "k_max", "type": "text", "default": PLACEHOLDER, "allowed": "whole number, 1 to 10", "label": "Clusters"}])
    agent_ns["normalize_genie_fill_widgets"](fill, CORE)
    defaults = {w["name"]: w["default"] for w in fill["widgets"]}
    assert all(PLACEHOLDER not in str(value) for value in defaults.values()), defaults
    assert defaults == {"group_by": "all", "k_max": "1"}, defaults


def test_whole_data_runs_with_group_by_all(agent_ns):
    """Whole data is group_by='all' when no plan names a Grouping, and never the placeholder."""
    assert agent_ns["implement_placeholder_default"]("group_by", None, "") == "all"
    assert agent_ns["implement_placeholder_default"]("group_by", PLACEHOLDER, "") == "all"
    fill = _fill([{"name": "group_by", "type": "text", "default": PLACEHOLDER, "allowed": "", "label": "Data groups"}])
    agent_ns["normalize_genie_fill_widgets"](fill, [])
    assert fill["widgets"][0]["default"] == "all"


def test_a_real_chosen_column_and_a_real_number_pass_through(agent_ns):
    """Must-keep: a real Grouping column and an in-range number are not rewritten."""
    fill = _fill([{"name": "group_by", "type": "text", "default": "region", "allowed": "all or column names", "label": "Data groups"},
                  {"name": "k_max", "type": "text", "default": "5", "allowed": "whole number, 1 to 10", "label": "Clusters"}])
    agent_ns["normalize_genie_fill_widgets"](fill, CORE)
    assert {w["name"]: w["default"] for w in fill["widgets"]} == {"group_by": "region", "k_max": "5"}


def test_the_stop_feedback_names_the_hidden_value_instead_of_quoting_the_placeholder(agent_ns):
    """Fail-pre: the stop text Genie reads must not carry the placeholder as a quoted value."""
    reason = f"run_use_case() raised ValueError: group_by='{PLACEHOLDER}' is outside the allowed range: all"
    shown = agent_ns["implement_hidden_text"](reason)
    assert f"'{PLACEHOLDER}'" not in shown and PLACEHOLDER not in shown.replace("a value Inspire hid", ""), shown
    assert "a value Inspire hid (not a real value)" in shown and "allowed range: all" in shown
    assert agent_ns["implement_hidden_text"]("group_by='region' is outside the allowed range: all") == \
        "group_by='region' is outside the allowed range: all"
