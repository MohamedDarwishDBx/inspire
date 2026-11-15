"""REQ-259: the Genie Agent of a kept (side) build holds the versioned views its publish creates.

A build held for publish stored its Genie space after the publish rename, so the stored space named the versioned view (`__v<N>`). The
replay checked that name before any publish had created it, and the Genie Agent failed with TABLE_OR_VIEW_NOT_FOUND. The held candidate
must keep the space in the form before the rename, and the replayed publish must create every view name the saved space holds.
"""
import json
import logging

import pytest

from rc2_fix_candidate_views_test import FakeSpark
from v140_implement_test import GENIE_CHECKED, SPACE_COLUMNS, _FileRunner, _output_context, _output_inspire, _space

ORDERS = "main.s.orders"
ORDERS_VIEW = ORDERS + "__implement_scope"
ORDERS_BODY = "SELECT order_id, customer_id, amount, status FROM main.s.orders_raw WHERE status = 'open'"
ORDERS_COLUMNS = [("order_id", "bigint", ""), ("customer_id", "string", ""), ("amount", "double", ""), ("status", "string", "")]


def _scope(agent_ns):
    quote = agent_ns["inspire_quote_identifier"]
    return {"table": ORDERS, "columns": [c for c, _t, _d in ORDERS_COLUMNS], "rows": [], "where": "", "source": f"({ORDERS_BODY})",
            "view": ORDERS_VIEW, "view_ref": ".".join(quote(p) for p in ORDERS_VIEW.split(".")),
            "view_sql": agent_ns["inspire_owned_view_sql"](ORDERS_VIEW, ORDERS_BODY), "ready": False,
            "pattern": agent_ns["scope_read_pattern"](ORDERS.split("."))}


def _harness(agent_ns, tmp_path):
    """The real Genie build with the warehouse answers faked. DESCRIBE of a view that was never created fails as it does on Databricks."""
    inst, calls = _output_inspire(agent_ns, tmp_path, GENIE_CHECKED)
    spark = FakeSpark({})
    inst.spark = spark
    inst._genie_scopes = lambda use_case: {agent_ns["inspire_table_scope_key"](ORDERS): _scope(agent_ns)}

    def describe(tables):
        out = {}
        for table in tables or []:
            plain = table.replace("`", "").lower()
            if "__implement_scope" in plain:
                if table.replace("`", "") not in spark.views:
                    raise RuntimeError(f"the columns of {table} could not be read: [TABLE_OR_VIEW_NOT_FOUND] The table or view {table} "
                                       "cannot be found")
                out[plain] = ORDERS_COLUMNS
            else:
                out[plain] = SPACE_COLUMNS.get(plain, [])
        return out

    inst._implement_space_columns = describe
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [] if "HAVING COUNT(*) > 1" in sql else [{"n": 1}]
    return inst, calls, spark


def _side_context(agent_ns, **extra):
    context = dict(_output_context(agent_ns), side=("genie_space",), hold_mode=True)
    context["allowed"] = ["main.inspire.churn_out", ORDERS]
    context.update(extra)
    return context


def _doc():
    space = json.loads(_space(tables=("main.inspire.churn_out", ORDERS), grounded=True))["serialized_space"]
    return json.dumps({"title": "Churn desk", "description": "d", "serialized_space": space})


def test_a_held_genie_space_keeps_the_base_table_names_not_the_versioned_views(agent_ns, tmp_path):
    inst, _calls, _spark = _harness(agent_ns, tmp_path)
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_genie_space(_side_context(agent_ns), _FileRunner([{"exit": 0}], [{"genie_space.json": _doc()}]))
    names = [t["identifier"] for t in held.value.artifact["serialized_space"]["data_sources"]["tables"]]
    assert ORDERS in names and not any("__v" in n for n in names), names


def test_a_held_genie_space_replays_into_the_views_its_publish_creates(agent_ns, tmp_path):
    inst, calls, spark = _harness(agent_ns, tmp_path)
    with pytest.raises(agent_ns["ImplementCandidate"]) as held:
        inst._implement_genie_space(_side_context(agent_ns), _FileRunner([{"exit": 0}], [{"genie_space.json": _doc()}]))
    replay = _side_context(agent_ns, publishing={"genie_space"},
                           replay={"genie_space": (2, {"artifact": held.value.artifact, "held": True})})
    fields = inst._implement_genie_space(replay, None)
    assert fields["genie_space_id"] == "s9"
    (body, _q), = [(b, q) for (m, p, b, q) in calls if m == "POST" and p == "/api/2.0/genie/spaces"]
    names = [t["identifier"] for t in json.loads(body["serialized_space"])["data_sources"]["tables"]]
    assert ORDERS_VIEW + "__v2" in names, names
    assert all(n in spark.views for n in names if "__implement_scope" in n), "every view the saved space names exists"


def test_the_view_names_a_publish_writes_into_the_space_are_the_views_it_creates(agent_ns):
    spark = FakeSpark({})
    scopes = {agent_ns["inspire_table_scope_key"](ORDERS): _scope(agent_ns)}
    candidates = agent_ns["candidate_scopes"](scopes)
    base = json.loads(_space(tables=(ORDERS,)))["serialized_space"]
    space = agent_ns["scope_genie_space"](base, spark, candidates)
    published = agent_ns["scope_publish_rename"](space, agent_ns["scope_publish_pairs"](scopes, "__v2"))
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark, obj.logger = spark, logging.getLogger("p70")
    created = obj._implement_publish_views({"uc_id": "N01-U02", "key": (1, "N01-U02", 2), "side": ("genie_space",)}, scopes, "genie_space")
    held = [t["identifier"] for t in published["data_sources"]["tables"]]
    assert held == [ORDERS_VIEW + "__v2"] and created == held
    assert all(n in spark.views for n in held), "every view name the space holds exists"
