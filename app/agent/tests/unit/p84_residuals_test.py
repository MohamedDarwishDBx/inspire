"""REQ-263 round 3, the two residuals of the one-value Grouping check.

(1) The build's count is retried once. A count that still fails is never a silent pass: the build names the Grouping columns it could
    not check, says so in plain words, and goes on knowingly. The run checks the same columns again before it scores a record.
(2) The run refuses a Grouping column that holds one value in the records, with the same wording as the build. A count that fails
    twice stops the run with the reason; it does not let the run through.
Offline, on the real notebook functions (agent_ns) and the build class, with a fake Spark."""
import pandas as pd
import pytest

from v120_artifacts_support import FakeSpark
from v120_genie_support import build_inspire, make_uc

TABLE = "inspire_kinds_rc7._inspire.sales_transactions"
ONE_VALUE_TEXT = "product has one value in this data, so it makes one group"


def test_a_count_that_fails_once_is_retried_and_answered(agent_ns):
    calls = []

    def count():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("warehouse busy")
        return 1

    assert agent_ns["inspire_retry_count"](count) == 1 and len(calls) == 2


def test_a_count_that_fails_twice_raises_and_is_never_a_pass(agent_ns):
    def count():
        raise RuntimeError("warehouse gone")

    with pytest.raises(RuntimeError, match="warehouse gone"):
        agent_ns["inspire_retry_count"](count)


def test_the_build_retries_a_failed_count_and_answers_it_on_the_second_try(agent_ns):
    seen = {"product": 0}

    def answer(statement):
        if "product" in statement and "COUNT(DISTINCT" in statement:
            seen["product"] += 1
            if seen["product"] == 1:
                raise RuntimeError("transient")
            return [{"distinct_values": 1}]
        return [{"distinct_values": 4}]

    inst = build_inspire(agent_ns, spark=FakeSpark(responder=answer))
    one, unchecked = inst._implement_one_value_columns("N04-U01", TABLE, {}, ["product", "paymentMethod"])
    assert (one, unchecked) == (["product"], []) and seen["product"] == 2


def test_a_count_that_still_fails_names_the_column_as_unchecked_and_the_plan_says_so(agent_ns):
    def answer(statement):
        if "product" in statement and "COUNT(DISTINCT" in statement:
            raise RuntimeError("warehouse gone")
        return [{"distinct_values": 4}]

    inst = build_inspire(agent_ns, spark=FakeSpark(responder=answer))
    one, unchecked = inst._implement_one_value_columns("N04-U01", TABLE, {}, ["product", "paymentMethod"])
    assert (one, unchecked) == ([], ["product"]), (one, unchecked)
    uc = make_uc("N04-U01", **{"Analytics Technique": "Anomaly Detection", "Primary Table": TABLE, "Tables Involved": TABLE})
    spec = {"data": {}, "config": {"widgets": {"group_by": "product"}}, "outputs": {}}
    columns = [{"column_name": "product", "data_type": "string"}, {"column_name": "paymentMethod", "data_type": "string"}]
    plan = inst._implement_grouping(uc, spec, ("4242", "N04-U01"), {TABLE: columns})
    assert plan["applies"] is True and plan["unchecked"] == ["product"], plan
    text = agent_ns["implement_grouping_unchecked_text"](plan["unchecked"])
    assert "product could not be checked for one value in this data" in text and "goes on" in text, text


def test_the_run_refuses_a_grouping_column_that_holds_one_value_with_the_build_wording(agent_ns):
    agent_ns["INSPIRE_RUN"] = {"grouping": {"columns": ["product", "paymentMethod"]}}
    frame = pd.DataFrame({"product": ["Tokyo Tidbits"] * 4, "paymentMethod": ["card", "cash", "card", "cash"], "x": [1, 2, 3, 4]})
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](frame, group_by="product", out=lambda *_a: None)
    shown = str(stopped.value)
    assert ONE_VALUE_TEXT in shown and "choose all, the whole data as one group" in shown, shown
    assert "scored any record" in shown, shown


def test_the_run_lets_a_column_with_several_values_through(agent_ns):
    agent_ns["INSPIRE_RUN"] = {"grouping": {"columns": ["paymentMethod"]}}
    frame = pd.DataFrame({"paymentMethod": ["card", "cash", "card", "cash"], "x": [1, 2, 3, 4]})
    grouped = agent_ns["inspire_group_records"](frame, group_by="paymentMethod", out=lambda *_a: None)
    assert "inspire_group" in grouped.columns


def test_a_run_count_that_fails_twice_stops_the_run_with_the_reason(agent_ns, monkeypatch):
    agent_ns["INSPIRE_RUN"] = {"grouping": {"columns": ["paymentMethod"]}}

    def broken(frame, column, spark_frame):
        raise RuntimeError("warehouse gone")

    monkeypatch.setitem(agent_ns, "inspire_group_distinct_values", broken)
    frame = pd.DataFrame({"paymentMethod": ["card", "cash"], "x": [1, 2]})
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](frame, group_by="paymentMethod", out=lambda *_a: None)
    assert "could not be checked for one value" in str(stopped.value) and "warehouse gone" in str(stopped.value), str(stopped.value)


def test_a_nested_grouping_with_a_coarse_column_of_one_value_is_not_refused_at_build(agent_ns):
    plan = agent_ns["implement_grouping_plan"]("Anomaly Detection", ["region", "country"], "region, country", "", [], "person", "",
                                               one_value=["region"])
    assert plan["applies"] is True and plan["columns"] == ["region", "country"] and "problem" not in plan, plan


def test_a_nested_grouping_with_a_coarse_column_of_one_value_is_not_refused_at_run(agent_ns):
    agent_ns["INSPIRE_RUN"] = {"grouping": {"columns": ["region", "country"]}}
    frame = pd.DataFrame({"region": ["EMEA"] * 80, "country": ["France"] * 40 + ["Spain"] * 40, "x": range(80)})
    grouped = agent_ns["inspire_group_records"](frame, group_by="region, country", out=lambda *_a: None)
    assert sorted(set(grouped["inspire_group"])) == ["EMEA / France", "EMEA / Spain"], set(grouped["inspire_group"])
