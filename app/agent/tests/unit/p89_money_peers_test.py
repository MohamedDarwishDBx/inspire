"""REQ-293 (rc7 N01-U01, session 9000000000000000003, money rebuild run 43755420113876): a money vibe rebuild planned the peer
comparison by franchiseID, the entity itself, so no franchise had peers ("no peers"), and Genie labelled the value at stake
"Peer revenue gap".

(a) A vibe that names no Grouping keeps the Grouping the built version planned, whatever it asks for.
(b) Grouping by the entity key of a peer comparison is refused with a plain reason, and the entity key is never recommended.
(c) The value-at-stake card is labelled by the money rule ("Value at stake"), never by a name Genie invented.
Offline, on the real notebook functions (agent_ns) and the App page validator (shell_sql)."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

PEER ="Peer Benchmarking"
PEER_KIND = "peer_benchmarking"
ENTITY = "franchiseID"
PLANNED = "franchise_region"
MONEY_VIBE = "Measure the value at stake in US dollars and show it on the page."
STAKE_SQL = "SELECT GREATEST(-value_at_stake, 0) AS value_at_stake, region FROM stake_rows"


def _spec(widgets, vibes=()):
    return {"config": {"widgets": dict(widgets)}, "vibes": "\n".join(vibes)}


def _page(label, sql=STAKE_SQL, fmt="currency"):
    return {"id": "n01_u01", "datasets": [{"name": "rows", "sql": sql}],
            "kpis": [{"id": "stake", "label": label, "dataset": "rows", "format": fmt, "expression": "SUM(value_at_stake)"}],
            "charts": [], "money": {"currency": "per_currency"}}


def test_a_money_vibe_that_names_no_grouping_keeps_the_planned_grouping(agent_ns):
    previous = _spec({"group_by": PLANNED, "result_table": "a.b"})
    spec = _spec({"result_table": "a.b"}, [MONEY_VIBE])
    got = agent_ns["implement_keep_grouping"](previous, spec)
    assert got["config"]["widgets"] == {"group_by": PLANNED, "result_table": "a.b"}, "a money vibe never re-plans the peer Grouping"
    assert "group_by" not in spec["config"]["widgets"], "the input spec is not mutated"


def test_a_spec_that_already_names_its_grouping_keeps_it(agent_ns):
    spec = _spec({"group_by": "all"}, [MONEY_VIBE])
    assert agent_ns["implement_keep_grouping"](_spec({"group_by": PLANNED}), spec) is spec


def test_a_vibe_that_names_a_grouping_is_left_to_the_router_to_apply(agent_ns):
    spec = _spec({}, ["Grouping: paymentMethod."])
    assert agent_ns["implement_keep_grouping"](_spec({"group_by": PLANNED}), spec) is spec, "the router applies the named Grouping"


def test_a_first_build_with_no_previous_version_keeps_the_spec(agent_ns):
    spec = _spec({}, [MONEY_VIBE])
    assert agent_ns["implement_keep_grouping"](None, spec) is spec


def test_grouping_by_the_entity_key_is_refused_for_a_peer_comparison_with_a_plain_reason(agent_ns):
    plan = agent_ns["implement_grouping_plan"](PEER, [ENTITY, PLANNED], ENTITY, kind=PEER_KIND, entity_key=ENTITY)
    assert plan["applies"] is False and plan.get("problem"), plan
    assert plan["problem"].startswith("group_by is 'franchiseID': "), plan["problem"]
    assert "its own group with no peers" in plan["problem"], plan["problem"]


def test_the_peer_refusal_also_holds_when_only_the_technique_says_peer_comparison(agent_ns):
    plan = agent_ns["implement_grouping_plan"](PEER, [ENTITY], ENTITY, entity_key=ENTITY)
    assert plan["applies"] is False and "no peers" in plan["problem"], plan


def test_a_peer_comparison_may_group_by_a_column_other_than_the_entity_key(agent_ns):
    plan = agent_ns["implement_grouping_plan"](PEER, [ENTITY, PLANNED], PLANNED, kind=PEER_KIND, entity_key=ENTITY)
    assert plan["applies"] is True and plan["default"] == PLANNED and plan["columns"] == [PLANNED], plan


def test_the_entity_key_is_never_recommended_for_a_peer_comparison(agent_ns):
    plan = agent_ns["implement_grouping_plan"](PEER, [ENTITY, PLANNED], "", recommended=[ENTITY], kind=PEER_KIND, entity_key=ENTITY)
    assert ENTITY not in plan["columns"] and plan["default"] != ENTITY, plan
    assert ENTITY not in plan["recommended"], plan


def test_the_entity_key_stays_groupable_for_a_kind_that_is_not_a_peer_comparison_must_exclude(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", [ENTITY], ENTITY, kind="anomaly", entity_key=ENTITY)
    assert plan["applies"] is True and plan["default"] == ENTITY, "only a peer comparison refuses its entity key (REQ-293)"


def test_a_currency_card_that_reads_the_value_at_stake_must_carry_the_money_rule_label(agent_ns):
    problems = shell_sql.money_page_problems(_page("Peer revenue gap"))
    assert any("Peer revenue gap" in p and "Value at stake" in p for p in problems), problems


def test_the_value_at_stake_card_with_the_money_rule_label_passes(agent_ns):
    assert shell_sql.money_page_problems(_page("Value at stake")) == []
    assert shell_sql.money_page_problems(_page("Total value at stake in USD")) == []


def test_a_currency_card_that_does_not_read_the_value_at_stake_keeps_its_own_label_must_exclude(agent_ns):
    revenue = dict(_page("Peer revenue gap", sql="SELECT revenue_gap, region FROM sales_rows"))
    revenue["kpis"] = [dict(revenue["kpis"][0], expression="SUM(revenue_gap)")]
    assert not any("value at stake" in p.lower() for p in shell_sql.money_page_problems(revenue)), "only the stake card is named by the money rule"


def _discovery_profiles(region_groups=1):
    """A main table of 48 franchises (67 records each) and a region column, as the discovery profile reads them."""
    return {"main.sales.franchise_sales": {"rows": 3216, "columns": {
        ENTITY: {"type_family": "string", "distinct": 48, "null_share": 0.0,
                 "top_values": [{"value": f"3000{i:03d}", "share": 1 / 48} for i in range(48)]},
        "region": {"type_family": "string", "distinct": region_groups, "null_share": 0.0,
                   "top_values": [{"value": "east", "share": 1.0}]}}}}


def test_the_discovery_profile_never_suggests_the_entity_key_for_a_peer_comparison(agent_ns):
    found = agent_ns["deep_grouping_suggestion"](PEER, "main.sales.franchise_sales", _discovery_profiles(), (), None, (), (), None,
                                                 PEER_KIND, entity_key=ENTITY)
    assert not found or ENTITY not in found.get("group_by", []), found


def test_the_discovery_profile_still_suggests_the_entity_key_for_another_family_must_exclude(agent_ns):
    found = agent_ns["deep_grouping_suggestion"]("Anomaly Detection", "main.sales.franchise_sales", _discovery_profiles(), (), None, (),
                                                 (), None, "anomaly", entity_key=ENTITY)
    assert found and ENTITY in found.get("group_by", []), found


def test_a_chart_series_that_reads_the_value_at_stake_must_carry_the_money_rule_label(agent_ns):
    page = dict(_page("Value at stake"), kpis=[], charts=[{"id": "trend", "dataset": "rows", "type": "line",
                                                           "y": [{"label": "Peer revenue gap", "expression": "SUM(value_at_stake)",
                                                                  "format": "currency", "currency": "USD"}]}])
    problems = shell_sql.money_page_problems(page)
    assert any("Peer revenue gap" in p and "Value at stake" in p and "trend" in p for p in problems), problems


def test_a_chart_series_with_the_money_rule_label_or_no_label_passes(agent_ns):
    named = dict(_page("Value at stake"), kpis=[], charts=[{"id": "trend", "dataset": "rows", "type": "line",
                                                            "y": [{"label": "Value at stake", "expression": "SUM(value_at_stake)",
                                                                   "format": "currency", "currency": "USD"}]}])
    unlabelled = dict(named, charts=[{"id": "trend", "dataset": "rows", "type": "line",
                                      "y": [{"expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}]}])
    assert shell_sql.money_page_problems(named) == []
    assert shell_sql.money_page_problems(unlabelled) == []


def test_a_chart_series_that_reads_no_stake_keeps_its_own_label_must_exclude(agent_ns):
    page = dict(_page("Value at stake"), kpis=[], charts=[{"id": "rev", "dataset": "rows", "type": "line",
                                                           "y": [{"label": "Revenue", "expression": "SUM(revenue_gap)",
                                                                  "format": "currency", "currency": "USD"}]}])
    page["datasets"] = [{"name": "rows", "sql": "SELECT revenue_gap, region FROM sales_rows"}]
    assert not any("value at stake" in p.lower() for p in shell_sql.money_page_problems(page))


def test_the_discovery_falls_back_to_the_key_the_use_case_names_when_no_entity_role_is_set(agent_ns):
    found = agent_ns["deep_grouping_suggestion"](PEER, "main.sales.franchise_sales", _discovery_profiles(), (), None, (), (), None, PEER_KIND,
                                                 subject="Coach franchises by franchiseID against their peers")
    assert not found or ENTITY not in found.get("group_by", []), found


def test_the_fallback_takes_only_a_key_so_a_grouping_column_the_use_case_names_stays_groupable_must_exclude(agent_ns):
    found = agent_ns["deep_grouping_suggestion"](PEER, "main.sales.franchise_sales", _discovery_profiles(region_groups=4), (), None, (), (),
                                                 None, PEER_KIND, subject="Coach regions by region")
    assert found and "region" in found.get("group_by", []), found
