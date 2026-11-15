"""REQ-243 (coordinator decision D-AUTO, from Amr's REQ-175 rule of 11-13): a Data Filter label goes into the use case name only when
it is 1 or 2 words. A longer label goes to the subtitle, and the name never carries it. The final gate (name_fits_rule) enforces the
same rule, so a name that breaks it is re-asked or repaired.
"""
import json

import pytest

ORDERS = "main.s.orders"
SCOPE = {ORDERS: {"columns": ["order_id", "country"], "rows": [{"column": "country", "op": "in", "values": ["Japan", "US"], "group": True}]}}


@pytest.fixture
def scoped(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](json.dumps(SCOPE)))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def use_case(name):
    return {"Primary Table": ORDERS, "Tables Involved": ORDERS, "Name": name}


def test_a_three_word_label_lands_in_the_subtitle_and_the_name_stays_without_it(scoped):
    ns = scoped
    ucs = [use_case("Realign Supplier Territories")]
    stats = ns["ensure_data_filter_labels"](ucs, label="Japan and US")
    assert ucs[0]["Name"] == "Realign Supplier Territories"
    assert ucs[0]["scope_label"] == "Japan and US"
    assert stats["subtitled"] == 1
    assert stats["fallback"] == 0


def test_a_two_word_label_is_put_into_the_name_when_the_name_lacks_it(scoped):
    ns = scoped
    ucs = [use_case("Realign Supplier Territories")]
    stats = ns["ensure_data_filter_labels"](ucs, label="Japan US")
    assert "Japan US" in ucs[0]["Name"]
    assert ucs[0]["scope_label"] == "Japan US"
    assert stats["subtitled"] == 0
    assert stats["fallback"] == 1
    assert ns["name_fits_rule"](ucs[0]["Name"], "Japan US")


def test_the_final_gate_fails_a_two_word_name_without_the_label(scoped):
    assert scoped["name_fits_rule"]("Realign Supplier Territories", "Japan US") is False


def test_the_final_gate_fails_a_three_word_label_written_into_the_name(scoped):
    assert scoped["name_fits_rule"]("Realign Japan and US Supplier Territories", "Japan and US") is False


def test_the_final_gate_passes_a_three_word_name_without_a_three_word_label(scoped):
    assert scoped["name_fits_rule"]("Realign Supplier Territories", "Japan and US") is True
