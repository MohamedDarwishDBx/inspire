"""REQ-227 (REQ-059 class): the Genie change lines and the vibe routing reasons the App shows use plain words.

No internal object name (__constraints), no word companion, and no model reasoning about the customer reach the person.
The routing reason names the kind the route check matched (KPI, chart, graph, plot, number tile), not always chart.
"""
import pytest

from customer_jargon_test import internal_hits  # shared REQ-059 terms (tests/fixtures/customer_jargon_terms.json)

REQ227_CHANGE = {
    "method_was": "Write the __constraints dashboard companion",
    "method_now": "Do not write __constraints; retain the price-test plan companion",
    "why": "The customer explicitly requested its removal.",
    "cause": "other",
}


def _fill(*changes):
    return {"changes": list(changes)}


def test_the_genie_used_line_reads_plain_words_and_drops_the_model_reasoning(agent_ns):
    notes = agent_ns["implement_genie_change_notes"](_fill(REQ227_CHANGE))
    assert notes == ["Genie used Do not write constraints; retain the price-test plan instead of Write the constraints dashboard."]
    assert [term for note in notes for term in internal_hits(note)] == []


def test_a_data_fact_still_gives_its_reason_to_the_person(agent_ns):
    change = {"method_was": "gradient boosted trees", "method_now": "a rules-based score", "why": "11 outcomes are too few",
              "cause": "data_shortfall"}
    notes = agent_ns["implement_genie_change_notes"](_fill(change))
    assert notes == ["Genie used a rules-based score instead of gradient boosted trees: 11 outcomes are too few."]


def test_a_what_change_on_a_companion_table_reads_plainly(agent_ns):
    change = {"what": "the __price_tests companion table", "cause": "other"}
    notes = agent_ns["implement_genie_change_notes"](_fill(change))
    assert notes == ["Genie changed the price tests table."]


def test_the_rule_method_line_is_plain_too(agent_ns):
    change = {"method_was": "Write the __constraints dashboard companion", "method_now": "Skip __constraints", "cause": "rule"}
    found = agent_ns["implement_genie_rule_methods"]([_fill(change)])
    assert found == ["Skip constraints instead of Write the constraints dashboard"]
    assert [term for text in found for term in internal_hits(text)] == []


def test_the_sanitizer_is_the_one_writer_the_change_lines_use(agent_ns):
    text = agent_ns["implement_plain_change_text"]("Write the __constraints dashboard companion; read result__price_tests")
    assert text == "Write the constraints dashboard; read price tests"


@pytest.mark.parametrize("ask, kind", [
    ("Remove the Limits fully used KPI from the dashboard", "KPI"),
    ("Show the KPI tiles for churn", "KPI"),
    ("Add a chart of revenue by region", "chart"),
    ("Plot the monthly trend", "plot"),
    ("Make the bar graphs sorted", "graph"),
])
def test_the_vibe_route_reason_names_the_kind_the_ask_asks_for(agent_ns, ask, kind):
    notebook = agent_ns["IMPLEMENT_NOTEBOOK"]
    fallback = []
    agent_ns["implement_vibe_drawn_routes"]([(1, notebook, ask)], [ask],
                                            {"app": "the App", notebook: agent_ns["IMPLEMENT_VIBE_NOTEBOOK_TARGET"]}, fallback)
    assert len(fallback) == 1
    reason = fallback[0]["reason"]
    assert reason.startswith(f"it asks for a {kind}, which the "), reason
    assert "chart" not in reason or kind == "chart", f"the reason names chart for an ask that is a {kind}: {reason}"
    line = agent_ns["implement_vibe_fallback_line"](fallback[0])
    assert f"it asks for a {kind}" in line and internal_hits(line) == []


def test_the_kind_gap_reason_and_the_gate_message_name_no_internal_object(agent_ns):
    """The gap reason and the companion gate text are the copy the App shows: no double-underscore name, no word companion."""
    gate_text = agent_ns["implement_plain_change_text"]("result__constraints was not written")
    assert gate_text == "constraints was not written"
    assert [term for term in internal_hits(gate_text)] == []
    assert internal_hits("the supporting tables its page draws: result__price_tests") == ["internal_object"]


def test_a_notebook_gate_verdict_keeps_exact_names_for_genie_and_its_person_copy_is_plain(agent_ns):
    """Genie reads the gate verdict with exact object names, so the verdict keeps them; the person reads the plain copy."""
    from customer_jargon_test import _code_cells

    verdict = "run r-1 did not write the companion tables its page draws: main.inspire.demand_out__series does not exist"
    assert "demand_out__series" in verdict and "companion" in verdict
    person = agent_ns["implement_plain_change_text"](verdict)
    assert person == "run r-1 did not write the tables its page draws: main.inspire.demand_out__series does not exist"
    assert internal_hits(person.replace("main.inspire.demand_out__series", "the table")) == []  # the qualified name is kept by design
    sources = "\n".join("".join(source) for source, _cell in _code_cells())
    for site in ('implement_plain_change_text("; ".join(outcome["gate_problems"]))',
                 "implement_plain_change_text('; '.join(outcome['build_problems']))",
                 'implement_plain_change_text("; ".join(outcome.get("build_problems") or []))'):
        assert site in sources, f"the person copy of a gate verdict is not made plain at: {site}"


def test_a_fully_qualified_table_name_reaches_the_person_verbatim(agent_ns):
    """D-AUTO / D-NAMES: a catalog.schema.table name is kept exactly, so the person can find the table."""
    text = "the table main.inspire.demand_out__series does not exist"
    assert agent_ns["implement_plain_change_text"](text) == text


def test_a_bare_internal_token_is_still_rewritten_to_plain_words(agent_ns):
    assert agent_ns["implement_plain_change_text"]("Skip __constraints") == "Skip constraints"
    assert agent_ns["implement_plain_change_text"]("read main.inspire.demand_out__series and __constraints") == (
        "read main.inspire.demand_out__series and constraints")
