"""REQ-180 gap, D-180A: a metric view is left out of the table listing even when information_schema cannot be read. SHOW TABLES
returns no type column (docs: sql-ref-syntax-aux-show-tables lists database, tableName, isTemporary only), so on that path the
type comes from DESCRIBE TABLE EXTENDED ... AS JSON, whose documented "type" field is METRIC_VIEW for a metric view
(docs: sql-ref-syntax-aux-describe-table). A table whose type cannot be read stays listed and is logged; a plain VIEW is kept."""
import json
import threading
import time

from v120_artifacts_support import CapturingLogger

CAT, SCH = "adb_fe_uae_01", "default"
VIEW, TABLE, UNREADABLE, PLAIN_VIEW = "order_revenue_metrics", "order_revenue", "legacy_table", "order_summary"


class _Row:
    def __init__(self, *vals):
        self._vals = vals

    def __getitem__(self, i):
        return self._vals[i]


def _fake_rows(types, unreadable=(), calls=None):
    """Stands in for _metadata_rows: information_schema always fails (the case under test); DESCRIBE ... AS JSON answers
    with the documented "type" field, or fails for the names in `unreadable`."""
    def rows(spark, query, args=None, logger=None, context="metadata query"):
        if calls is not None:
            calls.append(query)
        if "information_schema" in query:
            raise RuntimeError("PERMISSION_DENIED: information_schema.tables is not readable")
        if query.startswith("DESCRIBE TABLE EXTENDED ") and query.endswith(" AS JSON"):
            name = query[len("DESCRIBE TABLE EXTENDED "):-len(" AS JSON")].replace("`", "").split(".")[-1]
            if name in unreadable:
                raise RuntimeError("PERMISSION_DENIED: DESCRIBE not allowed")
            return [_Row(json.dumps({"table_name": name, "type": types[name], "view_text": ""}))]
        raise AssertionError(f"unexpected query: {query}")
    return rows


def _types():
    return {VIEW: "METRIC_VIEW", TABLE: "MANAGED", UNREADABLE: "MANAGED", PLAIN_VIEW: "VIEW"}


def _inst(agent_ns, names=(VIEW, TABLE, UNREADABLE, PLAIN_VIEW)):
    inst = object.__new__(agent_ns["DataLoader"])
    inst.logger = CapturingLogger()
    inst.spark = object()
    inst.catalog_capabilities = {CAT: True}
    inst.streaming_batch_size = 1000
    inst._show_table_names = lambda query, limit=None, offset=0: list(names)
    return inst


def _patch(monkeypatch, agent_ns, rows_fn):
    monkeypatch.setitem(agent_ns, "_metadata_rows", rows_fn)
    monkeypatch.setitem(agent_ns, "_with_metadata_retries", lambda spark, work, logger=None, context="": work())


def _listed(tables):
    return {t.rsplit(".", 1)[-1].replace("`", "") for t in tables}


def test_show_tables_fallback_leaves_out_a_metric_view_and_keeps_a_table(agent_ns, monkeypatch):
    _patch(monkeypatch, agent_ns, _fake_rows(_types(), unreadable={UNREADABLE}))
    inst = _inst(agent_ns)
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    assert VIEW not in _listed(tables), "a metric view must not be listed: it is never a use case's table or a Data Filters pick"
    assert _listed(tables) == {TABLE, PLAIN_VIEW}, "a table whose type cannot be read is left out too (fail closed)"


def test_a_table_whose_type_cannot_be_read_is_left_out_and_logged(agent_ns, monkeypatch):
    _patch(monkeypatch, agent_ns, _fake_rows(_types(), unreadable={UNREADABLE}))
    inst = _inst(agent_ns)
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    assert UNREADABLE not in _listed(tables), "fail closed: a table whose type cannot be read is never offered"
    lines = [m for _lvl, m in inst.logger.records if "[TABLE-TYPE UNKNOWN]" in m]
    assert len(lines) == 1, lines
    assert lines[0].startswith("[TABLE-TYPE UNKNOWN] 1 table left out of ") and lines[0].endswith(": Inspire could not read its type"), lines


def test_a_plain_view_is_not_taken_for_a_metric_view(agent_ns, monkeypatch):
    _patch(monkeypatch, agent_ns, _fake_rows(_types()))
    inst = _inst(agent_ns, names=(PLAIN_VIEW,))
    assert _listed(inst._fetch_tables_for_schema(CAT, SCH)) == {PLAIN_VIEW}


def test_every_listed_table_is_typed_once_with_describe(agent_ns, monkeypatch):
    calls = []
    _patch(monkeypatch, agent_ns, _fake_rows(_types(), calls=calls))
    inst = _inst(agent_ns)
    inst._fetch_tables_for_schema(CAT, SCH)
    describes = [q for q in calls if q.startswith("DESCRIBE TABLE EXTENDED ")]
    assert len(describes) == 4, describes


def test_describe_without_a_type_field_is_unreadable_not_a_metric_view(agent_ns, monkeypatch):
    def rows(spark, query, args=None, logger=None, context="metadata query"):
        return [_Row(json.dumps({"table_name": "x"}))]
    monkeypatch.setitem(agent_ns, "_metadata_rows", rows)
    fqn = f"`{CAT}`.`{SCH}`.`{TABLE}`"
    views, unreadable = agent_ns["metric_view_names_by_describe"](object(), [fqn], CapturingLogger())
    assert views == set() and unreadable == [fqn]


def test_explicit_metric_view_on_a_catalog_without_information_schema_is_left_out(agent_ns, monkeypatch):
    _patch(monkeypatch, agent_ns, _fake_rows(_types()))
    inst = _inst(agent_ns)
    inst.catalog_capabilities = {CAT: False}
    inst.individual_tables = [(CAT, SCH, VIEW), (CAT, SCH, TABLE)]
    inst._metadata_errors = {}
    inst.metadata_unavailable = {}
    inst._canonical_names = {}
    inst._lkey = lambda cat, sch, tbl: (cat.lower(), sch.lower(), tbl.lower())
    inst._metadata_lock = __import__("threading").Lock()
    inst._drop_explicit_metric_views()
    assert inst.individual_tables == [(CAT, SCH, TABLE)]


def test_the_strategy_prompt_states_that_a_metric_view_is_not_a_table(agent_ns):
    prompt = agent_ns["PROMPT_TEMPLATES"]["STRATEGY_ALIGNMENT_PROMPT"]
    assert "A metric view is not a table" in prompt


class _Named:
    def __init__(self, table_name, table_type):
        self.table_name = table_name
        self.table_type = table_type


def test_join_inference_never_reads_a_metric_view_as_a_table(agent_ns, monkeypatch):
    """Join inference reads every table of a schema and infers FKs from their columns. A metric view's columns would feed that
    graph, so the view is left out of the schema's table names (information_schema types every table on this path)."""
    rows_out = [_Named(TABLE, "MANAGED"), _Named(VIEW, "METRIC_VIEW"), _Named(PLAIN_VIEW, "VIEW")]
    monkeypatch.setitem(agent_ns, "_metadata_rows", lambda spark, query, args=None, logger=None, context="metadata query": rows_out)
    inst = object.__new__(agent_ns["DataLoader"])
    inst.spark = object()
    inst.logger = CapturingLogger()
    assert inst._schema_table_names(CAT, SCH) == {TABLE, PLAIN_VIEW}


# The live shape of DESCRIBE TABLE EXTENDED ... AS JSON for a metric view whose source table is gone (coordinator capture on
# my-uae, 2026-11-14: a json_metadata column with "type":"METRIC_VIEW"). Trimmed: the other keys follow the documented fields.
LIVE_METRIC_VIEW_JSON = json.dumps({
    "table_name": "order_revenue_metrics", "catalog_name": CAT, "schema_name": SCH, "namespace": [SCH],
    "type": "METRIC_VIEW", "language": "YAML",
    "view_text": "version: 0.1\nsource: amr_ali.sales.orders\nmeasures:\n  - name: revenue\n    expr: SUM(amount)\n",
    "columns": [{"name": "revenue", "type": "DOUBLE", "is_measure": True}],
}, sort_keys=True)


def test_the_live_json_metadata_shape_types_a_metric_view(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "_metadata_rows", lambda spark, query, args=None, logger=None, context="metadata query": [_Row(LIVE_METRIC_VIEW_JSON)])
    views, unknown = agent_ns["metric_view_names_by_describe"](object(), [f"`{CAT}`.`{SCH}`.`{VIEW}`"], CapturingLogger())
    assert views == {f"{CAT}.{SCH}.{VIEW}"} and unknown == []


def test_a_denied_describe_metric_view_is_never_a_use_case_table(agent_ns, monkeypatch):
    # The must-exclude case: the view's DESCRIBE is denied, so its type is unknown and it is left out of the listing. The grounding
    # universe is built from that listing, so a use case that names the view has no verified table and cannot be grounded on it.
    _patch(monkeypatch, agent_ns, _fake_rows(_types(), unreadable={VIEW}))
    inst = _inst(agent_ns)
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    assert VIEW not in _listed(tables)
    validator = object.__new__(agent_ns["DatabricksInspire"])
    validator.logger = CapturingLogger()
    validator.global_table_names = {f"{CAT}.{SCH}.{name}" for name in _listed(tables)}
    validator.data_category_map = {}
    validator.discovery_evidence = None
    schema = [(CAT, SCH, name, "c", "string", None) for name in _listed(tables)]
    row = {"No": "AI-01-U09", "Name": "Denied view", "Tables Involved": f"{CAT}.{SCH}.{VIEW}"}
    _valid, dropped, kept = validator._validate_use_case_tables([row], schema, "[Batch P1_1]")
    assert not kept and len(dropped) == 1


def test_fallback_typing_of_fifty_tables_runs_in_parallel_within_the_worker_bound(agent_ns, monkeypatch):
    names = [f"t{i:02d}" for i in range(50)]
    types = {name: "MANAGED" for name in names}
    types["t07"] = "METRIC_VIEW"
    lock = threading.Lock()
    state = {"now": 0, "peak": 0, "calls": 0}

    def rows(spark, query, args=None, logger=None, context="metadata query"):
        if "information_schema" in query:
            raise RuntimeError("PERMISSION_DENIED: information_schema.tables is not readable")
        name = query[len("DESCRIBE TABLE EXTENDED "):-len(" AS JSON")].replace("`", "").split(".")[-1]
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
            state["calls"] += 1
        try:
            time.sleep(0.05)
        finally:
            with lock:
                state["now"] -= 1
        return [_Row(json.dumps({"table_name": name, "type": types[name]}))]

    monkeypatch.setitem(agent_ns, "_metadata_rows", rows)
    monkeypatch.setitem(agent_ns, "_with_metadata_retries", lambda spark, work, logger=None, context="": work())
    inst = _inst(agent_ns, names=names)
    started = time.perf_counter()
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    elapsed = time.perf_counter() - started
    print(f"\n[timing] 50-table fallback listing, 50ms DESCRIBE fake: {elapsed:.3f}s, peak parallel DESCRIBE {state['peak']}")
    assert state["calls"] == 50
    assert "t07" not in _listed(tables) and len(_listed(tables)) == 49
    assert 1 < state["peak"] <= agent_ns["METADATA_PARALLELISM"], state
    assert elapsed < 1.0, f"sequential typing takes 2.5s; parallel typing took {elapsed:.3f}s"


def test_the_probe_cap_bounds_the_describes_and_logs_what_it_leaves_out(agent_ns, monkeypatch):
    names = [f"t{i:02d}" for i in range(50)]
    calls = []

    def rows(spark, query, args=None, logger=None, context="metadata query"):
        if "information_schema" in query:
            raise RuntimeError("PERMISSION_DENIED: information_schema.tables is not readable")
        calls.append(query)
        return [_Row(json.dumps({"type": "MANAGED"}))]

    monkeypatch.setitem(agent_ns, "_metadata_rows", rows)
    monkeypatch.setitem(agent_ns, "_with_metadata_retries", lambda spark, work, logger=None, context="": work())
    inst = _inst(agent_ns, names=names)
    inst.streaming_batch_size = 20
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    logs = [m for _lvl, m in inst.logger.records]
    assert len(calls) == 20 and len(_listed(tables)) == 20
    assert any(m.startswith("[TABLE-TYPE PROBE CAP] 30 tables beyond the probe cap of 20") for m in logs), logs
    assert any("[TABLE-TYPE UNKNOWN] 30 tables left out of" in m for m in logs), logs
