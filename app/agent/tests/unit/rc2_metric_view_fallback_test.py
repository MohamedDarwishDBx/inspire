"""REQ-180 gap, D-180A: a metric view is left out of the table listing even when information_schema cannot be read. SHOW TABLES
returns no type column (docs: sql-ref-syntax-aux-show-tables lists database, tableName, isTemporary only), so on that path the
type comes from DESCRIBE TABLE EXTENDED ... AS JSON, whose documented "type" field is METRIC_VIEW for a metric view
(docs: sql-ref-syntax-aux-describe-table). A table whose type cannot be read stays listed and is logged; a plain VIEW is kept."""
import json

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
    assert {TABLE, UNREADABLE, PLAIN_VIEW} <= _listed(tables)


def test_a_table_whose_type_cannot_be_read_stays_listed_and_the_probe_is_logged(agent_ns, monkeypatch):
    _patch(monkeypatch, agent_ns, _fake_rows(_types(), unreadable={UNREADABLE}))
    inst = _inst(agent_ns)
    tables = inst._fetch_tables_for_schema(CAT, SCH)
    assert UNREADABLE in _listed(tables), "an unreadable type is not a metric view, so the table is kept (and logged)"
    lines = [m for _lvl, m in inst.logger.records if "[METRIC-VIEW PROBE]" in m]
    assert len(lines) == 1 and "1 of 4" in lines[0], lines


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
