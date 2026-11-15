"""REQ-263 round 2: a Grouping column that holds one value inside the Launch scope makes one group, so it is refused before any Genie
round. The build reads the count inside the scope, the plan refuses a person's own column choice, and a recommended column is dropped
instead. The run-controls Grouping carries one_model, so a Grouping an owner sets on the Run page for a one-model kind is refused at
run time as well. Offline, on the real notebook functions (agent_ns) and the run-controls source Genie's notebook runs."""
import ast

import pandas as pd
import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import INSTRUCTION

CANDIDATES = ["product", "paymentMethod"]
TABLE = "inspire_kinds_rc7._inspire.sales_transactions"
ONE_VALUE_TEXT = "product has one value in this data, so it makes one group"


def test_a_chosen_column_with_one_value_in_scope_is_refused_with_the_reason(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", CANDIDATES, "product", "", [], "person", "", one_value=["product"])
    assert plan["applies"] is False and plan["problem"].startswith("group_by is 'product': "), plan
    assert ONE_VALUE_TEXT in plan["problem"] and "choose all, the whole data as one group" in plan["problem"], plan["problem"]


def test_a_chosen_column_with_several_values_is_not_refused(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", CANDIDATES, "product", "", [], "person", "", one_value=[])
    assert plan["applies"] is True and plan["columns"] == CANDIDATES and "problem" not in plan, plan


def test_a_recommended_column_with_one_value_is_dropped_not_refused(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", CANDIDATES, "", "", ["product", "paymentMethod"], "statistics", "",
                                               one_value=["product"])
    assert plan["applies"] is True and plan["default"] == "paymentMethod", plan
    assert "problem" not in plan


def test_the_build_counts_the_chosen_column_values_inside_the_scope_and_names_the_one_value_ones(agent_ns):
    def answer(statement):
        counts = {"product": 1, "paymentMethod": 4}
        for column, count in counts.items():
            if f"CAST(`{column}` AS STRING)" in statement or f"CAST({column} AS STRING)" in statement:
                return [{"distinct_values": count}]
        return [{"distinct_values": 0}]

    spark = FakeSpark(responder=answer)
    inst = build_inspire(agent_ns, spark=spark)
    assert inst._implement_one_value_columns("N04-U01", TABLE, {}, ["product", "paymentMethod"]) == ["product"]
    assert any("sales_transactions" in statement for statement in spark.statements), spark.statements


def test_a_one_model_grouping_is_carried_into_the_run_controls_and_refused_for_a_column_at_run_time(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Segmentation", ["customer_segment", "region"], "", "", ["region"], "statistics")
    assert plan["one_model"] is True and plan["default"] == "all", plan
    inst = build_inspire(agent_ns)
    uc = make_uc("N06-U02", **{"Analytics Technique": "Segmentation", "_implement_grouping": dict(plan)})
    source = inst._genie_run_controls_source(uc, inst._genie_notebook_spec(uc), INSTRUCTION)
    run = ast.literal_eval(source.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    assert run["grouping"]["one_model"] is True, run.get("grouping")
    agent_ns["INSPIRE_RUN"] = {"grouping": {"one_model": True, "columns": ["region"]}}
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](pd.DataFrame({"region": ["a", "b"], "x": [1, 2]}), group_by="region", out=lambda *_a: None)
    assert "one fitted model" in str(stopped.value) or "one registered model" in str(stopped.value), str(stopped.value)


def test_the_build_refuses_a_chosen_one_value_column_inside_the_grouping_step_before_any_genie_round(agent_ns):
    def answer(statement):
        return [{"distinct_values": 1 if "product" in statement and "COUNT(DISTINCT" in statement else 4}]

    inst = build_inspire(agent_ns, spark=FakeSpark(responder=answer))
    uc = make_uc("N04-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": TABLE, "Tables Involved": TABLE})
    spec = {"data": {}, "config": {"widgets": {"group_by": "product"}}, "outputs": {}}
    columns = [{"column_name": "product", "data_type": "string"}, {"column_name": "paymentMethod", "data_type": "string"}]
    plan = inst._implement_grouping(uc, spec, ("4242", "N04-U01"), {TABLE: columns})
    assert plan["applies"] is False and ONE_VALUE_TEXT in plan["problem"], plan
