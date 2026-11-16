"""Every output a build publishes, and every page or space it reads after publish, names the live views, never a candidate (REQ-202).

A build attempt creates its scope views under candidate names and drops them when the build ends. Two things kept the candidate name
after that: the App page that the Genie KPI sync reads after publish (context["page_spec"], set before publish), and the artifact stored
for the published page (context["artifacts"]). The KPI sync then wrote the candidate name into the Genie Agent and failed with
TABLE_OR_VIEW_NOT_FOUND. The stored page and the page the KPI sync reads now go through _implement_live_names.
"""
import json
import logging

VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n05_u02__implement_scope"
CANDIDATE = VIEW + "__candidate"
SOURCE = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__sales_transactions_raw"
BODY = f"SELECT amount, region FROM {SOURCE} WHERE v = 7"


def _scopes(agent_ns):
    quote = agent_ns["inspire_quote_identifier"]
    view_ref = ".".join(quote(p) for p in VIEW.split("."))
    scope = {"table": SOURCE, "columns": ["amount", "region"], "rows": [], "where": "", "source": f"({BODY})", "view": VIEW,
             "view_ref": view_ref, "view_sql": agent_ns["inspire_owned_view_sql"](VIEW, BODY), "ready": False, "pattern": None}
    return {agent_ns["inspire_table_scope_key"](SOURCE): scope}


def _candidate_page(agent_ns):
    """An App page as the attempt left it: its dataset SQL reads the candidate view by its quoted reference."""
    cand_ref = ".".join(agent_ns["inspire_quote_identifier"](p) for p in CANDIDATE.split("."))
    return {"id": "n05_u02", "datasets": [{"name": "kpi", "sql": f"SELECT SUM(amount) AS total FROM {cand_ref}"}],
            "charts": [{"id": "c1", "dataset": "kpi"}]}


def _obj(agent_ns, scopes):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.logger = logging.getLogger("rc2-fix-candidate-leak")
    obj._implement_build_scopes = lambda context: scopes
    return obj


def _context(page):
    return {"uc_id": "N05-U02", "key": (1, "N05-U02", 2), "use_case": {"No": "N05-U02"},
            "asset_status": {"app": {"state": "ready", "spec_version": 2}}, "page_spec": page}


def test_the_kpi_sync_reads_the_live_page_after_publish(agent_ns):
    obj = _obj(agent_ns, _scopes(agent_ns))
    page = obj._implement_genie_kpi_page(_context(_candidate_page(agent_ns)))
    assert "__candidate" not in json.dumps(page), "the KPI definitions read after publish name the live view"
    live_ref = ".".join(agent_ns["inspire_quote_identifier"](p) for p in VIEW.split("."))
    assert live_ref in json.dumps(page), "the KPI SQL reads the live view by its quoted reference"


def test_a_page_stored_as_an_artifact_names_the_live_views(agent_ns):
    obj = _obj(agent_ns, _scopes(agent_ns))
    stored = obj._implement_live_names({"uc_id": "N05-U02", "use_case": {"No": "N05-U02"}}, _candidate_page(agent_ns))
    assert "__candidate" not in json.dumps(stored)


def test_no_published_output_names_a_candidate_view(agent_ns):
    """Closing scan of the published outputs: App page, Genie space (instructions, sample SQL, KPI SQL), dashboard datasets and App
    files all pass through the publish rename. Any candidate name left in one of them is a hit."""
    obj = _obj(agent_ns, _scopes(agent_ns))
    cand_ref = ".".join(agent_ns["inspire_quote_identifier"](p) for p in CANDIDATE.split("."))
    context = {"uc_id": "N05-U02", "use_case": {"No": "N05-U02"}}
    space = {"data_sources": {"tables": [{"identifier": CANDIDATE, "column_configs": []}]},
             "instructions": {"text_instructions": [{"content": [f"Use {CANDIDATE} for totals"]}]},
             "config": {"sample_questions": [{"question": ["Total?"], "sql": [f"SELECT SUM(amount) FROM {cand_ref}"]}]}}
    dashboard = {"datasets": [{"name": "kpi", "query": f"SELECT amount FROM {cand_ref}"}]}
    files = {"pages/n05_u02.json": json.dumps(_candidate_page(agent_ns)), "inspire_app.json": json.dumps({"reads": [CANDIDATE]})}
    published = {
        "app_page": obj._implement_live_names(context, _candidate_page(agent_ns)),
        "genie_space": obj._implement_live_names(context, space),
        "dashboard": obj._implement_live_names(context, dashboard),
        "app_files": obj._implement_live_names(context, files),
    }
    hits = {name: "__candidate" for name, text in published.items() if "__candidate" in json.dumps(text)}
    assert hits == {}, f"published outputs that name a candidate view: {sorted(hits)}"
    assert CANDIDATE not in json.dumps(published["genie_space"]) and VIEW in json.dumps(published["genie_space"])


def test_an_unknown_candidate_free_value_is_returned_unchanged(agent_ns):
    obj = _obj(agent_ns, _scopes(agent_ns))
    page = {"id": "n05_u02", "datasets": [{"name": "kpi", "sql": f"SELECT 1 FROM {SOURCE}"}]}
    assert obj._implement_live_names({"uc_id": "N05-U02", "use_case": {"No": "N05-U02"}}, page) == page


def test_keeping_the_previous_version_builds_the_app_under_a_side_name_and_removing_it_keeps_the_name(agent_ns):
    """The App name that surprised a walker (v2 under a -v2 name) is the design of vibe_previous. Its default is keep (frontend
    VIBE_PREVIOUS_DEFAULT): the previous App stays live and the new version is built beside it under a -vN name. Remove builds
    in place. Pinned here so a change to either choice is deliberate."""
    routes = {"app": {}}
    assets = {"app": "sales-desk"}
    keep = agent_ns["implement_side_outputs"]({"vibe_previous": "keep", "outputs": {"app_name": "sales-desk"}}, routes, {}, assets)
    remove = agent_ns["implement_side_outputs"]({"vibe_previous": "remove", "outputs": {"app_name": "sales-desk"}}, routes, {}, assets)
    assert keep[0] == ["app"] and remove[0] == [], "keep builds the App beside the previous one, remove builds it in place"
    assert agent_ns["implement_side_names"]({"app_name": "sales-desk"}, "app", 2, "")["app_name"] == "sales-desk-v2"
