"""REQ-299 (Amr, 14:00 test): when the customer defined a strategy, the naming prompts get the customer's own wording. A use
case that serves "Grow Revenue" is named "Grow Revenue", never a synonym such as "Increase Revenue". Only a strategy the customer
defined counts: Inspire's built-in goals are Inspire's words. With no customer strategy the prompts are unchanged."""
import json
import string

import pytest

CUSTOMER = {"levels": ["Goal"], "strategy": [
    {"name": "Grow Revenue", "children": [{"name": "Win new accounts"}]},
    {"name": "Reduce Cost"},
]}


class _Stub:
    """A stand-in for the agent's run_worker: records each call and returns the scripted answer."""

    def __init__(self, answer):
        self.calls = []
        self.answer = answer

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.answer


def _customer_tree(agent_ns):
    return agent_ns["parse_strategic_context"](json.dumps(CUSTOMER))


def _render(template, rule):
    fields = {name for _, name, _, _ in string.Formatter().parse(template) if name}
    values = {name: f"<{name}>" for name in fields}
    values["strategy_name_rule"] = rule
    return template.format(**values)


def test_a_customer_strategy_puts_its_goal_names_and_the_own_words_instruction_into_the_naming_prompt(agent_ns):
    rule = agent_ns["strategy_name_rule"](_customer_tree(agent_ns))
    out = _render(agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"], rule)
    assert "The customer's own strategy names these goals: Grow Revenue; Win new accounts; Reduce Cost" in out
    assert "customer's own words for that goal, never a synonym" in out
    assert "write \"Grow Revenue\", not \"Increase Revenue\"" in out
    assert "The 2 to 6 word rule still applies." in out


def test_with_no_customer_strategy_the_naming_prompt_keeps_its_wording_and_has_no_new_rule(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    out = _render(template, "")
    assert "customer's own strategy" not in out and "never a synonym" not in out
    assert "user directive wins without exception.\n\n  - **`usecase`**" in out, "the Name rules sit exactly where they did before REQ-299"


@pytest.mark.parametrize("tree_name", ["none", "builtin", "customer_without_entries"])
def test_the_rule_is_empty_unless_the_customer_defined_entries(agent_ns, tree_name):
    rule = agent_ns["strategy_name_rule"]
    trees = {
        "none": None,
        "builtin": agent_ns["build_builtin_strategy"]("Grow Revenue (more sales), Reduce Cost"),
        "customer_without_entries": agent_ns["parse_strategic_context"](json.dumps({"levels": [], "strategy": []})),
    }
    assert rule(trees[tree_name]) == "", "Inspire's built-in goals are not the customer's words, so they change nothing (user words win)"


def test_the_name_re_ask_for_a_data_filter_label_carries_the_strategy_wording(agent_ns):
    rule = agent_ns["strategy_name_rule"](_customer_tree(agent_ns))
    stub = _Stub(json.dumps([{"Ref": "0", "Name": "Grow Revenue Across Accounts"}]))
    misses = [{"No": "1", "Name": "Increase revenue across accounts", "Primary Table": "c.s.orders"}]
    names = agent_ns["reask_data_filter_names"](stub, misses, "", strategy_rule=rule)
    assert names == ["Grow Revenue Across Accounts"]
    sent = stub.calls[0]["prompt_vars"]
    assert "Grow Revenue; Win new accounts; Reduce Cost" in sent["strategy_name_rule"]
    rendered = agent_ns["PROMPT_TEMPLATES"]["DATA_FILTER_LABEL_RENAME_PROMPT"].format(**sent)
    assert "The customer's own strategy names these goals: Grow Revenue" in rendered and "never a synonym" in rendered


def test_the_name_re_ask_without_a_customer_strategy_adds_nothing(agent_ns):
    stub = _Stub(json.dumps([{"Ref": "0", "Name": "Forecast Order Volume"}]))
    misses = [{"No": "1", "Name": "Forecast order volume", "Primary Table": "c.s.orders"}]
    agent_ns["reask_data_filter_names"](stub, misses, "")
    rendered = agent_ns["PROMPT_TEMPLATES"]["DATA_FILTER_LABEL_RENAME_PROMPT"].format(**stub.calls[0]["prompt_vars"])
    assert "customer's own strategy" not in rendered and "never a synonym" not in rendered
