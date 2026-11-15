"""A side output (vibe keep) that fails before its publish drops the versioned views it created; once it has published, its versioned
views stay, because the App or Genie Agent or dashboard it serves reads them (REQ-210 cleanup).
"""
import logging

from rc2_fix_candidate_views_test import FakeSpark, SOURCE, VIEW, _scopes
from rc2_fix_versioned_views_test import VERSIONED

def _obj(agent_ns, spark, scopes):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-versioned-cleanup")
    obj._implement_build_scopes = lambda context: scopes
    return obj


def _context(side=("app",)):
    return {"uc_id": "N05-U02", "key": (1, "N05-U02", 5), "use_case": {"No": "N05-U02"}, "side": tuple(side), "permissions": []}


def _live(agent_ns):
    return {VIEW: agent_ns["inspire_owned_view_sql"](VIEW, f"SELECT amount, region FROM {SOURCE} WHERE v = 6")}


def _drops(spark):
    return [s for s in spark.statements if s.startswith("DROP VIEW IF EXISTS ")]


def test_a_side_publish_that_fails_drops_the_versioned_view_it_created(agent_ns):
    spark = FakeSpark(_live(agent_ns))
    live_before = dict(spark.views)
    context = _context()
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    assert obj._implement_publish_views(context, _scopes(agent_ns), "app") == [VERSIONED]
    assert VERSIONED in spark.views
    assert obj._implement_restore_live_views(context, "app") == []
    assert VERSIONED not in spark.views, "the failed side build leaves no versioned view behind"
    assert spark.views[VIEW] == live_before[VIEW], "the previous App's live view is untouched"
    assert len(_drops(spark)) == 1 and VERSIONED.split(".")[-1] in _drops(spark)[0]


def test_a_side_output_that_published_keeps_its_versioned_views_when_a_later_step_fails(agent_ns):
    spark = FakeSpark(_live(agent_ns))
    context = _context(side=("genie_space",))
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    obj._implement_publish_views(context, _scopes(agent_ns), "genie_space")
    context.setdefault("published", set()).add("genie_space")
    assert obj._implement_restore_live_views(context, "genie_space") == []
    assert VERSIONED in spark.views and _drops(spark) == [], "a written output keeps the versioned views it serves"


def test_a_failed_app_after_its_write_keeps_its_versioned_views(agent_ns):
    spark = FakeSpark(_live(agent_ns))
    context = _context()
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    obj._implement_publish_views(context, _scopes(agent_ns), "app")
    context["app_written"] = True
    obj._implement_restore_live_views(context, "app")
    assert VERSIONED in spark.views and _drops(spark) == []


def test_a_failed_versioned_drop_is_a_note_not_an_exception(agent_ns):
    class DropFails(FakeSpark):
        def sql(self, statement):
            if statement.startswith("DROP VIEW"):
                self.statements.append(statement)
                raise RuntimeError("[INSUFFICIENT_PRIVILEGES] no privilege")
            return super().sql(statement)

    spark = DropFails(_live(agent_ns))
    context = _context()
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    obj._implement_publish_views(context, _scopes(agent_ns), "app")
    notes = obj._implement_drop_versioned(context, "app")
    assert len(notes) == 1 and "did not publish" in notes[0]
