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
    assert _fqtn("bakehouse", "sales_calendar") in set().union(*calls), "the second targeted retry is allowed"
    calls.clear()
    obj._retry_missing_table_coverage(ucs, universe, include_business_catchall=True)
    assert _fqtn("bakehouse", "sales_calendar") not in (set().union(*calls) if calls else set()), \
        "the cap is two targeted retries per table, the third call retries nothing"


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


# --- REQ-413 coordinator follow-up: FK inference, join relation, section 3e sites, fail-before per root cause ---

def _inferred_graph(ns, schema, tables):
    """FK graph in the `_kind_fk_graph` shape, from the naming rules the loader really runs (no stubbed inference)."""
    import threading
    cls = ns["DataLoader"]
    loader = cls.__new__(cls)
    loader.logger = logging.getLogger("req413_table_coverage")
    loader._metadata_lock = threading.RLock()
    loader.foreign_key_graph = {}
    loader._inferred_fk = {}
    loader._person_fk = set()
    loader._join_inferred_schemas = set()
    loader.primary_keys = {}
    inferred = loader._infer_foreign_keys(_details("samples", schema, tables))
    graph, links = {}, []
    for scored in inferred.values():
        for rel, _confidence in scored:
            child = f"{rel[0]}.{rel[1]}.{rel[2]}".lower()
            graph.setdefault(child, []).append((rel[3], f"{rel[4]}.{rel[5]}.{rel[6]}".lower(), rel[7]))
            links.append(f"{rel[0]}.{rel[1]}.{rel[2]}.{rel[3]} -> {rel[4]}.{rel[5]}.{rel[6]}.{rel[7]}")
    return graph, sorted(links)


BAKE_EDGES = [
    "samples.bakehouse.media_customer_reviews.franchiseID -> samples.bakehouse.sales_franchises.franchiseID",
    "samples.bakehouse.media_gold_reviews_chunked.franchiseID -> samples.bakehouse.sales_franchises.franchiseID",
    "samples.bakehouse.sales_franchises.supplierID -> samples.bakehouse.sales_suppliers.supplierID",
    "samples.bakehouse.sales_transactions.customerID -> samples.bakehouse.sales_customers.customerID",
    "samples.bakehouse.sales_transactions.franchiseID -> samples.bakehouse.sales_franchises.franchiseID",
]


def test_fk_inference_links_each_bakehouse_master_through_its_domain_prefixed_name(agent_ns):
    # Root cause R2: `sales_franchises` never matched `franchiseID` before (only affix names were stripped), so the graph was empty.
    _graph, links = _inferred_graph(agent_ns, "bakehouse", _load("bakehouse_schema.json"))
    assert links == BAKE_EDGES
    parents = {l.split(" -> ")[1].rsplit(".", 1)[0] for l in links}
    assert parents == {_fqtn("bakehouse", t) for t in BAKE_MASTERS}


def test_tpcds_inferred_keys_are_the_exact_recorded_set_with_no_new_wrong_link(agent_ns):
    _graph, links = _inferred_graph(agent_ns, "tpcds_sf1", _load("tpcds_sf1_schema.json"))
    with open(os.path.join(REG, "tpcds_sf1_inferred_fk.json"), encoding="utf-8") as handle:
        expected = json.load(handle)["inferred_fk"]
    assert links == sorted(expected), "the inferred set changed: review each new or dropped link before updating the fixture"


def test_a_domain_prefixed_decoy_with_no_key_match_infers_nothing(agent_ns):
    decoy = {"sales_customers": ["name", "city"], "sales_orders": ["orderid", "customerid", "amount"]}
    _graph, links = _inferred_graph(agent_ns, "decoy", decoy)
    assert links == []


def test_a_generic_stem_never_joins_even_when_a_table_is_named_for_it(agent_ns):
    # `codeid` must not join on the generic stem `code` (old rule: forms of table `codes` include `code`).
    tables = {"codes": ["codeid", "label"], "orders": ["orderid", "codeid"]}
    _graph, links = _inferred_graph(agent_ns, "codes", tables)
    assert links == []


def test_the_join_relation_uses_the_fk_graph_first_and_shared_keys_only_for_isolated_tables(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    cols = {"c.s.a": [("c", "s", "a", "id_x", "bigint", ""), ("c", "s", "a", "regionid", "bigint", "")],
            "c.s.b": [("c", "s", "b", "regionid", "bigint", "")],
            "c.s.c": [("c", "s", "c", "regionid", "bigint", "")],
            "c.s.d": [("c", "s", "d", "custid", "bigint", "")],
            "c.s.e": [("c", "s", "e", "custid", "bigint", "")]}
    graph = {"c.s.a": [("regionid", "c.s.b", "regionid")]}
    adjacency, sources = cls._join_adjacency(list(cols), cols, graph)
    assert sources[frozenset(("c.s.a", "c.s.b"))] == "graph"
    # a and b are joined by the graph, so only the isolated table c takes the shared-key fallback (edges to a and b).
    assert adjacency["c.s.a"] == {"c.s.b", "c.s.c"}, "a's own shared key adds nothing; c's fallback edge reaches a"
    assert adjacency["c.s.c"] == {"c.s.a", "c.s.b"} and sources[frozenset(("c.s.b", "c.s.c"))] == "shared_key"
    assert adjacency["c.s.d"] == {"c.s.e"} and sources[frozenset(("c.s.d", "c.s.e"))] == "shared_key"


def test_a_reference_table_rides_along_as_context_inside_the_budget(agent_ns):
    # Section 3e site (a): augment excluded REFERENCE tables; they must ride along when reachable, within the budget.
    class _Loader:
        enable_column_sampling = False
        foreign_key_graph = {("c", "s", "fact"): [("c", "s", "fact", "dim_id", "c", "s", "dim_ref", "id")]}

        def _get_table_details(self, cat, sch, tab, apply_sampling=False):
            return [(cat, sch, tab, "id", "bigint", ""), (cat, sch, tab, "label", "string", "")]

    obj = _obj(agent_ns, data_loader=_Loader(), data_category_map={"c.s.fact": "TRANSACTIONAL", "c.s.dim_ref": "REFERENCE"})
    obj._get_reverse_foreign_key_graph = lambda: {}
    fact = [("c", "s", "fact", "dim_id", "bigint", "")]
    out = obj._augment_columns_with_related_tables(fact)
    assert {(c[2], c[3]) for c in out} == {("fact", "dim_id"), ("dim_ref", "id"), ("dim_ref", "label")}
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    original = runtime["join_context_column_budget"]
    runtime["join_context_column_budget"] = 1
    try:
        assert obj._augment_columns_with_related_tables(fact) == fact, "a reference table over the budget is left to the gate"
    finally:
        runtime["join_context_column_budget"] = original


def _gate_obj(ns, categories, scores, retried):
    obj = _obj(ns, data_category_map=categories, business_scores=scores)
    obj.max_parallelism = 1
    obj._generation_context = lambda: {}
    obj._plan_progress_batches = lambda *a, **k: None

    def fake_batch(column_details, batch_id, **kwargs):
        retried.append({f"{c[0]}.{c[1]}.{c[2]}" for c in column_details})
        return []

    obj._process_batch_with_retry = fake_batch
    return obj


def test_the_gate_retries_a_covered_table_whose_signal_column_no_use_case_names(agent_ns):
    # Root cause R6: a table that a use case already cites was never retried for a signal column nothing names.
    details = _bakehouse()
    tables = BAKE_TX | BAKE_MASTERS
    categories = {_fqtn("bakehouse", t): ("TRANSACTIONAL" if t in BAKE_TX else "MASTER") for t in tables}
    scores = {f: 1.0 for f in categories}
    ucs = [_uc([_fqtn("bakehouse", t) for t in tables], text="Rank the franchises by totalPrice and dateTime.")]
    retried = []
    obj = _gate_obj(agent_ns, categories, scores, retried)
    obj._retry_missing_table_coverage(ucs, details, include_business_catchall=True)
    assert any(_fqtn("bakehouse", "sales_suppliers") in batch for batch in retried), "approved, latitude, longitude are named nowhere"


def test_the_gate_never_retries_a_technical_table(agent_ns):
    # Section 3e site (c): a technical table is not a business table; it must not be retried.
    details = _bakehouse() + [("samples", "bakehouse", "dim_date", "day", "string", "")]
    tables = BAKE_TX | BAKE_MASTERS
    categories = {_fqtn("bakehouse", t): ("TRANSACTIONAL" if t in BAKE_TX else "MASTER") for t in tables}
    categories[_fqtn("bakehouse", "dim_date")] = "TECHNICAL"
    scores = {f: 1.0 for f in categories if categories[f] != "TECHNICAL"}
    ucs = [_uc([_fqtn("bakehouse", t) for t in tables], text="Total totalPrice by franchiseID.")]
    retried = []
    obj = _gate_obj(agent_ns, categories, scores, retried)
    obj._retry_missing_table_coverage(ucs, details, include_business_catchall=True)
    assert not any(_fqtn("bakehouse", "dim_date") in batch for batch in retried)


def test_the_readout_states_unused_reference_tables_and_lists_technical_tables_once(agent_ns, caplog):
    # Section 3e sites (b) and (c): reference tables are never silently gone; technical tables are listed once.
    details = _bakehouse()
    references = [("samples", "bakehouse", "ref_currency", "code", "string", "")]
    technical = [("samples", "bakehouse", "dim_date", "day", "string", ""), ("samples", "bakehouse", "dim_date", "month", "string", "")]
    obj = _obj(agent_ns)
    ucs = [_uc([_fqtn("bakehouse", t) for t in BAKE_TX | BAKE_MASTERS])]
    with caplog.at_level(logging.WARNING, logger="req413_table_coverage"):
        obj._record_table_coverage(details, ucs, references, technical)
    coverage = obj.processing_honesty["table_coverage"]
    assert set(coverage["reference_reasons"]) == {_fqtn("bakehouse", "ref_currency")}
    assert coverage["technical"] == [_fqtn("bakehouse", "dim_date")]
    assert "[TABLE-COVERAGE FIRED]" in caplog.text


def _recorded_links(name):
    with open(os.path.join(REG, f"{name}_inferred_fk.json"), encoding="utf-8") as handle:
        return sorted(json.load(handle)["inferred_fk"])


def test_tpch_inferred_keys_are_the_exact_recorded_set_and_each_is_a_real_tpch_key(agent_ns):
    # Every recorded link is a real TPC-H foreign key (checked by hand against the TPC-H schema); the set is exact.
    _graph, links = _inferred_graph(agent_ns, "tpch", _load("tpch_schema.json"))
    assert links == _recorded_links("tpch")
    assert len(links) == 9


def test_nyctaxi_single_table_scope_infers_no_keys(agent_ns):
    _graph, links = _inferred_graph(agent_ns, "nyctaxi", _load("nyctaxi_schema.json"))
    assert links == _recorded_links("nyctaxi") == []


def test_a_scope_with_one_prefixed_table_keeps_its_full_name_form(agent_ns):
    # The domain-prefix rule needs a second table in the scope that shares the leading token. Alone, sales_franchises keeps
    # only its full name forms, and media_reviews.franchiseid joins nothing. A second sales_ table turns the rule on.
    forms = agent_ns["DataLoader"]._table_name_forms
    alone = {"sales_franchises": ["franchiseid", "name"], "media_reviews": ["franchiseid", "review"]}
    _graph, links = _inferred_graph(agent_ns, "scope", alone)
    assert links == []
    assert forms("sales_franchises", strip_affixes=True) == {"sales_franchises", "sales_franchise"}
    shared = dict(alone, sales_customers=["customerid", "name"])
    _graph, links = _inferred_graph(agent_ns, "scope", shared)
    assert links == ["samples.scope.media_reviews.franchiseid -> samples.scope.sales_franchises.franchiseid"]
