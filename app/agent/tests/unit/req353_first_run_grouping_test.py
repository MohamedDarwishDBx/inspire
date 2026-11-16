"""REQ-353: a First run that keeps only some groups of a Grouping column must not make that Grouping one value.

The wizard counts a Grouping column over the Launch scope (the Data Filters). A First run then narrows the records (for example to
the one smallest whole group of the column), and the one-value check used to read those narrowed records, so a column with three
values in scope read as one value and the preview refused the build. The check now reads the Launch scope, the same count the wizard
made. A refusal names the column, and the name is schema, so the run's stop reason keeps it instead of a redaction placeholder.
Offline, on the real notebook functions (agent_ns); the Launch count goes through a fake Spark session."""
import pandas as pd
import pytest

from v120_artifacts_support import FakeSpark

TABLE = "main.sales.transactions"
ONE_VALUE_TEXT = "paymentMethod has one value in this data, so it makes one group"
PLACEHOLDER = "a data value"
FIRST_RUN = pd.DataFrame({"paymentMethod": ["visa"] * 4, "amount": [1, 2, 3, 4]})


def _launch(distinct):
    def answer(statement):
        if "COUNT(DISTINCT" in statement and "paymentMethod" in statement:
            return [{"inspire_values": distinct}]
        return []
    return FakeSpark(responder=answer)


def _restricted_first_run(agent_ns):
    agent_ns["INSPIRE_SCOPE"] = {"scope": "records", "table": TABLE, "column": "paymentMethod", "whole_groups": True,
                                 "values": ["visa"]}


def test_a_first_run_that_keeps_one_group_is_not_refused_when_the_launch_scope_holds_several(agent_ns):
    _restricted_first_run(agent_ns)
    spark = _launch(3)
    agent_ns["inspire_group_records"](FIRST_RUN.copy(), group_by="paymentMethod", out=lambda *_a: None, spark_session=spark)
    assert agent_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["paymentMethod"], agent_ns["INSPIRE_RUN_GROUPING"]
    assert any("COUNT(DISTINCT" in s and "paymentMethod" in s and "transactions" in s for s in spark.statements), spark.statements


def test_a_grouping_with_one_value_in_the_launch_scope_is_refused_with_the_column_name_shown(agent_ns):
    _restricted_first_run(agent_ns)
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](FIRST_RUN.copy(), group_by="paymentMethod", out=lambda *_a: None, spark_session=_launch(1))
    shown = agent_ns["inspire_error_line"](stopped.value)
    assert ONE_VALUE_TEXT in shown and "choose all, the whole data as one group" in shown, shown
    assert PLACEHOLDER not in shown, shown


def test_without_a_first_run_the_records_are_the_launch_scope_and_one_value_is_still_refused(agent_ns):
    agent_ns["INSPIRE_SCOPE"] = {"scope": "all", "table": TABLE}
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](FIRST_RUN.copy(), group_by="paymentMethod", out=lambda *_a: None)
    shown = agent_ns["inspire_error_line"](stopped.value)
    assert ONE_VALUE_TEXT in shown and PLACEHOLDER not in shown, shown


def test_a_launch_count_that_fails_twice_stops_the_run_instead_of_reading_the_first_run(agent_ns):
    _restricted_first_run(agent_ns)

    def broken(statement):
        raise RuntimeError("warehouse unavailable")

    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](FIRST_RUN.copy(), group_by="paymentMethod", out=lambda *_a: None,
                                          spark_session=FakeSpark(responder=broken))
    shown = agent_ns["inspire_error_line"](stopped.value)
    assert "could not be checked for one value in this data" in shown and ONE_VALUE_TEXT not in shown, shown


JOIN = {"table": "main.sales.customers", "key": "customer_id", "ref_column": "customer_id"}
JOINED_RECORDS = pd.DataFrame({"customer_id": [1, 2, 3, 4], "amount": [10, 20, 30, 40]})


def _joined_first_run(agent_ns, monkeypatch, segments):
    _restricted_first_run(agent_ns)
    agent_ns["INSPIRE_RUN"] = {"grouping": {"joins": {"customers.segment": JOIN}}}

    def join(frame, wanted, out=print, spark_session=None, run=None):
        return frame.assign(segment=segments[: len(frame)])

    monkeypatch.setitem(agent_ns, "inspire_group_joined", join)


def _joined_launch(distinct):
    def answer(statement):
        if "COUNT(DISTINCT" in statement and "LEFT JOIN" in statement and "customers" in statement:
            return [{"inspire_values": distinct}]
        return []
    return FakeSpark(responder=answer)


def test_a_joined_grouping_column_is_counted_in_the_launch_scope_under_a_first_run(agent_ns, monkeypatch):
    _joined_first_run(agent_ns, monkeypatch, ["gold", "silver", "bronze", "gold"])
    spark = _joined_launch(3)
    agent_ns["inspire_group_records"](JOINED_RECORDS.copy(), group_by="customers.segment", out=lambda *_a: None, spark_session=spark)
    assert agent_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["segment"], agent_ns["INSPIRE_RUN_GROUPING"]
    assert any("LEFT JOIN" in s and "customers" in s for s in spark.statements), spark.statements


def test_a_joined_grouping_with_one_value_in_the_launch_scope_is_still_refused(agent_ns, monkeypatch):
    _joined_first_run(agent_ns, monkeypatch, ["gold"] * 4)
    with pytest.raises(agent_ns["InspireRunStop"]) as stopped:
        agent_ns["inspire_group_records"](JOINED_RECORDS.copy(), group_by="customers.segment", out=lambda *_a: None,
                                          spark_session=_joined_launch(1))
    shown = agent_ns["inspire_error_line"](stopped.value)
    assert "segment has one value in this data, so it makes one group" in shown and PLACEHOLDER not in shown, shown
