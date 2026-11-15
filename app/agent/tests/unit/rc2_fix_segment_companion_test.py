"""REQ-264: one companion-name rule for the writer, the layout check and every App page read, and a segmentation App whose
cards companion is not written yet falls back to the decision list instead of asking the page for a table nothing offers.

Live evidence (scratch catalog, use case N06-U01, result table inspire_kinds_rc7._inspire_walk_v153_e2e_n06_u01.n06_u01_results):
the segments companion exists with the lowercase name the notebook writes, and its columns are segment_id, label, size, value, profile.
The App fit check (shell_sql.part_table_problems) needs a table of the segment_cards section that reads that companion. The layout was
decided before the run wrote the companion, so the App prompt offered no companion table, and the page could not satisfy the check.
"""
from v120_artifacts_support import FakeSpark, make_inspire
from v208_companion_share_test import _Frame

RESULT = "inspire_kinds_rc7._inspire_walk_v153_e2e_n06_u01.n06_u01_results"
SEGMENTS = f"{RESULT}__segments"
ASSIGN = f"{RESULT}__assign"
MIGRATION = f"{RESULT}__migration"
# The live columns of the segments companion (databricks tables get, read-only).
LIVE_SEGMENTS_COLUMNS = ["segment_id", "label", "size", "value", "profile"]
SEGMENT_USE_CASE = {"use_case_kind": "segmentation"}


def _layout_inspire(ns, tmp_path, described):
    def answer(statement):
        table = statement.split("DESCRIBE TABLE ", 1)[1].replace("`", "")
        if table not in described:
            raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] {table}")
        return [{"col_name": c, "data_type": "string"} for c in described[table]]

    inst = make_inspire(ns, spark=FakeSpark(responder=answer), session_id=5150)
    inst.local_log_output_dir = str(tmp_path)
    return inst


def _shell_sql(ns, tmp_path):
    payload = ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))
    return ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])["shell_sql"]


def test_one_helper_names_a_result_companion_for_the_writer_and_the_app_reads(agent_ns):
    """Must-fail before the fix: the notebook built companion names in five places, and the App reads in two more, each by its own f-string."""
    facts = agent_ns["inspire_shell_facts"]
    assert facts.companion(RESULT, "__segments") == SEGMENTS
    assert facts.companion(f"`{RESULT.split('.')[0]}`.`{RESULT.split('.')[1]}`.`{RESULT.split('.')[2]}`", "__segments") == SEGMENTS
    assert set(agent_ns["implement_layout_tables"](RESULT, "segment_explorer")) == {SEGMENTS, ASSIGN, MIGRATION}
    assert {SEGMENTS, ASSIGN, MIGRATION} <= set(agent_ns["implement_app_result_reads"](RESULT))
    assert agent_ns["implement_kind_companion_tables"]({"result_table": RESULT, "use_case_kind": "segmentation"}).keys() >= {SEGMENTS}


def test_the_writer_saves_the_segments_companion_at_the_name_the_app_reads(agent_ns):
    """Must-keep: the writer and the App reads agree on the segments companion name, so the table the run writes is the one the page reads."""
    saved = []
    agent_ns["inspire_write_companion"](_Frame(LIVE_SEGMENTS_COLUMNS, saved), RESULT, "__segments", LIVE_SEGMENTS_COLUMNS, FakeSpark(), lambda _s: None)
    assert saved == [".".join(f"`{part}`" for part in SEGMENTS.split("."))]


def test_the_segment_cards_columns_are_a_subset_of_the_live_segments_companion(agent_ns, tmp_path):
    """Must-keep: the columns the App fit requires of the cards table are the columns the notebook writes, read from the live contract."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    contract = agent_ns["_inspire_kinds"]()["contracts"]["segments"]["suffixes"]["__segments"]
    assert contract == LIVE_SEGMENTS_COLUMNS
    assert set(shell_sql.PART_COLUMNS["segment_cards"]) <= set(LIVE_SEGMENTS_COLUMNS)


def test_a_segment_layout_whose_cards_companion_is_not_written_yet_falls_back_to_the_decision_list(agent_ns, tmp_path, capsys):
    """Fail-pre: the layout was kept as segment_explorer with no companion offered, so the App fit demanded a card table nothing could read.
    Post-fix: the layout falls back to the decision list, and says which table the run has not written."""
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path, {})
    layout, tables = inst._implement_app_layout("N06-U01", SEGMENT_USE_CASE, {}, RESULT, warnings, inst._implement_schema_reader())
    assert (layout, tables) == (agent_ns["INSPIRE_DEFAULT_LAYOUT"], {})
    assert len(warnings) == 1 and "segment_explorer" not in warnings[0] and "Segment explorer layout reads tables the run has not written yet" in warnings[0]
    assert SEGMENTS in warnings[0]
    assert "[APP-LAYOUT FIRED] N06-U01: segment_explorer -> " in capsys.readouterr().out


def test_a_segment_layout_keeps_its_layout_when_its_cards_companion_is_written_and_only_its_other_views_are_missing(agent_ns, tmp_path):
    """Must-keep: only the cards companion blocks the layout. A missing projection companion leaves its view out, not the layout."""
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path, {SEGMENTS: LIVE_SEGMENTS_COLUMNS})
    layout, tables = inst._implement_app_layout("N06-U01", SEGMENT_USE_CASE, {}, RESULT, warnings, inst._implement_schema_reader())
    assert layout == "segment_explorer"
    assert tables == {SEGMENTS: LIVE_SEGMENTS_COLUMNS}
    assert len(warnings) == 1 and "keeps its decision list" in warnings[0] and ASSIGN in warnings[0]


def test_the_app_build_reads_the_companions_the_run_wrote_before_it_draws_the_page(agent_ns, tmp_path):
    """Fail-pre: the layout was decided at context time, before the run wrote the companion, and the App page was drawn from that stale
    decision. Post-fix: the App build recomputes the layout and its companion tables from the schema it reads after the run."""
    inst = _layout_inspire(agent_ns, tmp_path, {SEGMENTS: LIVE_SEGMENTS_COLUMNS, ASSIGN: ["entity", "segment", "x", "y"],
                                                 MIGRATION: ["from_segment", "to_segment", "count"]})
    context = {"uc_id": "N06-U01", "use_case": dict(SEGMENT_USE_CASE), "spec": {"outputs": {}}, "result_table": RESULT,
               "allowed": [RESULT], "app_layout": agent_ns["INSPIRE_DEFAULT_LAYOUT"], "layout_tables": {}}
    inst._implement_refresh_app_layout(context)
    assert context["app_layout"] == "segment_explorer"
    assert set(context["layout_tables"]) == {SEGMENTS, ASSIGN, MIGRATION}
    assert {SEGMENTS, ASSIGN, MIGRATION} <= set(context["allowed"])


def test_the_app_build_keeps_a_layout_its_companions_still_do_not_support_out_of_the_page(agent_ns, tmp_path):
    """Must-exclude: a refresh against a schema with no companion does not invent a segment layout."""
    inst = _layout_inspire(agent_ns, tmp_path, {})
    context = {"uc_id": "N06-U01", "use_case": dict(SEGMENT_USE_CASE), "spec": {"outputs": {}}, "result_table": RESULT,
               "allowed": [RESULT], "app_layout": agent_ns["INSPIRE_DEFAULT_LAYOUT"], "layout_tables": {}}
    inst._implement_refresh_app_layout(context)
    assert context["app_layout"] == agent_ns["INSPIRE_DEFAULT_LAYOUT"] and context["layout_tables"] == {}


def test_a_driver_breakdown_keeps_its_decision_layout_and_its_sections_without_a_companion_when_all_its_views_are_missing(agent_ns, tmp_path):
    """Must-keep for another kind: a decision layout whose sections need no companion table to pass the App fit keeps its layout."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path / "x", {})
    layout, tables = inst._implement_app_layout("N04-U05", {"use_case_kind": "driver_breakdown"}, {}, RESULT, warnings, inst._implement_schema_reader())
    assert layout == "performance_explainer" and tables == {}
    assert shell_sql.companion_required_suffixes("performance_explainer") == set()
    text = agent_ns["implement_layout_brief"]("performance_explainer", {}, shell_sql)
    assert "driver_tornado (" in text and "variance_table (" in text
    assert shell_sql.companion_required_suffixes("segment_explorer") == {"__segments"}


def test_the_declared_required_companions_are_exactly_the_companions_of_the_sections_the_app_fit_checks_for_a_table(agent_ns, tmp_path):
    """Must-keep single source: the kinds registry declares the companions a layout's card and effect sections read, and the App fit check
    (PART_COLUMNS) requires a table for exactly those sections. The two must agree, so the notebook's layout decision and the check match."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    for layout in agent_ns["_inspire_kinds"]()["layouts"]:
        derived = {shell_sql.SECTIONS[s]["suffix"] for s in layout.get("sections") or []
                   if s in shell_sql.PART_COLUMNS and shell_sql.SECTIONS.get(s, {}).get("suffix")}
        assert set(layout.get("required_companions") or []) == derived, layout["id"]
    assert shell_sql.companion_required_suffixes("segment_explorer") == {"__segments"}
    assert shell_sql.companion_required_suffixes("performance_explainer") == set()


def test_every_companion_name_of_the_notebook_goes_through_one_wrapper_that_refuses_a_name_without_three_levels(agent_ns):
    """Fail-pre: the validated companion names (run log, acted, closed, closes, changes, summary, reasons, assumptions, plans) and the
    Lakebase view keys were built by their own f-strings. They now share one wrapper, which validates a catalog.schema.table name first."""
    companion = agent_ns["inspire_companion"]
    assert companion(RESULT, "__lb") == f"{RESULT}__lb"
    assert companion(RESULT, "_reasons") == f"{RESULT}_reasons"
    assert agent_ns["inspire_run_log_table"](RESULT) == companion(RESULT, agent_ns["INSPIRE_RUN_LOG_SUFFIX"])
    assert agent_ns["implement_reasons_view"](RESULT) == companion(RESULT, "_reasons")
    try:
        companion("n06_u01_results", "__segments")
    except ValueError as error:
        assert "catalog.schema.table" in str(error) or "three" in str(error), str(error)
    else:
        raise AssertionError("a companion of a name without three levels must be refused")
