from v142_genie_test import RESULT, COLUMNS


def _columns(*extra):
    return {k.lower(): v for k, v in dict(COLUMNS, **{c: "STRING" for c in extra}).items()}


def test_an_unnamed_count_of_records_is_the_open_work_count_answered_first(agent_ns):
    fact = agent_ns["implement_scope_fact"](RESULT, _columns("data_quality_flag", "held_back"))
    assert "Any count of records, candidates, duplicates or groups that does not name one group is the open work count" in fact
    assert "answer it with that number first and say that it is the records that need action." in fact


def test_the_default_count_fact_is_absent_without_the_quality_flag(agent_ns):
    assert agent_ns["implement_scope_fact"](RESULT, _columns()) == ""
