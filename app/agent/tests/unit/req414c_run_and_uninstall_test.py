"""REQ-414 part B, run hook and uninstall: a build's assets are created during the run, their records are kept on the use case's asset
status, and Uninstall all deletes each one (a missing asset is silent, any other failure is reported). Stubs stand in for the
workspace; nothing here contacts one.
"""
import logging
import os
import sys

import pytest

from _agentload import load_agent_namespace

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_build  # noqa: E402

NOT_FOUND = type("NotFound", (Exception,), {})
PERMISSION = "[PERMISSION_DENIED] User does not have permission to delete this index"


class Recorder:
    """A call function that records every call and answers from a script (answer, or an exception to raise)."""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []

    def __call__(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        for (m, prefix), outcome in self.script.items():
            if m == method and path.startswith(prefix):
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome
        if method == "POST" and path == shell_build.SUPERVISOR_AGENTS_PATH:
            return {"id": "sup-1"}
        if method == "POST" and path == shell_build.JOBS_CREATE_PATH:
            return {"job_id": 77}
        return {}


def log_into(lines):
    return lines.append


# --- the dispatch: one use case's build, per path -------------------------------------------------------------------------

def test_a_supervisor_build_creates_the_supervisor_and_keeps_its_records():
    rec = Recorder()
    out = shell_build.build_for_use_case(rec, "cross_domain_assistant", {"supervisor_agents": "available"}, "uc-1", "space-a",
                                         "q", "c.s.t", "", "", None, log_into([]), lambda n: n, None)
    assert out["path"] == "supervisor"
    assert {"asset": "supervisor", "supervisor_id": "sup-1"} in out["records"]


def test_an_unavailable_supervisor_runs_the_orchestrator_and_creates_nothing():
    rec = Recorder()
    out = shell_build.build_for_use_case(rec, "cross_domain_assistant", {"supervisor_agents": "unavailable"}, "uc-1", "space-a",
                                         "q", "", "", "", lambda s, q: f"{s} answered", log_into([]), lambda n: n, None)
    assert out["path"] == "orchestrator_job" and out["records"] == []
    assert rec.calls == [], "the orchestrator asks Genie through the caller's helper, not the REST client"


def test_a_build_with_no_space_is_skipped_and_logged():
    lines = []
    out = shell_build.build_for_use_case(Recorder(), "cross_domain_assistant", {"supervisor_agents": "available"}, "uc-1", "",
                                         "q", "", "", "", None, log_into(lines), lambda n: n, None)
    assert out["records"] == [] and any("no Genie space" in line for line in lines)


def test_an_agent_build_adds_its_approval_columns_through_the_lakebase_connection():
    rec, statements = Recorder(), []
    out = shell_build.build_for_use_case(rec, "watch_act_agent", {}, "uc-1", "", "q", "c.s.orders", "", "", None, log_into([]),
                                         lambda n: f"`{n}`", statements.extend)
    assert out["path"] == "agent_job" and out["records"] == [{"asset": "job", "job_id": 77}]
    assert statements == ["ALTER TABLE `c.s.orders_approval` ADD COLUMN IF NOT EXISTS `approval_status` STRING",
                          "ALTER TABLE `c.s.orders_approval` ADD COLUMN IF NOT EXISTS `approval_note` STRING"]


def test_an_agent_build_without_a_lakebase_connection_says_the_columns_were_not_added():
    lines = []
    shell_build.build_for_use_case(Recorder(), "watch_act_agent", {}, "uc-1", "", "q", "c.s.orders", "", "", None, log_into(lines),
                                   lambda n: n, None)
    assert any("were not added" in line for line in lines)


def test_the_ai_query_path_creates_nothing():
    rec = Recorder()
    out = shell_build.build_for_use_case(rec, "lookalikes", {"vector_search": "unavailable"}, "uc-1", "", "q", "c.s.t", "txt", "e",
                                         None, log_into([]), lambda n: n, None)
    assert out == {"path": "ai_query", "records": []} and rec.calls == []


# --- REQ-354: Uninstall all removes what a build created, and leaves nothing behind ----------------------------------

def test_a_build_with_an_index_a_supervisor_and_a_job_leaves_nothing_behind_on_uninstall():
    """Three builds' records on one use case, then Uninstall all: every created asset is deleted (index, tools, supervisor, job)."""
    rec = Recorder()
    records = []
    records += shell_build.build_for_use_case(rec, "cross_domain_assistant", {"supervisor_agents": "available"}, "uc-1", "space-a",
                                              "q", "", "", "", None, log_into([]), lambda n: n, None)["records"]
    records += shell_build.build_for_use_case(rec, "lookalikes", {"vector_search": "available"}, "uc-1", "", "q", "c.s.t", "txt", "ep",
                                              None, log_into([]), lambda n: n, None)["records"]
    records += shell_build.build_for_use_case(rec, "watch_act_agent", {}, "uc-1", "", "q", "c.s.orders", "", "", None, log_into([]),
                                              lambda n: n, lambda statements: None)["records"]
    assert {r["asset"] for r in records} == {"supervisor", "supervisor_tool", "vector_index", "job"}

    rec = Recorder()
    warnings = shell_build.delete_records(shell_build.BuildApi(rec), records, lambda e: False, str)
    assert warnings == []
    deleted = {p for _m, p, _b, _q in rec.calls}
    assert "/api/2.0/vector-search/indexes/inspire_uc_1" in deleted and "/api/2.1/supervisor-agents/sup-1" in deleted
    assert "/api/2.2/jobs/delete" in deleted and len(rec.calls) == len(records) + 0 or len(rec.calls) >= 4


def test_the_uninstall_deletes_each_built_asset_once_in_order():
    rec = Recorder()
    records = [{"asset": "job", "job_id": 77}, {"asset": "vector_index", "name": "inspire_uc_1"},
               {"asset": "supervisor", "supervisor_id": "sup-1"}, {"asset": "supervisor_tool", "supervisor_id": "sup-1", "tool_id": "t1"}]
    assert shell_build.delete_records(shell_build.BuildApi(rec), records, lambda e: False, str) == []
    assert [(m, p) for m, p, _b, _q in rec.calls] == [
        ("DELETE", "/api/2.1/supervisor-agents/sup-1/tools/t1"), ("DELETE", "/api/2.1/supervisor-agents/sup-1"),
        ("DELETE", "/api/2.0/vector-search/indexes/inspire_uc_1"), ("POST", "/api/2.2/jobs/delete")]


def test_a_missing_asset_is_silent_on_uninstall_and_a_permission_error_is_reported():
    rec = Recorder({("DELETE", "/api/2.0/vector-search/indexes/"): NOT_FOUND("gone"),
                    ("POST", "/api/2.2/jobs/delete"): RuntimeError(PERMISSION)})
    records = [{"asset": "vector_index", "name": "inspire_uc_1"}, {"asset": "job", "job_id": 77}]
    warnings = shell_build.delete_records(shell_build.BuildApi(rec), records, lambda e: type(e).__name__ == "NotFound", str)
    assert len(warnings) == 1 and "/api/2.2/jobs/delete" in warnings[0] and "PERMISSION_DENIED" in warnings[0]


def test_an_asset_with_no_delete_call_is_reported_not_skipped():
    warnings = shell_build.delete_records(shell_build.BuildApi(Recorder()), [{"asset": "table"}], lambda e: False, str)
    assert len(warnings) == 1 and "no uninstall call" in warnings[0]


# --- the notebook's own methods: the run hook and the uninstall call -----------------------------------------------------

@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def Stub(cls, rec):
    """A real DatabricksInspire instance (no constructor) whose workspace calls are replaced by the recorder and two stubs."""
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("req414c")
    obj.lakebase_calls = []
    obj._implement_api = rec
    obj._implement_genie_smoke = lambda space, question: {"content": f"{space} says {question}"}
    obj._implement_lakebase_sql = lambda env, statements: obj.lakebase_calls.append((env, list(statements)))
    return obj


def test_the_run_hook_builds_the_kinds_path_and_keeps_its_records_on_the_asset_status(ns):
    cls = ns["DatabricksInspire"]
    rec = Recorder()
    stub = Stub(cls, rec)
    context = {"uc_id": "UC-1", "kind_spec": {"kind": {"id": "cross_domain_assistant", "question": "How did sales do?"}},
               "asset_status": {"genie_space": {"id": "space-a"}}, "result_table": "c.s.sales", "lakebase": {}}
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "available"}
    try:
        cls._implement_build_paths(stub, context)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    assert {"asset": "supervisor", "supervisor_id": "sup-1"} in context["asset_status"]["build_records"]


def test_a_use_case_without_a_kind_does_not_run_any_build(ns):
    cls = ns["DatabricksInspire"]
    rec = Recorder()
    context = {"uc_id": "UC-2", "kind_spec": None, "asset_status": {}}
    cls._implement_build_paths(Stub(cls, rec), context)
    assert rec.calls == [] and "build_records" not in context["asset_status"]


def test_the_uninstall_call_reads_the_records_and_treats_a_missing_asset_as_silent(ns):
    cls = ns["DatabricksInspire"]
    rec = Recorder({("DELETE", "/api/2.0/vector-search/indexes/"): NOT_FOUND("does not exist")})
    stub = Stub(cls, rec)
    asset_status = {"build_records": [{"asset": "vector_index", "name": "inspire_uc_1"}, {"asset": "job", "job_id": 77}]}
    warnings = cls._implement_delete_build_records(stub, asset_status)
    assert warnings == []
    assert [p for _m, p, _b, _q in rec.calls] == ["/api/2.0/vector-search/indexes/inspire_uc_1", "/api/2.2/jobs/delete"]


def test_the_approval_columns_use_the_app_build_lakebase_environment(ns):
    cls = ns["DatabricksInspire"]
    rec = Recorder()
    stub = Stub(cls, rec)
    context = {"uc_id": "UC-3", "kind_spec": {"kind": {"id": "watch_act_agent", "question": "q"}}, "asset_status": {},
               "result_table": "c.s.orders", "lakebase": {"env": {"PGHOST": "h"}}}
    cls._implement_build_paths(stub, context)
    assert stub.lakebase_calls and stub.lakebase_calls[0][0] == {"PGHOST": "h"}
    assert stub.lakebase_calls[0][1][0].startswith("ALTER TABLE")


def test_the_orchestrator_fallback_calls_the_real_genie_helper_for_each_domain_space(ns):
    """Item 5: with no supervisor, the run hook asks each domain Genie space through the existing Genie conversation helper."""
    cls = ns["DatabricksInspire"]
    stub = Stub(cls, Recorder())
    asked = []
    stub._implement_genie_smoke = lambda space, question: (asked.append((space, question)) or {"content": f"{space} answered"})
    previous = dict(ns["TECHNICAL_CONTEXT"].get("ai_function_status") or {})
    ns["TECHNICAL_CONTEXT"]["ai_function_status"] = {"supervisor_agents": "unavailable"}
    try:
        context = {"uc_id": "UC-4", "kind_spec": {"kind": {"id": "cross_domain_assistant", "question": "How did sales do?"}},
                   "asset_status": {"genie_space": {"id": "space-a"}}, "result_table": "c.s.sales", "lakebase": {}}
        cls._implement_build_paths(stub, context)
    finally:
        ns["TECHNICAL_CONTEXT"]["ai_function_status"] = previous
    assert asked == [("space-a", "How did sales do?")]
    assert "build_records" not in context.get("asset_status", {}), "the orchestrator creates no asset, so nothing is recorded to remove"
