from v142_genie_test import COLUMNS, LATEST, ORDERS, RESULT, _rich_space


def _columns(*extra):
    return {k.lower(): v for k, v in dict(COLUMNS, **{c: "STRING" for c in extra}).items()}


def test_the_scope_fact_names_open_work_as_current_unheld_ok_rows_and_the_two_excluded_groups(agent_ns):
    fact = agent_ns["implement_scope_fact"](RESULT, _columns("data_quality_flag", "held_back"))
    assert fact.startswith(f"Open work in `{RESULT}` is the current rows (is_current = TRUE and change_source <> 'delete') ")
    assert "with held_back = FALSE and data_quality_flag = 'ok'." in fact
    assert "name each group separately in plain words" in fact
    assert "held back (held_back = TRUE, kept off the to fix list on purpose)" in fact
    assert "records that could not be checked (data_quality_flag is not 'ok'" in fact
    assert "Never count a record that could not be checked as open work." in fact
    assert not any(ch in fact for ch in "–—"), "no dashes in Genie-facing text"


def test_the_scope_fact_leaves_out_the_held_back_test_when_the_table_has_no_held_back_column(agent_ns):
    fact = agent_ns["implement_scope_fact"](RESULT, _columns("data_quality_flag"))
    assert "with data_quality_flag = 'ok'." in fact and "held_back" not in fact


def test_a_result_table_without_a_quality_flag_gets_no_scope_fact(agent_ns):
    assert agent_ns["implement_scope_fact"](RESULT, _columns()) == ""


def test_the_genie_space_is_told_the_open_work_scope_once_when_the_table_carries_the_flag(agent_ns):
    space = _rich_space()
    columns = _columns("data_quality_flag", "held_back")
    fact = agent_ns["implement_scope_fact"](RESULT, columns)
    problems = agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, "", "")
    agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, "", "")
    text = "".join(space["instructions"]["text_instructions"][0]["content"])
    assert problems == [] and text.count(fact) == 1
