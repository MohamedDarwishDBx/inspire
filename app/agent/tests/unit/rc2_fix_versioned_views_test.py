"""A side output (vibe keep) reads its own versioned views and never touches the live ones; a replacing output (vibe remove) swaps the live
views and grants them before anything else is written (REQ-210).

With keep, the previous App keeps its live views byte-identical, so it shows its own data and keeps its grants, and the side App reads
only the views named with its version suffix. With remove, the swap comes immediately before the readers are granted.
"""
import json
import logging
import re

from rc2_fix_candidate_views_test import CANDIDATE, FakeSpark, SOURCE, VIEW, _scopes

VERSIONED = VIEW + "__v5"
LIVE_BODY = "SELECT amount, region FROM " + SOURCE + " WHERE v = 6"


def _obj(agent_ns, spark, scopes):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-versioned-views")
    obj._implement_build_scopes = lambda context: scopes
    return obj


def _context(side=()):
    return {"uc_id": "N05-U02", "key": (1, "N05-U02", 5), "use_case": {"No": "N05-U02"}, "side": tuple(side)}


def _quoted(agent_ns, name):
    return ".".join(agent_ns["inspire_quote_identifier"](p) for p in name.split("."))


def _mentions(statement, name):
    return re.search(re.escape(name) + r"(?!\w)", statement.replace("`", "")) is not None


def _live_views(agent_ns):
    """A live view as the previous App left it: the definition is CREATE OR REPLACE VIEW of the live name over the same source."""
    return {VIEW: agent_ns["inspire_owned_view_sql"](VIEW, LIVE_BODY)}


def test_keep_leaves_the_live_views_byte_identical_and_creates_only_the_versioned_view(agent_ns):
    spark = FakeSpark(_live_views(agent_ns))
    before = dict(spark.views)
    context = _context(side=("app",))
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    assert obj._implement_publish_views(context, _scopes(agent_ns), "app") == [VERSIONED]
    assert spark.views[VIEW] == before[VIEW], "the previous App's live view is byte-identical after the side build publishes"
    assert not [s for s in spark.statements if _mentions(s, VIEW)], "no statement of the side build names the live view"
    assert "live_views" not in context, "nothing is saved for a restore: the live views were never touched"
    assert VERSIONED in spark.views


def test_keep_grants_the_versioned_view_and_the_live_view_is_not_granted(agent_ns):
    """The grant decision reads the views the publish returned: under keep those are the versioned names, never the live ones."""
    spark = FakeSpark(_live_views(agent_ns))
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    views = obj._implement_publish_views(_context(side=("app",)), _scopes(agent_ns), "app")
    assert views == [VERSIONED] and VIEW not in views


def test_the_side_app_reads_only_its_versioned_names(agent_ns):
    obj = _obj(agent_ns, FakeSpark({}), _scopes(agent_ns))
    cand_ref = ".".join(agent_ns["inspire_quote_identifier"](p) for p in CANDIDATE.split("."))
    page = {"id": "n05_u02", "datasets": [{"name": "kpi", "sql": f"SELECT SUM(amount) AS total FROM {cand_ref}"}]}
    files = {"pages/n05_u02.json": json.dumps(page)}
    renamed = obj._implement_live_names(_context(side=("app",)), files, "app")
    text = renamed["pages/n05_u02.json"]
    assert _quoted(agent_ns, VERSIONED) in text, "the page reads the versioned view by its quoted reference"
    assert "__candidate" not in text and not _mentions(text, VIEW), "the side App's files name its versioned view and no live view"


def test_remove_swaps_the_live_view_and_saves_its_definition_for_the_restore_backstop(agent_ns):
    spark = FakeSpark(_live_views(agent_ns))
    context = _context(side=())
    obj = _obj(agent_ns, spark, _scopes(agent_ns))
    assert obj._implement_publish_views(context, _scopes(agent_ns), "app") == [VIEW]
    assert context["live_views"] == {VIEW: _live_views(agent_ns)[VIEW]}, "the live definition is saved before the swap"
    assert spark.views[VIEW] == agent_ns["inspire_owned_view_sql"](VIEW, "SELECT amount, region, product FROM " + SOURCE + " WHERE v = 7")


def test_remove_grants_the_swapped_view_before_any_other_write(agent_ns):
    """Closing check on _implement_deploy_app: between the live swap for a replacing App and its first reader grant, nothing writes
    the App, deploys it, or creates a view."""
    from pathlib import Path

    notebook = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
    cells = json.loads(notebook.read_text(encoding="utf-8"))["cells"]
    code = "\n".join("".join(c["source"]) for c in cells if c.get("cell_type") == "code")
    head = code.index("    def _implement_deploy_app(")
    source = code[head:code.index("\n    def ", head + 10)]
    marker = "# The live views (vibe remove) are swapped here"
    assert source.count(marker) == 1
    start = source.index(marker)
    grants = [source.index(g, start) for g in ("self._implement_app_principal_grants(client_id, views",
                                              "self._implement_app_audience_grants(app_name, views") if g in source[start:]]
    assert grants, "the readers of the swapped views are granted in the same publish"
    between = source[start:min(grants)]
    for forbidden in ("_implement_write_app_files(", "_implement_app_deployment(", "create_scope_views("):
        assert forbidden not in between, f"{forbidden} runs between the live swap and its grants"


def test_no_published_output_names_a_candidate_or_a_live_view_under_keep(agent_ns):
    """Closing scan: under keep every published output names only versioned views."""
    obj = _obj(agent_ns, FakeSpark({}), _scopes(agent_ns))
    cand_ref = ".".join(agent_ns["inspire_quote_identifier"](p) for p in CANDIDATE.split("."))
    context = _context(side=("app", "genie_space", "dashboard"))
    space = {"data_sources": {"tables": [{"identifier": CANDIDATE, "column_configs": []}]},
             "config": {"sample_questions": [{"question": ["Total?"], "sql": [f"SELECT SUM(amount) FROM {cand_ref}"]}]}}
    dashboard = {"datasets": [{"name": "kpi", "query": f"SELECT amount FROM {cand_ref}"}]}
    page = {"id": "n05_u02", "datasets": [{"name": "kpi", "sql": f"SELECT SUM(amount) FROM {cand_ref}"}]}
    published = {name: obj._implement_live_names(context, value, name) for name, value in
                 (("app", page), ("genie_space", space), ("dashboard", dashboard))}
    for name, value in published.items():
        text = json.dumps(value)
        assert "__candidate" not in text, name
        assert not _mentions(text, VIEW), f"{name} names the live view under keep"
        assert _quoted(agent_ns, VERSIONED) in text, f"{name} reads its versioned view"
