"""REQ-414 part B: the build paths for the AI-native kinds (AI Search index, Supervisor Agent or orchestrator job, scheduled agent job
with Lakebase write-back and an approval step).

The pure builders live in app_shell/server/shell_build.py and reach the workspace only through an `api` object with do(). The
tests drive them with stubs, and load the module from the packed App shell payload the way the agent notebook does. Nothing here
contacts a workspace.
"""
import os
import sys

import pytest

from _agentload import load_agent_namespace

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_actions  # noqa: E402
import shell_build  # noqa: E402

TODAY = None  # record_values only reads TODAY for the dated actions; the approval actions do not use it


class Log:
    def info(self, message, *args, **kwargs):
        pass

    def warning(self, message, *args, **kwargs):
        pass


class FakeSpark:
    """Every DESCRIBE and minimal call succeeds, so the function part of the probe is all available."""

    def sql(self, statement):
        return _Frame()


class _Frame:
    def collect(self):
        return []


class StatusError(Exception):
    def __init__(self, status_code, message=""):
        super().__init__(message)
        self.status_code = status_code


class FakeApi:
    """Records every call. `answers` maps (method, path prefix) to the error it raises, or to the body it returns."""

    def __init__(self, answers=None, created_id="sup-1"):
        self.answers = answers or {}
        self.created_id = created_id
        self.calls = []

    def do(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        for (m, prefix), outcome in self.answers.items():
            if m == method and path.startswith(prefix):
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome
        if method == "POST" and path == shell_build.SUPERVISOR_AGENTS_PATH:
            return {"id": self.created_id}
        return {}


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


# --- the supervisor probe: a cheap list call, classified by its status --------------------------------------------------------

@pytest.mark.parametrize("status,text,expected", [
    (200, "", "available"),
    (404, "not found", "unavailable"),
    (403, "Supervisor agents are not enabled for this workspace", "unavailable"),
    (403, "User does not have permission", "unknown"),
    (500, "internal error", "unknown"),
    (None, "timed out", "unknown"),
])
def test_the_supervisor_list_call_is_classified_by_its_status(status, text, expected):
    assert shell_build.classify_supervisor_probe(status, text) == expected


def test_probe_supervisor_reads_the_status_from_the_api_error():
    assert shell_build.probe_supervisor(FakeApi()) == "available"
    assert shell_build.probe_supervisor(FakeApi({("GET", "/api/2.1/supervisor-agents"): StatusError(404)})) == "unavailable"
    assert shell_build.probe_supervisor(FakeApi({("GET", "/api/2.1/supervisor-agents"): StatusError(500)})) == "unknown"
    assert shell_build.probe_supervisor(FakeApi({("GET", "/api/2.1/supervisor-agents"): RuntimeError("boom")})) == "unknown"


def test_the_probe_uses_the_documented_list_path_and_only_gets():
    api = FakeApi()
    shell_build.probe_supervisor(api)
    assert api.calls == [("GET", "/api/2.1/supervisor-agents", None, None)]


# --- choosing the path: the supervisor only when the probe says so ------------------------------------------------------

def test_the_supervisor_path_is_chosen_only_when_the_probe_says_available():
    assert shell_build.choose_path("cross_domain_assistant", "available") == "supervisor"
    assert shell_build.choose_path("cross_domain_assistant", "unavailable") == "orchestrator_job"
    assert shell_build.choose_path("cross_domain_assistant", "unknown") == "orchestrator_job"
    assert shell_build.choose_path("cross_domain_assistant", None) == "orchestrator_job"


def test_the_vector_index_is_built_only_when_vector_search_is_available_else_ai_query():
    for kind in ("lookalikes", "taxonomy_mapping"):
        assert shell_build.choose_path(kind, "unknown", "available") == "vector_index"
        assert shell_build.choose_path(kind, "unknown", "unavailable") == "ai_query"
        assert shell_build.choose_path(kind, "unknown", "unknown") == "ai_query"


@pytest.mark.parametrize("kind", ["watch_act_agent", "exception_workflow_agent", "outreach_agent"])
def test_the_agent_kinds_run_the_scheduled_job(kind):
    assert shell_build.choose_path(kind, "available", "available") == "agent_job"


def test_a_kind_without_a_build_path_has_none():
    assert shell_build.choose_path("entity_matching", "available", "available") == "none"


def test_the_fallback_sentences_name_the_path_taken():
    assert "orchestrator job" in shell_build.fallback_sentence("orchestrator_job")
    assert "ai_query" in shell_build.fallback_sentence("ai_query")
    assert shell_build.fallback_sentence("supervisor") == ""


# --- the supervisor: created from the domain Genie spaces only ----------------------------------------------------------

def test_the_supervisor_spec_routes_to_exactly_the_given_genie_spaces():
    spec = shell_build.supervisor_spec("cross domain", ["space-a", " space-b ", ""])
    assert spec["agent"] == {"name": "cross domain"}
    assert [t["body"]["genie_space"]["id"] for t in spec["tools"]] == ["space-a", "space-b"]
    assert all(t["body"]["tool_type"] == "genie_space" for t in spec["tools"])


def test_a_supervisor_needs_at_least_one_genie_space():
    with pytest.raises(ValueError, match="at least one Genie space"):
        shell_build.supervisor_spec("x", ["", "  "])


def test_create_supervisor_posts_the_agent_then_one_tool_per_space_with_the_tool_id_as_a_query():
    api = FakeApi(created_id="sup-42")
    out = shell_build.create_supervisor(api, "cross", ["space-a", "space-b"])
    assert out == {"supervisor_id": "sup-42", "tools": ["genie_space_1", "genie_space_2"]}
    assert api.calls[0] == ("POST", "/api/2.1/supervisor-agents", {"name": "cross"}, None)
    assert api.calls[1] == ("POST", "/api/2.1/supervisor-agents/sup-42/tools", {"tool_type": "genie_space", "genie_space": {"id": "space-a"}},
                            {"tool_id": "genie_space_1"})
    assert len(api.calls) == 3


def test_a_supervisor_created_without_an_id_is_refused_before_any_tool_is_attached():
    api = FakeApi(created_id="")
    with pytest.raises(ValueError, match="without an id"):
        shell_build.create_supervisor(api, "cross", ["space-a"])
    assert [c[0] for c in api.calls] == ["POST"], "no tool is posted for a supervisor without an id"


# --- the orchestrator fallback and the index and job specs ---------------------------------------------------------------

def test_the_orchestrator_asks_each_domain_space_and_summarises_all_answers():
    spec = shell_build.orchestrator_job_spec("cross", ["space-a", "space-b"], "0 0 6 * * ?")
    asks = [t for t in spec["tasks"] if t["task_key"].startswith("ask_")]
    assert [t["genie_space_id"] for t in asks] == ["space-a", "space-b"]
    summary = next(t for t in spec["tasks"] if t["task_key"] == "summary")
    assert summary["depends_on"] == [t["task_key"] for t in asks]
    assert spec["schedule"] == "0 0 6 * * ?"


def test_the_index_is_a_delta_sync_index_over_its_source_table():
    spec = shell_build.index_spec("lookalikes_idx", "endpoint-1", "catalog.schema.customers", "customer_id", "profile_text")
    assert spec["index_type"] == "DELTA_SYNC"
    assert spec["delta_sync_index_spec"]["source_table"] == "catalog.schema.customers"
    assert spec["delta_sync_index_spec"]["embedding_source_columns"] == [{"name": "profile_text"}]


def test_an_index_missing_a_field_is_refused():
    with pytest.raises(ValueError, match="endpoint"):
        shell_build.index_spec("i", "", "t", "k", "c")


def test_the_agent_job_writes_pending_rows_and_acts_only_on_approved_rows():
    spec = shell_build.agent_job_spec("watch", "0 0 7 * * ?", "SELECT 1", "lakebase.schema.watch")
    tasks = {t["task_key"]: t for t in spec["tasks"]}
    assert tasks["write_back"]["writes"] == {shell_build.APPROVAL_COLUMN: shell_build.PENDING}
    assert tasks["approval"]["depends_on"] == ["write_back"]
    assert tasks["act"]["only_rows_where"] == {shell_build.APPROVAL_COLUMN: shell_build.APPROVED}
    assert tasks["act"]["depends_on"] == ["approval"]
    assert not any(t.get("writes", {}).get(shell_build.APPROVAL_COLUMN) == shell_build.APPROVED for t in spec["tasks"]), \
        "no task writes the approved state; only the approver does"


def test_the_agent_job_needs_its_detect_query_and_its_lakebase_table():
    with pytest.raises(ValueError):
        shell_build.agent_job_spec("watch", "", "", "lakebase.schema.watch")


def test_only_approved_rows_are_acted_on_pending_and_rejected_rows_never_are():
    rows = [{"id": 1, shell_build.APPROVAL_COLUMN: "approved"}, {"id": 2, shell_build.APPROVAL_COLUMN: "awaiting approval"},
            {"id": 3, shell_build.APPROVAL_COLUMN: "rejected"}, {"id": 4}]
    assert [r["id"] for r in shell_build.rows_ready_to_act(rows)] == [1]


# --- approve and reject: the registry writes the approval columns -------------------------------------------------------

def test_approve_writes_the_approved_state_and_reject_writes_the_reason():
    assert shell_actions.record_values("approve", {}, TODAY) == {shell_build.APPROVAL_COLUMN: "approved"}
    assert shell_actions.record_values("reject", {"reason": "outside policy"}, TODAY) == {
        shell_build.APPROVAL_COLUMN: "rejected", shell_build.APPROVAL_NOTE_COLUMN: "outside policy"}


def test_reject_without_a_reason_is_refused():
    with pytest.raises(ValueError, match="reason"):
        shell_actions.record_values("reject", {}, TODAY)


def test_approve_and_reject_are_registry_record_actions_the_agent_offers():
    assert "approve" in shell_actions.RECORD_ACTIONS and "reject" in shell_actions.RECORD_ACTIONS
    assert "approve" in shell_actions.WRITE_ACTIONS


# --- the notebook's route: the module loads from the packed payload, and its pin matches -------------------------------

def test_the_shell_build_module_loads_from_the_packed_app_shell_and_exposes_the_builders(ns):
    module = ns["implement_shell_module"](ns["inspire_notebook_asset"]("app_shell"), "shell_build")
    assert module.__name__ == "shell_build"
    assert callable(module.choose_path) and callable(module.probe_supervisor) and callable(module.create_supervisor)


def test_the_shell_facts_loader_still_loads_its_module(ns):
    module = ns["implement_shell_facts_module"](ns["inspire_notebook_asset"]("app_shell"))
    assert module.__name__ == "shell_facts"


def test_the_probe_records_the_supervisor_status_and_it_drives_the_supervisor_choice(ns):
    ns["AI_FUNCTION_PROBE_CACHE"].clear()
    ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)
    try:
        ns["probe_ai_functions"](FakeSpark(), Log(), workspace_key="ws-a", api=FakeApi())
        status = ns["TECHNICAL_CONTEXT"]["ai_function_status"]
        assert status["supervisor_agents"] == "available"
        assert ns["inspire_shell_build"].choose_path("cross_domain_assistant", status["supervisor_agents"]) == "supervisor"
    finally:
        ns["AI_FUNCTION_PROBE_CACHE"].clear()
        ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)


def test_a_not_enabled_supervisor_falls_back_to_the_orchestrator(ns):
    ns["AI_FUNCTION_PROBE_CACHE"].clear()
    ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)
    try:
        api = FakeApi({("GET", "/api/2.1/supervisor-agents"): StatusError(403, "supervisor agents not enabled")})
        ns["probe_ai_functions"](FakeSpark(), Log(), workspace_key="ws-b", api=api)
        status = ns["TECHNICAL_CONTEXT"]["ai_function_status"]
        assert status["supervisor_agents"] == "unavailable"
        assert ns["inspire_shell_build"].choose_path("cross_domain_assistant", status["supervisor_agents"]) == "orchestrator_job"
    finally:
        ns["AI_FUNCTION_PROBE_CACHE"].clear()
        ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)
