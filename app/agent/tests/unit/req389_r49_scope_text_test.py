"""REQ-389 part 2 (lane R49): the Discover run's scope text does not reach the build's goal, success measures, Genie input or prompts.
A Discover run writes its Table Scope into the use case goal and success measures ("This covers only the rows of ... where paymentMethod is
visa or amex", "... using visa or amex rows only"). When the Data step chose a different scope, those sentences are taken out and the
build's own scope sentence follows the goal. The person's own words stay. These tests fail on the base notebook and pass after the change."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v140_implement_test import VALID  # noqa: E402

TABLE = "cat.sch.orders"
WHOLE = {TABLE: {"columns": ["id", "paymentMethod"], "rows": []}}
DISCOVER_GOAL = (f"Customers who buy at more than one franchise may compete for the same buyers. This covers only the rows of `{TABLE}` where "
                 "`paymentMethod` is visa or amex, using `id` and `paymentMethod`. "
                 f"Covers only the columns `id`, `paymentMethod` and the rows where `paymentMethod` in visa or amex of {TABLE}.")
DISCOVER_MEASURE = "A list of franchise pairs with shared buyers is delivered, using visa or amex rows only."
OWN_MEASURE = "Track the share of repeat buyers each month."


def _chosen_spec(ns, table_scope, goal=DISCOVER_GOAL, measures=(DISCOVER_MEASURE,)):
    """The validated build spec. table_scope {} is a Data-step choice of whole data; None is no choice on the Data step."""
    spec = json.loads(json.dumps(VALID))
    spec["use_case"] = {"goal": goal, "decision_owner": "", "success_measures": list(measures)}
    spec["data"] = dict(spec["data"], tables={}, filters=[])
    if table_scope is not None:
        spec["data"]["table_scope"] = table_scope
    out, errors = ns["validate_implement_spec"](spec)
    assert errors == [], errors
    return out


def _set_session(ns, scopes):
    ns["INSPIRE_TABLE_SCOPES"].clear()
    ns["INSPIRE_TABLE_SCOPES"].update(ns["parse_table_scopes"](json.dumps(scopes), ""))


def test_a_llm_written_scope_sentence_is_taken_out_of_the_statement_and_the_scope_clause_of_a_measure_too(agent_ns):
    cleaned = agent_ns["without_scope_sentences"](DISCOVER_GOAL)
    assert "visa or amex" not in cleaned and "Covers only" not in cleaned, cleaned
    assert cleaned.startswith("Customers who buy at more than one franchise may compete for the same buyers."), cleaned
    assert agent_ns["without_scope_sentences"](DISCOVER_MEASURE) == "A list of franchise pairs with shared buyers is delivered.", \
        agent_ns["without_scope_sentences"](DISCOVER_MEASURE)


def test_a_sentence_that_names_no_table_scope_is_kept_as_written(agent_ns):
    own = "Find the repeat buyers. Track the share of visa payments over time."
    assert agent_ns["without_scope_sentences"](own) == own
    assert agent_ns["without_scope_sentences"](OWN_MEASURE) == OWN_MEASURE


def test_the_build_framing_follows_the_data_step_scope_and_keeps_the_persons_words(fresh_ns):
    ns = fresh_ns
    _set_session(ns, {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}})
    ns["apply_chosen_table_scope"](_chosen_spec(ns, WHOLE)["data"], "")
    framing = ns["implement_build_framing"](_chosen_spec(ns, WHOLE, measures=[DISCOVER_MEASURE, OWN_MEASURE]))
    assert "visa or amex" not in framing["goal"], framing["goal"]
    assert framing["goal"].startswith("Customers who buy at more than one franchise may compete for the same buyers."), framing["goal"]
    assert f"Covers only the columns `id`, `paymentMethod` of {TABLE}." in framing["goal"], framing["goal"]
    assert framing["success_measures"] == ["A list of franchise pairs with shared buyers is delivered.", OWN_MEASURE], framing["success_measures"]


def test_the_build_framing_is_the_spec_unchanged_when_the_data_step_chose_no_scope(fresh_ns):
    ns = fresh_ns
    _set_session(ns, WHOLE)
    spec = _chosen_spec(ns, None)
    assert ns["implement_build_framing"](spec) == spec["use_case"], "no choice keeps the Discover framing as the person saw it"


def test_the_genie_implementation_choices_carry_no_discover_row_filter_text_when_whole_data_is_chosen(fresh_ns):
    ns = fresh_ns
    _set_session(ns, {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}})
    spec = _chosen_spec(ns, WHOLE)
    ns["apply_chosen_table_scope"](spec["data"], "")
    text = ns["implement_choices_markdown"](spec)
    goal_lines = [line for line in text.split("\n") if line.startswith("- Goal: ")]
    measure_lines = [line for line in text.split("\n") if line.startswith("- Success measure: ")]
    assert goal_lines and "visa or amex" not in goal_lines[0], text
    assert "visa or amex" not in text, text
    assert f"Covers only the columns `id`, `paymentMethod` of {TABLE}." in goal_lines[0], goal_lines[0]
    assert measure_lines == ["- Success measure: A list of franchise pairs with shared buyers is delivered."], measure_lines


def test_the_genie_implementation_choices_keep_the_discover_goal_when_no_scope_was_chosen(fresh_ns):
    ns = fresh_ns
    _set_session(ns, {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}})
    spec = _chosen_spec(ns, None)
    ns["apply_chosen_table_scope"](spec["data"], "")
    text = ns["implement_choices_markdown"](spec)
    assert f"- Goal: {DISCOVER_GOAL}" in text, text


def test_the_kpi_prompt_directives_carry_no_discover_scope_text_when_the_build_chose_a_scope(fresh_ns):
    ns = fresh_ns
    _set_session(ns, {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}})
    spec = _chosen_spec(ns, WHOLE)
    ns["apply_chosen_table_scope"](spec["data"], "")
    prompt = ns["implement_kpi_prompt"]({"Name": "Link buyers", "Statement": "x"}, {}, spec)
    assert "visa or amex" not in prompt, prompt
    assert "- Success measure: A list of franchise pairs with shared buyers is delivered." in prompt, prompt


def test_the_guided_tour_prompt_directives_carry_no_discover_scope_text_when_the_build_chose_a_scope(fresh_ns):
    ns = fresh_ns
    _set_session(ns, {TABLE: {"columns": ["id", "paymentMethod"], "rows": [{"column": "paymentMethod", "op": "in", "values": ["visa", "amex"]}]}})
    spec = _chosen_spec(ns, WHOLE)
    ns["apply_chosen_table_scope"](spec["data"], "")
    prompt = ns["implement_app_tour_prompt"]({"Name": "Link buyers", "Statement": "x"}, spec, {}, {}, [], ["English"])
    assert "visa or amex" not in prompt, prompt


def test_the_row_written_for_a_chosen_scope_carries_the_build_scope_and_the_row_it_came_from_is_not_changed(fresh_ns):
    ns = fresh_ns
    _set_session(ns, WHOLE)
    row = {"session_id": "s", "statement": DISCOVER_GOAL}
    out = ns["implement_chosen_scope_row"](row, {"Statement": DISCOVER_GOAL, "Primary Table": TABLE}, lambda uc: [])
    assert "visa or amex" not in out["statement"], out["statement"]
    assert f"Covers only the columns `id`, `paymentMethod` of {TABLE}." in out["statement"], out["statement"]
    assert row["statement"] == DISCOVER_GOAL, "the caller's row is not changed"


def test_the_build_record_carries_the_built_framing_with_the_discover_scope_text_taken_out(fresh_ns):
    ns = fresh_ns
    _set_session(ns, WHOLE)
    built = ns["implement_built_framing"](_chosen_spec(ns, WHOLE, measures=[DISCOVER_MEASURE, OWN_MEASURE]))
    assert "visa or amex" not in built["goal"], built
    assert f"Covers only the columns `id`, `paymentMethod` of {TABLE}." in built["goal"], built
    assert built["success_measures"] == ["A list of franchise pairs with shared buyers is delivered.", OWN_MEASURE], built


def test_the_built_framing_with_no_scope_choice_is_the_spec_framing_as_written(fresh_ns):
    ns = fresh_ns
    _set_session(ns, WHOLE)
    spec = _chosen_spec(ns, None, measures=[OWN_MEASURE])
    assert ns["implement_built_framing"](spec) == {"goal": DISCOVER_GOAL, "success_measures": [OWN_MEASURE]}


def test_the_implement_table_has_a_built_framing_column_for_the_build_record(agent_ns):
    assert dict(agent_ns["IMPLEMENT_COLUMNS"]).get("built_framing") == "VARIANT"
