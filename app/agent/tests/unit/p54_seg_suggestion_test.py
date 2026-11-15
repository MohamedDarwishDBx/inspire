"""P54 (REQ-193, generation time): a segmentation use case gets no suggested Grouping (deep_grouping_suggestion), because a per-group fit
of a family C or segmentation-kind use case needs one registered model per group. Anomaly keeps its suggestion (must-exclude).
Fail-pre on 62698898b: Clustering with no kind returns a suggestion there, and the kind argument does not exist there (TypeError)."""
import pytest

TABLE = "main.sales.orders"
PROFILES = {TABLE: {"rows": 5000, "columns": {"payment_method": {
    "type_family": "string", "null_share": 0.0, "distinct": 3,
    "top_values": [{"value": "visa", "share": 0.4}, {"value": "amex", "share": 0.35}, {"value": "mastercard", "share": 0.25}]}}}}


def _suggest(agent_ns, technique, **kwargs):
    return agent_ns["deep_grouping_suggestion"](technique, TABLE, PROFILES, **kwargs)


@pytest.mark.parametrize("technique", ["Clustering", "Segmentation"])
def test_p54_a_family_c_technique_gets_no_suggested_grouping_at_generation(agent_ns, technique):
    assert _suggest(agent_ns, technique) is None


@pytest.mark.parametrize("technique", ["Clustering", "K-means", "RFM"])
def test_p54_a_segmentation_kind_gets_no_suggested_grouping_at_generation_whatever_the_technique(agent_ns, technique):
    assert _suggest(agent_ns, technique, kind="segmentation") is None


def test_p54_must_exclude_an_anomaly_use_case_keeps_its_suggested_grouping(agent_ns):
    found = _suggest(agent_ns, "Anomaly Detection")
    assert found is not None and found["group_by"] == ["payment_method"]


def test_p54_must_exclude_an_anomaly_kind_keeps_its_suggested_grouping(agent_ns):
    found = _suggest(agent_ns, "Anomaly Detection", kind="anomaly")
    assert found is not None and found["group_by"] == ["payment_method"]
