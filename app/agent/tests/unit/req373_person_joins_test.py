"""REQ-373: the joins the person draws on the Launch page are the first source of joins, and a linked group of tables is one joined
dataset. Each test fails on the notebook before REQ-373 and passes after it.

* parse_person_relationships reads the 18_table_relationships widget (a JSON list of {from, to}).
* DataLoader keeps the person's joins in foreign_key_graph, drops other joins on the same table pair, and skips those pairs in
  name inference. A table with only person joins stays open to inference for its other pairs.
* joined_groups finds the linked groups, and create_optimized_batches packs each group as one unit, so one batch holds it.
* Tables Involved names a joined dataset once when the run has person joins; without them the output is unchanged.
"""
import json
import threading
from collections import defaultdict

from v120_artifacts_support import CapturingLogger

CHILD = ("main", "sales", "orders")
PARENT = ("main", "sales", "customers")
OTHER = ("main", "sales", "regions")


def _join(child, column, parent, parent_column):
    return {"from": {"table": ".".join(child), "column": column}, "to": {"table": ".".join(parent), "column": parent_column}}


def _loader(ns, joins=()):
    cls = ns["DataLoader"]
    dl = cls.__new__(cls)
    dl.logger = CapturingLogger()
    dl._metadata_lock = threading.RLock()
    dl.foreign_key_graph = defaultdict(list)
    dl._inferred_fk = {}
    dl._person_relations = []
    dl._person_fk = set()
    dl._join_inferred_schemas = set()
    if joins:
        dl.set_person_relationships(ns["parse_person_relationships"](json.dumps(list(joins))))
    return dl


def test_the_widget_reads_each_join_as_an_eight_part_key_and_skips_what_is_not_a_join(agent_ns):
    parse = agent_ns["parse_person_relationships"]
    text = json.dumps([
        _join(CHILD, "customer_id", PARENT, "customer_id"),
        {"from": {"table": "orders", "column": "x"}, "to": {"table": "main.sales.customers", "column": "id"}},
        "not a join",
        _join(CHILD, "customer_id", PARENT, "customer_id"),
    ])
    assert parse(text) == [(*CHILD, "customer_id", *PARENT, "customer_id")], "one join; a bare name, a non-object and a repeat are skipped"
    assert parse("") == [] and parse("{nope") == [] and parse('{"from": 1}') == []


def test_a_person_join_is_the_only_join_on_its_table_pair_in_the_graph(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    # Declared keys arrive from information_schema: one on the same pair (another column), one on another parent.
    dl.foreign_key_graph[CHILD] = [(*CHILD, "cust_ref", *PARENT, "id"), (*CHILD, "region_id", *OTHER, "region_id")]
    dl._apply_person_relationships()
    rels = dl.foreign_key_graph[CHILD]
    assert (*CHILD, "customer_id", *PARENT, "customer_id") in rels
    assert (*CHILD, "cust_ref", *PARENT, "id") not in rels, "a declared key on the pair the person linked is replaced"
    assert (*CHILD, "region_id", *OTHER, "region_id") in rels, "a declared key on another pair stays"


def test_the_person_join_survives_a_constraint_load_that_rewrites_the_table_and_is_not_doubled(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    dl.foreign_key_graph[CHILD] = []
    dl._apply_person_relationships()
    dl.foreign_key_graph[CHILD] = [(*CHILD, "cust_ref", *PARENT, "id")]  # _load_constraints rewrites the list
    dl._apply_person_relationships()
    dl._apply_person_relationships()
    assert dl.foreign_key_graph[CHILD] == [(*CHILD, "customer_id", *PARENT, "customer_id")]


def test_name_inference_skips_a_pair_the_person_linked_and_still_infers_the_other_pairs_of_that_table(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    inferred = {
        CHILD: [((*CHILD, "customer_id", *PARENT, "id"), 0.9), ((*CHILD, "region_id", *OTHER, "id"), 0.8)],
    }
    dl._infer_foreign_keys = lambda details: inferred
    added = dl.merge_inferred_foreign_keys([])
    assert added == 1, "the pair the person linked is not inferred again; the other pair is"
    rels = dl.foreign_key_graph[CHILD]
    assert (*CHILD, "customer_id", *PARENT, "customer_id") in rels and (*CHILD, "customer_id", *PARENT, "id") not in rels
    assert (*CHILD, "region_id", *OTHER, "id") in rels


def test_with_no_person_join_a_table_with_declared_keys_is_still_closed_to_name_inference(agent_ns):
    dl = _loader(agent_ns, [])
    dl.foreign_key_graph[CHILD] = [(*CHILD, "cust_ref", *PARENT, "id")]
    dl._infer_foreign_keys = lambda details: {CHILD: [((*CHILD, "region_id", *OTHER, "id"), 0.8)]}
    assert dl.merge_inferred_foreign_keys([]) == 0, "declared keys still close the table, as before REQ-373"


def test_linked_tables_form_one_joined_group_and_unlinked_tables_form_none(agent_ns):
    dl = _loader(agent_ns, [_join(CHILD, "customer_id", PARENT, "customer_id"), _join(PARENT, "region_id", OTHER, "region_id")])
    assert dl.joined_groups() == [frozenset({tuple(p.lower() for p in t) for t in (CHILD, PARENT, OTHER)})]
    assert _loader(agent_ns, []).joined_groups() == []


def _info(ns, table, weight):
    info = ns["TableSizeInfo"]("main", "sales", table, num_columns=1)
    info.memory_weight = weight
    return info


def test_without_a_group_the_batches_pack_exactly_as_before(agent_ns):
    ns = agent_ns
    optimizer = ns["DynamicBatchOptimizer"](CapturingLogger(), max_batch_weight=10)
    infos = [_info(ns, "t1", 6), _info(ns, "t2", 5), _info(ns, "t3", 4), _info(ns, "t4", 3)]
    batches = optimizer.create_optimized_batches(infos)
    assert batches == [[("main", "sales", "t1")], [("main", "sales", "t2"), ("main", "sales", "t3")], [("main", "sales", "t4")]]


def test_a_joined_group_lands_in_one_batch_even_when_the_packing_would_split_it(agent_ns):
    ns = agent_ns
    optimizer = ns["DynamicBatchOptimizer"](CapturingLogger(), max_batch_weight=10)
    infos = [_info(ns, "t1", 6), _info(ns, "t2", 5), _info(ns, "t3", 4), _info(ns, "t4", 3)]
    group = frozenset({("main", "sales", "t1"), ("main", "sales", "t4")})
    batches = optimizer.create_optimized_batches(infos, [group])
    assert batches == [[("main", "sales", "t1"), ("main", "sales", "t4")], [("main", "sales", "t2"), ("main", "sales", "t3")]]
    flat = [t for batch in batches for t in batch]
    assert sorted(flat) == sorted((i.catalog, i.schema, i.table) for i in infos), "every table is in exactly one batch"


def test_with_person_joins_a_table_spelled_two_ways_in_tables_involved_is_named_once(agent_ns):
    ns = agent_ns
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    inst._honesty_state = {}
    inst.processing_honesty = {}
    inst.data_loader = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    schema = [("main", "sales", "orders", "customer_id", "BIGINT", ""), ("main", "sales", "customers", "customer_id", "BIGINT", "")]
    uc = {"No": "1", "Name": "Orders by customer", "Tables Involved": "orders, sales.orders, main.sales.orders, customers"}
    kept, dropped = inst._phaseQ1_validate_grounding([uc], schema)
    assert dropped == [] and kept == [uc]
    assert uc["Tables Involved"] == "main.sales.orders, main.sales.customers"


def test_without_person_joins_tables_involved_keeps_its_names_as_before(agent_ns):
    ns = agent_ns
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    inst._honesty_state = {}
    inst.processing_honesty = {}
    inst.data_loader = _loader(ns, [])
    schema = [("main", "sales", "orders", "customer_id", "BIGINT", "")]
    uc = {"No": "1", "Name": "Orders", "Tables Involved": "orders, sales.orders, main.sales.orders"}
    inst._phaseQ1_validate_grounding([uc], schema)
    assert uc["Tables Involved"] == "main.sales.orders, main.sales.orders, main.sales.orders", "unchanged without person joins"
