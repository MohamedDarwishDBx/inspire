"""REQ-183 (live walk of 9c54b8c83, N01-U02, rebuild run 9000000000000001): three defects in one rebuild.

1. A Genie Agent built with a Table Scope is saved holding the scope view, and a replay re-checks the saved space against the
   use case's base tables, so the view is refused ("the Genie Agent uses table <view>, which is outside this use case").
2. The status part that reports it is cut at 160 characters, so the table name is the part that disappears.
3. A grouping proof run (group_by overridden to a column) recorded "all": an App-held Grouping row applied after the job
   parameter, so the proof run did not follow the Grouping it was sent.
Offline: the notebook namespace is loaded by _agentload; the App-held setting path runs through its real assumptions reader."""
import json

from rc14_space_sql_scope_test import TABLE, _scopes
from v120_artifacts_support import FakeSpark

OTHER = "main.s.customers"
LONG_VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope"


def _built_space(agent_ns, scopes):
    """A space as the build saves it: normalized over the base tables, then renamed to the Table Scope view."""
    space = {"title": "Orders", "data_sources": {"tables": [{"identifier": TABLE, "column_configs": [{"column_name": "order_id"}]}]},
             "config": {"sample_questions": [{"id": "a" * 32, "question": ["How many orders?"]}]}, "instructions": {},
             "benchmarks": {"questions": []}}
    normalized = agent_ns["normalize_genie_space"](json.dumps(space), [TABLE])[2]
    return agent_ns["scope_genie_space"](normalized, FakeSpark(), scopes)


def test_a_replayed_scoped_space_is_checked_against_its_use_case_tables_and_their_scope_views(agent_ns):
    scopes = _scopes(agent_ns)
    saved = _built_space(agent_ns, scopes)
    view = saved["data_sources"]["tables"][0]["identifier"]
    assert view != TABLE, "the build renamed the table to its Table Scope view"
    allowed = agent_ns["implement_genie_allowed"]([TABLE], scopes)
    assert view in allowed and TABLE in allowed
    errors = agent_ns["normalize_genie_space"](json.dumps(saved), allowed)[3]
    assert errors == [], f"a replay of the saved space must pass the same check as the build: {errors}"


def test_the_replay_check_still_refuses_a_table_outside_the_use_case_even_through_a_view(agent_ns):
    scopes = _scopes(agent_ns)
    saved = _built_space(agent_ns, scopes)
    view = saved["data_sources"]["tables"][0]["identifier"]
    allowed = agent_ns["implement_genie_allowed"]([OTHER], scopes)
    assert view not in allowed, "the scope view of a table the use case does not read is not an allowed table"
    errors = agent_ns["normalize_genie_space"](json.dumps(saved), allowed)[3]
    assert any(f"uses table {view}, which is outside this use case" in e for e in errors), errors


def test_a_status_reason_keeps_the_table_name_it_refuses(agent_ns):
    reason = ("the v2 Genie Agent no longer passes its checks against the current tables: the Genie Agent uses table "
              f"{LONG_VIEW}, which is outside this use case")
    short = agent_ns["implement_short_reason"](reason)
    assert LONG_VIEW in short, short
    assert len(short) <= agent_ns["IMPLEMENT_SHORT_REASON_CHARS"] + 4


def test_a_long_spark_error_keeps_the_table_it_names(agent_ns):
    lead = "Spark could not resolve the relation that the use case reads from the Table Scope of its primary table in the workspace, " * 2
    raw = (f"INTERNAL_ERROR: {lead}named `inspire_kinds_rc7`.`_inspire`.`inspire_kinds_rc7__inspire_sales_transactions__"
           "n01_u02__implement_scope`. JVM stacktrace follows: at org.apache.spark.sql.Dataset.collect(Dataset.scala:1)")
    brief = agent_ns["implement_brief_error"](raw)
    assert "inspire_kinds_rc7__inspire_sales_transactions__n01_u02__implement_scope" in brief, brief


def test_a_grouping_proof_run_keeps_the_grouping_it_was_sent_over_an_app_held_grouping(agent_ns, monkeypatch):
    setting = {"name": "group_by", "kind": "choice", "choices": ["paymentMethod"], "many": True, "solo": ["all"], "default": "all"}
    rows = [{"name": "group_by", "value": None, "text_value": "all", "changed_by": "amr", "changed_at": "2026-11-14T07:00:00"}]

    def respond(statement):
        return rows if "ROW_NUMBER() OVER (PARTITION BY name" in statement else []

    def run_with(mark):
        ns = agent_ns
        monkeypatch.setitem(ns, "inspire_widget", lambda name, default="": mark if name == ns["INSPIRE_GROUP_PROOF_MARK"] else default)
        scope = {"INSPIRE_RUN": {"settings": [setting], "settings_read": True}, "group_by": "paymentMethod"}
        ns["inspire_apply_assumptions"](FakeSpark(responder=respond), "main.s.sales_out", "N01-U02", scope=scope, out=lambda m: None)
        return scope.get("INSPIRE_SETTINGS_APPLIED", {})

    assert run_with("1") == {}, "a proof run must not take the App's Grouping over the one it was sent"
    assert run_with("") == {"group_by": "all"}, "a scheduled run still applies the Grouping the App holds"
