"""REQ-413 (coordinator item 1): the Table Election extracted from run() into `_elect_generation_batches`.

OLD_ELECTION_BLOCK below is the inline election block exactly as origin/dev carries it (the code run() had before the
extraction), copied verbatim from the notebook and dedented into a method body. The parity tests drive the same inputs
through the old block and the new method and assert identical outputs wherever the old path applied (every non-join
branch). The join-mode tests assert the new contract on bakehouse and tpcds: transactional tables primary, masters as
context inside the budget. The reference is copied, not re-typed, so a drift in origin/dev shows up as a failed copy.
"""
import json
import logging
import os

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REG = os.path.join(ROOT, "tests", "regression")

OLD_ELECTION_BLOCK = r'''
        master_details = []
        transactional_details = []
        for detail in business_details:
            (catalog, schema, table, _, _, _) = detail
            fqtn = f"{catalog}.{schema}.{table}"
            if fqtn in transactional_tables_set:
                transactional_details.append(detail)
            else:
                master_details.append(detail)

        _rt = TECHNICAL_CONTEXT["runtime"]
        _table_election_threshold = _rt["table_election_threshold"]
        _table_election_tx_min = _rt["table_election_transactional_tables_min"]
        total_business_tables = len(business_tables)
        tx_count = len(transactional_tables_set)

        elected_master_details = master_details
        elected_transactional_details = transactional_details

        if self.table_election_mode == "Let Inspire Decides":
            if total_business_tables > _table_election_threshold:
                if tx_count >= _table_election_tx_min:
                    elected_master_details = []
                    log_print(f"🗳️ Table Election: {inspire_plural(total_business_tables, 'table')} > threshold ({_table_election_threshold}), "
                              f"using TRANSACTIONAL tables only ({inspire_plural(tx_count, 'table')})")
                    self.logger.info(f"Table Election [Let Inspire Decides]: total={total_business_tables} > threshold={_table_election_threshold}, "
                                   f"tx={tx_count} >= min={_table_election_tx_min} → transactional only")
                else:
                    log_print(f"🗳️ Table Election: {inspire_plural(total_business_tables, 'table')} > threshold ({_table_election_threshold}), "
                              f"but transactional tables ({tx_count}) < min ({_table_election_tx_min}), "
                              f"including MASTER tables as well")
                    self.logger.info(f"Table Election [Let Inspire Decides]: total={total_business_tables} > threshold={_table_election_threshold}, "
                                   f"tx={tx_count} < min={_table_election_tx_min} → transactional + master")
            else:
                log_print(f"🗳️ Table Election: {inspire_plural(total_business_tables, 'table')} <= threshold ({_table_election_threshold}), "
                          f"using ALL business tables (master + transactional)")
                self.logger.info(f"Table Election [Let Inspire Decides]: total={total_business_tables} <= threshold={_table_election_threshold} → all tables")
        elif self.table_election_mode == "Transactional Only":
            elected_master_details = []
            if not elected_transactional_details:
                self.logger.warning("Table Election [Transactional Only]: No transactional tables found. Falling back to all business tables.")
                log_print("⚠️ Table Election: No transactional tables found. Falling back to all business tables.", level="WARNING")
                elected_master_details = master_details
            else:
                log_print(f"🗳️ Table Election: TRANSACTIONAL ONLY mode, using {inspire_plural(tx_count, 'transactional table')}, "
                          f"excluding {inspire_plural(len(master_tables_set), 'master table')}")
                self.logger.info(f"Table Election [Transactional Only]: tx={tx_count}, excluded master={len(master_tables_set)}")
        else:
            log_print(f"🗳️ Table Election: ALL TABLES mode, using all {total_business_tables} business tables")
            self.logger.info(f"Table Election [All Tables]: using all {total_business_tables} business tables")

        if self.table_election_mode == "Let Inspire Decides" and master_details and not elected_master_details:
            elected_master_details = self._usage_kept_master_details(master_details, business_details)

        master_details = elected_master_details
        transactional_details = elected_transactional_details

        master_tables_count = len({f"{c}.{s}.{t}" for (c, s, t, _, _, _) in master_details}) if master_details else 0
        tables_per_call = self._determine_tables_per_call(master_tables_count)

        adjusted_batches = []
        next_batch_num = 1

        if master_details:
            grouped_master = self._split_by_table_limit(master_details, tables_per_call)
            for group in grouped_master:
                estimated_prompt_size = base_prompt_size + self._estimate_schema_markdown_size(group)
                if estimated_prompt_size > safe_context_limit:
                    singles = self._split_by_table_limit(group, 1)
                    for single in singles:
                        adjusted_batches.append((next_batch_num, single))
                        next_batch_num += 1
                else:
                    adjusted_batches.append((next_batch_num, group))
                    next_batch_num += 1

        if transactional_details:
            grouped_tx = self._split_by_table_limit(transactional_details, 1)
            for group in grouped_tx:
                adjusted_batches.append((next_batch_num, group))
                next_batch_num += 1

        augmented_batches = []
        for batch_num, batch_columns in adjusted_batches:
            augmented = self._augment_columns_with_related_tables(batch_columns)
            augmented_batches.append((batch_num, augmented))
        return {"batches": augmented_batches, "master_details": master_details, "transactional_details": transactional_details}
'''

BAKE_TX = {"sales_transactions", "media_customer_reviews", "media_gold_reviews_chunked"}
BAKE_MASTERS = {"sales_customers", "sales_franchises", "sales_suppliers"}
TPCDS_FACTS = {"catalog_returns", "catalog_sales", "inventory", "store_returns", "store_sales", "web_returns", "web_sales"}


def _load(name):
    with open(os.path.join(REG, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def _type(col):
    low = col.lower()
    return "bigint" if low.endswith(("id", "_sk")) else "string"


def _details(schema, tables):
    return [("samples", schema, t, c, _type(c), "") for t, cols in tables.items() for c in cols]


def _inferred_graph(ns, schema, tables):
    """The FK graph the naming rules infer for the scope, in the `_kind_fk_graph` shape (the graph run() builds)."""
    import threading
    cls = ns["DataLoader"]
    loader = cls.__new__(cls)
    loader.logger = logging.getLogger("req413_election_parity")
    loader._metadata_lock = threading.RLock()
    loader.foreign_key_graph = {}
    loader._inferred_fk = {}
    loader._person_fk = set()
    loader._join_inferred_schemas = set()
    loader.primary_keys = {}
    graph = {}
    for scored in loader._infer_foreign_keys(_details(schema, tables)).values():
        for rel, _confidence in scored:
            graph.setdefault(f"{rel[0]}.{rel[1]}.{rel[2]}".lower(), []).append(
                (rel[3], f"{rel[4]}.{rel[5]}.{rel[6]}".lower(), rel[7]))
    return graph


def _fqtn(schema, table):
    return f"samples.{schema}.{table}"


def _scope(schema, tables, tx_names, mode, ns, total_override=None):
    details = _details(schema, tables)
    names = [f"samples.{schema}.{t}" for t in tables]
    tx_set = {f"samples.{schema}.{t}" for t in tables if t in tx_names}
    master_set = set(names) - tx_set
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req413_election_parity")
    obj.table_election_mode = mode
    obj.discovery_evidence = None
    obj._estimate_schema_markdown_size = lambda cols: 100 * len(cols)
    obj.data_loader = None
    obj._kind_fk_graph = _inferred_graph(ns, schema, tables)
    tx_details = [d for d in details if f"{d[0]}.{d[1]}.{d[2]}" in tx_set]
    master_details = [d for d in details if f"{d[0]}.{d[1]}.{d[2]}" in master_set]
    return obj, details, tx_details, master_details, names, tx_set, master_set


def _old(ns, obj, details, names, tx_set, master_set, base, limit):
    globs = dict(ns)
    exec("def _old_election(self, business_details, business_tables, transactional_tables_set, master_tables_set,\n"
         "                  base_prompt_size, safe_context_limit):\n" + OLD_ELECTION_BLOCK, globs)
    return globs["_old_election"](obj, details, names, tx_set, master_set, base, limit)


def _new(obj, details, names, tx_set, master_set, base, limit):
    return obj._elect_generation_batches(details, names, tx_set, master_set, base, limit)


def _same(old, new):
    assert old["batches"], "a parity check over an empty batch list proves nothing"
    assert old["batches"] == new["batches"]
    assert old["master_details"] == new["master_details"]
    assert old["transactional_details"] == new["transactional_details"]


@pytest.mark.parametrize("mode", ["All Tables", "Transactional Only", "Let Inspire Decides"])
def test_small_scope_is_identical_to_the_inline_block(agent_ns, mode):
    tables = {t: c for t, c in _load("bakehouse_schema.json").items() if t in
              {"sales_transactions", "sales_customers", "sales_franchises", "sales_suppliers"}}
    obj, details, _tx, _m, names, tx_set, master_set = _scope("bakehouse", tables,
                                                             {"sales_transactions"}, mode, agent_ns)
    base, limit = 1000, 10 ** 9
    _same(_old(agent_ns, obj, details, names, tx_set, master_set, base, limit),
          _new(obj, details, names, tx_set, master_set, base, limit))


@pytest.mark.parametrize("mode", ["All Tables", "Transactional Only"])
def test_full_bakehouse_and_tpcds_are_identical_when_the_join_path_does_not_apply(agent_ns, mode):
    for schema, tables, tx in (("bakehouse", _load("bakehouse_schema.json"), BAKE_TX),
                               ("tpcds_sf1", _load("tpcds_sf1_schema.json"), TPCDS_FACTS)):
        obj, details, _tx, _m, names, tx_set, master_set = _scope(schema, tables, tx, mode, agent_ns)
        for base, limit in ((1000, 10 ** 9), (1000, 50000)):
            _same(_old(agent_ns, obj, details, names, tx_set, master_set, base, limit),
                  _new(obj, details, names, tx_set, master_set, base, limit))


def test_tpch_over_threshold_with_one_transactional_table_takes_the_old_path_unchanged(agent_ns):
    obj, details, _tx, _m, names, tx_set, master_set = _scope("tpch", _load("tpch_schema.json"), {"lineitem"},
                                                             "Let Inspire Decides", agent_ns)
    _same(_old(agent_ns, obj, details, names, tx_set, master_set, 1000, 10 ** 9),
          _new(obj, details, names, tx_set, master_set, 1000, 10 ** 9))


def test_bakehouse_join_mode_keeps_three_transactional_tables_primary_and_three_masters_as_context(agent_ns):
    obj, details, _tx, _m, names, tx_set, master_set = _scope("bakehouse", _load("bakehouse_schema.json"), BAKE_TX,
                                                             "Let Inspire Decides", agent_ns)
    out = _new(obj, details, names, tx_set, master_set, 1000, 10 ** 9)
    assert out["join_plan"] is not None
    groups = out["join_plan"]["groups"]
    primaries = {p for g in groups for p in g["primaries"]}
    context = {c for g in groups for c in g["context"]}
    assert primaries == {_fqtn("bakehouse", t) for t in BAKE_TX}
    assert context == {_fqtn("bakehouse", t) for t in BAKE_MASTERS}
    assert out["join_plan"]["unattached"] == []
    assert len(out["batches"]) == len(groups) == 1


def test_tpcds_join_mode_keeps_every_fact_primary_once_and_carries_each_master_or_leaves_it(agent_ns):
    tables = _load("tpcds_sf1_schema.json")
    obj, details, _tx, _m, names, tx_set, master_set = _scope("tpcds_sf1", tables, TPCDS_FACTS,
                                                             "Let Inspire Decides", agent_ns)
    out = _new(obj, details, names, tx_set, master_set, 1000, 10 ** 9)
    groups = out["join_plan"]["groups"]
    primaries = [p for g in groups for p in g["primaries"]]
    assert sorted(primaries) == sorted(tx_set)
    carried = {c for g in groups for c in g["context"]}
    assert carried | set(out["join_plan"]["unattached"]) == master_set
    assert carried, "dimensions must ride along with the facts"
