"""REQ-245 (follow-up): the App's persisted read objects name the views its publish put in place.

_implement_deploy_app persists read_objects (the App's views, the reasons view, the source tables its pages read directly) with the
build, so Check again and the Build page read the same set. The views came from a rebuilt scope list whose views were never ready, so
the persisted list was empty for a first build. The views now come from the publish, the same names the audience grant uses.
Only the collaborators the deploy reaches on the per-user path are stubbed; the publish and the read-object assembly are real.
"""
import json
import logging

SOURCE = "inspire_kinds_rc7._inspire.sales_customers"
RESULT = "inspire_kinds_rc7._inspire.segment_results"
APP = "inspire-fulfillment-app"
AMR = "amr.ali@example.com"
ACL = {"access_control_list": [{"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]}]}


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("SHOW CREATE TABLE "):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found. SQLSTATE: 42P01")
        return self


def _fresh_scopes(agent_ns):
    return agent_ns["parse_table_scopes"](json.dumps({SOURCE: {"columns": ["customer_id", "name"]}}), "inspire_kinds_rc7._inspire",
                                          view_tag="uc_a")


def _obj(agent_ns, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-deploy-read-objects")
    app = {"name": APP, "compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-client", "resources": []}

    def api(method, path, body=None):
        if path.endswith("/permissions/apps/" + APP):
            return ACL
        return app if method == "GET" else {}

    obj._implement_api = api
    obj._implement_build_scopes = lambda context: _fresh_scopes(agent_ns)
    obj._implement_owns_app = lambda uc_id, app_obj: True
    obj._implement_notebook_paths = lambda use_case, key: ("/nb/use_case", "/nb/use_case/notebook")
    obj._implement_access_rows = lambda table: []
    obj._implement_app_before = lambda *a, **k: {}
    obj._implement_app_block_files = lambda files, source: {}
    obj._implement_app_scopes = lambda name, app_obj, scopes, warnings, poll_s: app_obj
    obj._implement_app_job_resources = lambda name, app_obj, jobs, warnings, on_lakebase, poll_s, warehouse: (app_obj, False)
    obj._implement_app_warehouse = lambda context: ""
    obj._implement_app_owner_tag = lambda uc_id: "owner"
    obj._implement_tag_app = lambda context, name: ""
    obj._implement_app_write_grants = lambda *a, **k: []
    obj._implement_app_sibling_access = lambda *a, **k: []
    obj._implement_app_audience_grants = lambda name, views, reasons, permissions, ran=None: ([{"name": AMR}], [])
    obj._implement_app_audience_unread = lambda views, audience: {}
    obj._implement_app_read_grants = lambda *a, **k: {}
    obj._implement_app_principal_grants = lambda principal, views, reasons, ran=None: []
    obj._implement_app_write_access = lambda *a, **k: []
    obj._implement_app_deployment = lambda *a, **k: {}
    obj._implement_app_health = lambda *a, **k: "healthy"
    obj._implement_app_undo = lambda *a, **k: None
    obj._implement_undo_save = lambda *a, **k: None
    obj._implement_write_app_files = lambda *a, **k: []
    obj._implement_app_alerts_paused = lambda was: ([], [])
    obj._implement_app_alert_access = lambda *a, **k: []
    obj._implement_app_feedback_table = lambda *a, **k: []
    obj._implement_app_feedback_create = lambda *a, **k: []
    obj._implement_app_feedback_inside = lambda *a, **k: []
    obj._implement_ledger_access = lambda *a, **k: None
    obj._implement_lakebase_grant = lambda *a, **k: ""
    obj._implement_existing_tables = lambda tables, warnings: []
    obj._implement_grant = lambda *a, **k: []
    return obj


def _context():
    return {"uc_id": "UC-A", "key": (1, "UC-A", 1), "use_case": {"Name": "Use case A", "No": "UC-A"}, "result_table": RESULT,
            "spec": {"outputs": {"app_access": "user"}, "job_slug": "", "job_tags": {}}, "app_host": {}, "allowed": [SOURCE],
            "protected": {}, "permissions": [], "asset_status": {}, "reasons_view": "", "summary_table": "", "run_log": ""}


def test_deploy_persists_the_live_views_the_publish_put_in_place(agent_ns):
    spark = FakeSpark()
    obj = _obj(agent_ns, spark)
    fields = obj._implement_deploy_app(_context(), APP, {"app.py": "x"}, [])
    live = next(iter(_fresh_scopes(agent_ns).values()))["view"]
    asset = fields["_asset"]
    assert asset["views"] == [live], asset
    assert asset["sources_read"] == [], "the source the App reads through its view is not also a direct read"


def test_deploy_persists_no_view_for_an_app_that_publishes_none(agent_ns):
    """Must-exclude: a read object is only a view the publish named; nothing is invented."""
    spark = FakeSpark()
    obj = _obj(agent_ns, spark)
    obj._implement_build_scopes = lambda context: {}
    fields = obj._implement_deploy_app(_context(), APP, {"app.py": "x"}, [])
    assert "views" not in fields.get("_asset", {}) or fields["_asset"]["views"] == []
