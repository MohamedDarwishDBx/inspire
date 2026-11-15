"""REQ-235: a side App (vibe keep) grants its audience and reads its objects on its versioned views, never the live views.

The audience of a new side App is shared after its deploy (REQ-185), so the grant that reaches it runs in _implement_app_audience_after_share.
That grant read the live view names, which belong to the previous App, so the side App's readers got no grant on the views it reads.
The grant now reads the views the publish named (the versioned views under keep), and the persisted read objects name the same views.
"""
import logging

LIVE = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n06_u01__implement_scope"
VERSIONED = LIVE + "__v7"
REASONS = "inspire_kinds_rc7._inspire.inspire_walk_e2e_n06_u01_n06_u01_results__signal__n06_u01__implement_scope"
APP = "inspire-e2e-walk-customers-v2"
AMR = "amr.ali@example.com"
GROUP = "Customer Analysts"
ACL = {"access_control_list": [
    {"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"group_name": GROUP, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"service_principal_name": "app-sp", "all_permissions": [{"permission_level": "CAN_MANAGE"}]},
]}


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)


def _scopes():
    return {LIVE: {"view": LIVE, "ready": True, "key": LIVE}}


def _obj(agent_ns, spark, scopes=None):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-side-grants")
    obj._implement_api = lambda method, path, body=None: ACL
    obj._implement_build_scopes = lambda context: scopes if scopes is not None else _scopes()
    obj._implement_access_rows = lambda table: []
    return obj


def _keep(**extra):
    context = {"uc_id": "N06-U01", "key": (1, "N06-U01", 7), "side": ("app",), "reasons_view": REASONS,
               "permissions": [], "spec": {"outputs": {}}, "versioned_views": {"app": [VERSIONED]}}
    context.update(extra)
    return context


def _mentions(statement, name):
    import re
    return re.search(re.escape(name) + r"(?!\w)", statement.replace("`", "")) is not None


def _granted_to(statements, name):
    return {s.rsplit(" TO ", 1)[1] for s in statements if s.startswith("GRANT SELECT ON TABLE") and _mentions(s, name)}


def test_keep_grants_select_on_each_versioned_view_to_every_principal_the_live_views_get(agent_ns):
    spark = FakeSpark()
    context, asset_status = _keep(), {}
    problems = _obj(agent_ns, spark)._implement_app_audience_after_share(context, APP, asset_status)
    assert problems == []
    versioned = _granted_to(spark.statements, VERSIONED)
    assert versioned == {f"`{AMR}`", f"`{GROUP}`"}, spark.statements
    assert f"GRANT USE CATALOG ON CATALOG `inspire_kinds_rc7` TO `{AMR}`" in spark.statements
    recorded = {r["table"] for r in asset_status["grants"]["app_audience"][APP]["sql"]}
    assert recorded == {VERSIONED, REASONS}, "the grants record names the versioned view the side App reads"


def test_keep_never_grants_the_live_view_the_previous_app_reads(agent_ns):
    spark = FakeSpark()
    _obj(agent_ns, spark)._implement_app_audience_after_share(_keep(), APP, {})
    assert not [s for s in spark.statements if _mentions(s, LIVE)], "no statement of the side build names the live view"


def test_remove_still_grants_the_live_view_to_the_same_principals(agent_ns):
    """Must-exclude: a replacing App (vibe remove) keeps reading the live views and keeps its grants on them."""
    spark = FakeSpark()
    context = {"uc_id": "N06-U01", "key": (1, "N06-U01", 7), "side": (), "reasons_view": REASONS, "permissions": [],
               "spec": {"outputs": {}}}
    _obj(agent_ns, spark)._implement_app_audience_after_share(context, APP, {})
    assert _granted_to(spark.statements, LIVE) == {f"`{AMR}`", f"`{GROUP}`"}
    assert not [s for s in spark.statements if _mentions(s, VERSIONED)]


def test_keep_without_a_versioned_publish_in_this_build_grants_nothing_on_the_live_views(agent_ns):
    spark = FakeSpark()
    context = _keep(versioned_views={})
    _obj(agent_ns, spark)._implement_app_audience_after_share(context, APP, {})
    assert not [s for s in spark.statements if _mentions(s, LIVE)], "a side App is never granted the previous App's live views"


def test_the_persisted_read_objects_of_a_side_app_name_its_versioned_views(agent_ns):
    obj = _obj(agent_ns, FakeSpark())
    assert obj._implement_app_read_views(_keep()) == [VERSIONED]
    assert obj._implement_app_read_views({"side": (), "reasons_view": REASONS}) == [LIVE]
