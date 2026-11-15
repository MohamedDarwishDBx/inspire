"""REQ-185: a user-authorization App's audience gets USE CATALOG, USE SCHEMA and SELECT on its App-owned views after the App is shared.

The deploy reads the audience before _implement_share shares the App, so a new App had an empty audience and no view grant ever ran.
The grant now runs after the share, on the App-owned views only, and the owner of those views is Inspire (never a raw principal id).
"""
import logging
import types

VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope"
REASONS = "inspire_kinds_rc7._inspire.inspire_walk_v153_e2e_n01_u01_n01_u01_results__signal__n01_u01__implement_scope"
SOURCE = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__sales_transactions_raw"
APP = "inspire-walk-v153-e2e-fra-d38f"
AMR = "audience.person@example.com"
INSPIRE_SP = "b2b3b070-1da5-45c3-b5b6-81a2feaf85bb"
ACL_AFTER_SHARE = {"access_control_list": [
    {"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"service_principal_name": "app-sp", "all_permissions": [{"permission_level": "CAN_MANAGE"}]},
]}


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)


def _obj(agent_ns, acl, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2b-audience")
    obj._implement_api = lambda method, path, body=None: acl
    obj._implement_build_scopes = lambda context: {VIEW: {"view": VIEW, "ready": True}}
    obj._implement_access_rows = lambda table: []
    return obj


def _context():
    # The publish records the views it put in place (REQ-245, eb73c49c7); the audience grant reads that list, not the build scopes.
    return {"reasons_view": REASONS, "permissions": [], "spec": {"outputs": {}}, "published_views": {"app": [VIEW]}}


def test_the_audience_read_after_the_share_is_granted_the_full_read_set_on_each_app_view(agent_ns):
    spark = FakeSpark()
    obj = _obj(agent_ns, ACL_AFTER_SHARE, spark)
    context, asset_status = _context(), {}
    problems = obj._implement_app_audience_after_share(context, APP, asset_status)
    assert problems == []
    assert f"GRANT USE CATALOG ON CATALOG `inspire_kinds_rc7` TO `{AMR}`" in spark.statements
    assert f"GRANT USE SCHEMA ON SCHEMA `inspire_kinds_rc7`.`_inspire` TO `{AMR}`" in spark.statements
    assert any(s.startswith("GRANT SELECT ON TABLE") and VIEW.split(".")[-1] in s and f"TO `{AMR}`" in s for s in spark.statements)
    recorded = asset_status["grants"]["app_audience"][APP]["sql"]
    assert {r["privilege"] for r in recorded} == {"SELECT", "READ METADATA"} and {r["table"] for r in recorded} == {VIEW, REASONS}, \
        "the grants record names each table-level grant on the view that ran (USE statements may be held through account users, so they are not recorded)"
    assert context["permissions"] == []


def test_the_audience_grant_never_names_a_source_table_the_app_reads_directly(agent_ns):
    spark = FakeSpark()
    obj = _obj(agent_ns, ACL_AFTER_SHARE, spark)
    obj._implement_app_audience_after_share(_context(), APP, {})
    assert spark.statements and not any(SOURCE in s for s in spark.statements)


def test_a_grant_the_build_cannot_run_for_the_audience_becomes_permission_required_with_its_sql(agent_ns):
    spark = FakeSpark()
    obj = _obj(agent_ns, ACL_AFTER_SHARE, spark)
    refused = f"GRANT SELECT ON TABLE `inspire_kinds_rc7`.`_inspire`.`{VIEW.split('.')[-1]}` TO `{AMR}`"

    def sql(statement):
        spark.statements.append(statement)
        if statement == refused:
            raise RuntimeError("[PERMISSION_DENIED] no MANAGE")
    obj.spark = types.SimpleNamespace(sql=sql)
    context = _context()
    obj._implement_app_audience_after_share(context, APP, {})
    entries = context["permissions"]
    assert len(entries) == 1 and entries[0]["principal"] == AMR and refused in entries[0]["statements"]


def test_an_unreadable_audience_is_a_warning_not_a_silent_skip(agent_ns):
    obj = _obj(agent_ns, None, FakeSpark())

    def fail(method, path, body=None):
        raise RuntimeError("HTTP 503")
    obj._implement_api = fail
    problems = obj._implement_app_audience_after_share(_context(), APP, {})
    assert len(problems) == 1 and "could not read who may open the App" in problems[0]


def test_the_build_runs_the_audience_grant_after_the_share(agent_ns):
    from _agentload import method_node, agent_source
    import ast
    source = ast.get_source_segment(agent_source(), method_node("DatabricksInspire", "_implement_one_locked"))
    share = source.index("self._implement_share(uc_id, result_table")
    assert share < source.index("self._implement_app_audience_after_share(context"), "the audience is read after the App is shared"


def test_the_owner_of_a_principal_id_is_never_named_and_inspire_passes_through(agent_ns):
    label = agent_ns["implement_owner_label"]
    assert label(INSPIRE_SP) == "your data owner"
    assert label("Inspire") == "Inspire"
    assert label(AMR) == "your data owner"
    assert label("Data Owners Group") == "Data Owners Group"
    assert label("") == "your data owner"


def test_the_view_record_names_inspire_as_owner_because_inspire_creates_the_views(agent_ns):
    assert agent_ns["IMPLEMENT_INSPIRE_OWNER"] == "Inspire"
