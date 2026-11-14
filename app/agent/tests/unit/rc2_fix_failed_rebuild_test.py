"""A rebuild that does not publish its App leaves the App's live scope views and their reader grants as they were.

Each attempt before publish rewrote the App-owned scope views with the candidate's definitions (create_scope_views, CREATE OR REPLACE
VIEW), and nothing put them back or granted their readers again, so the live App was denied (waiting for access). create_scope_views now
saves each live definition first (live=...), and _implement_restore_live_views puts it back and re-grants when the App was not written.
"""
import logging
import re

VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope"
REASONS = "inspire_kinds_rc7._inspire.inspire_walk_v153_e2e_n01_u01_n01_u01_results__signal__n01_u01__implement_scope"
SOURCE = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__sales_transactions_raw"
APP = "inspire-walk-v153-e2e-fra-d38f"
AMR = "audience.person@example.com"
LIVE_V6 = (f"CREATE VIEW `inspire_kinds_rc7`.`_inspire`.`inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope` "
           "(`amount`, `region`) AS SELECT amount, region FROM `inspire_kinds_rc7`.`_inspire`.`sales_transactions_raw` WHERE v = 6")
LIVE_V6_REPLACE = "CREATE OR REPLACE VIEW" + LIVE_V6[len("CREATE VIEW"):]
CANDIDATE_V7_SQL = (f"CREATE OR REPLACE VIEW {VIEW} AS SELECT amount, region, product FROM {SOURCE} WHERE v = 7")
ACL_SHARED = {"access_control_list": [
    {"user_name": AMR, "all_permissions": [{"permission_level": "CAN_USE"}]},
    {"service_principal_name": "app-sp", "all_permissions": [{"permission_level": "CAN_MANAGE"}]},
]}


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class FakeSpark:
    """Records every statement. SHOW CREATE TABLE returns the live definition of a view that exists, or fails as NOT_FOUND."""

    def __init__(self, live):
        self.live = dict(live)
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("SHOW CREATE TABLE "):
            view = statement[len("SHOW CREATE TABLE "):]
            if view not in self.live:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {view} cannot be found. SQLSTATE: 42P01")
            return FakeResult([[self.live[view]]])
        if statement.startswith(("CREATE OR REPLACE VIEW ", "CREATE VIEW ")):
            self.live[VIEW] = statement
        return FakeResult([])


def _obj(agent_ns, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-failed-rebuild")
    obj._implement_api = lambda method, path, body=None: ACL_SHARED
    obj._implement_access_rows = lambda table: []
    return obj


def _context(**extra):
    base = {"uc_id": "N01-U01", "spec": {"outputs": {"app_access": "user"}}, "app_host": {"name": APP},
            "reasons_view": REASONS, "permissions": []}
    base.update(extra)
    return base


def _scopes():
    return {VIEW: {"view": VIEW, "table": SOURCE, "view_sql": CANDIDATE_V7_SQL, "ready": False}}


def _index(statements, predicate):
    return [i for i, s in enumerate(statements) if predicate(s)]


def test_a_failed_build_puts_the_live_view_back_and_grants_the_audience_again(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context()
    context["live_views"] = {}
    # The attempt rewrites the live view with the candidate's definition, then the publish never happens.
    agent_ns["create_scope_views"](spark, _scopes(), live=context["live_views"])
    assert context["live_views"] == {VIEW: LIVE_V6_REPLACE}, "the definition the App reads is saved before the rewrite"
    assert spark.live[VIEW] == CANDIDATE_V7_SQL, "the candidate rewrote the live view (the state the failure left behind)"

    notes = obj._implement_restore_live_views(context, "app")

    assert notes == []
    restore = _index(spark.statements, lambda s: s.startswith("CREATE OR REPLACE VIEW ") and s != CANDIDATE_V7_SQL)
    assert restore, "the saved definition is put back"
    assert spark.statements[restore[-1]] == LIVE_V6_REPLACE
    grants = _index(spark.statements, lambda s: s.startswith("GRANT SELECT ON TABLE") and VIEW.split(".")[-1] in s and f"TO `{AMR}`" in s)
    assert grants and grants[-1] > restore[-1], "the audience is granted the view again after the view is put back"
    assert context["permissions"] == [], "a successful re-grant leaves no Permission Required entry"


def test_a_published_app_keeps_its_new_views(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context(app_written=True)
    context["live_views"] = {}
    agent_ns["create_scope_views"](spark, _scopes(), live=context["live_views"])
    before = list(spark.statements)

    assert obj._implement_restore_live_views(context, "app") == []

    assert spark.statements == before, "once the App is written in this build, its new views stay: nothing is restored or granted"


def test_a_first_build_with_no_live_view_restores_nothing(agent_ns):
    spark = FakeSpark({})
    obj = _obj(agent_ns, spark)
    context = _context()
    context["live_views"] = {}
    agent_ns["create_scope_views"](spark, _scopes(), live=context["live_views"])
    assert context["live_views"] == {VIEW: None}, "a view that does not exist yet is recorded as absent"
    before = list(spark.statements)

    assert obj._implement_restore_live_views(context, "app") == []

    assert spark.statements == before


def test_a_view_is_saved_once_per_build_so_a_second_attempt_keeps_the_live_definition(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    context = _context(live_views={})
    agent_ns["create_scope_views"](spark, _scopes(), live=context["live_views"])
    # The second attempt builds its scopes again (ready is False again) and rewrites the view a second time.
    agent_ns["create_scope_views"](spark, _scopes(), live=context["live_views"])
    assert context["live_views"] == {VIEW: LIVE_V6_REPLACE}, "the second attempt must not save its own candidate over the live definition"


def test_a_name_that_is_not_a_view_is_never_rewritten(agent_ns):
    spark = FakeSpark({VIEW: "CREATE TABLE `inspire_kinds_rc7`.`_inspire`.`x` (a INT)"})
    try:
        agent_ns["scope_view_definition"](spark, VIEW)
    except ValueError as error:
        assert "is not a view" in str(error)
    else:
        raise AssertionError("a table under a scope view name must refuse the rewrite, not replace the table")
