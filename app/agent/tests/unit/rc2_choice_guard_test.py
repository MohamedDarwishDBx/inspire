"""REQ-346: a repair may change the method, technique or model, but never the grouping, the scope or the measure the person pinned.

The guard compares the pinned choices by widget name, the spec's value (before) against the widget value Genie filled (after). It
never reads the text of a change. The rehearsal build (use case "Recover Revenue Drops") failed because a method-only repair
(per-cell bootstrap became pooled decomposition) matched the keyword "measure" in its free text and was refused as a grouping change."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

GROUPING = {"columns": ["transaction_type"], "one_model": False}
CORE_GROUPED = [{"name": "group_by", "default": "transaction_type"}]


def fill(changes=(), widgets=()):
    return {"status": "built", "changes": list(changes), "widgets": [{"name": n, "default": d} for n, d in widgets]}


def method_change(what, was, now):
    return {"what": what, "why": "the data is thin", "cause": "rule", "method_was": was, "method_now": now,
            "setting": "", "value_was": "", "value_now": ""}


RECORDED_METHOD_ONLY = method_change("the per-cell measure of the revenue drop", "Per-cell bootstrap with FDR correction",
                                     "Pooled price-volume-mix decomposition without inference")


def test_the_recorded_method_only_repair_passes_even_when_its_text_names_a_keyword(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE_GROUPED, None)
    moved = agent_ns["implement_choice_changes"]([fill([RECORDED_METHOD_ONLY], [("group_by", "transaction_type")])], pinned)
    assert moved == [], "a method change is a legitimate repair, not a grouping change (must-pass)"


def test_a_method_or_model_change_that_names_group_or_scope_in_its_text_still_passes(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE_GROUPED, None)
    change = method_change("the forecast group scope", "one forecast for every group", "a seasonal model per scope")
    assert agent_ns["implement_choice_changes"]([fill([change])], pinned) == [], "text is never read (must-pass)"


def test_a_group_by_change_is_refused_and_names_the_grouping(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE_GROUPED, None)
    moved = agent_ns["implement_choice_changes"]([fill(widgets=[("group_by", "all")])], pinned)
    assert len(moved) == 1 and "grouping" in moved[0] and "transaction_type" in moved[0], moved
    text = agent_ns["implement_choice_refusal"](GROUPING, moved)
    assert text.startswith("could not group by transaction_type: a repair tried to change it"), text
    assert text.endswith("change the grouping on the Run page"), text


def test_a_scope_change_is_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([], {"chosen": {"scope": "recent", "days": 30}})
    assert pinned == {"run_scope": "recent", "scope_days": 30}, pinned
    moved = agent_ns["implement_choice_changes"]([fill(widgets=[("run_scope", "all")])], pinned)
    assert moved and moved[0].startswith("the scope from recent to all"), moved


def test_a_scope_limit_that_the_person_did_not_choose_is_not_pinned(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([], {"chosen": {"scope": "all", "days": 30}})
    assert pinned == {"run_scope": "all"}, "days only pins when the scope is recent (must-exclude)"


def test_a_measure_change_is_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([{"name": "currency", "default": "USD"}], None)
    moved = agent_ns["implement_choice_changes"]([fill(widgets=[("currency", "EUR")])], pinned)
    assert moved and moved[0].startswith("the measure from USD to EUR"), moved


def test_a_method_plus_grouping_change_is_refused_and_names_the_grouping_not_the_method(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE_GROUPED, None)
    moved = agent_ns["implement_choice_changes"](
        [fill([RECORDED_METHOD_ONLY], [("group_by", "all")])], pinned)
    assert len(moved) == 1 and "grouping" in moved[0], moved
    assert not any("bootstrap" in item or "decomposition" in item for item in moved), "the method is not what is refused"
    assert "could not group by transaction_type" in agent_ns["implement_choice_refusal"](GROUPING, moved)


def test_an_empty_spec_value_is_not_a_pinned_choice_so_genie_may_fill_it(agent_ns):
    assert agent_ns["implement_choice_pinned"]([{"name": "group_by", "default": ""}], None) == {}, "empty is for Genie (must-exclude)"
    pinned = agent_ns["implement_choice_pinned"]([{"name": "group_by", "default": ""}], None)
    assert agent_ns["implement_choice_changes"]([fill(widgets=[("group_by", "all")])], pinned) == []


def test_a_fill_that_keeps_every_pinned_choice_is_not_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE_GROUPED + [{"name": "currency", "default": "USD"}], {"chosen": {"scope": "all"}})
    kept = fill([RECORDED_METHOD_ONLY], [("group_by", "transaction_type"), ("currency", "usd"), ("run_scope", "ALL")])
    assert agent_ns["implement_choice_changes"]([kept], pinned) == [], "the same values, in any case, are not a change (must-exclude)"
