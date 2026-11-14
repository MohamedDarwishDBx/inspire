"""REQ-193 (live, rc7 N06-U02 segmentation built with the wizard defaults): the Grouping the plan recommended became the group_by default
(REQ-183), so a segmentation build fitted one model per group, and family C registers one model per use case. The preview failed with
"requires one fitted model per inspire_group". Only segmentation (family C) is proven to fail per group, so only C defaults to the whole
data and refuses a per-group Grouping when the build starts; the run also refuses a column Grouping at run time. Anomaly (B) runs per
group live, so its planned Grouping keeps applying (must-exclude). Offline, on the real notebook functions and the kinds.json registry."""
import json
import os

import pytest

from v120_genie_support import build_inspire, make_uc

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = os.path.join(HERE, "..", "..", "agent", "app_shell", "kinds.json")
ONE_MODEL_TECHNIQUES = {"Clustering", "Segmentation"}
PER_GROUP_TECHNIQUES = ["Anomaly Detection", "Predictive Modeling", "Forecasting", "Peer Benchmarking", "Trend Analysis",
                        "Threshold Optimization", "Statistical Process Control"]
CANDIDATES = ["customer_segment", "region"]


def _kinds():
    with open(KINDS, encoding="utf-8") as handle:
        return json.load(handle)


def test_the_n06_u02_segmentation_defaults_to_the_whole_data_even_when_a_grouping_was_recommended(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Segmentation", CANDIDATES, "", "", ["region"], "statistics")
    assert (plan["applies"], plan["default"], plan["columns"], plan["one_model"]) == (True, "all", CANDIDATES, True)
    assert plan["chosen_by"] == "default"


def test_the_n06_u02_defaults_produce_a_spec_whose_group_by_widget_reads_all(agent_ns):
    inst = build_inspire(agent_ns)
    plan = agent_ns["implement_grouping_plan"]("Segmentation", CANDIDATES, "", "", ["region"], "statistics")
    uc = make_uc("N06-U02", **{"Analytics Technique": "Segmentation", "_implement_grouping": dict(plan)})
    widgets = {w["name"]: w.get("default") for w in inst._genie_core_widgets(inst._genie_notebook_spec(uc))}
    assert widgets.get("group_by") == "all", widgets
    assert "problem" not in plan


@pytest.mark.parametrize("technique", PER_GROUP_TECHNIQUES)
def test_must_exclude_a_kind_that_runs_per_group_keeps_its_planned_grouping_anomaly_included(agent_ns, technique):
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
    plan = agent_ns["implement_grouping_plan"]("Segmentation", CANDIDATES, "all", "", ["region"], "person")
    assert (plan["applies"], plan["default"], plan["columns"], plan.get("problem")) == (True, "all", CANDIDATES, None)


def test_a_per_group_anomaly_grouping_builds_as_planned_by_the_person(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", CANDIDATES, "customer_segment", "", [], "person")
    assert (plan["applies"], plan["default"], plan.get("problem")) == (True, "customer_segment", None)


def test_the_run_refuses_a_column_grouping_for_a_one_model_kind_before_it_fits_anything(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"grouping": {"one_model": True}})
    with pytest.raises(agent_ns["InspireRunStop"]) as refused:
        agent_ns["inspire_group_records"](None, group_by="region")
    assert "fits one model across all of the data" in str(refused.value)


def test_the_run_still_reads_all_for_a_one_model_kind(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_RUN", {"grouping": {"one_model": True}})
    with pytest.raises(TypeError):  # past the guard: frame None is the only stop
        agent_ns["inspire_group_records"](None, group_by="all")


def test_the_build_instruction_for_a_one_model_kind_fits_one_model_and_never_one_per_group(agent_ns):
    rule = agent_ns["genie_grouping_rule"]({"one_model": True, "columns": ["customer_segment"]})
    assert "Fit ONE model on every record" in rule and "never fit one model per group" in rule
    assert "one baseline or model per group" not in rule
    assert "one baseline or model per group" in agent_ns["genie_grouping_rule"]({"columns": ["region"]})


def test_the_sweep_only_segmentation_family_c_techniques_default_to_the_whole_data(agent_ns):
    kinds = _kinds()["kinds"]
    swept = {k["id"]: sorted(t for t in k["techniques"] if agent_ns["inspire_grouping_fits_one_model"](t)) for k in kinds}
    assert {k: v for k, v in swept.items() if v} == {
        "segmentation": ["Clustering", "Segmentation"],
        "cost_to_serve": ["Segmentation"],
        "peer_benchmarking": ["Clustering"],
    }


def test_the_kinds_json_one_model_families_are_the_notebook_registry(agent_ns):
    assert _kinds()["one_model_families"] == list(agent_ns["INSPIRE_ONE_MODEL_FAMILIES"]) == ["C"]


def test_a_generated_notebook_run_start_guard_refuses_a_column_for_a_one_model_kind_with_only_its_inlined_sources(agent_ns):
    from v207_app_reads_after_build_test import _inlined
    notebook = {"__name__": "generated"}
    exec(compile(_inlined(agent_ns), "<generated>", "exec"), notebook)
    notebook["INSPIRE_RUN"] = {"grouping": {"one_model": True}}
    with pytest.raises(notebook["InspireRunStop"]) as refused:
        notebook["inspire_group_records"](None, group_by="region")
    assert "fits one model across all of the data" in str(refused.value)
    notebook["INSPIRE_RUN"] = {"grouping": {"one_model": False}}
    with pytest.raises(TypeError):
        notebook["inspire_group_records"](None, group_by="region")
