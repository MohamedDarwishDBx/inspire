"""REQ-180 and D-180A: a metric view is never a use case's table. It is left out of Tables Involved (the validator and the
grounding step both drop it), and its source table is never named in its place, so a use case cannot name a primary table
that is gone (amr_ali.sales.orders) or a metric view (adb_fe_uae_01.default.order_revenue_metrics). A use case whose tables
are all metric views has no table to read and is rejected or dropped. The view can still sit in the schema listing because
its columns are readable, so every check must look the view up by name."""
from v120_artifacts_support import CapturingLogger

VIEW = "adb_fe_uae_01.default.order_revenue_metrics"
VIEW_SOURCE = "amr_ali.sales.orders"
ORDERS = "main.s.orders"


def _inst(agent_ns, views=True):
    inst = object.__new__(agent_ns["DatabricksInspire"])
    inst.logger = CapturingLogger()
    inst.global_table_names = {ORDERS, VIEW}
    inst.data_category_map = {}
    inst.discovery_evidence = {"metric_views": [{"fqn": VIEW, "source": VIEW_SOURCE, "measures": []}]} if views else None
    return inst


def _schema():
    # The view's columns are listed like a table's: that is how a metric view reaches the validator and the grounding step.
    return [(*name.split("."), "c", "string", None) for name in (ORDERS, VIEW)]


def _row(no, tables):
    return {"No": no, "Name": f"Use case {no}", "Tables Involved": tables}


def test_a_metric_view_is_left_out_of_tables_involved_and_the_table_beside_it_is_kept(agent_ns):
    inst = _inst(agent_ns)
    rows = [_row("AI-01-U01", f"{ORDERS}, {VIEW}")]
    is_valid, dropped, kept = inst._validate_use_case_tables(rows, _schema(), "[Batch P1_1]")
    assert is_valid and not dropped
    assert [r["No"] for r in kept] == ["AI-01-U01"]
    assert kept[0]["Tables Involved"] == ORDERS, "the view is removed from the use case; the real table is its only table"


def test_a_use_case_whose_only_table_is_a_metric_view_is_rejected_with_a_reason(agent_ns):
    inst = _inst(agent_ns)
    is_valid, dropped, kept = inst._validate_use_case_tables([_row("AI-01-U02", VIEW)], _schema(), "[Batch P1_1]")
    assert not is_valid and not kept
    assert len(dropped) == 1
    assert "metric view" in dropped[0]["hallucination_reason"].lower()


def test_grounding_never_names_a_metric_views_source_and_drops_a_use_case_with_only_the_view(agent_ns):
    # The schema holds the view AND its source, so the old source injection had a verified source to name (the reported bug).
    inst = _inst(agent_ns)
    inst.global_table_names = {ORDERS, VIEW, VIEW_SOURCE}
    schema = _schema() + [(*VIEW_SOURCE.split("."), "c", "string", None)]
    view_only = _row("AI-01-U03", VIEW)
    mixed = _row("AI-01-U04", f"{VIEW}, {ORDERS}")
    kept, dropped = inst._phaseQ1_validate_grounding([view_only, mixed], schema)
    assert [uc["No"] for uc in kept] == ["AI-01-U04"]
    assert [(uc["No"], reason.split(":")[0]) for uc, reason in dropped] == [("AI-01-U03", "METRIC_VIEW_ONLY")]
    assert kept[0]["Tables Involved"] == ORDERS, "the view is left out and the real table stays the only table"
    assert all(VIEW_SOURCE not in uc["Tables Involved"] for uc in kept), "the view's source is never named in its place"


def test_the_metric_view_is_not_a_grounding_universe_table_even_when_it_is_listed(agent_ns):
    inst = _inst(agent_ns)
    kept, dropped = inst._phaseQ1_validate_grounding([_row("AI-01-U05", VIEW)], _schema())
    assert not kept and dropped and dropped[0][1].startswith("METRIC_VIEW_ONLY")
