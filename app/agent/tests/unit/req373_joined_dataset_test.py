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

    def profile_table(self, table_sql, table_label, columns, column_tags=None, known_rows=None):
        self.profiled.append((table_sql, table_label, columns, column_tags, known_rows))
        return {"rows": known_rows, "sampled": False, "columns": {name: {"null_share": 0.0} for name, _dtype in columns}}


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
    orders, customers = evidence["profiles"]["main.sales.orders"], evidence["profiles"]["main.sales.customers"]
    assert set(orders["columns"]) == {"order_id", "customer_id"}, "each member keeps its own columns, under their real names"
    assert set(customers["columns"]) == {"customer_id", "region_note"}
    assert orders["via_join"] == customers["via_join"] == "main.sales.customers + main.sales.orders"
    assert orders["rows"] == customers["rows"] == 120, "the members carry the join's row count"
    assert deep.profiled[0][4] == 120, "the join's row count from the guard is passed on, not counted a second time"
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


def _loop_rows():
    return [("main", "sales", "orders", "order_id", "BIGINT", ""), ("main", "sales", "orders", "customer_id", "BIGINT", ""),
            ("main", "sales", "customers", "customer_id", "BIGINT", ""), ("main", "sales", "customers", "region_note", "STRING", ""),
            ("main", "sales", "returns", "return_id", "BIGINT", "")]


class _LoopDeep(_FakeDeep):
    max_tables = 10
    max_joins = 5
    pii_excluded = ()
    sample_rows = 10

    def summary(self):
        return {"tables_read": [], "tables_read_count": 0, "statements": 0}


def _whole_loop(ns, monkeypatch, joins=True):
    monkeypatch.setitem(ns, "collect_metric_views", lambda spark, schemas, logger: [])
    monkeypatch.setitem(ns, "collect_usage_signals", lambda spark, fqns, logger, days: {})
    deep = _LoopDeep(anchor_rows=100, joined_rows=120)
    monkeypatch.setitem(ns, "DeepEvidence", lambda *args, **kwargs: deep)
    inst = _inst(ns)
    inst.spark = None
    inst.data_loader = _loader(ns, [_join(CHILD, "customer_id", PARENT, "customer_id")] if joins else [])
    inst.discovery_type = None
    inst._implement_builder = lambda: None
    inst._implement_builder_label = lambda: ""
    inst._plan_progress_batches = lambda *args: None
    inst._evidence_progress = lambda *args: None
    inst._evidence_join_candidates = lambda tables: []
    return inst, deep


def test_the_whole_discovery_loop_profiles_a_group_once_and_names_it_once_in_the_evidence(agent_ns, monkeypatch):
    ns = agent_ns
    inst, deep = _whole_loop(ns, monkeypatch)
    evidence = inst._collect_discovery_evidence(_loop_rows())
    labels = [label for _sql, label, _cols, _tags, _rows in deep.profiled]
    assert sorted(labels) == ["main.sales.customers + main.sales.orders", "main.sales.returns"], \
        "the group is one profile read; the table in no group is profiled on its own; no member is profiled again"
    record = evidence["joined_datasets"][0]
    assert record["status"] == "joined" and record["sql"].startswith("SELECT ") and " LEFT JOIN " in record["sql"]
    assert evidence["profiles"]["main.sales.orders"]["via_join"] == record["label"]
    assert "main.sales.returns" in evidence["profiles"] and "via_join" not in evidence["profiles"]["main.sales.returns"]


def test_the_evidence_line_names_a_group_once_and_names_each_column_by_its_table(agent_ns, monkeypatch):
    ns = agent_ns
    inst, _deep = _whole_loop(ns, monkeypatch)
    inst.discovery_type = ns["DISCOVERY_AI_ENHANCED"]  # the gate shares profiles only when measures are shared (AI-enhanced)
    inst.discovery_evidence = inst._collect_discovery_evidence(_loop_rows())
    inst.discovery_evidence["metric_views"] = []
    lines, _joins = inst._evidence_lines(["main.sales.orders", "main.sales.customers", "main.sales.returns"])
    joined = [line for line in lines if "joined dataset" in line]
    assert len(joined) == 1, lines
    assert joined[0].startswith("- joined dataset `main.sales.customers + main.sales.orders`")
    assert not any(line.startswith("- `main.sales.orders`") or line.startswith("- `main.sales.customers`") for line in lines), \
        "the members get no line of their own"
    assert any(line.startswith("- `main.sales.returns`") for line in lines)


def test_without_person_joins_the_loop_profiles_every_table_as_before(agent_ns, monkeypatch):
    ns = agent_ns
    inst, deep = _whole_loop(ns, monkeypatch, joins=False)
    evidence = inst._collect_discovery_evidence(_loop_rows())
    assert sorted(label for _s, label, _c, _t, _r in deep.profiled) == [
        "main.sales.customers", "main.sales.orders", "main.sales.returns"]
    assert "joined_datasets" not in evidence and all(p.get("via_join") is None for p in evidence["profiles"].values())
    assert all(known is None for *_rest, known in deep.profiled), "without a join the count is read as before"
