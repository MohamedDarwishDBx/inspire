"""REQ-250 (follow-up): the Genie Agent may read the use case's own result companions, through the same list as the App-fit check.

The companions (the result table with __segments, __assign, __migration) hold what decision owners ask about, so a Genie Agent that
reads them is correct. implement_use_case_reads is the one list both checks use: the use case's allowed tables plus its own result's
companions (implement_app_result_reads). Another use case's companions are not in it, and a Genie SQL that reads one is refused.
"""
import json

RESULT = "inspire_kinds_rc7._inspire.segment_results"
OTHER_RESULT = "inspire_kinds_rc7._inspire.other_results"
SOURCE = "inspire_kinds_rc7._inspire.sales_customers"


def _space(sql):
    return {"title": "Segments", "config": {"sample_questions": [{"question": ["Which segment grew?"]}]},
            "data_sources": {"tables": [{"identifier": RESULT}]},
            "instructions": {"example_question_sqls": [{"question": ["Which segment grew?"], "sql": [sql]}]}}


def _outside(errors):
    return [e for e in errors if "outside this use case" in e]


def test_use_case_reads_add_only_this_results_companions(agent_ns):
    reads = agent_ns["implement_use_case_reads"]([SOURCE], RESULT)
    assert SOURCE in reads and RESULT in reads
    assert f"{RESULT}__segments" in reads and f"{RESULT}__assign" in reads
    assert not [r for r in reads if r.startswith(OTHER_RESULT)], "another use case's companions are not the use case's reads"


def test_genie_sql_may_read_its_own_result_companion(agent_ns):
    allowed = agent_ns["implement_use_case_reads"]([SOURCE], RESULT)
    sql = f"SELECT segment FROM {RESULT}__segments"
    _title, _desc, _space_out, errors = agent_ns["normalize_genie_space"](json.dumps(_space(sql)), allowed)
    assert _outside(errors) == [], errors


def test_genie_sql_refuses_another_use_cases_companion(agent_ns):
    """Must-exclude: a Genie SQL that reads another use case's companion is outside this use case."""
    allowed = agent_ns["implement_use_case_reads"]([SOURCE], RESULT)
    sql = f"SELECT segment FROM {OTHER_RESULT}__segments"
    _title, _desc, _space_out, errors = agent_ns["normalize_genie_space"](json.dumps(_space(sql)), allowed)
    assert _outside(errors) and f"{OTHER_RESULT}__segments" in _outside(errors)[0], errors
