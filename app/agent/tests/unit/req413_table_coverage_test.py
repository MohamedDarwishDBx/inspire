"""REQ-413 (R1-R4, R6): a Table Election that keeps transactional tables primary still reaches every business table.

Masters and reference tables that join a primary ride along as join context inside a column budget. Batches are built
per join group, the coverage gate reads the full business set (one targeted retry, else a stated reason), and a
high-signal column that no use case names gets the same one retry. Fixtures: bakehouse (6 business tables), tpcds_sf1
(24 tables) and a generated 300-table scope. Classification of the bakehouse fixture (3 transactional, 3 master) is the
live run's split (`tx=3`, `total=6`); tests supply it because classification is an LLM call.
"""
import json
import logging
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REG = os.path.join(ROOT, "tests", "regression")

BAKE_TX = {"sales_transactions", "media_customer_reviews", "media_gold_reviews_chunked"}
BAKE_MASTERS = {"sales_customers", "sales_franchises", "sales_suppliers"}
TPCDS_FACTS = {"catalog_returns", "catalog_sales", "inventory", "store_returns", "store_sales", "web_returns", "web_sales"}


def _load(name):
    with open(os.path.join(REG, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def _type(col):
    low = col.lower()
    if low.endswith(("id", "_sk")):
        return "bigint"
    if low in ("latitude", "longitude", "totalprice", "unitprice"):
        return "double"
    return "string"


def _details(catalog, schema, tables):
    return [(catalog, schema, table, col, _type(col), "") for table, cols in tables.items() for col in cols]


def _fqtn(schema, table, catalog="samples"):
    return f"{catalog}.{schema}.{table}"


def _split(details, tx_names, schema):
    tx = [d for d in details if d[2] in tx_names]
    masters = [d for d in details if d[2] not in tx_names]
    return tx, masters


def _obj(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req413_table_coverage")
    obj.processing_honesty = {}
    obj._kind_fk_graph = {}
    obj.data_category_map = {}
    obj.max_parallelism = 2
    for key, value in attrs.items():
        setattr(obj, key, value)
    return obj


def _bakehouse():
    return _details("samples", "bakehouse", _load("bakehouse_schema.json"))


def _uc(tables, text="", name="Use case"):
    return {"Name": name, "Statement": text, "Solution": text, "Business Value": "", "High Level Design": "",
            "Tables Involved": ", ".join(tables)}


# --- R1 and R3: the election keeps transactional tables primary and every master rides along (bakehouse) ---

def test_bakehouse_every_business_table_is_a_primary_or_context_of_a_join_group(agent_ns):
    details = _bakehouse()
    tx, masters = _split(details, BAKE_TX, "bakehouse")
    plan = _obj(agent_ns)._join_group_plan(tx, masters, details)
    primaries = {p for g in plan["groups"] for p in g["primaries"]}
    context = {c for g in plan["groups"] for c in g["context"]}
    assert primaries == {_fqtn("bakehouse", t) for t in BAKE_TX}
    assert context == {_fqtn("bakehouse", t) for t in BAKE_MASTERS}
    assert plan["unattached"] == [], "no master may be dropped when it fits the budget"
    assert primaries | context == {_fqtn("bakehouse", t) for t in BAKE_TX | BAKE_MASTERS}, "6 of 6 business tables reach a batch"


def test_bakehouse_transactional_tables_that_share_a_master_share_one_join_group(agent_ns):
    details = _bakehouse()
    tx, masters = _split(details, BAKE_TX, "bakehouse")
    plan = _obj(agent_ns)._join_group_plan(tx, masters, details)
    sales = _fqtn("bakehouse", "sales_transactions")
    reviews = _fqtn("bakehouse", "media_customer_reviews")
    group_of = {p: i for i, g in enumerate(plan["groups"]) for p in g["primaries"]}
    assert group_of[sales] == group_of[reviews], "reviews join sales through franchiseID, so one batch must hold both"
    shared = next(g for g in plan["groups"] if sales in g["primaries"])
    assert _fqtn("bakehouse", "sales_franchises") in shared["context"]


def test_a_master_outside_the_column_budget_is_left_to_the_coverage_gate_not_dropped(agent_ns):
    details = _bakehouse()
    tx, masters = _split(details, BAKE_TX, "bakehouse")
    plan = _obj(agent_ns)._join_group_plan(tx, masters, details)
    original = agent_ns["TECHNICAL_CONTEXT"]["runtime"]["join_context_column_budget"]
    agent_ns["TECHNICAL_CONTEXT"]["runtime"]["join_context_column_budget"] = 10
    try:
        small = _obj(agent_ns)._join_group_plan(tx, masters, details)
    finally:
        agent_ns["TECHNICAL_CONTEXT"]["runtime"]["join_context_column_budget"] = original
    assert agent_ns["TECHNICAL_CONTEXT"]["runtime"]["join_context_column_budget"] == original
    for group in small["groups"]:
        assert group["context_columns"] <= 10
    carried = {c for g in small["groups"] for c in g["context"]}
    assert carried | set(small["unattached"]) == {_fqtn("bakehouse", t) for t in BAKE_MASTERS}, "no master silently dropped"
    assert small["unattached"], "the budget must leave at least one master to the coverage gate"
    assert plan["unattached"] == []


# --- pure planner: hop limit, must-fail and must-keep ---

def test_context_stops_at_the_hop_limit_and_the_planner_says_so(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    adjacency = {"p1": {"m1"}, "m1": {"p1", "m2"}, "m2": {"m1", "m3"}, "m3": {"m2"}}
    groups, unattached = cls._plan_join_groups(["p1"], ["m1", "m2", "m3"], adjacency, {"m1": 1, "m2": 1, "m3": 1}, 100, 5)
    assert groups[0]["context"] == ["m1", "m2"], "m3 is three hops away and must not ride along"
    assert unattached == ["m3"]


def test_a_primary_with_no_reachable_master_still_gets_its_own_group(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    groups, unattached = cls._plan_join_groups(["p1", "p2"], ["m1"], {"p1": {"m1"}, "p2": set(), "m1": {"p1"}},
                                              {"m1": 1}, 100, 5)
    assert [g["primaries"] for g in groups] == [["p1"], ["p2"]]
    assert groups[1]["context"] == [] and unattached == []


# --- the 300-table synthetic scope: the column budget holds at scale ---

def _synthetic_300():
    tables = {}
    for i in range(60):
        cols = [f"tx{i}_id"] + [f"pool{(i + k) % 40}_id" for k in range(2)] + [f"measure{i}_{c}" for c in range(9)]
        tables[f"fact_{i:03d}"] = cols
    for j in range(240):
        extra = [f"attr{j}_{c}" for c in range(20 if j % 5 == 0 else 6)]
        tables[f"dim_{j:03d}"] = [f"dim{j}_id", f"pool{j % 40}_id"] + extra
    tx = [t for t in tables if t.startswith("fact_")]
    return tables, set(tx)


def test_a_300_table_scope_keeps_every_batch_inside_the_column_budget(agent_ns):
    tables, tx_names = _synthetic_300()
    details = _details("samples", "synthetic", tables)
    tx, masters = _split(details, tx_names, "synthetic")
    plan = _obj(agent_ns)._join_group_plan(tx, masters, details)
    by_table = {}
    for d in details:
        by_table.setdefault(f"{d[0]}.{d[1]}.{d[2]}", []).append(d)
    primaries = [p for g in plan["groups"] for p in g["primaries"]]
    assert sorted(primaries) == sorted(_fqtn("synthetic", t, "samples") for t in tx_names), "every transactional table is primary once"
    budget = agent_ns["TECHNICAL_CONTEXT"]["runtime"]["join_context_column_budget"]
    for group in plan["groups"]:
        context_cols = sum(len(by_table[m]) for m in group["context"])
        assert context_cols <= budget, (context_cols, budget)
        assert context_cols == group["context_columns"]
        assert len(group["columns"]) == sum(len(by_table[t]) for t in group["primaries"]) + context_cols
    all_masters = {_fqtn("synthetic", t, "samples") for t in tables if t not in tx_names}
    carried = {c for g in plan["groups"] for c in g["context"]}
    assert carried | set(plan["unattached"]) == all_masters, "no master is silently dropped"
    assert carried, "shared key columns must put masters into join groups"


# --- R3 on a real inferred FK graph (tpcds_sf1, 24 tables) ---

def test_tpcds_fixture_join_groups_cover_all_24_tables_through_the_inferred_fk_graph(agent_ns):
    tables = _load("tpcds_sf1_schema.json")
    details = _details("samples", "tpcds_sf1", tables)
    cls = agent_ns["DataLoader"]
    loader = cls.__new__(cls)
    import threading
    loader.logger = logging.getLogger("req413_table_coverage")
    loader._metadata_lock = threading.RLock()
    loader.foreign_key_graph = {}
    loader._inferred_fk = {}
    loader._person_fk = set()
    loader.primary_keys = {}  # the samples fixture declares no primary keys
    loader._join_inferred_schemas = set()
    inferred = loader._infer_foreign_keys(details)
    graph = {}
    for scored in inferred.values():
        for rel, _confidence in scored:
            child = f"{rel[0]}.{rel[1]}.{rel[2]}".lower()
            graph.setdefault(child, []).append((rel[3], f"{rel[4]}.{rel[5]}.{rel[6]}".lower(), rel[7]))
    assert graph, "the inferred graph must carry relationships for the fixture"
    tx, masters = _split(details, TPCDS_FACTS, "tpcds_sf1")
    obj = _obj(agent_ns, _kind_fk_graph=graph)
    plan = obj._join_group_plan(tx, masters, details)
    primaries = {p for g in plan["groups"] for p in g["primaries"]}
    context = {c for g in plan["groups"] for c in g["context"]}
    every = {_fqtn("tpcds_sf1", t) for t in tables}
    assert primaries == {_fqtn("tpcds_sf1", t) for t in TPCDS_FACTS}
    assert primaries | context | set(plan["unattached"]) == every, "all 24 tables are carried or left to the gate"
    assert context, "at least one dimension must ride along with a fact through the FK graph"


# --- R4: the coverage readout reads the full business set and states a reason for each unused table ---

def test_the_readout_names_every_business_table_no_use_case_uses(agent_ns, caplog):
    details = _bakehouse()
    obj = _obj(agent_ns)
    ucs = [_uc([_fqtn("bakehouse", t) for t in BAKE_TX])]
    with caplog.at_level(logging.WARNING, logger="req413_table_coverage"):
        reasons = obj._record_table_coverage(details, ucs)
    assert set(reasons) == {_fqtn("bakehouse", t) for t in BAKE_MASTERS}, "the three masters are unused and must be named"
    assert obj.processing_honesty["table_coverage"]["used"] == 3
    assert obj.processing_honesty["table_coverage"]["business"] == 6
    assert "[TABLE-COVERAGE FIRED]" in caplog.text


def test_the_readout_is_empty_when_every_business_table_is_used(agent_ns, caplog):
    details = _bakehouse()
    obj = _obj(agent_ns)
    ucs = [_uc([_fqtn("bakehouse", t) for t in BAKE_TX | BAKE_MASTERS])]
    with caplog.at_level(logging.INFO, logger="req413_table_coverage"):
        assert obj._record_table_coverage(details, ucs) == {}
    assert obj.processing_honesty["table_coverage"]["used"] == 6
    assert "[TABLE-COVERAGE FIRED]" not in caplog.text


def test_a_master_with_no_join_path_gets_one_standalone_retry_and_is_never_silently_dropped(agent_ns, monkeypatch):
    details = _bakehouse()
    calendar = [("samples", "bakehouse", "sales_calendar", "day_name", "string", ""),
                ("samples", "bakehouse", "sales_calendar", "holiday_note", "string", "")]
    universe = details + calendar
    fqtns = {_fqtn("bakehouse", t) for t in BAKE_TX | BAKE_MASTERS} | {_fqtn("bakehouse", "sales_calendar")}
    categories = {f: ("TRANSACTIONAL" if f.split(".")[-1] in BAKE_TX else "MASTER") for f in fqtns}
    scores = {f: 1.0 for f in fqtns}
    ucs = [_uc([_fqtn("bakehouse", t)]) for t in BAKE_TX]
    obj = _obj(agent_ns, data_category_map=categories, business_scores=scores)
    calls = []

    def fake_batch(self, column_details, batch_id, **kwargs):
        calls.append({f"{c[0]}.{c[1]}.{c[2]}" for c in column_details})
        return []

    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_process_batch_with_retry", fake_batch)
    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_generation_context", lambda self: {}, raising=False)
    monkeypatch.setattr(agent_ns["DatabricksInspire"], "_plan_progress_batches", lambda self, *a, **k: None, raising=False)
    obj.processing_honesty.setdefault("total_batch_splits", 0)
    obj._retry_missing_table_coverage(ucs, universe, include_business_catchall=True)
    retried = set().union(*calls) if calls else set()
    assert _fqtn("bakehouse", "sales_calendar") in retried, "a master with no join path must still get its one targeted retry"

    calls.clear()
    obj._retry_missing_table_coverage(ucs, universe, include_business_catchall=True)
    retried_again = set().union(*calls) if calls else set()
    assert _fqtn("bakehouse", "sales_calendar") not in retried_again, "the retry is one per table"


# --- R6: a high-signal column that no use case names is flagged for the same one retry ---

def test_a_signal_column_no_use_case_names_flags_its_table(agent_ns, caplog):
    details = _bakehouse()
    categories = {_fqtn("bakehouse", t): ("TRANSACTIONAL" if t in BAKE_TX else "MASTER") for t in BAKE_TX | BAKE_MASTERS}
    obj = _obj(agent_ns, data_category_map=categories)
    ucs = [_uc([_fqtn("bakehouse", "sales_transactions")], text="Total the totalPrice per franchiseID by dateTime.")]
    with caplog.at_level(logging.INFO, logger="req413_table_coverage"):
        gaps = obj._signal_column_gap_tables(ucs, details)
    assert _fqtn("bakehouse", "sales_suppliers") in gaps, "approved, latitude and longitude are named nowhere"
    assert _fqtn("bakehouse", "sales_customers") in gaps, "email_address is named nowhere"
    assert "[SIGNAL-COLUMN FIRED]" in caplog.text


def test_naming_every_signal_column_clears_the_gap(agent_ns):
    details = _bakehouse()
    categories = {_fqtn("bakehouse", t): ("TRANSACTIONAL" if t in BAKE_TX else "MASTER") for t in BAKE_TX | BAKE_MASTERS}
    obj = _obj(agent_ns, data_category_map=categories)
    text = ("Flag approved suppliers by latitude and longitude. Contact each customer at email_address. "
            "Total totalPrice per franchiseID.")
    ucs = [_uc([_fqtn("bakehouse", t) for t in BAKE_TX | BAKE_MASTERS], text=text)]
    gaps = obj._signal_column_gap_tables(ucs, details)
    assert _fqtn("bakehouse", "sales_suppliers") not in gaps
    assert _fqtn("bakehouse", "sales_customers") not in gaps
