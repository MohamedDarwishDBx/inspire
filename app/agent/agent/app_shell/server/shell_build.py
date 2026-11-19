"""REQ-414 part B: the build paths for the AI-native kinds, planned here and run by the agent job.

Three paths: an AI Search index (vector_search) for lookalikes and taxonomy mapping, a Supervisor Agent over the domain Genie spaces
for the cross-domain assistant, and a scheduled agent job for watch-and-act, exception and outreach agents (Lakebase write-back, then
an approval step: nothing is acted on until its row is approved). Every path reads the probe status (TECHNICAL_CONTEXT
["ai_function_status"]) and falls back to ai_query or to the orchestrator job when the function is not available.

This module is pure: it builds request bodies and decides which path runs. The notebook makes the calls, through an `api` object
with a `do(method, path, body=None, query=None)` method (the SDK's api_client), so the tests drive it with a stub.
"""
SUPERVISOR_AGENTS_PATH = "/api/2.1/supervisor-agents"
SUPERVISOR_TOOL_PATH = "/api/2.1/supervisor-agents/{supervisor_id}/tools"
PROBE_STATUSES = ("available", "unavailable", "unknown")

# kind id -> the build path that serves it
BUILD_PATH_FOR_KIND = {
    "lookalikes": "vector_index",
    "taxonomy_mapping": "vector_index",
    "cross_domain_assistant": "supervisor",
    "watch_act_agent": "agent_job",
    "exception_workflow_agent": "agent_job",
    "outreach_agent": "agent_job",
}

# Approval columns the agent job writes beside its rows. They are not action statuses, so the shell's status set is unchanged.
APPROVAL_COLUMN = "approval_status"
APPROVAL_NOTE_COLUMN = "approval_note"
PENDING = "awaiting approval"
APPROVED = "approved"
REJECTED = "rejected"


def classify_supervisor_probe(status, text="") -> str:
    """The cheap list call: 200 = available; 404 = unavailable; 403 that says the feature is not enabled = unavailable; anything
    else (a 5xx, a timeout, a permission problem that is not 'not enabled') = unknown, which is never cached."""
    low = str(text or "").lower()
    if status == 200:
        return "available"
    if status == 404:
        return "unavailable"
    if status == 403 and ("not enabled" in low or "preview" in low):
        return "unavailable"
    return "unknown"


def probe_supervisor(api) -> str:
    """One GET on the supervisor list path. `api.do` raises on a non-2xx answer; its status code and message are read here."""
    try:
        api.do("GET", SUPERVISOR_AGENTS_PATH)
        return classify_supervisor_probe(200)
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        if status is None:
            status = getattr(getattr(exc, "response", None), "status_code", None)
        return classify_supervisor_probe(status, str(exc))


def choose_path(kind_id: str, supervisor_status: str, index_status: str = "unknown") -> str:
    """The build path for a kind, and whether it uses the function or the fallback.

    The supervisor is used only when the probe says it is available; otherwise the orchestrator job runs over the same Genie spaces.
    A vector index is built only when vector_search is available; otherwise lookalikes and taxonomy use ai_query."""
    path = BUILD_PATH_FOR_KIND.get(kind_id)
    if path is None:
        return "none"
    if path == "supervisor":
        return "supervisor" if supervisor_status == "available" else "orchestrator_job"
    if path == "vector_index":
        return "vector_index" if index_status == "available" else "ai_query"
    return "agent_job"


def supervisor_spec(name: str, genie_space_ids) -> dict:
    """Request bodies for a Supervisor Agent over the domain Genie spaces: the agent, then one genie_space tool per space."""
    spaces = [str(s).strip() for s in genie_space_ids if str(s or "").strip()]
    if not spaces:
        raise ValueError("a supervisor needs at least one Genie space to route to")
    agent = {"name": str(name)}
    tools = []
    for index, space in enumerate(spaces, start=1):
        tools.append({"tool_id": f"genie_space_{index}", "body": {"tool_type": "genie_space", "genie_space": {"id": space}}})
    return {"agent": agent, "tools": tools}


def create_supervisor(api, name: str, genie_space_ids) -> dict:
    """POST the supervisor, then one tool per Genie space. Returns the supervisor id the service assigns."""
    spec = supervisor_spec(name, genie_space_ids)
    created = api.do("POST", SUPERVISOR_AGENTS_PATH, body=spec["agent"])
    supervisor_id = str((created or {}).get("id") or (created or {}).get("name", "").rsplit("/", 1)[-1]).strip()
    if not supervisor_id:
        raise ValueError("the supervisor was created without an id, so its tools cannot be attached")
    for tool in spec["tools"]:
        api.do("POST", SUPERVISOR_TOOL_PATH.format(supervisor_id=supervisor_id), body=tool["body"],
               query={"tool_id": tool["tool_id"]})
    return {"supervisor_id": supervisor_id, "tools": [t["tool_id"] for t in spec["tools"]]}


def orchestrator_job_spec(name: str, genie_space_ids, cron: str = "") -> dict:
    """The fallback when no supervisor is available: one question task per domain Genie space, then a summary task over their answers."""
    spaces = [str(s).strip() for s in genie_space_ids if str(s or "").strip()]
    if not spaces:
        raise ValueError("the orchestrator job needs at least one Genie space")
    tasks = [{"task_key": f"ask_{i}", "genie_space_id": space} for i, space in enumerate(spaces, start=1)]
    tasks.append({"task_key": "summary", "depends_on": [t["task_key"] for t in tasks]})
    return {"name": str(name), "schedule": str(cron or ""), "tasks": tasks}


def index_spec(name: str, endpoint: str, source_table: str, primary_key: str, text_column: str) -> dict:
    """A Delta Sync AI Search index over a source table, embedding one text column."""
    for field, value in (("name", name), ("endpoint", endpoint), ("source_table", source_table), ("primary_key", primary_key),
                         ("text_column", text_column)):
        if not str(value or "").strip():
            raise ValueError(f"an AI Search index needs its {field}")
    return {
        "name": str(name), "endpoint_name": str(endpoint), "primary_key": str(primary_key),
        "index_type": "DELTA_SYNC",
        "delta_sync_index_spec": {"source_table": str(source_table), "pipeline_type": "TRIGGERED",
                                  "embedding_source_columns": [{"name": str(text_column)}]},
    }


def agent_job_spec(name: str, cron: str, detect_sql: str, lakebase_table: str) -> dict:
    """The scheduled agent job: detect, write the flagged rows to Lakebase as awaiting approval, then act on approved rows only."""
    if not str(detect_sql or "").strip() or not str(lakebase_table or "").strip():
        raise ValueError("the agent job needs its detect query and its Lakebase table")
    return {
        "name": str(name), "schedule": str(cron or ""),
        "tasks": [
            {"task_key": "detect", "sql": detect_sql},
            {"task_key": "write_back", "depends_on": ["detect"], "lakebase_table": lakebase_table,
             "writes": {APPROVAL_COLUMN: PENDING}},
            {"task_key": "approval", "depends_on": ["write_back"], "gate": {APPROVAL_COLUMN: APPROVED}},
            {"task_key": "act", "depends_on": ["approval"], "only_rows_where": {APPROVAL_COLUMN: APPROVED}},
        ],
    }


def rows_ready_to_act(rows) -> list:
    """Only rows an approver has approved. Pending and rejected rows are never acted on."""
    return [row for row in rows or [] if str(row.get(APPROVAL_COLUMN) or "").strip() == APPROVED]


def fallback_sentence(path: str) -> str:
    """Generated-code instruction for a build path that did not run its function."""
    if path == "orchestrator_job":
        return "The supervisor is not available in this workspace, so the orchestrator job asks each domain Genie space and summarises the answers."
    if path == "ai_query":
        return "The AI Search index is not available in this workspace, so the match uses ai_query over the text columns."
    return ""
