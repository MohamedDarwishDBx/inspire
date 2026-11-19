"""REQ-414: eleven AI-native kinds (eight new, three upgrades) that are proposed only when a label column exists to score them against.

Gate: an AI-native kind's signature names `label_column` in roles_all, so no label means no kind, and the refusal is logged as
[AI-KIND-GATE FIRED]. Roles are read from the column name alone and added on top of the primary role. Fixtures: healthverity
(column names only, from the shipped demo files), nyctaxi and bakehouse (the repo's regression schemas). Types come from the same
name heuristic the REQ-413 tests use, because the fixtures carry no types.
"""
import copy
import json
import logging
import os

import pytest

from _agentload import load_agent_namespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REG = os.path.join(ROOT, "tests", "regression")
KINDS = os.path.join(ROOT, "agent", "app_shell", "kinds.json")
AI_KINDS = {
    "watch_act_agent": "Watch and act agent", "exception_workflow_agent": "Exception workflow agent", "outreach_agent": "Outreach agent",
    "root_cause_agent": "Root-cause agent", "written_commentary": "Written commentary", "taxonomy_mapping": "Taxonomy mapping",
    "lookalikes": "Lookalikes", "cross_domain_assistant": "Cross-domain assistant", "entity_matching_ai": "AI entity matching",
    "next_best_action_ai": "AI next best action", "data_agent_ai": "AI data agent",
}
STYLES = {"news", "league", "mail", "kanban", "sheet", "lab", "cockpit", "map", "flow", "graph", "answer", "agent"}


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _type(col):
    """Name-based type guess (the fixtures carry no types): dates, numbers, yes/no flags, ids, else text."""
    low = col.lower()
    if low.endswith(("id", "_sk")):
        return "bigint"
    if low.endswith(("_at", "_ts", "_date")) or "date" in low or "time" in low:
        return "timestamp"
    if low in ("approved", "is_churned", "churned"):
        return "boolean"
    if any(tok in low for tok in ("price", "amount", "total", "quantity", "units", "size", "distance", "fare", "latitude",
                                  "longitude", "lat", "long", "billed", "paid", "units", "spend", "contacts", "score")):
        return "double"
    return "string"


def metadata_of(tables):
    """{fqn: entry} the way the notebook's _kind_metadata_from_details builds it, from {table: [columns]}."""
    return {f"c.s.{table}": {"columns": {col: {"type": _type(col), "comment": ""} for col in cols}} for table, cols in tables.items()}


def load_fixture(name):
    with open(os.path.join(REG, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def detect(ns, tables, log=False):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req414")
    found = obj.detect_supported_kinds(metadata_of(tables), {}, log=log)
    return {k["kind"] for k in found}


def registry():
    return json.load(open(KINDS, encoding="utf-8"))


def test_the_registry_has_eleven_ai_native_kinds_with_a_label_gate_and_a_permitted_style():
    kinds = {k["id"]: k for k in registry()["kinds"]}
    assert len(kinds) == 51
    for kind_id, label in AI_KINDS.items():
        kind = kinds[kind_id]
        assert kind["label"] == label and kind["ai_native"] is True
        assert "label_column" in kind["signature"]["roles_all"], f"{kind_id} has no label gate"
        assert kind["app_style"] in STYLES
        assert kind["family"] == "ai_native"
    assert kinds["entity_matching_ai"]["upgrade_of"] == "entity_matching"
    assert kinds["next_best_action_ai"]["upgrade_of"] == "next_best_action"
    assert kinds["data_agent_ai"]["upgrade_of"] == "data_agent"


@pytest.mark.parametrize("kind_id,style", [("watch_act_agent", "agent"), ("exception_workflow_agent", "agent"),
                                           ("outreach_agent", "agent"), ("root_cause_agent", "agent")])
def test_the_agent_kinds_use_the_agent_style(kind_id, style):
    assert {k["id"]: k for k in registry()["kinds"]}[kind_id]["app_style"] == style


@pytest.mark.parametrize("column,role", [("offer_outcome", "label_column"), ("category", "label_column"),
                                         ("customer_tier", "label_column"), ("handled_by_team", "action_target"),
                                         ("customer_name", "entity_name")])
def test_a_column_name_gives_its_secondary_role_and_keeps_its_primary_one(ns, column, role):
    cls = ns["DatabricksInspire"]
    roles, _ = cls._column_roles({column: "STRING", "customer_id": "BIGINT"})
    assert column in roles[role], (column, roles)


def test_a_key_column_never_takes_a_label_role(ns):
    roles, _ = ns["DatabricksInspire"]._column_roles({"category_id": "BIGINT", "customer_id": "BIGINT"})
    assert roles["label_column"] == []


def test_no_label_no_kind_is_refused_and_logged(ns, caplog):
    """Must-fail: a case table with an owner and a status but no label column proposes no watch-and-act kind."""
    tables = {"cases": ["case_id", "customer_id", "created_at", "due_at", "case_status", "handled_by_team", "complaint_text"],
              "customers": ["customer_id", "customer_name", "signup_date"]}
    caplog.set_level(logging.INFO, logger="req414")
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req414")
    found = {k["kind"] for k in obj.detect_supported_kinds(metadata_of(tables), {}, log=True)}
    assert "watch_act_agent" not in found
    assert not [k for k in found if k in AI_KINDS]
    assert any("[AI-KIND-GATE FIRED]" in r.getMessage() and "watch_act_agent" in r.getMessage() for r in caplog.records)


def test_a_label_column_lets_the_same_schema_propose_the_kind(ns):
    """Must-keep: the same case table with a labelled outcome column is proposed."""
    tables = {"cases": ["case_id", "customer_id", "created_at", "due_at", "case_status", "handled_by_team", "priority", "complaint_text"],
              "customers": ["customer_id", "customer_name", "signup_date"]}
    assert "watch_act_agent" in detect(ns, tables)


def test_healthverity_shaped_schema_proposes_no_ai_kind(ns):
    found = detect(ns, load_fixture("healthverity_schema.json"))
    assert not found & set(AI_KINDS), sorted(found & set(AI_KINDS))


def test_nyctaxi_schema_proposes_no_ai_kind(ns):
    found = detect(ns, load_fixture("nyctaxi_schema.json"))
    assert not found & set(AI_KINDS), sorted(found & set(AI_KINDS))


def test_bakehouse_proposes_only_entity_matching_ai(ns):
    """Measured on the bakehouse regression schema: sales_suppliers has the label `approved`, the entity name `name` and a region
    (`city`), so entity matching is the one AI kind its labels support. No table there has an action target, so no agent kind."""
    found = detect(ns, load_fixture("bakehouse_schema.json"))
    assert found & set(AI_KINDS) == {"entity_matching_ai"}, sorted(found & set(AI_KINDS))


def test_the_verb_share_flags_a_heavy_batch_and_never_a_spread_one(ns):
    flags = ns["name_verb_share_flags"]
    heavy = [f"Detect Thing {i} to Protect Revenue" for i in range(6)] + ["Forecast Sales Demand", "Ask Owners Their Backlog",
                                                                         "Route Late Orders", "Match Duplicate Records"]
    assert flags(heavy), "a batch whose five top verbs start 40% or more is flagged"
    spread = ["Detect Late Shipments", "Ask Owners About Backlog", "Route Returns To Refund", "Match Duplicate Suppliers",
              "Forecast Seasonal Demand", "Draft Renewal Letters", "Cut Idle Stock", "Keep Top Buyers Warm",
              "Answer Pricing Questions", "Protect Margin On Discounts", "Reduce Scrap Rate", "Stop Repeat Refunds",
              "Price Bulk Orders", "Target Lapsed Members", "Spot Ghost Vendors", "Plan Winter Staffing",
              "Classify Support Tickets", "Segment Store Traffic", "Escalate Stuck Claims", "Recover Unpaid Balances"]
    assert flags(spread) == set()


def test_a_batch_under_ten_names_is_never_flagged(ns):
    assert ns["name_verb_share_flags"](["Detect A"] * 9) == set()


def test_the_fallback_sentence_names_only_the_functions_not_available(ns):
    status = ns["TECHNICAL_CONTEXT"].setdefault("ai_function_status", {})
    saved = dict(status)
    try:
        status.clear()
        status.update({"ai_decide": "unavailable", "ai_similarity": "available"})
        text = ns["ai_function_fallback_sentence"](["ai_decide", "ai_similarity"])
        assert "ai_decide" in text and "ai_query" in text and "ai_similarity" not in text
        assert ns["ai_function_fallback_sentence"](["ai_similarity"]) == ""
        assert "ai_query" in ns["ai_function_fallback_sentence"](["ai_enrich"]), "a function the probe never reached falls back"
    finally:
        status.clear()
        status.update(saved)


def test_the_checklist_line_for_an_ai_kind_carries_the_fallback_when_its_function_is_missing(ns):
    kinds = {k["id"]: k for k in ns["_inspire_kinds"]()["kinds"]}
    assert kinds["next_best_action_ai"]["ai_functions"] == ["ai_decide"]
    status = ns["TECHNICAL_CONTEXT"].setdefault("ai_function_status", {})
    saved = dict(status)
    try:
        status["ai_decide"] = "unavailable"
        sentence = ns["ai_function_fallback_sentence"](kinds["next_best_action_ai"]["ai_functions"])
        assert "ai_decide" in sentence and "ai_query" in sentence
        checklist = {k["id"]: k for k in ns["_inspire_kinds"]()["kinds"]}["next_best_action_ai"]
        assert checklist["id"] == "next_best_action_ai"
    finally:
        status.clear()
        status.update(saved)


def test_a_technique_added_only_to_the_registry_shows_in_both_lookups(ns, monkeypatch):
    """The gate-family table and the value-key table are read from kinds.json: a row added there, and nowhere else, reaches both."""
    registry = copy.deepcopy(ns["_inspire_kinds"]())
    registry["technique_gate_families"].append(["registry_probe", "Registry Probe", ["registry probe"], []])
    registry["technique_value_keys"]["Registry Probe"] = "value_registry_probe"
    monkeypatch.setitem(ns, "_inspire_kinds", lambda: registry)
    cls = ns["DatabricksInspire"]
    table = ns["_RegistryTable"]
    families = table(cls.__dict__["_TECHNIQUE_FAMILIES"].build).__get__(None, cls)
    values = table(cls.__dict__["_TECHNIQUE_VALUE_KEYS"].build).__get__(None, cls)
    assert "Registry Probe" in {label for _key, label, _aliases, _methods in families}
    assert values["Registry Probe"] == "value_registry_probe"
    assert "Watch and Act" in values and "Watch and Act" in {label for _k, label, _a, _m in families}
