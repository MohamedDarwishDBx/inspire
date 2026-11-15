"""REQ-292 and REQ-269 (rc2, lane P88).

REQ-292(a): the First-run sentence named the goal (about 1,000 records) where the whole groups it picked held 583 records.
REQ-292(b): a forecast on short history counts the backtest folds the history fits and says why that is short, never a bare 0.
REQ-269: the First-run sample sentence leads the Genie Agent's instructions, so an answer about the table is told the sample first.
"""

from v142_genie_test import COLUMNS, LATEST, ORDERS, RESULT, _rich_space
from v120_artifacts_support import FakeSpark

TABLE = "inspire_kinds_rc7._inspire.sales_transactions"
GROUPS = {"amex": 204, "visa": 190, "mastercard": 189}
WHOLE_GROUPS = {
    "scope": "records", "table": TABLE, "records": 1000, "column": "paymentMethod", "whole_groups": True,
    "values": ["amex", "visa", "mastercard"], "group_records": GROUPS, "key": "transaction_id",
}
EXPECTED_TEXT = ("583 records of inspire_kinds_rc7._inspire.sales_transactions, in 3 whole groups so no group is cut: "
                 "paymentMethod = amex, 204 records; paymentMethod = visa, 190 records; paymentMethod = mastercard, 189 records")


def _instruction_text(space):
    return "".join(space["instructions"]["text_instructions"][0]["content"])


def _columns(*extra):
    return {k.lower(): v for k, v in dict(COLUMNS, **{c: "STRING" for c in extra}).items()}


def test_the_first_run_sentence_counts_the_records_its_whole_groups_hold_not_the_goal(agent_ns):
    # fail-pre: the branch for whole groups that all fit under the goal printed "about 1,000 records", the goal, not the 583 read
    assert agent_ns["inspire_scope_text"](WHOLE_GROUPS) == EXPECTED_TEXT
    assert "about 1,000" not in agent_ns["inspire_scope_text"](WHOLE_GROUPS)


def test_the_scope_record_and_the_genie_fact_carry_the_same_count_the_run_read(agent_ns):
    record = agent_ns["inspire_scope_record"](WHOLE_GROUPS, "")
    assert record["text"] == EXPECTED_TEXT
    fact = agent_ns["implement_run_scope_fact"](record, [{"table": TABLE, "rows": 583, "rows_total": 3333}])
    assert ", which read 583 records of " + TABLE + "." in fact
    assert "about 1,000" not in fact


def test_a_group_total_above_the_goal_still_reports_the_real_total(agent_ns):
    # the branch that already counted the real total, pinned so the two branches cannot drift apart
    text = agent_ns["inspire_scope_text"](dict(WHOLE_GROUPS, records=500))
    assert text.startswith("583 records of " + TABLE + ", in 3 whole groups, so the First run sees more than one group")


def test_the_genie_instruction_leads_with_the_first_run_sample_and_its_count(agent_ns):
    # fail-pre: the sample sentence was appended after every other fact, so Genie read the table's own rules before the sample
    fact = agent_ns["implement_run_scope_fact"](agent_ns["inspire_scope_record"](WHOLE_GROUPS, ""), [{"table": TABLE, "rows": 583}])
    space = _rich_space()
    problems = agent_ns["implement_genie_space_grounding"](space, _columns("data_quality_flag", "held_back"), RESULT, [RESULT, ORDERS],
                                                           (), LATEST, "", "", run_scope=fact)
    text = _instruction_text(space)
    assert problems == [] and text.startswith(fact), text[:300]
    assert text.count(fact) == 1
    assert "583 records of " + TABLE in text.split("\n\n")[0]


def test_the_backtest_counts_the_folds_the_history_fits_at_the_horizon(agent_ns):
    # fail-pre: the helper did not exist, so no run could count the folds its history fits. Each fold tests on the next horizon
    # periods and trains on at least two seasonal cycles; train lengths are returned latest fold first.
    origins = agent_ns["inspire_backtest_origins"]
    assert origins(periods=730, horizon=7, season=7) == [723, 716, 709]
    assert origins(periods=30, horizon=7, season=7) == [23, 16], "the third fold would train on 9 periods, under two cycles of 7"
    assert origins(periods=20, horizon=7, season=7) == [], "under two seasonal cycles plus one horizon, no fold fits"
    assert origins(periods=730, horizon=7, season=7, folds=1) == [723]


def test_a_short_history_says_how_many_folds_fit_and_why_it_cannot_be_trusted(agent_ns):
    fit = agent_ns["inspire_backtest_origins"](periods=30, horizon=7, season=7)
    assert agent_ns["inspire_backtest_shortfall"](fit, 3, periods=30, horizon=7, season=7) == (
        "the history fits 2 of 3 backtest folds: each series has 30 periods, and a fold trains on 14 periods (two seasonal cycles) "
        "before testing on the next 7, so the forecast cannot be checked on 3 folds yet")
    assert agent_ns["inspire_backtest_shortfall"](agent_ns["inspire_backtest_origins"](periods=730, horizon=7, season=7),
                                                  3, periods=730, horizon=7, season=7) == "", "enough folds: nothing to explain"


def test_the_forecasting_guidance_tells_the_run_to_count_folds_with_the_helpers(agent_ns):
    # fail-pre: the guidance asked for three folds and never said how a run counts the folds its history fits
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]["Forecasting"]
    assert "inspire_backtest_origins(" in guidance and "inspire_backtest_shortfall(" in guidance
    assert "min_backtest_folds" in guidance


def test_a_folds_shortfall_is_written_into_the_reason_the_run_is_not_trusted(fresh_ns):
    # fail-pre: inspire_write_result had no why= channel, so the status could only say "measured 2" without the reason
    from v120_artifacts_support import FakeSpark
    import types
    frame = types.SimpleNamespace(schema=types.SimpleNamespace(fields=[]), write=types.SimpleNamespace(
        mode=lambda *_a: types.SimpleNamespace(option=lambda *_b: types.SimpleNamespace(saveAsTable=lambda *_c: None))))
    seen = []
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"min_backtest_folds": "3"}
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, **given: seen.append(given) or 3
    why = fresh_ns["inspire_backtest_shortfall"](fresh_ns["inspire_backtest_origins"](periods=30, horizon=7, season=7), 3,
                                                 periods=30, horizon=7, season=7)
    fresh_ns["inspire_write_result"](frame, "main.inspire.fc_out", spark_session=FakeSpark(), out=lambda *_a: None,
                                     accepted=False, missed={"min_backtest_folds": 2}, why=why)
    text = seen[0]["nothing_to_act"]
    assert text.startswith("No model passed this use case's acceptance check in the last run: Minimum backtest folds is 3, and this run measured 2"), text
    assert text.endswith(". The history fits 2 of 3 backtest folds: each series has 30 periods, and a fold trains on 14 periods (two seasonal "
                         "cycles) before testing on the next 7, so the forecast cannot be checked on 3 folds yet"), text


# P88 round 2 (D-AUTO): records mode on a table smaller than the goal names the rows it reads. The count comes from one shared fixture
# that the wizard JS test also reads (app/frontend/test/firstRunCountShared.test.mjs).
import json as _json
from pathlib import Path as _Path

_CASES = _json.loads((_Path(__file__).resolve().parents[1] / "fixtures" / "first_run_count_cases.json").read_text())["cases"]


def _standalone(table, goal, available=None):
    chosen = {"scope": "records", "table": table, "records": goal, "key": "transaction_id"}
    return dict(chosen, available=available) if available is not None else chosen


def test_records_mode_on_a_table_smaller_than_the_goal_names_the_rows_it_reads(agent_ns):
    # fail-pre: the plain records branch printed the goal ("1,000 records") whatever the table held
    text = agent_ns["inspire_scope_text"](_standalone(TABLE, 1000, available=583))
    assert text == f"583 records of {TABLE} {agent_ns['INSPIRE_SPREAD_WORDS']}", text


def test_the_text_matches_the_fixture_for_every_case_and_the_goal_only_when_the_table_is_larger(agent_ns):
    # fail-pre on the smaller-table cases (text said the goal); the larger-table case already read the goal
    for case in _CASES:
        text = agent_ns["inspire_scope_text"](_standalone(TABLE, case["goal"], available=case["rows"]))
        noun = "record" if case["shown"] == 1 else "records"
        assert text.startswith(f"{case['shown']:,} {noun} of {TABLE}"), (case["name"], text)


def test_the_one_group_and_cut_records_name_the_rows_too(agent_ns):
    one = dict(_standalone(TABLE, 1000, available=583), one_group=True)
    assert agent_ns["inspire_scope_text"](one).startswith(f"583 records of {TABLE} "), agent_ns["inspire_scope_text"](one)
    cut = dict(_standalone(TABLE, 1000, available=583), cut="Anomaly Detection", cut_column="")
    assert agent_ns["inspire_scope_text"](cut).startswith(f"583 records of {TABLE} "), agent_ns["inspire_scope_text"](cut)


def test_resolve_counts_the_table_for_records_mode_and_the_text_follows_the_count(agent_ns):
    # fail-pre: resolve returned the choice with no count, so the text could not name what the run reads
    spark = FakeSpark(responder=lambda s: [{"n": 583}] if s.startswith("SELECT COUNT(*)") else [])
    resolved = agent_ns["inspire_scope_resolve"](spark, _standalone(TABLE, 1000))
    assert resolved["available"] == 583
    assert any(s.startswith("SELECT COUNT(*) AS n FROM") for s in spark.statements)
    assert agent_ns["inspire_scope_text"](resolved).startswith(f"583 records of {TABLE} ")
