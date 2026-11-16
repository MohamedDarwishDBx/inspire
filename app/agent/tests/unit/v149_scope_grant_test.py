"""REQ-150: the build grants the MVP App's principal USE CATALOG, USE SCHEMA and SELECT on each scope view it reads, in that order."""
import time

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import _inspire

VIEW = "main.inspire.churn_out_scope"
REASONS = "main.inspire.churn_out_reasons"
SELECT_VIEW = "GRANT SELECT ON TABLE `main`.`inspire`.`churn_out_scope` TO `sp-1`"


class Recorder:
    """Records every statement; a statement that starts with a key of `refused` raises that key's error, as the workspace would."""

    def __init__(self, refused=None):
        self.statements, self.refused = [], dict(refused or {})

    def sql(self, statement, *args, **kwargs):
        text = " ".join(str(statement).split())
        self.statements.append(text)
        for marker, error in self.refused.items():
            if text.startswith(marker):
                raise error


def _app(ns, spark):
    inst = _inspire(ns, spark)
    inst.logger = CapturingLogger()
    return inst


def test_scope_view_grant_gives_use_catalog_then_use_schema_then_select_on_the_view_only(agent_ns):
    spark = Recorder()
    assert _app(agent_ns, spark)._implement_app_principal_grants("sp-1", [VIEW], "") == []
    assert spark.statements[:3] == ["GRANT USE CATALOG ON CATALOG `main` TO `sp-1`",
                                    "GRANT USE SCHEMA ON SCHEMA `main`.`inspire` TO `sp-1`", SELECT_VIEW], \
        "USE CATALOG, then USE SCHEMA, then SELECT on the scope view"
    assert all("churn_out" not in s or "churn_out_scope" in s for s in spark.statements), \
        "the scope loop never grants on the unfiltered base table"


def test_a_denied_scope_view_select_is_returned_once_with_its_exact_statement_and_a_held_use_grant_is_not_a_failure(agent_ns):
    spark = Recorder({"GRANT USE CATALOG": RuntimeError("already held through the account"),
                      SELECT_VIEW: RuntimeError("PERMISSION_DENIED: no SELECT")})
    inst = _app(agent_ns, spark)
    denied = inst._implement_app_principal_grants("sp-1", [VIEW], "")
    assert denied == [SELECT_VIEW], "the failed SELECT is listed as its exact statement; a USE that fails is never a failure"
    assert any(k == "INFO" and "GRANT USE CATALOG" in m and "was not needed" in m for k, m in inst.logger.records)
    assert not any("GRANT USE" in d for d in denied)
    twice = inst._implement_app_principal_grants("sp-1", [VIEW, VIEW], "")
    assert "; ".join(dict.fromkeys(twice)) == SELECT_VIEW, "the caller lists each denied statement once"


def test_a_select_that_runs_on_a_scope_view_is_handed_back_for_the_principal_and_a_use_grant_is_not(agent_ns):
    ran = []
    _app(agent_ns, Recorder())._implement_app_principal_grants("sp-1", [VIEW], REASONS, ran)
    assert [(g["privilege"], g["table"]) for g in ran] == [
        ("SELECT", VIEW), ("READ METADATA", VIEW), ("SELECT", REASONS), ("READ METADATA", REASONS)], \
        "every table-level grant that ran is handed back so an undo can revoke it; USE may have been held before the build"


def test_a_source_table_whose_columns_cannot_be_read_is_named_with_that_cause_and_the_next_action_not_a_table_scope(agent_ns):
    text = agent_ns["implement_app_raw_block"](["main.inspire.src"], ["main.inspire.src"])
    assert "could not read the columns of main.inspire.src" in text, "the unreadable cause gets its own sentence"
    assert "Make sure each table exists and the build can read its columns" in text
    assert agent_ns["inspire_rebuild_action"]("the App") in text, "the rebuild wording comes from the one shared source"
    assert "Data Filters" not in text, "a Table Scope cannot give a table readable columns, so the reason never sends people to one"


def test_a_source_table_the_build_can_read_is_sent_to_table_filters_in_data_and_results_and_is_not_called_unreadable(agent_ns):
    text = agent_ns["implement_app_raw_block"](["main.inspire.src"], [])
    assert "Add each one under Table filters or Column roles in Data & results, which Open all settings on the Build page opens" in text
    assert "could not read" not in text


def test_a_refusal_with_both_causes_names_each_table_under_its_own_cause(agent_ns):
    text = agent_ns["implement_app_raw_block"](["main.inspire.a", "main.inspire.b"], ["main.inspire.b"])
    assert "could not read the columns of main.inspire.b" in text
    assert "still read main.inspire.a directly" in text
    assert "could not read the columns of main.inspire.a" not in text


def test_the_value_ledger_grant_to_a_shared_principal_is_handed_back_and_a_per_user_build_grants_nothing(agent_ns):
    ran = []
    _app(agent_ns, Recorder())._implement_ledger_access("main.inspire", "sp-1", ran)
    table = agent_ns["inspire_shell_facts"].ledger_table("main.inspire")
    assert [(g["privilege"], g["table"]) for g in ran] == [("SELECT", table), ("MODIFY", table)], \
        "every ledger grant that ran is handed back, so an undo can take it back"
    assert agent_ns["implement_revoke_sql"](ran[1], "sp-1") == f"REVOKE MODIFY ON TABLE {table} FROM `sp-1`"
    per_user = []
    _app(agent_ns, Recorder())._implement_ledger_access("main.inspire", "", per_user)
    assert per_user == [], "a per-user App has no service principal, so nothing is granted or handed back"


def test_a_ledger_grant_that_is_refused_is_not_handed_back_and_stops_the_build(agent_ns):
    ran = []
    spark = Recorder({"GRANT MODIFY": RuntimeError("PERMISSION_DENIED: no MODIFY")})
    with pytest.raises(agent_ns["ImplementBlocked"], match="could not get MODIFY on the value ledger"):
        _app(agent_ns, spark)._implement_ledger_access("main.inspire", "sp-1", ran)
    assert [g["privilege"] for g in ran] == ["SELECT"], "only the grant that ran is recorded"


def test_a_transient_scope_grant_error_is_retried_as_the_other_grant_paths_retry_it_and_a_permanent_one_is_not(agent_ns, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda seconds: None)
    transient = RuntimeError("429 Too Many Requests: rate limit exceeded")
    permanent = RuntimeError("PERMISSION_DENIED: no SELECT")
    assert agent_ns["implement_transient"](transient) and not agent_ns["implement_transient"](permanent), "the premise of both checks"

    class Flaky(Recorder):
        def __init__(self, errors):
            super().__init__()
            self.errors = list(errors)

        def sql(self, statement, *args, **kwargs):
            text = " ".join(str(statement).split())
            if text == SELECT_VIEW and self.errors:
                self.statements.append(text)
                raise self.errors.pop(0)
            return super().sql(statement, *args, **kwargs)

    once = Flaky([transient])
    assert _app(agent_ns, once)._implement_app_principal_grants("sp-1", [VIEW], "") == [], "a transient refusal is retried and then runs"
    assert once.statements.count(SELECT_VIEW) == 2

    forever = Flaky([permanent] * 5)
    assert _app(agent_ns, forever)._implement_app_principal_grants("sp-1", [VIEW], "") == [SELECT_VIEW]
    assert forever.statements.count(SELECT_VIEW) == 1, "a permanent refusal is raised at once, with no retry"
