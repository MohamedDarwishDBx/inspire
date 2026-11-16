"""REQ-373 (increment 2): a linked group of tables is ONE joined dataset. Its one LEFT join is built from the person's column pairs,
counted and profiled once, the profile is shared by its members, a join that fans out falls back per table with the reason logged,
PII tags follow their column into the join, and a group heavier than the batch cap is split. Each test fails before this change.
"""
import json
import threading
from collections import defaultdict

from v120_artifacts_support import CapturingLogger

CHILD = ("main", "sales", "orders")
PARENT = ("main", "sales", "customers")
OTHER = ("main", "sales", "regions")
OUTSIDE = ("main", "sales", "returns")


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
    dl._column_tags = {}
    if joins:
        dl.set_person_relationships(ns["parse_person_relationships"](json.dumps(list(joins))))
    return dl


def _key(table):
    return tuple(part.lower() for part in table)


class _FakeDeep:
    """Stands in for DeepEvidence: count_join answers the guard counts, profile_table records what it was asked to profile."""

    def __init__(self, anchor_rows, joined_rows):
        self.counts = [{"a": anchor_rows, "j": joined_rows}]
        self.reads = []
        self.profiled = []

    def count_join(self, anchor_source, joined_sql, label):
        self.reads.append(("joined_guard", label))
        return self.counts[0]["a"], self.counts[0]["j"]

    def profile_table(self, table_sql, table_label, columns, column_tags=None):
        self.profiled.append((table_sql, table_label, columns, column_tags))
        return {"profile_of": table_label}


def _inst(ns):
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    return inst


def _columns():
    return {
        CHILD: [("order_id", "BIGINT"), ("customer_id", "BIGINT")],
        PARENT: [("customer_id", "BIGINT"), ("region_note", "STRING")],
        OTHER: [("region_id", "BIGINT")],
    }


def test_the_plan_anchors_on_the_source_table_and_walks_the_persons_column_pairs(agent_ns):
    ns = agent_ns
    joins = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id"),
                         _join(PARENT, "region_id", OTHER, "region_id")])._person_relations
    plan = ns["joined_dataset_plan"](joins)
    assert plan["anchor"] == _key(CHILD), "the child table of the first join the person drew is the source"
    assert plan["steps"] == [
        (_key(PARENT), [(_key(CHILD), "customer_id", "customer_id")]),
        (_key(OTHER), [(_key(PARENT), "region_id", "region_id")]),
    ]
    assert ns["joined_dataset_plan"]([]) is None


def test_the_join_is_one_left_chain_with_unique_column_names_and_no_ddl(agent_ns):
    ns = agent_ns
    joins = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])._person_relations
    plan = ns["joined_dataset_plan"](joins)
    cols = {_key(t): c for t, c in _columns().items()}
    sql, columns, _tags = ns["joined_dataset_sql"](plan, cols, {}, ns["scoped_source"])
    assert sql.count(" LEFT JOIN ") == 1 and " INNER JOIN " not in sql and sql.count(" JOIN ") == 1
    assert "AS t0" in sql and "AS t1" in sql
    assert "ON t0.`customer_id` = t1.`customer_id`" in sql
    assert "CREATE" not in sql.upper() and "CACHE" not in sql.upper() and "PERSIST" not in sql.upper()
    names = [name for name, _dtype in columns]
    assert len(names) == len(set(names)) == 4, "every column of every table appears once, under its own alias"
    assert "t0__order_id" in names and "t1__customer_id" in names


def test_a_pii_tag_on_a_source_column_keeps_gating_the_joined_column(agent_ns):
    ns = agent_ns
    joins = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])._person_relations
    plan = ns["joined_dataset_plan"](joins)
    cols = {_key(t): c for t, c in _columns().items()}
    tags = {_key(PARENT): {"region_note": {"classification": "pii"}}}
    _sql, _columns_out, joined_tags = ns["joined_dataset_sql"](plan, cols, tags, ns["scoped_source"])
    assert joined_tags == {"t1__region_note": {"classification": "pii"}}
    assert ns["deep_column_is_pii"]("t1__region_note", joined_tags["t1__region_note"]), "the joined column is still gated as PII"


def test_the_row_guard_keeps_a_join_within_the_factor_and_refuses_a_fan_out(agent_ns):
    fits = agent_ns["joined_dataset_fits"]
    assert fits(100, 300) == (True, "")
    assert fits(0, 0) == (True, "")
    ok, reason = fits(100, 301)
    assert not ok and "301 rows from 100 rows" in reason and "more than 3 times" in reason


def test_a_group_that_fans_out_is_profiled_per_table_and_the_reason_is_logged(agent_ns):
    ns = agent_ns
    inst = _inst(ns)
    loader = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    deep = _FakeDeep(anchor_rows=100, joined_rows=400)
    evidence = {"profiles": {}}
    covered = inst._profile_joined_datasets(deep, loader, [CHILD, PARENT], _columns(), evidence)
    assert covered == set() and deep.profiled == [], "nothing is profiled as one dataset"
    assert evidence["joined_datasets"][0]["status"] == "per_table"
    assert "more than 3 times" in evidence["joined_datasets"][0]["reason"]
    assert inst.logger.matching("JOINED-DATASET FALLBACK FIRED"), "the fallback is logged with its reason"


def test_a_group_that_fits_is_joined_and_profiled_once_and_its_members_share_the_profile(agent_ns):
    ns = agent_ns
    inst = _inst(ns)
    loader = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    deep = _FakeDeep(anchor_rows=100, joined_rows=120)
    evidence = {"profiles": {}}
    profiled = [CHILD, PARENT, OUTSIDE]
    covered = inst._profile_joined_datasets(deep, loader, profiled, _columns(), evidence)
    assert covered == {CHILD, PARENT}, "the tables in the group are covered; the table outside it is not"
    assert len(deep.profiled) == 1, "the group is profiled once, not once per table"
    assert deep.profiled[0][0].startswith("(SELECT ") and deep.profiled[0][0].endswith(") AS joined_dataset")
    shared = evidence["profiles"]["main.sales.orders"]
    assert shared is evidence["profiles"]["main.sales.customers"], "the members share one profile"
    assert "main.sales.returns" not in evidence["profiles"]
    assert evidence["joined_datasets"][0]["status"] == "joined"
    assert inst.logger.matching("JOINED-DATASET FIRED")


def test_a_member_missing_from_the_scan_falls_back_per_table(agent_ns):
    ns = agent_ns
    inst = _inst(ns)
    loader = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")])
    deep = _FakeDeep(anchor_rows=100, joined_rows=120)
    evidence = {"profiles": {}}
    covered = inst._profile_joined_datasets(deep, loader, [CHILD], _columns(), evidence)
    assert covered == set() and deep.reads == [], "no join is read when a member is not in the scan"
    assert evidence["joined_datasets"][0]["reason"] == "a joined table is not in this scan"


def test_without_person_joins_nothing_is_joined_and_the_evidence_is_unchanged(agent_ns):
    ns = agent_ns
    inst = _inst(ns)
    deep = _FakeDeep(anchor_rows=1, joined_rows=1)
    evidence = {"profiles": {}}
    assert inst._profile_joined_datasets(deep, _loader(ns, []), [CHILD, PARENT], _columns(), evidence) == set()
    assert deep.reads == [] and deep.profiled == [] and "joined_datasets" not in evidence


def test_a_group_heavier_than_the_cap_is_split_into_parts_no_heavier_than_the_cap(agent_ns):
    ns = agent_ns
    infos = []
    for name, weight in (("t1", 6), ("t2", 5), ("t3", 4), ("t4", 3)):
        info = ns["TableSizeInfo"]("main", "sales", name, num_columns=1)
        info.memory_weight = weight
        infos.append(info)
    chunks = ns["split_unit_by_weight"](infos, 10)
    assert [[i.table for i in c] for c in chunks] == [["t1"], ["t2", "t3"], ["t4"]]


def test_an_oversize_group_is_split_before_packing_so_no_batch_exceeds_the_cap(agent_ns):
    ns = agent_ns
    log = CapturingLogger()
    optimizer = ns["DynamicBatchOptimizer"](log, max_batch_weight=10)
    infos = []
    for name, weight in (("t1", 6), ("t2", 5), ("t3", 4), ("t4", 3)):
        info = ns["TableSizeInfo"]("main", "sales", name, num_columns=1)
        info.memory_weight = weight
        infos.append(info)
    group = frozenset({("main", "sales", n) for n in ("t1", "t2", "t3", "t4")})  # 18 > cap of 10
    batches = optimizer.create_optimized_batches(infos, [group])
    flat = [t for batch in batches for t in batch]
    assert sorted(flat) == sorted(("main", "sales", n) for n in ("t1", "t2", "t3", "t4")), "every table is in exactly one batch"
    weights = {("main", "sales", i.table): i.memory_weight for i in infos}
    assert all(sum(weights[t] for t in batch) <= 10 for batch in batches)
    assert log.matching("JOINED-GROUP SPLIT FIRED")
