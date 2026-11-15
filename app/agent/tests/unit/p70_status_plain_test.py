"""REQ-260: the status line says what happened in plain words. A raw Databricks error, a GRANT statement and "vN stays live" never reach it.

The status text comes from three places in the agent notebook: the failed-output warning (implement_status_error), the Lakebase warning
(implement_lakebase_fallback, with its grant listed in Permission Required) and the owner refusal (implement_settings_refusal).
"""
from customer_jargon_test import internal_hits

RAW = ("the columns of inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope__v9 could not be "
       "read: [TABLE_OR_VIEW_NOT_FOUND] The table or view `inspire_kinds_rc7`.`_inspire`.`inspire_kinds_rc7__inspire_sales_transactions__n01_u02"
       "__implement_scope__v9` cannot be found")
DENIED = "[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.s.orders"
GRANT_SQL = 'GRANT CREATE ON DATABASE databricks_postgres TO "b2b3b070-1da5-45c3-b5b6-81a2feaf85bb"'


def test_a_raw_missing_view_error_reads_as_plain_words(agent_ns):
    text = agent_ns["implement_status_error"](RAW)
    assert text == "a table it reads is not there now, so it cannot be built; press Try again", text  # one source: IMPLEMENT_TRY_AGAIN
    for bad in ("TABLE_OR_VIEW_NOT_FOUND", "[", "inspire_kinds_rc7", "__implement_scope", "__v9", "cannot be found", "GRANT", "stays live"):
        assert bad not in text, bad
    assert internal_hits(text) == []


def test_a_denied_read_points_to_permission_required_and_shows_no_grant(agent_ns):
    text = agent_ns["implement_status_error"](DENIED)
    assert "Permission Required" in text and "GRANT" not in text and "[" not in text and "main.s" not in text, text


def test_an_unknown_error_keeps_its_words_and_loses_its_code_table_and_grant(agent_ns):
    text = agent_ns["implement_status_error"]("[UNRESOLVED_COLUMN] zz cannot be resolved in main.s.orders. GRANT SELECT ON TABLE main.s.orders TO x")
    assert text and "UNRESOLVED_COLUMN" not in text and "main.s" not in text and "GRANT" not in text and "[" not in text, text


def test_the_lakebase_warning_shows_the_grant_only_in_permission_required(agent_ns):
    text = agent_ns["implement_lakebase_fallback"]("the App's service principal could not be given access to its Lakebase tables", GRANT_SQL)
    assert "GRANT" not in text and "Permission Required" in text, text
    assert internal_hits(text) == []


def test_an_owner_refusal_says_the_version_you_have_stays_as_it_is_not_a_version_number(agent_ns):
    text = agent_ns["implement_settings_refusal"]({"spec_version": 2}, "someone.else@example.com", 3)
    assert "stays live" not in text and "stays as it is" in text, text
