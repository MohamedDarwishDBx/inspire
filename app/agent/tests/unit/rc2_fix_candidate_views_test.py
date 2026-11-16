"""A build attempt checks candidate scope views; only publish puts the live views in place.

Before this change every attempt rewrote the App-owned scope views under their live names, so a published App read candidate
definitions while a rebuild ran. Now an attempt creates each scope view under a candidate name (the live name plus
CANDIDATE_VIEW_SUFFIX), its page check, candidate App files and Genie checks read the candidate, and publish swaps the live views,
writes the App files, Genie space and dashboard with the live names, and drops the candidates. A failed attempt drops its
candidates and leaves the live views byte-identical.
"""
import logging
import re

VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope"
CANDIDATE = VIEW + "__candidate"
SOURCE = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__sales_transactions_raw"
APP = "inspire-walk-v153-e2e-fra-d38f"
AUDIENCE = "audience.person@example.com"
BODY_V7 = f"SELECT amount, region, product FROM {SOURCE} WHERE v = 7"
BODY_V6 = f"SELECT amount, region FROM {SOURCE} WHERE v = 6"
LIVE_V6 = f"CREATE OR REPLACE VIEW {VIEW} AS SELECT amount, region FROM {SOURCE} WHERE v = 6"


def _quoted(name, quote):
    return ".".join(quote(part) for part in name.split("."))


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class FakeSpark:
    """A catalog of view definitions keyed by the unquoted view name, recording every statement in order."""

    def __init__(self, live):
        self.views = dict(live)
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        if statement.startswith("SHOW CREATE TABLE "):
            name = statement[len("SHOW CREATE TABLE "):].replace("`", "")
            if name not in self.views:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {name} cannot be found. SQLSTATE: 42P01")
            return FakeResult([[self.views[name]]])
        match = re.match(r"CREATE (?:OR REPLACE )?VIEW (.+?) AS ", statement)
        if match:
            self.views[match.group(1).replace("`", "")] = statement
        match = re.match(r"DROP VIEW IF EXISTS (.+)$", statement)
        if match:
            self.views.pop(match.group(1).replace("`", ""), None)
        return FakeResult([])


def _live_scope(agent_ns):
    quote = agent_ns["inspire_quote_identifier"]
    return {"table": SOURCE, "columns": ["amount", "region", "product"], "rows": [], "where": "", "source": f"({BODY_V7})",
            "view": VIEW, "view_ref": _quoted(VIEW, quote), "view_sql": agent_ns["inspire_owned_view_sql"](VIEW, BODY_V7), "ready": False,
            "pattern": None}


def _scopes(agent_ns):
    return {agent_ns["inspire_table_scope_key"](SOURCE): _live_scope(agent_ns)}


def _obj(agent_ns, spark):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = spark
    obj.logger = logging.getLogger("rc2-fix-candidate-views")
    return obj


def _context(**extra):
    base = {"uc_id": "N01-U01", "spec": {"outputs": {"app_access": "user"}}, "app_host": {"name": APP}, "permissions": []}
    base.update(extra)
    return base


def _mentions_live(statement):
    # The live name as a whole name: the candidate name starts with it, so a plain substring test would match the candidate too.
    return re.search(re.escape(VIEW) + r"(?!\w)", statement.replace("`", "")) is not None


def test_a_candidate_scope_is_the_live_view_under_the_candidate_name(agent_ns):
    scope = _live_scope(agent_ns)
    candidate = agent_ns["scope_candidate"](scope)
    assert candidate["view"] == CANDIDATE
    assert candidate["view_ref"] == _quoted(CANDIDATE, agent_ns["inspire_quote_identifier"])
    assert candidate["view_sql"] == agent_ns["inspire_owned_view_sql"](CANDIDATE, BODY_V7), "the candidate reads the same body"
    assert candidate["ready"] is False
    assert scope["view"] == VIEW, "the live scope is not changed by making its candidate"


def test_a_failed_attempt_never_touches_the_live_view_at_any_round(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context()
    live = dict(spark.views)
    for _round in range(2):
        candidates = obj._implement_candidate_scopes(context, _scopes(agent_ns))
        agent_ns["create_scope_views"](spark, candidates)
        assert spark.views[VIEW] == LIVE_V6, "the live definition stays byte-identical while the candidate is checked"
        assert spark.views[CANDIDATE] == agent_ns["inspire_owned_view_sql"](CANDIDATE, BODY_V7), "the check reads the candidate"
        assert not [s for s in spark.statements if _mentions_live(s)], "no statement of the attempt names the live view"
        assert obj._implement_restore_live_views(context, "app") == []
        assert spark.views[VIEW] == LIVE_V6, "after the failed round the live definition is still the one the App reads"
        assert CANDIDATE not in spark.views, "the failed round drops its candidate"
    assert dict(spark.views) == {VIEW: LIVE_V6}, "after both failed rounds only the live view remains, unchanged"
    assert live == {VIEW: LIVE_V6}


def test_a_successful_publish_swaps_the_live_view_and_drops_the_candidate(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context()
    candidates = obj._implement_candidate_scopes(context, _scopes(agent_ns))
    agent_ns["create_scope_views"](spark, candidates)
    checked = len(spark.statements)

    views = obj._implement_publish_views(context, _scopes(agent_ns))
    assert views == [VIEW], "publish names the live view, the one the audience and the App's principal are granted"
    assert context["live_views"] == {VIEW: "CREATE OR REPLACE VIEW" + LIVE_V6[len("CREATE OR REPLACE VIEW"):]}, \
        "the live definition is saved before publish swaps it"
    assert spark.views[VIEW] == agent_ns["inspire_owned_view_sql"](VIEW, BODY_V7), "the live view now has the checked definition"
    assert obj._implement_drop_candidates(context) == []
    assert CANDIDATE not in spark.views, "the candidate is dropped after publish"
    swap = [i for i, s in enumerate(spark.statements) if s.startswith("CREATE OR REPLACE VIEW ") and _mentions_live(s)]
    assert swap and swap[0] >= checked, "the live swap comes after the candidate was checked"
    assert spark.statements[-1].startswith("DROP VIEW IF EXISTS "), "the last statement of a published attempt drops the candidate"


def test_a_candidate_is_dropped_once_even_when_several_attempts_recorded_it(agent_ns):
    spark = FakeSpark({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context()
    for _round in range(3):
        agent_ns["create_scope_views"](spark, obj._implement_candidate_scopes(context, _scopes(agent_ns)))
    obj._implement_drop_candidates(context)
    drops = [s for s in spark.statements if s.startswith("DROP VIEW IF EXISTS ")]
    expected = "DROP VIEW IF EXISTS " + _quoted(CANDIDATE, agent_ns["inspire_quote_identifier"])
    assert drops == [expected], "each candidate name is dropped once, by its quoted name, after the rounds that created it"
    assert CANDIDATE not in spark.views and VIEW in spark.views


def test_a_failed_drop_is_reported_as_a_note_and_never_raised(agent_ns):
    class DropFails(FakeSpark):
        def sql(self, statement):
            if statement.startswith("DROP VIEW"):
                self.statements.append(statement)
                raise RuntimeError("[INSUFFICIENT_PRIVILEGES] no privilege")
            return super().sql(statement)

    spark = DropFails({VIEW: LIVE_V6})
    obj = _obj(agent_ns, spark)
    context = _context()
    obj._implement_candidate_scopes(context, _scopes(agent_ns))
    notes = obj._implement_drop_candidates(context)
    assert len(notes) == 1 and "could not drop its candidate view" in notes[0]
    assert "candidate_views" not in context, "the registry is cleared even when a drop fails"


def test_published_files_and_genie_space_name_only_live_views(agent_ns):
    scopes = _scopes(agent_ns)
    pairs = agent_ns["scope_publish_pairs"](scopes)
    candidate_ref = _quoted(CANDIDATE, agent_ns["inspire_quote_identifier"])
    live_ref = _quoted(VIEW, agent_ns["inspire_quote_identifier"])
    files = {"app/pages.json": f'{{"sql": "SELECT * FROM {candidate_ref} WHERE region = \'EU\'"}}',
             "app/settings.json": f'{{"reads": ["{CANDIDATE}"]}}'}
    space = {"data_sources": {"tables": [{"identifier": CANDIDATE, "column_configs": []}]},
             "config": {"sample_questions": [{"sql": [f"SELECT COUNT(*) FROM {CANDIDATE}"]}]}}

    published_files = agent_ns["scope_publish_rename"](files, pairs)
    published_space = agent_ns["scope_publish_rename"](space, pairs)

    assert "__candidate" not in repr(published_files) and "__candidate" not in repr(published_space)
    assert live_ref in published_files["app/pages.json"] and VIEW in published_files["app/settings.json"]
    assert published_space["data_sources"]["tables"][0]["identifier"] == VIEW
    assert published_space["config"]["sample_questions"][0]["sql"] == [f"SELECT COUNT(*) FROM {VIEW}"]
    assert space["data_sources"]["tables"][0]["identifier"] == CANDIDATE, "the checked artifact is not changed by the rename"


def test_the_live_name_of_a_table_that_is_not_scoped_is_left_alone(agent_ns):
    pairs = agent_ns["scope_publish_pairs"](_scopes(agent_ns))
    text = f"SELECT * FROM {SOURCE} WHERE v = 7"
    assert agent_ns["scope_publish_rename"](text, pairs) == text


def test_every_create_scope_views_call_in_the_notebook_is_a_candidate_attempt_or_the_publish_swap(agent_ns):
    """Closing grep for the defect class. Exactly four create_scope_views calls remain: the definition itself, the pass-through in
    scope_genie_space, two attempts on candidate scopes (no live=), and the one publish swap (live=). An attempt that creates its
    scope views under a live name, or a publish that does not save the live definition first, fails here."""
    import json
    from pathlib import Path

    notebook = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
    cells = json.loads(notebook.read_text(encoding="utf-8"))["cells"]
    source = "\n".join("".join(c["source"]) for c in cells if c.get("cell_type") == "code")
    calls = list(re.finditer(r"(?<!def )\bcreate_scope_views\(((?:[^()]|\([^()]*\))*)\)", source))
    args = sorted(m.group(1) for m in calls)
    assert args == sorted([
        "spark, scopes, live=live",
        'self.spark, scopes, live=context.setdefault("live_views", {})',
        "self.spark, scopes",
        "self.spark, scopes",
        "self.spark, {key: scope_named(scope, suffix) for key, scope in scopes_in_force(scopes).items()}",
    ]), args
    for match in calls:
        if match.group(1) == "self.spark, scopes":
            before = source[: match.start()]
            assert before.rfind("scopes = self._implement_candidate_scopes(") > before.rfind("create_scope_views("), \
                "an attempt creates candidate scopes, not the live views"
    genie = []
    for match in re.finditer(r"(?<!def )\bscope_genie_space\(", source):
        depth, end = 1, match.end()
        while depth:
            depth += {"(": 1, ")": -1}.get(source[end], 0)
            end += 1
        genie.append(source[match.end():end - 1])
    assert genie and all("_implement_candidate_scopes(" in g and "live=" not in g for g in genie), genie
