"""REQ-268 / REQ-245: the Table Scope views of a use case belong to its session, so a first build's App readers keep their grants.

The App-owned scope views of a use case are named by the use case number (N04-U01) in one schema per catalog. Two sessions that each
have a use case N04-U01 in the same catalog therefore wrote the same view: the second build's CREATE OR REPLACE VIEW rewrote the view
the first App reads, and the rewrite dropped the grants the App's readers held. On walker T2's first build (session 1794649528905225587)
the audience grants ran at 13:05 to 13:08 UTC, and the shared sales view was replaced at 13:35 UTC by another session's N04-U01 build.

The view tag now carries the session (implement_scope_tag), so one session's build never names another session's view. A rebuild in the
same session names the same views, so its own readers are granted again as before.
"""
import json
import logging

SOURCE = "inspire_kinds_rc7._inspire.sales_transactions"
DATABASE = "inspire_kinds_rc7._inspire"
APP = "inspire-walk-rc2-planning"
AMR = "amr.ali@example.com"
FIRST_SESSION = "1794649528905225587"
OTHER_SESSION = "1794654914621667415"
ACL = {"access_control_list": [{"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]}]}


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("SHOW CREATE TABLE "):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] The table or view cannot be found. SQLSTATE: 42P01")
        return self


def _use_case(session):
    return {"No": "N04-U01", "_source_session_id": session, "_implement_data": {"column_roles": {"value": f"{SOURCE}.amount"}}}


def _runner(agent_ns, spark, session):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-session-scope")
    obj.inspire_database = DATABASE
    obj._implement_api = lambda method, path, body=None: ACL
    obj._genie_involved_tables = lambda use_case: [SOURCE]
    obj._implement_scope_columns = lambda table: ["amount", "region"]
    obj._implement_build_scopes = lambda context: obj._genie_scopes(context["use_case"])
    return obj


def _scopes(agent_ns, spark, session):
    obj = _runner(agent_ns, spark, session)
    return obj._genie_scopes(_use_case(session))


def _view_of(scopes):
    return next(s["view"] for s in scopes.values() if s.get("view"))


def _first_build(agent_ns, spark, session):
    obj = _runner(agent_ns, spark, session)
    return obj, {"uc_id": "N04-U01", "key": (int(session), "N04-U01", 1), "use_case": _use_case(session), "permissions": []}


def test_two_sessions_with_the_same_use_case_number_name_different_scope_views(agent_ns):
    """Fail-pre: the view tag ignored the session, so both sessions' N04-U01 scope view had one name."""
    first = _view_of(_scopes(agent_ns, FakeSpark(), FIRST_SESSION))
    other = _view_of(_scopes(agent_ns, FakeSpark(), OTHER_SESSION))
    assert first and other
    assert first != other, f"two sessions share one view: {first}"


def test_a_second_session_build_never_rewrites_the_first_sessions_view(agent_ns):
    """Fail-pre: the second build's publish rewrote the first build's view, which dropped that App's readers' grants."""
    spark = FakeSpark()
    first_obj, first_context = _first_build(agent_ns, spark, FIRST_SESSION)
    first_view = _view_of(first_obj._genie_scopes(first_context["use_case"]))
    first_obj._implement_publish_views(first_context, first_obj._implement_build_scopes(first_context), "app")
    first_obj._implement_app_audience_after_share(first_context, APP, {})
    before = len(spark.statements)

    other_obj, other_context = _first_build(agent_ns, spark, OTHER_SESSION)
    other_obj._implement_publish_views(other_context, other_obj._implement_build_scopes(other_context), "app")

    rewritten = [s for s in spark.statements[before:] if first_view in s.replace("`", "")]
    assert rewritten == [], f"the second session rewrote the first session's view: {rewritten}"


def test_first_build_grants_its_audience_select_on_its_own_session_view(agent_ns):
    """The first build of a user-authorization App grants its audience SELECT on the view its own session names."""
    spark = FakeSpark()
    obj, context = _first_build(agent_ns, spark, FIRST_SESSION)
    view = _view_of(obj._genie_scopes(context["use_case"]))
    obj._implement_publish_views(context, obj._implement_build_scopes(context), "app")
    asset_status = {}
    assert obj._implement_app_audience_after_share(context, APP, asset_status) == []
    granted = {s.rsplit(" TO ", 1)[1] for s in spark.statements if s.startswith("GRANT SELECT ON TABLE") and view in s.replace("`", "")}
    assert granted == {f"`{AMR}`"}, spark.statements
    recorded = {r["table"] for r in asset_status["grants"]["app_audience"][APP]["sql"]}
    assert view in recorded


def test_a_rebuild_in_the_same_session_names_the_same_views(agent_ns):
    """Must-exclude: a rebuild in the same session keeps its own view name, so its App readers are granted on the view they read."""
    first = _view_of(_scopes(agent_ns, FakeSpark(), FIRST_SESSION))
    again = _view_of(_scopes(agent_ns, FakeSpark(), FIRST_SESSION))
    assert first == again
