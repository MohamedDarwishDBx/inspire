"""REQ-180: a metric view is never a use case's table. Its source table is not named in its place, so a use case cannot
name a primary table that is gone (amr_ali.sales.orders) or a metric view (adb_fe_uae_01.default.order_revenue_metrics)
in Tables Involved. The view can still sit in the schema listing because its columns are readable, so the validator
and the grounding step must both refuse it."""
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
    # The view's columns are listed like a table's: that is how a metric view reaches the validator.
    return [(*name.split("."), "c", "string", None) for name in (ORDERS, VIEW)]


def _row(no, tables):
    return {"No": no, "Name": f"Use case {no}", "Tables Involved": tables}


def test_a_metric_view_is_left_out_of_tables_involved_and_the_table_beside_it_is_kept(agent_ns):
    inst = _inst(agent_ns)
    rows = [_row("AI-01-U01", f"{ORDERS}, {VIEW}")]
    is_valid, dropped, kept = inst._validate_use_case_tables(rows, _schema(), "[Batch P1_1]")
    assert is_valid and not dropped
    assert [r["No"] for r in kept] == ["AI-01-U01"]
    assert kept[0]["Tables Involved"].split(", ")[0] == ORDERS, "the real table is the primary; the view stays a related source"


def test_a_use_case_whose_only_table_is_a_metric_view_is_rejected_with_a_reason(agent_ns):
    inst = _inst(agent_ns)
    is_valid, dropped, kept = inst._validate_use_case_tables([_row("AI-01-U02", VIEW)], _schema(), "[Batch P1_1]")
    assert not is_valid and not kept
    assert len(dropped) == 1
    assert "metric view" in dropped[0]["hallucination_reason"].lower()


def test_base_table_first_never_names_the_source_of_a_metric_view_it_has_not_verified(agent_ns):
    inst = _inst(agent_ns)
    assert inst._base_table_first([VIEW], "AI-01-U03") == [VIEW], "no verified source: the view is not replaced by a table nobody checked"
    assert inst._base_table_first([VIEW], "AI-01-U03", available={VIEW_SOURCE}) == [VIEW_SOURCE, VIEW], "a verified source is the primary"
    assert inst._base_table_first([VIEW], "AI-01-U03", available={"main.s.other"}) == [VIEW], "a source that is not in the universe is not named"
    assert inst._base_table_first([VIEW, ORDERS], "AI-01-U03") == [ORDERS, VIEW], "a real table is moved to the primary place"
