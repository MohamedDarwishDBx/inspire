"""REQ-299 (Amr, 14:00 test): when the customer defined a strategy, the use case names reuse the customer's own goal words. A use
case that serves "Grow Revenue" is named "Grow Revenue", never a synonym such as "Increase Revenue". The generation prompt stays
strategy-blind (v1.3.0), so the naming happens after selection: the strategy alignment step names each aligned use case, and the
Data Filter re-ask (a rename pass after selection) gets the same wording. Only a strategy the customer defined counts: Inspire's
built-in goals are Inspire's words. With no customer strategy the prompts and the names are unchanged."""
import json
import string

import pytest

from v130_strategy_alignment_test import TREE, answer, harness, uc

CUSTOMER = {"levels": ["Goal", "Objective"], "strategy": [
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


def _render(template, **values):
    fields = {name for _, name, _, _ in string.Formatter().parse(template) if name}
    rendered = {name: f"<{name}>" for name in fields}
    rendered.update(values)
    return template.format(**rendered)


def test_the_generation_prompt_stays_strategy_blind_so_the_customer_words_arrive_after_selection(agent_ns):
    template = agent_ns["PROMPT_TEMPLATES"]["BASE_USE_CASE_GEN_PROMPT"]
    assert "strategy_name_rule" not in {f for _, f, _, _ in string.Formatter().parse(template) if f}
    assert "customer's own strategy" not in _render(template)


def test_the_alignment_prompt_names_an_aligned_use_case_in_the_customers_own_words(agent_ns):
    out = _render(agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"])
    assert "11. **Name**: when the use case serves a customer strategy entry you aligned to" in out
    assert "the customer's own words for that goal" in out and 'never a synonym such as "Increase Revenue"' in out
    assert "You reword a use case's name only under rule 11." in out
    assert '"name": null' in out, "the answer carries the name, null when the use case serves no customer goal"


def test_a_customer_goal_renames_an_aligned_use_case_to_the_customers_words(agent_ns):
    tree = json.loads(json.dumps(TREE))
    tree["strategy"][0]["children"][0]["name"] = "Grow Revenue"
    ucs = [uc("N01-U01", Name="Increase Revenue by Region")]
    obj = harness(agent_ns, answers={"N01-U01": answer("N01-U01", name="Grow Revenue by Region")},
                  tree=agent_ns["parse_strategic_context"](json.dumps(tree)))
    obj._run_strategy_alignment(ucs)
    assert ucs[0]["Name"] == "Grow Revenue by Region" and ucs[0]["usecase"] == "Grow Revenue by Region"


def test_the_name_is_kept_when_the_model_names_nothing(agent_ns):
    ucs = [uc("N01-U01", Name="Increase Revenue by Region")]
    obj = harness(agent_ns, answers={"N01-U01": answer("N01-U01", name=None)}, tree=_customer_tree(agent_ns))
    obj._run_strategy_alignment(ucs)
    assert ucs[0]["Name"] == "Increase Revenue by Region"


def _record(name, aligned=True):
    return {"customer_name": name, "alignments": [{"id": "S1"}] if aligned else []}


def test_built_in_goals_are_inspire_words_and_never_rename_a_use_case(agent_ns):
    builtin = agent_ns["build_builtin_strategy"]("Grow Revenue, Reduce Cost")
    uc_row = {"Name": "Increase Revenue by Region"}
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Revenue by Region"), builtin, set()) is False
    assert uc_row["Name"] == "Increase Revenue by Region"


def test_a_name_the_person_typed_is_never_rewritten(agent_ns):
    uc_row = {"Name": "Our own name", "user_use_case_name": "Our own name"}
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Revenue by Region"), _customer_tree(agent_ns), set()) is False
    assert uc_row["Name"] == "Our own name"


def test_a_use_case_with_no_alignment_keeps_its_name(agent_ns):
    uc_row = {"Name": "Increase Revenue by Region"}
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Revenue by Region", aligned=False),
                                                _customer_tree(agent_ns), set()) is False


@pytest.mark.parametrize("name", ["Grow Revenue Across Every Single Region Of Our Business", "Grow"])
def test_a_name_outside_the_two_to_six_word_rule_is_refused(agent_ns, name):
    uc_row = {"Name": "Increase Revenue by Region"}
    assert agent_ns["apply_customer_goal_name"](uc_row, _record(name), _customer_tree(agent_ns), set()) is False
    assert uc_row["Name"] == "Increase Revenue by Region"


def test_a_name_already_used_by_another_use_case_is_not_given_twice(agent_ns):
    names_in_use = {"grow revenue by region"}
    uc_row = {"Name": "Increase Revenue by Region"}
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Revenue by Region"), _customer_tree(agent_ns), names_in_use) is False


def test_with_a_data_filter_label_the_customer_name_must_carry_it(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns["DATA_FILTER_LABEL"], "text", "Contoso")
    uc_row = {"Name": "Increase Revenue by Region"}
    tree = _customer_tree(agent_ns)
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Revenue by Region"), tree, set()) is False, "the label is missing"
    assert agent_ns["apply_customer_goal_name"](uc_row, _record("Grow Contoso Revenue"), tree, set()) is True
    assert uc_row["Name"] == "Grow Contoso Revenue"


def test_the_name_re_ask_for_a_data_filter_label_carries_the_customer_wording(agent_ns):
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


@pytest.mark.parametrize("tree_name", ["none", "builtin", "customer_without_entries"])
def test_the_rule_is_empty_unless_the_customer_defined_entries(agent_ns, tree_name):
    trees = {
        "none": None,
        "builtin": agent_ns["build_builtin_strategy"]("Grow Revenue (more sales), Reduce Cost"),
        "customer_without_entries": agent_ns["parse_strategic_context"](json.dumps({"levels": [], "strategy": []})),
    }
    assert agent_ns["strategy_name_rule"](trees[tree_name]) == "", "Inspire's built-in goals are not the customer's words"


def test_the_re_asks_and_the_alignment_pass_are_wired_to_the_customer_rule(agent_ns):
    from _agentload import agent_source

    source = agent_source()
    assert source.count("strategy_rule=strategy_rule") == 2, "both name re-asks (labels, lengths) pass the customer rule on"
    assert 'strategy_rule = strategy_name_rule(getattr(self, "strategy_tree", None))' in source
    assert "if apply_customer_goal_name(uc, record, tree, names_in_use):" in source
