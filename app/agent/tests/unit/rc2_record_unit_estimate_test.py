"""REQ-306: an estimate tag or a table path never becomes the unit of a money or value-at-stake figure."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from v141_app_shell_test import shell_sql  # noqa: E402

TAG = "[estimate: depends on inspire_01._inspire.bakehouse__sales_transactions]"


def test_an_estimate_currency_on_a_count_stake_is_never_its_unit():
    assert shell_sql.impact_of({"currency": TAG, "impact_kind": ""}) == {"kind": "number", "unit": ""}
    assert shell_sql.impact_of({"currency": TAG}) == {"kind": "number", "unit": ""}


def test_an_estimate_impact_unit_is_dropped_and_a_plain_unit_stays():
    assert shell_sql.impact_of({"impact_kind": "hours", "impact_unit": TAG}) == {"kind": "hours", "unit": ""}
    assert shell_sql.impact_of({"impact_kind": "hours", "impact_unit": "hours"}) == {"kind": "hours", "unit": "hours"}
    assert shell_sql.impact_of({"impact_kind": "number", "impact_unit": "main.sales.orders"}) == {"kind": "number", "unit": ""}


def test_money_keeps_its_iso_code_and_drops_a_non_code():
    assert shell_sql.impact_of({"impact_kind": "money", "currency": "USD"}) == {"kind": "money", "unit": "USD"}
    assert shell_sql.impact_of({"impact_kind": "money", "currency": TAG}) == {"kind": "money", "unit": ""}
    assert shell_sql.impact_of({"currency": "USD"}) == {"kind": "money", "unit": "USD"}


def test_plain_unit_rejects_brackets_tables_and_long_sentences():
    assert shell_sql.plain_unit("units") == "units"
    assert shell_sql.plain_unit("(estimate: x)") == ""
    assert shell_sql.plain_unit("a.b.c") == ""
    assert shell_sql.plain_unit("x" * 25) == ""
    assert shell_sql.plain_unit(None) == ""
