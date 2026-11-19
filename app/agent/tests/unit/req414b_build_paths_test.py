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
    assert out["supervisor_id"] == "sup-42" and out["tools"] == ["genie_space_1", "genie_space_2"]
    assert api.calls[0] == ("POST", "/api/2.1/supervisor-agents", {"name": "cross"}, None)
    assert api.calls[1] == ("POST", "/api/2.1/supervisor-agents/sup-42/tools", {"tool_type": "genie_space", "genie_space": {"id": "space-a"}},
                            {"tool_id": "genie_space_1"})
    assert len(api.calls) == 3


def test_a_supervisor_created_without_an_id_is_refused_before_any_tool_is_attached():
    api = FakeApi(created_id="")
    with pytest.raises(shell_build.SupervisorIdMissing, match="no id"):
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


def test_approve_and_reject_are_a_persons_click_and_the_agent_never_offers_them():
    """Governance: approval is a person's click on a pending row. The agent cannot approve for the person."""
    assert set(shell_actions.APPROVAL_ACTIONS) == {"approve", "reject"}
    assert not set(shell_actions.APPROVAL_ACTIONS) & set(shell_actions.RECORD_ACTIONS)
    assert "approve" in shell_actions.WRITE_ACTIONS, "the write still goes through the registry route"


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


# --- execution: each path creates its assets and records them ----------------------------------------------------------

def test_the_supervisor_id_is_read_from_the_documented_fields_and_a_missing_id_stops_the_build():
    assert shell_build.parse_supervisor_id({"id": "sup-1"}) == "sup-1"
    assert shell_build.parse_supervisor_id({"name": "supervisor-agents/sup-2"}) == "sup-2"
    with pytest.raises(shell_build.SupervisorIdMissing) as caught:
        shell_build.parse_supervisor_id({"created_at": "x", "status": "ok"})
    assert "['created_at', 'status']" in str(caught.value), "the raw keys are named so the run can log them"
    with pytest.raises(shell_build.SupervisorIdMissing):
        shell_build.parse_supervisor_id("not an object")


def test_a_supervisor_answer_without_an_id_attaches_no_tools():
    api = FakeApi(created_id="")
    with pytest.raises(shell_build.SupervisorIdMissing):
        shell_build.create_supervisor(api, "cross", ["space-a"])
    assert [c[0] for c in api.calls] == ["POST"], "no tool is posted when the supervisor id is missing"


def test_the_supervisor_path_records_the_supervisor_and_each_tool():
    out = shell_build.create_supervisor(FakeApi(created_id="sup-7"), "cross", ["space-a", "space-b"])
    assert out["records"] == [{"asset": "supervisor", "supervisor_id": "sup-7"},
                              {"asset": "supervisor_tool", "supervisor_id": "sup-7", "tool_id": "genie_space_1"},
                              {"asset": "supervisor_tool", "supervisor_id": "sup-7", "tool_id": "genie_space_2"}]


def test_the_index_path_creates_the_index_and_records_its_name():
    api = FakeApi()
    record = shell_build.build_index(api, shell_build.index_spec("lookalikes_idx", "endpoint-1", "c.s.customers", "customer_id", "profile_text"))
    assert record == {"asset": "vector_index", "name": "lookalikes_idx"}
    assert api.calls[0][:2] == ("POST", "/api/2.0/vector-search/indexes")


def test_the_job_path_creates_the_job_and_records_its_id():
    api = FakeApi({("POST", "/api/2.2/jobs/create"): {"job_id": 991}})
    record = shell_build.build_agent_job(api, shell_build.agent_job_spec("watch", "0 0 7 * * ?", "SELECT 1", "lb.s.watch"))
    assert record == {"asset": "job", "job_id": 991}


def test_a_job_answer_without_a_job_id_is_refused():
    with pytest.raises(ValueError, match="job_id"):
        shell_build.build_agent_job(FakeApi({("POST", "/api/2.2/jobs/create"): {}}), shell_build.agent_job_spec("w", "", "SELECT 1", "t"))


def test_the_orchestrator_asks_every_space_and_keeps_a_failed_answer_next_to_the_rest():
    def ask(space, question):
        if space == "space-b":
            raise RuntimeError("Genie space is busy")
        return f"{space}: ok"
    out = shell_build.orchestrate(ask, ["space-a", "space-b"], "How did sales do?")
    assert out["answers"]["space-a"] == {"answer": "space-a: ok", "error": ""}
    assert out["failed"] == ["space-b"] and out["answers"]["space-b"]["error"] == "Genie space is busy"


def test_the_orchestrator_refuses_an_empty_question():
    with pytest.raises(ValueError, match="question"):
        shell_build.orchestrate(lambda s, q: "", ["space-a"], " ")


# --- the uninstall listing: one test per path, so nothing is left behind -----------------------------------------------

def test_the_index_path_is_on_the_uninstall_list_as_a_delete_of_the_index():
    calls = shell_build.uninstall_requests([{"asset": "vector_index", "name": "lookalikes_idx"}])
    assert calls == [("DELETE", "/api/2.0/vector-search/indexes/lookalikes_idx", None)]


def test_the_supervisor_path_deletes_its_tools_before_the_supervisor():
    records = [{"asset": "supervisor", "supervisor_id": "sup-7"},
               {"asset": "supervisor_tool", "supervisor_id": "sup-7", "tool_id": "genie_space_1"}]
    calls = shell_build.uninstall_requests(records)
    assert calls[0] == ("DELETE", "/api/2.1/supervisor-agents/sup-7/tools/genie_space_1", None)
    assert calls[1] == ("DELETE", "/api/2.1/supervisor-agents/sup-7", None)


def test_the_job_path_is_on_the_uninstall_list_as_a_jobs_delete():
    assert shell_build.uninstall_requests([{"asset": "job", "job_id": 991}]) == [("POST", "/api/2.2/jobs/delete", {"job_id": 991})]


def test_the_orchestrator_path_creates_nothing_so_its_uninstall_list_is_empty():
    assert shell_build.uninstall_requests([]) == []


def test_an_asset_with_no_uninstall_call_is_refused_not_skipped():
    with pytest.raises(ValueError, match="no uninstall call"):
        shell_build.uninstall_requests([{"asset": "table"}])


# --- one dispatcher runs each path; each path's records feed the uninstall ----------------------------------------------

def test_the_dispatcher_creates_the_supervisor_path_and_returns_its_records():
    logs = []
    out = shell_build.run_build_paths(FakeApi(created_id="sup-9"), {"path": "supervisor", "kind": "cross_domain_assistant",
                                                                     "name": "cross", "genie_space_ids": ["space-a"]}, None, logs.append)
    assert out["path"] == "supervisor" and out["records"][0] == {"asset": "supervisor", "supervisor_id": "sup-9"}
    assert any("path=supervisor" in line for line in logs)


def test_the_dispatcher_stops_the_supervisor_path_when_the_id_is_missing_and_logs_why():
    logs = []
    with pytest.raises(shell_build.SupervisorIdMissing):
        shell_build.run_build_paths(FakeApi(created_id=""), {"path": "supervisor", "kind": "k", "name": "c",
                                                             "genie_space_ids": ["space-a"]}, None, logs.append)
    assert any("nothing attached" in line for line in logs)


def test_the_dispatcher_runs_the_orchestrator_through_the_ask_it_is_given():
    out = shell_build.run_build_paths(FakeApi(), {"path": "orchestrator_job", "kind": "k", "genie_space_ids": ["space-a"],
                                                  "question": "q"}, lambda s, q: "answered", lambda line: None)
    assert out["records"] == [] and out["result"]["answers"]["space-a"]["answer"] == "answered"


def test_the_dispatcher_creates_the_index_and_the_job_and_records_both():
    api = FakeApi({("POST", "/api/2.2/jobs/create"): {"job_id": 5}})
    index = shell_build.run_build_paths(api, {"path": "vector_index", "kind": "lookalikes",
                                              "index_spec": shell_build.index_spec("i", "e", "c.s.t", "id", "txt")}, None, lambda l: None)
    job = shell_build.run_build_paths(api, {"path": "agent_job", "kind": "watch_act_agent",
                                            "job_spec": shell_build.agent_job_spec("w", "0 0 7 * * ?", "SELECT 1", "lb.s.w")}, None,
                                      lambda l: None)
    assert index["records"] == [{"asset": "vector_index", "name": "i"}] and job["records"] == [{"asset": "job", "job_id": 5}]


def test_the_ai_query_path_creates_nothing():
    assert shell_build.run_build_paths(FakeApi(), {"path": "ai_query", "kind": "lookalikes"}, None, lambda l: None)["records"] == []


def test_an_unknown_path_is_refused():
    with pytest.raises(ValueError, match="no build path"):
        shell_build.run_build_paths(FakeApi(), {"path": "magic"}, None, lambda l: None)


def test_every_path_records_what_its_uninstall_must_remove():
    api = FakeApi({("POST", "/api/2.2/jobs/create"): {"job_id": 5}}, created_id="sup-3")
    built = [
        shell_build.run_build_paths(api, {"path": "supervisor", "kind": "k", "name": "c", "genie_space_ids": ["s1"]}, None, lambda l: None),
        shell_build.run_build_paths(api, {"path": "vector_index", "kind": "k",
                                          "index_spec": shell_build.index_spec("i", "e", "c.s.t", "id", "txt")}, None, lambda l: None),
        shell_build.run_build_paths(api, {"path": "agent_job", "kind": "k",
                                          "job_spec": shell_build.agent_job_spec("w", "", "SELECT 1", "lb.s.w")}, None, lambda l: None),
    ]
    records = [r for out in built for r in out["records"]]
    calls = shell_build.uninstall_requests(records)
    assert ("POST", "/api/2.2/jobs/delete", {"job_id": 5}) in calls
    assert ("DELETE", "/api/2.0/vector-search/indexes/i", None) in calls
    assert ("DELETE", "/api/2.1/supervisor-agents/sup-3", None) in calls


def test_the_approval_columns_are_added_with_the_quoting_the_notebook_passes_in():
    stmts = shell_build.approval_ddl("lb.s.watch", lambda name: f"`{name}`")
    assert stmts == ["ALTER TABLE `lb.s.watch` ADD COLUMN IF NOT EXISTS `approval_status` STRING",
                     "ALTER TABLE `lb.s.watch` ADD COLUMN IF NOT EXISTS `approval_note` STRING"]
    with pytest.raises(ValueError, match="Lakebase table"):
        shell_build.approval_ddl("", lambda name: name)
