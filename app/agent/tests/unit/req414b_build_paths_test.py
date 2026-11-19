"""REQ-414 part B: the build paths for the AI-native kinds, planned and run by app_shell/server/shell_build.py.

Pure builders and request bodies, reached through an `api` object with do(). The agent job's spec is validated by the SDK's own
JobSettings parser, so a spec the Jobs API would reject fails here. Nothing contacts a workspace.
"""
import os
import sys

import pytest

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_actions  # noqa: E402
import shell_build  # noqa: E402

NOTEBOOK = "/Workspace/Inspire/agent/dbx_inspire_ai_agent"


class FakeApi:
    """Records every call. `answers` maps (method, path prefix) to the body it returns, or to an exception it raises."""

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
        if method == "POST" and path == shell_build.JOBS_CREATE_PATH:
            return {"job_id": 77}
        return {}


class StatusError(Exception):
    def __init__(self, status_code, message=""):
        super().__init__(message)
        self.status_code = status_code


def job_spec(**overrides):
    args = dict(name="watch", cron="0 0 7 * * ?", detect_sql="SELECT 1", lakebase_table="c.s.orders", notebook_path=NOTEBOOK)
    args.update(overrides)
    return shell_build.agent_job_spec(**args)


# --- the supervisor probe ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("status,text,expected", [
    (200, "", "available"), (404, "not found", "unavailable"),
    (403, "Supervisor agents are not enabled for this workspace", "unavailable"),
    (403, "User does not have permission", "unknown"), (500, "internal error", "unknown"), (None, "timed out", "unknown"),
])
def test_the_supervisor_list_call_is_classified_by_its_status(status, text, expected):
    assert shell_build.classify_supervisor_probe(status, text) == expected


def test_probe_supervisor_reads_the_status_from_the_api_error():
    path = "/api/2.1/supervisor-agents"
    assert shell_build.probe_supervisor(FakeApi()) == "available"
    assert shell_build.probe_supervisor(FakeApi({("GET", path): StatusError(404)})) == "unavailable"
    assert shell_build.probe_supervisor(FakeApi({("GET", path): RuntimeError("boom")})) == "unknown"


# --- choosing the path ------------------------------------------------------------------------------------------------------

def test_the_supervisor_path_is_chosen_only_when_the_probe_says_available():
    assert shell_build.choose_path("cross_domain_assistant", "available") == "supervisor"
    for status in ("unavailable", "unknown", None):
        assert shell_build.choose_path("cross_domain_assistant", status) == "orchestrator_job"


def test_the_index_is_built_only_when_vector_search_is_available_else_ai_query():
    for kind in ("lookalikes", "taxonomy_mapping"):
        assert shell_build.choose_path(kind, "unknown", "available") == "vector_index"
        assert shell_build.choose_path(kind, "unknown", "unavailable") == "ai_query"


@pytest.mark.parametrize("kind", ["watch_act_agent", "exception_workflow_agent", "outreach_agent"])
def test_the_agent_kinds_run_the_scheduled_job(kind):
    assert shell_build.choose_path(kind, "available", "available") == "agent_job"


def test_a_kind_without_a_build_path_has_none():
    assert shell_build.choose_path("entity_matching", "available", "available") == "none"


# --- the supervisor: every domain space, one tool each, with its description ----------------------------------------------

def test_the_supervisor_spec_has_one_tool_per_domain_space_with_its_description():
    spec = shell_build.supervisor_spec("cross", [("space-a", "Sales"), ("space-b", "Stock")])
    assert [t["tool_id"] for t in spec["tools"]] == ["space_space_a", "space_space_b"]
    assert spec["tools"][1]["body"] == {"tool_type": "genie_space", "genie_space": {"id": "space-b"}, "description": "Stock"}


def test_a_space_listed_twice_is_attached_once():
    spec = shell_build.supervisor_spec("cross", [("space-a", "Sales"), ("space-a", "Sales")])
    assert len(spec["tools"]) == 1


def test_a_supervisor_needs_at_least_one_domain_space():
    with pytest.raises(ValueError, match="at least one Genie space"):
        shell_build.supervisor_spec("x", [("", "x")])


def test_create_supervisor_posts_the_agent_then_one_tool_per_space_with_the_tool_id_as_a_query():
    api = FakeApi(created_id="sup-42")
    out = shell_build.create_supervisor(api, "cross", [("space-a", "Sales"), ("space-b", "Stock")])
    assert out["supervisor_id"] == "sup-42" and out["tools"] == ["space_space_a", "space_space_b"]
    assert api.calls[0] == ("POST", "/api/2.1/supervisor-agents", {"name": "cross"}, None)
    assert api.calls[1][1] == "/api/2.1/supervisor-agents/sup-42/tools" and api.calls[1][3] == {"tool_id": "space_space_a"}


def test_a_supervisor_answer_without_an_id_attaches_no_tools_and_names_the_keys():
    api = FakeApi(created_id="")
    with pytest.raises(shell_build.SupervisorIdMissing):
        shell_build.create_supervisor(api, "cross", [("space-a", "Sales")])
    assert [c[0] for c in api.calls] == ["POST"]


def test_the_supervisor_id_is_read_from_the_documented_fields():
    assert shell_build.parse_supervisor_id({"id": "sup-1"}) == "sup-1"
    assert shell_build.parse_supervisor_id({"name": "supervisor-agents/sup-2"}) == "sup-2"
    with pytest.raises(shell_build.SupervisorIdMissing) as caught:
        shell_build.parse_supervisor_id({"created_at": "x", "status": "ok"})
    assert "['created_at', 'status']" in str(caught.value)


# --- the agent job in the Jobs 2.2 format, validated by the SDK ----------------------------------------------------------

def test_the_agent_job_spec_is_in_the_jobs_format_with_notebook_tasks_a_cron_schedule_and_tags():
    spec = job_spec()
    assert spec["tags"] == {"inspire": "agent_job"}
    assert spec["schedule"] == {"quartz_cron_expression": "0 0 7 * * ?", "timezone_id": "UTC", "pause_status": "PAUSED"}
    assert [t["task_key"] for t in spec["tasks"]] == ["detect", "write_back", "act"]
    assert all(t["notebook_task"]["notebook_path"] == NOTEBOOK for t in spec["tasks"])
    assert spec["tasks"][2]["depends_on"] == [{"task_key": "write_back"}]


def test_the_agent_job_spec_is_accepted_by_the_sdks_job_settings_parser():
    """A real SDK parse in a fresh interpreter: the notebook loader stubs databricks.sdk inside this process, so the check runs apart."""
    import json
    import subprocess
    code = ("import json, sys\n"
            "from databricks.sdk.service.jobs import JobSettings\n"
            "s = JobSettings.from_dict(json.loads(sys.stdin.read()))\n"
            "print(json.dumps({'cron': s.schedule.quartz_cron_expression, 'tz': s.schedule.timezone_id,\n"
            "                  'keys': [t.task_key for t in s.tasks], 'path': s.tasks[0].notebook_task.notebook_path}))\n")
    done = subprocess.run([sys.executable, "-c", code], input=json.dumps(job_spec()), capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    parsed = json.loads(done.stdout)
    assert parsed == {"cron": "0 0 7 * * ?", "tz": "UTC", "keys": ["detect", "write_back", "act"], "path": NOTEBOOK}


def test_a_missing_cron_gets_the_default_schedule_not_no_schedule():
    assert job_spec(cron="")["schedule"]["quartz_cron_expression"] == shell_build.DEFAULT_CRON


def test_the_agent_job_needs_its_detect_query_table_and_notebook():
    for bad in ({"detect_sql": ""}, {"lakebase_table": ""}, {"notebook_path": ""}):
        with pytest.raises(ValueError):
            job_spec(**bad)


def test_the_job_is_created_from_its_spec_and_its_id_is_recorded():
    api = FakeApi()
    record = shell_build.build_agent_job(api, job_spec())
    assert record == {"asset": "job", "job_id": 77} and api.calls[0][2]["tasks"][0]["task_key"] == "detect"


def test_a_job_answer_without_a_job_id_is_refused():
    with pytest.raises(ValueError, match="job_id"):
        shell_build.build_agent_job(FakeApi({("POST", "/api/2.2/jobs/create"): {}}), job_spec())


# --- index inputs and the endpoint --------------------------------------------------------------------------------------

def test_the_index_inputs_come_from_the_kinds_detected_roles():
    columns = {"entity_name": ["c.s.customers.customer_name"], "case_id": ["c.s.customers.customer_id"]}
    got = shell_build.index_inputs(columns, "c.s.customers")
    assert got == {"text_column": "customer_name", "source_table": "c.s.customers", "primary_key": "customer_id"}


def test_the_index_inputs_fall_back_to_a_free_text_column_then_a_label():
    got = shell_build.index_inputs({"free_text": ["c.s.cases.complaint"], "label_column": ["c.s.cases.priority"]}, "c.s.cases")
    assert got["text_column"] == "complaint" and got["source_table"] == "c.s.cases"


def test_missing_index_inputs_are_empty_so_the_path_falls_back():
    assert shell_build.index_inputs({}, "c.s.t")["text_column"] == ""


def test_an_online_endpoint_is_picked_and_none_online_picks_nothing():
    ready = {"endpoints": [{"name": "old", "endpoint_status": {"state": "OFFLINE"}},
                           {"name": "vs-main", "endpoint_status": {"state": "ONLINE"}}]}
    assert shell_build.pick_endpoint(ready) == "vs-main"
    assert shell_build.pick_endpoint({"endpoints": [{"name": "x", "endpoint_status": {"state": "PROVISIONING"}}]}) == ""
    assert shell_build.pick_endpoint({}) == ""


# --- planning: a path without its inputs is skipped, with the reason named --------------------------------------------

def test_the_index_plan_needs_every_input_or_names_what_is_missing():
    plan, why = shell_build.plan_for("vector_index", "lookalikes", "inspire_uc", {"text_column": "n", "source_table": "c.s.t",
                                                                                   "primary_key": "", "endpoint": "vs"})
    assert plan is None and "primary_key" in why and "falling back to ai_query" in why


def test_the_agent_job_plan_is_skipped_without_its_notebook_or_result_table():
    _plan, why = shell_build.plan_for("agent_job", "watch_act_agent", "n", {"result_table": "c.s.t", "notebook_path": ""})
    assert "no notebook" in why
    _plan, why = shell_build.plan_for("agent_job", "watch_act_agent", "n", {"result_table": "", "notebook_path": NOTEBOOK})
    assert "no result table" in why


def test_the_supervisor_plan_is_skipped_when_no_domain_space_was_built():
    plan, why = shell_build.plan_for("supervisor", "cross_domain_assistant", "n", {"domains": []})
    assert plan is None and "no domain Genie space" in why


# --- the orchestrator: real Genie calls through the caller's helper, failures kept ---------------------------------------

def test_the_orchestrator_asks_every_domain_space_and_keeps_a_failed_answer_next_to_the_rest():
    def ask(space, question):
        if space == "space-b":
            raise RuntimeError("Genie space is busy")
        return f"{space}: ok"
    out = shell_build.orchestrate(ask, ["space-a", "space-b"], "How did sales do?")
    assert out["answers"]["space-a"] == {"answer": "space-a: ok", "error": ""}
    assert out["failed"] == ["space-b"]


def test_the_orchestrator_refuses_an_empty_question():
    with pytest.raises(ValueError, match="question"):
        shell_build.orchestrate(lambda s, q: "", ["space-a"], " ")


# --- the dispatcher and the uninstall listing ----------------------------------------------------------------------------

def test_the_uninstall_lists_tools_before_their_supervisor_then_the_index_then_the_job():
    records = [{"asset": "job", "job_id": 77}, {"asset": "vector_index", "name": "inspire_uc_1"},
               {"asset": "supervisor", "supervisor_id": "sup-1"}, {"asset": "supervisor_tool", "supervisor_id": "sup-1", "tool_id": "t1"}]
    assert [(m, p) for m, p, _b in shell_build.uninstall_requests(records)] == [
        ("DELETE", "/api/2.1/supervisor-agents/sup-1/tools/t1"), ("DELETE", "/api/2.1/supervisor-agents/sup-1"),
        ("DELETE", "/api/2.0/vector-search/indexes/inspire_uc_1"), ("POST", "/api/2.2/jobs/delete")]


def test_an_asset_with_no_uninstall_call_is_refused():
    with pytest.raises(ValueError, match="no uninstall call"):
        shell_build.uninstall_requests([{"asset": "table"}])


def test_the_result_table_name_is_quoted_part_by_part_in_postgres_form():
    quote = lambda name: f'"{name}"'
    assert shell_build.postgres_table("app_schema", "catalog.schema.loss_desk_out", quote) == '"app_schema"."loss_desk_out"'
    with pytest.raises(ValueError, match="schema"):
        shell_build.postgres_table("", "catalog.schema.t", quote)


def test_the_approval_ddl_creates_the_table_with_its_columns_or_adds_the_missing_ones_and_never_fails_on_either():
    quote = lambda name: f'"{name}"'
    stmts = shell_build.approval_ddl("app_schema", "catalog.schema.loss_desk_out", quote)
    assert stmts[0] == 'CREATE TABLE IF NOT EXISTS "app_schema"."loss_desk_out" ("approval_status" TEXT, "approval_note" TEXT)'
    assert stmts[1].startswith('ALTER TABLE "app_schema"."loss_desk_out" ADD COLUMN IF NOT EXISTS "approval_status" TEXT')
    assert all("IF NOT EXISTS" in stmt for stmt in stmts), "neither statement fails when the table is there or missing"


def test_the_no_endpoint_line_is_the_plain_sentence_the_build_and_the_app_show():
    assert shell_build.NO_ENDPOINT_LINE == ("No vector search endpoint is ready, so this use case matches with ai_query. "
                                            "A workspace admin can create one to switch to AI Search.")


def test_approve_and_reject_are_a_persons_click_and_the_agent_never_offers_them():
    assert set(shell_actions.APPROVAL_ACTIONS) == {"approve", "reject"}
    assert not set(shell_actions.APPROVAL_ACTIONS) & set(shell_actions.RECORD_ACTIONS)


def test_approve_writes_the_approved_state_and_reject_writes_the_reason():
    assert shell_actions.record_values("approve", {}, None) == {shell_build.APPROVAL_COLUMN: "approved"}
    assert shell_actions.record_values("reject", {"reason": "outside policy"}, None) == {
        shell_build.APPROVAL_COLUMN: "rejected", shell_build.APPROVAL_NOTE_COLUMN: "outside policy"}
    with pytest.raises(ValueError, match="reason"):
        shell_actions.record_values("reject", {}, None)


def test_only_approved_rows_are_acted_on():
    rows = [{"id": 1, "approval_status": "approved"}, {"id": 2, "approval_status": "awaiting approval"},
            {"id": 3, "approval_status": "rejected"}, {"id": 4}]
    assert [r["id"] for r in shell_build.rows_ready_to_act(rows)] == [1]
