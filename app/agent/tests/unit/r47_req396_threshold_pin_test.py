"""REQ-396: a repair may not loosen a threshold the use case states, and Genie's refusal says what it wanted to change.

Live evidence (rc7, joined segmentation use case N02-U02): the build let Genie set the per-entity minimum from 10 (or 20) to 1 and
then pass on rule-based tiers, so the App reported a result the stated minimum would not have allowed. The stated thresholds are the
family's readiness minimums (GENIE_READINESS_THRESHOLDS plus the person's overrides), which reach the notebook as widgets. They are
pinned like the grouping, the scope and the measure (REQ-346): the spec's value (before) against the widget Genie filled (after).
The text of a change is never read, and a method or technique change is not a threshold change, so it keeps its REQ-346 behaviour."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v203_kind_companion_gate_test import TABLE as SEG_TABLE, _gates  # noqa: E402

GROUPING = {"columns": ["city"], "one_model": False}
CORE = [{"name": "group_by", "default": "city"}, {"name": "min_entities_per_k", "default": "10"},
        {"name": "min_numeric_features", "default": "3"}, {"name": "min_join_coverage", "default": "0.8"}]
STATED = {"min_entities_per_k": 10, "min_numeric_features": 3, "min_join_coverage": 0.8}


def fill(widgets=(), changes=()):
    return {"status": "built", "changes": list(changes), "widgets": [{"name": n, "default": d} for n, d in widgets]}


def method_change(was, now):
    return {"what": "the segmentation method", "why": "the data is thin", "cause": "rule", "method_was": was, "method_now": now,
            "setting": "", "value_was": "", "value_now": ""}


def test_a_stated_threshold_is_pinned_next_to_the_grouping(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    assert pinned == {"group_by": "city", "min_entities_per_k": 10, "min_numeric_features": 3, "min_join_coverage": 0.8}, pinned


def test_a_threshold_loosened_by_a_repair_is_refused_and_named(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    moved = agent_ns["implement_choice_changes"]([fill([("min_entities_per_k", "1")])], pinned)
    assert moved == ["the threshold min_entities_per_k from 10 to 1"], moved


def test_the_refusal_says_what_genie_wanted_to_change_and_that_the_threshold_is_kept(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    moved = agent_ns["implement_choice_changes"]([fill([("min_entities_per_k", "1")])], pinned)
    text = agent_ns["implement_choice_refusal"](GROUPING, moved)
    assert text == ("could not keep the thresholds you set: a repair tried to change them (the threshold min_entities_per_k from 10 to 1), "
                    "and Inspire keeps every threshold the use case states; change the threshold on the Use case page, then build again"), text


def test_a_threshold_kept_at_its_stated_value_in_any_number_form_is_not_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    kept = fill([("min_entities_per_k", "10.0"), ("min_numeric_features", "3"), ("min_join_coverage", "0.80")])
    assert agent_ns["implement_choice_changes"]([kept], pinned) == [], "the same number, written another way, is not a change (must-keep)"


def test_a_threshold_the_use_case_leaves_empty_is_not_pinned_so_genie_may_fill_it(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([{"name": "min_rows", "default": ""}], None, {"min_rows": None, "min_join_coverage": ""})
    assert pinned == {}, "an empty stated threshold is for Genie to fill (must-exclude)"
    assert agent_ns["implement_choice_changes"]([fill([("min_rows", "5")])], pinned) == []


def test_a_method_change_and_a_grouping_change_keep_their_req346_behaviour(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    method = method_change("KMeans segmentation with quantile fallback", "Rule-based spend-gap tiers")
    assert agent_ns["implement_choice_changes"]([fill(changes=[method], widgets=[("min_entities_per_k", "10")])], pinned) == [], \
        "a method change passes under REQ-346 (must-pass)"
    moved = agent_ns["implement_choice_changes"]([fill([("group_by", "all"), ("min_entities_per_k", "1")])], pinned)
    assert len(moved) == 2, moved
    assert agent_ns["implement_choice_refusal"](GROUPING, moved).startswith("could not group by city: a repair tried to change it"), moved


def test_a_scope_or_measure_only_pin_set_is_unchanged_by_the_threshold_pins(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([{"name": "currency", "default": "USD"}], None)
    assert pinned == {"currency": "USD"}, "no thresholds passed, so only the REQ-346 choices are pinned (must-exclude)"


def test_numbers_are_compared_as_numbers_and_text_as_text(agent_ns):
    same = agent_ns["implement_choice_same"]
    assert same("0.80", 0.8) and same("1", 1.0) and same("ALL", "all"), "equal numbers and equal text are the same choice"
    assert not same("1", "2") and not same("recent", "all"), "different values are a change (must-fail)"


# REQ-396, item 1: the preview gate and the App publish step must agree on a companion table the run honestly skipped. Segmentation
# (rc7 N02-U02): __migration counts the members that moved since the previous assignment, so the first run has no rows to write and
# its page layout (segment_explorer) needs only __segments. A skip the run printed must not send Genie back to write it.

SEG = {"result_table": SEG_TABLE, "use_case_kind": "segmentation"}
SEG_SEGMENTS = ["segment_id", "label", "size", "value", "profile"]
SEG_ASSIGN = ["entity", "segment", "x", "y"]
SEG_MIGRATION_WHY = "there is no earlier assignment to compare with"


def test_a_skipped_companion_the_layout_does_not_need_is_not_sent_back_to_genie(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS, f"{SEG_TABLE}__assign": SEG_ASSIGN}
    skips = {"__migration": SEG_MIGRATION_WHY}
    assert _gates(agent_ns, tables, SEG, skips) == [], "a printed skip for a table the layout can do without passes the gate (must-pass)"


def test_a_skipped_companion_the_layout_needs_is_still_sent_back(agent_ns):
    tables = {f"{SEG_TABLE}__assign": SEG_ASSIGN, f"{SEG_TABLE}__migration": ["from_segment", "to_segment", "count"]}
    [gate] = _gates(agent_ns, tables, SEG, {"__segments": "fewer than 3 segments"})
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {SEG_TABLE}__segments does not exist "
                                "(the run printed: fewer than 3 segments)"], gate["problems"]


def test_a_missing_companion_without_a_printed_skip_is_still_sent_back_and_the_skipped_one_is_not_named(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS}
    [gate] = _gates(agent_ns, tables, SEG, {"__migration": SEG_MIGRATION_WHY})
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {SEG_TABLE}__assign does not exist"], \
        gate["problems"]
    assert f"{SEG_TABLE}__assign:" in gate["feedback"] and f"{SEG_TABLE}__migration:" not in gate["feedback"], \
        "Genie is told the columns of the table it must write, never of the skipped one (must-keep)"


def test_a_skip_for_a_table_the_run_did_write_changes_nothing(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS, f"{SEG_TABLE}__assign": SEG_ASSIGN,
              f"{SEG_TABLE}__migration": ["from_segment", "to_segment", "count"]}
    assert _gates(agent_ns, tables, SEG, {"__migration": "not needed"}) == [], "a written table passes with or without a skip (must-keep)"


def test_the_left_out_helper_keeps_every_missing_table_the_layout_needs(agent_ns):
    left_out = agent_ns["implement_skipped_companions_left_out"]
    missing = {f"{SEG_TABLE}__segments": "does not exist", f"{SEG_TABLE}__migration": "does not exist"}
    assert left_out(missing, SEG_TABLE, {"__segments": "x", "__migration": "y"}, "segment_explorer") == \
        {f"{SEG_TABLE}__segments": "does not exist"}, "the layout's required companion stays in the gate (must-fail)"
    assert left_out(missing, SEG_TABLE, None, "segment_explorer") == missing, "no printed skip, no exemption (must-keep)"


def test_the_data_shortfall_repair_keeps_the_stated_minimums_and_never_offers_to_lower_one(agent_ns):
    # REQ-396, item 3: the shortfall repair used to offer "lower `{setting}` within its allowed range" as a way past the counts, which is
    # how a per-city minimum of 10 or 20 became 1. The repair now keeps every stated minimum and asks for a method valid at the counts.
    text = agent_ns["IMPLEMENT_DATA_REPAIR"]
    assert "lower `{setting}` within its allowed range" not in text, "a stated minimum is not offered as the way past a shortfall (must-fail)"
    assert "Keep every readiness minimum exactly as the use case states it" in text and "never lower one" in text
    assert "the simplest technique that is valid at" in text and "Never fabricate data" in text, "the method repair stays (must-keep)"
