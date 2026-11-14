"""REQ-193 (live, rc7 N06-U02 segmentation built with the wizard defaults): the Grouping the plan recommended became the group_by default
(REQ-183), so the build fitted one model per group, and the kind's family registers one model per use case. The preview failed with
"requires one fitted model per inspire_group". A kind whose family registers one model now defaults to the whole data as one group,
and a per-group Grouping for it is refused when the build starts, with the reason. Offline, on the real notebook functions and the
kinds.json registry."""
import json
import os

import pytest

from v120_genie_support import build_inspire, make_uc

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = os.path.join(HERE, "..", "..", "agent", "app_shell", "kinds.json")
ONE_MODEL_TECHNIQUES = {"Predictive Modeling", "Anomaly Detection", "Clustering", "Segmentation"}
CANDIDATES = ["customer_segment", "region"]


def _kinds():
    with open(KINDS, encoding="utf-8") as handle:
        return json.load(handle)


def test_the_segmentation_wizard_defaults_to_the_whole_data_even_when_a_grouping_was_recommended(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Segmentation", CANDIDATES, "", "", ["region"], "statistics")
    assert (plan["applies"], plan["default"], plan["columns"], plan["one_model"]) == (True, "all", CANDIDATES, True)
    assert plan["chosen_by"] == "default"


def test_the_n06_u02_defaults_produce_a_spec_whose_group_by_widget_reads_all(agent_ns):
    inst = build_inspire(agent_ns)
    plan = agent_ns["implement_grouping_plan"]("Segmentation", CANDIDATES, "", "", ["region"], "statistics")
    uc = make_uc("N06-U02", **{"Analytics Technique": "Segmentation", "_implement_grouping": dict(plan)})
    spec = inst._genie_notebook_spec(uc)
    widgets = {w["name"]: w.get("default") for w in inst._genie_core_widgets(spec)}
    assert widgets.get("group_by") == "all", widgets
    assert "problem" not in plan


@pytest.mark.parametrize("technique", ["Forecasting", "Peer Benchmarking", "Trend Analysis", "Threshold Optimization", "Statistical Process Control"])
def test_a_kind_that_fits_a_model_per_group_keeps_its_planned_grouping(agent_ns, technique):
    plan = agent_ns["implement_grouping_plan"](technique, CANDIDATES, "", "", ["region"], "statistics")
    assert (plan["applies"], plan["default"], bool(plan.get("one_model"))) == (True, "region", False), technique
    assert plan["chosen_by"] == "statistics"


@pytest.mark.parametrize("technique", sorted(ONE_MODEL_TECHNIQUES))
def test_a_per_group_grouping_is_refused_up_front_with_the_reason_for_a_one_model_kind(agent_ns, technique):
    plan = agent_ns["implement_grouping_plan"](technique, CANDIDATES, "region", "", [], "person")
    assert plan["applies"] is False and plan["one_model"] is True
    assert plan["problem"].startswith("group_by is 'region': this use case fits one model across all of the data")
    assert "one registered model per group" in plan["problem"]


def test_choosing_all_for_a_one_model_kind_builds_and_a_person_choice_of_all_is_kept(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", CANDIDATES, "all", "", ["region"], "person")
    assert (plan["applies"], plan["default"], plan["columns"], plan.get("problem")) == (True, "all", CANDIDATES, None)


def test_the_one_model_kinds_are_exactly_the_model_families_whose_technique_works_in_groups(agent_ns):
    table = agent_ns["INSPIRE_TECHNIQUE_RECORDS"] or agent_ns["INSPIRE_TECHNIQUE_RECORDS_LOADER"]()
    model_families = set(agent_ns["INSPIRE_MODEL_FAMILIES"])
    got = {t for t in agent_ns["TECHNIQUE_EXECUTION_FAMILY"] if agent_ns["inspire_grouping_fits_one_model"](t)}
    grouped_model = {t for t, family in agent_ns["TECHNIQUE_EXECUTION_FAMILY"].items()
                     if table.get(t) == "groups" and family in model_families}
    assert got == grouped_model == ONE_MODEL_TECHNIQUES


def test_the_sweep_every_kind_with_a_one_model_technique_is_the_defaulted_one(agent_ns):
    kinds = _kinds()["kinds"]
    swept = {k["id"]: sorted(t for t in k["techniques"] if agent_ns["inspire_grouping_fits_one_model"](t)) for k in kinds}
    assert {k: v for k, v in swept.items() if v} == {
        "risk_propensity": ["Predictive Modeling"],
        "anomaly": ["Anomaly Detection"],
        "segmentation": ["Clustering", "Segmentation"],
        "leakage_reconciliation": ["Anomaly Detection"],
        "cost_to_serve": ["Segmentation"],
        "peer_benchmarking": ["Clustering"],
    }


def test_the_kinds_json_model_families_are_the_notebook_registry(agent_ns):
    assert _kinds()["model_families"] == list(agent_ns["INSPIRE_MODEL_FAMILIES"])
