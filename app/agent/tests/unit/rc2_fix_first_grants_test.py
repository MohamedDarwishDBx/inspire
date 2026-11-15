"""REQ-245: the first build of a user-authorization App grants its audience SELECT on the live views the App reads.

The audience of an App is shared after its deploy, so the grant that reaches it runs in _implement_app_audience_after_share. That grant
read the App's views from a fresh scope list: a scope parsed from the use case starts not ready, so no view name came back and the
audience got no grant at all (the App then answered "The App cannot read the tables this page uses yet").
The grant now reads the views the publish named (context["published_views"]), the same names the App's read objects persist.

The scopes here are built the way production builds them: a new, not-ready list on every call. The side-grant test injects ready
scopes, which is why it never caught this.
"""
import json
import logging

SOURCE = "inspire_kinds_rc7._inspire.sales_transactions"
APP = "inspire-fulfillment-app"
AMR = "amr.ali@example.com"
ACL = {"access_control_list": [
    {"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"service_principal_name": "app-sp", "all_permissions": [{"permission_level": "CAN_MANAGE"}]},
]}


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("SHOW CREATE TABLE "):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found. SQLSTATE: 42P01")
        return self


def _obj(agent_ns, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-first-grants")
    obj._implement_api = lambda method, path, body=None: ACL
    obj._implement_build_scopes = lambda context: _fresh_scopes(agent_ns)
    return obj


def _fresh_scopes(agent_ns):
    return agent_ns["parse_table_scopes"](json.dumps({SOURCE: {"columns": ["amount", "region"]}}), "inspire_kinds_rc7._inspire",
                                          view_tag="uc_a")


def _first_build():
    return {"uc_id": "UC-A", "key": (1, "UC-A", 1), "permissions": []}


def _view(agent_ns):
    scope = next(iter(_fresh_scopes(agent_ns).values()))
    return scope["view"]


def _mentions(statement, name):
    import re
    return re.search(re.escape(name) + r"(?!\w)", statement.replace("`", "")) is not None


def _granted_to(statements, name):
    return {s.rsplit(" TO ", 1)[1] for s in statements if s.startswith("GRANT SELECT ON TABLE") and _mentions(s, name)}


def test_first_build_grants_the_audience_select_on_the_live_view_the_app_reads(agent_ns):
    spark = FakeSpark()
    obj, context, asset_status = _obj(agent_ns, spark), _first_build(), {}
    obj._implement_publish_views(context, obj._implement_build_scopes(context), "app")
    problems = obj._implement_app_audience_after_share(context, APP, asset_status)
    assert problems == []
    view = _view(agent_ns)
    assert _granted_to(spark.statements, view) == {f"`{AMR}`"}, spark.statements
    recorded = {r["table"] for r in asset_status["grants"]["app_audience"][APP]["sql"]}
    assert recorded == {view}, "the grants record names the live view the first build's App reads"


def test_first_build_grants_nothing_on_the_source_table_or_a_candidate_name(agent_ns):
    """Must-exclude: the grant never names the base table (no grant beyond what the App reads) or a candidate view."""
    spark = FakeSpark()
    obj, context = _obj(agent_ns, spark), _first_build()
    obj._implement_publish_views(context, obj._implement_build_scopes(context), "app")
    obj._implement_app_audience_after_share(context, APP, {})
    grants = [s for s in spark.statements if s.startswith("GRANT ")]
    assert grants, spark.statements
    assert not [s for s in grants if _mentions(s, SOURCE)], "no grant names the base table"
    assert not [s for s in grants if "__candidate" in s], "no grant names a candidate view"


def test_no_publish_means_no_audience_grant(agent_ns):
    """Must-exclude: an audience grant with nothing published this build names no object at all."""
    spark = FakeSpark()
    problems = _obj(agent_ns, spark)._implement_app_audience_after_share(_first_build(), APP, {})
    assert problems == []
    assert not [s for s in spark.statements if s.startswith("GRANT ")], spark.statements
