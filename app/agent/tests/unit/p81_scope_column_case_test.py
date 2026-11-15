"""P81 (REQ-284): a KPI or alignment that names a scoped column in another letter case is inside the Table Scope.

Unity Catalog and Spark resolve column names without regard to case, so `totalprice` is the scoped `totalPrice`.
The Discover run of 2026-11-15 (session 1794744601846819814) refused 8 of 14 use cases with
"the read uses totalprice, transactionid, which is outside the Table Scope", and the use cases kept placeholder KPIs.
A column that is really outside the scope must still be refused."""
import json

import pytest

TABLE = "inspire_kinds_rc7._inspire.sales_transactions"
DATABASE = "inspire_kinds_rc7._inspire"
SCOPE_COLUMNS = ["transactionID", "customerID", "product", "totalPrice"]


@pytest.fixture
def scoped(agent_ns):
    text = json.dumps({TABLE: {"columns": SCOPE_COLUMNS,
                               "rows": [{"column": "product", "op": "in", "values": ["Tokyo Tidbits"]}]}})
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](text, DATABASE))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def test_a_column_named_in_another_letter_case_is_inside_the_scope(scoped):
    scoped["assert_scope_columns"](TABLE, ["totalprice", "transactionid"])


def test_the_kpi_builder_accepts_a_scoped_column_written_in_lower_case(scoped):
    sql = scoped["DeepEvidence"].kpi_sql({"table": TABLE, "aggregation": "SUM", "column": "totalprice"})
    assert "totalPrice" in sql, "the scoped read projects the scope's own spelling of the column"


def test_a_column_really_outside_the_scope_is_still_refused(scoped):
    with pytest.raises(ValueError, match="outside the Table Scope"):
        scoped["assert_scope_columns"](TABLE, ["totalprice", "cardNumber"])
