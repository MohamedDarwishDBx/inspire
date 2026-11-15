import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

TODAY = "2026-11-15"
PAGE = {"result_table": "cat.sch.results"}
NAMES = {"record_key", "action_status", "held_back", "data_quality_flag", "is_current", "change_source", "snooze_until"}

# key, status, held_back, data_quality_flag, is_current, change_source, snooze_until
# The snoozed row is the one-row difference REQ-224 found: the scope line counted it as open, the Work list did not.
ROWS = [
    ("open_ok", None, False, "ok", True, "run", None),
    ("open_new", "New", False, "ok", True, "run", None),
    ("open_snoozed_past", "New", False, "ok", True, "run", "2026-11-14"),
    ("snoozed_future", "New", False, "ok", True, "run", "2026-11-20"),
    ("held_ok", "New", True, "ok", True, "run", None),
    ("done_ok", "Done", False, "ok", True, "run", None),
    ("no_pair", "New", False, "no candidate pair", True, "run", None),
]


class CountIf:
    """sqlite has no COUNT_IF; the App's SQL runs on Databricks, this stands in for it in the fixture only."""
    def __init__(self):
        self.n = 0

    def step(self, value):
        self.n += 1 if value else 0

    def finalize(self):
        return self.n


def _db():
    db = sqlite3.connect(":memory:")
    db.create_aggregate("COUNT_IF", 1, CountIf)
    db.execute("CREATE TABLE src (record_key, action_status, held_back, data_quality_flag, is_current, change_source, snooze_until)")
    db.executemany("INSERT INTO src VALUES (?, ?, ?, ?, ?, ?, ?)", ROWS)
    return db


def _scope_row(db):
    sql, items = shell_sql.scope_counts_query(PAGE, NAMES, TODAY)
    sql = sql.replace("`cat`.`sch`.`results`", "src").replace("cat.sch.results", "src")
    sql = sql.replace("AS STRING)", "AS TEXT)").replace("AS DATE)", "AS TEXT)")  # sqlite has no DATE; ISO text compares the same way
    values = {p["name"]: p["value"] for p in items}
    cur = db.execute(sql.replace(" LIMIT 1", ""), values)
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, cur.fetchone()))


def _open_keys(db):
    """The Work tab's Open list: the list's own predicate (window_conditions), checked and held rows left out."""
    params = shell_sql._Params()
    today = params.add(TODAY, "DATE")
    where = " AND ".join(shell_sql.window_conditions({"window": "all"}, params, True, today, "c", True))
    db.execute("DROP VIEW IF EXISTS temp.c")
    db.execute("CREATE TEMP VIEW c AS SELECT record_key AS _inspire_key, COALESCE(action_status, 'New') AS _inspire_status, "
               "held_back AS _inspire_held, CAST(NULL AS TEXT) AS _inspire_due, snooze_until AS _inspire_snooze, "
               "CAST(0 AS INTEGER) AS _inspire_joined, CAST(("
               + shell_facts.flagged_ok_sql(["data_quality_flag"]) +
               ") AS INTEGER) AS _inspire_ok, CAST(NULL AS TEXT) AS _inspire_flag FROM src WHERE is_current AND change_source <> 'delete'")
    values = {p["name"]: p["value"] for p in params.items}
    return [r[0] for r in db.execute(f"SELECT _inspire_key FROM c WHERE {where} ORDER BY 1", values)]


def test_the_open_count_is_the_work_list_open_rows_when_a_snoozed_row_is_in_the_scope():
    # Before the fix the scope counted 3 open (the snoozed row included) while the Work list showed 2.
    db = _db()
    assert _open_keys(db) == ["open_new", "open_ok", "open_snoozed_past"]
    assert _scope_row(db)["open_"] == len(_open_keys(db)) == 3


def test_a_snoozed_row_waits_for_its_date_and_is_named_apart_in_the_scope_line():
    row = _scope_row(_db())
    assert row["snoozed_"] == 1
    assert "snoozed_future" not in _open_keys(_db())


def test_done_rows_stay_separate_from_open_and_never_join_the_open_count():
    db = _db()
    row = _scope_row(db)
    assert "done_ok" not in _open_keys(db)
    assert row["closed_"] == 1 and row["open_"] == 3, "Done is its own count, not open work"
    assert (row["open_"], row["held_"], row["closed_"], row["snoozed_"], row["unchecked"]) == (3, 1, 1, 1, 1)


def test_the_scope_line_names_snoozed_rows_only_when_there_are_some():
    text = shell_sql.scope_counts_text([{"open_": 3, "held_": 1, "closed_": 1, "unchecked": 1, "snoozed_": 1}])
    assert text == ("Scope: 6 checked records, 3 open, 1 held back, 1 done or closed. 1 snoozed until a later date. "
                    "1 could not be checked and are never open work.")
    assert shell_sql.scope_counts_text([{"open_": 2, "held_": 0, "closed_": 0, "unchecked": 0, "snoozed_": 0}]) == (
        "Scope: 2 checked records, 2 open, 0 held back, 0 done or closed. 0 could not be checked and are never open work.")


def test_the_genie_scope_fact_counts_only_the_open_work_scope(agent_ns):
    cols = {c.lower(): "STRING" for c in ("data_quality_flag", "held_back", "action_status", "snooze_until")}
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", cols)
    # Genie used to count any ok, unheld row, so Done, Dismissed and Could not fix rows were counted as open (182 vs 157).
    assert "with action_status is 'New' or 'In progress' (NULL counts as New) and held_back = FALSE and " in fact
    assert "snooze_until is empty or on or before CURRENT_DATE() and data_quality_flag = 'ok'." in fact
    assert "the records already done, dismissed or could not be fixed (action_status Done, Dismissed or Could not fix)" in fact
    assert "the records snoozed until a later date" in fact
    assert "give the open count first, then the total as 'N flagged, M still open'." in fact
    assert "answer it with that number first and say that it is the records that need action." in fact
    assert not any(ch in fact for ch in "–—"), "no dashes in Genie-facing text"


def test_the_genie_open_statuses_are_the_app_open_statuses(agent_ns):
    # Drift guard: the notebook text names the open statuses by hand, so it must match the App's own list.
    assert set(shell_facts.OPEN_STATUSES) == {"New", "In progress"}
    cols = {c.lower(): "STRING" for c in ("data_quality_flag", "action_status")}
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", cols)
    for status in shell_facts.OPEN_STATUSES:
        assert f"'{status}'" in fact


def test_a_genie_fact_without_a_status_column_adds_no_status_rule(agent_ns):
    fact = agent_ns["implement_scope_fact"]("cat.sch.results", {"data_quality_flag": "STRING"})
    assert "action_status" not in fact and "snooze_until" not in fact
    assert "with data_quality_flag = 'ok'." in fact


# ---- Round 2: the Actions line and the App's KPIs read the same open-work scope ----

KPI_PAGE = {"result_table": "cat.sch.results",
            "datasets": [{"name": "rows", "sql": "SELECT * FROM `cat`.`sch`.`results`"}],
            "kpis": [{"id": "open", "label": "Open", "dataset": "rows", "expression": "COUNT(*)", "open_work": True}]}


def _kpi_value(db, page):
    sql, items = shell_sql.kpi_query(page, "open", {}, None, NAMES)
    sql = sql.replace("`cat`.`sch`.`results`", "src").replace("cat.sch.results", "src").replace("AS DATE)", "AS TEXT)")
    sql = sql.replace("current_date", f"'{TODAY}'").replace(f"LIMIT {shell_sql.CAPS['kpi_rows']}", "")
    values = {p["name"]: p["value"] for p in items}
    return db.execute(sql, values).fetchone()[1]  # (period, value)


def test_a_kpi_marked_open_work_counts_the_same_rows_as_the_scope_line():
    db = _db()
    assert _kpi_value(db, KPI_PAGE) == _scope_row(db)["open_"] == len(_open_keys(db)) == 3


def test_an_unmarked_count_kpi_still_counts_every_row_it_reads():
    plain = dict(KPI_PAGE, kpis=[dict(KPI_PAGE["kpis"][0], open_work=False)])
    assert _kpi_value(_db(), plain) == len(ROWS)


def test_the_actions_line_has_no_open_figure_outside_the_one_scope():
    # The impact aggregate used to carry its own open predicate (no hold, flag or snooze). Open now comes from open_work_sql only.
    assert "open_n" not in shell_facts.ACTION_NUMBERS
    assert "open_n" not in shell_facts.action_cells("a")
    assert "open_n" not in shell_facts.action_counts_sql("cat.sch.results")


def test_facts_from_the_old_open_count_shape_are_refused_so_they_rebuild():
    old = {"v": 5, "log": "l", "acted": "a", "closed": "c", "changes": "x", "actions": {"open_n": 1, "done_n": 0, "resolved_n": 0},
           "stamp_us": 1, "people": [], "numbers": {}, "runs": [], "names": [], "columns": []}
    assert "older shape" in shell_facts.facts_problem(old)


def test_an_open_work_kpi_must_be_a_plain_row_count_of_the_result_table():
    page = dict(KPI_PAGE, kpis=[dict(KPI_PAGE["kpis"][0], expression="SUM(`value`)")])
    problems = shell_sql.spec_problems(page)
    assert any("is marked open_work" in p for p in problems), problems


# ---- Round 3: the page spec defaults open-count KPIs to open_work, and the example pages mark theirs ----
import json  # noqa: E402

EXAMPLES = os.path.join(ROOT, "agent", "app_shell", "examples")
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")


def test_a_generated_open_count_kpi_carries_open_work_without_a_flag():
    generated = dict(KPI_PAGE, kpis=[{"id": "open", "label": "Open claims", "dataset": "rows", "expression": "COUNT(*)"}])
    assert shell_sql.kpi_open_work(generated, generated["kpis"][0]), "a plain count named open reads the open scope"
    assert _kpi_value(_db(), generated) == _scope_row(_db())["open_"] == 3


def test_a_total_sum_or_unnamed_count_is_never_inferred_as_open_work():
    for label, expression in (("Items on the list", "COUNT(*)"), ("Open exposure", "SUM(value)"), ("Open ratio", "COUNT(*) / 2")):
        page = dict(KPI_PAGE, kpis=[{"id": "k", "label": label, "dataset": "rows", "expression": expression}])
        assert not shell_sql.kpi_open_work(page, page["kpis"][0]), (label, expression)


def test_the_example_pages_mark_their_open_count_kpis_and_no_other_count_reads_open_work():
    marked = {("monitor_triage", "open_n"), ("forecast_cockpit", "orders_open"), ("process_flow", "open")}
    seen = set()
    for name in sorted(os.listdir(EXAMPLES)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(EXAMPLES, name), encoding="utf-8") as f:
            page = json.load(f)
        for kpi in page.get("kpis") or []:
            if kpi.get("open_work") is True:
                seen.add((name[:-5], kpi["id"]))
                assert shell_sql.kpi_open_work(page, kpi), (name, kpi["id"])
                assert shell_sql.kpi_counts_result_rows(page, kpi), (name, kpi["id"], "must count the result table")
    assert seen == marked, seen


def test_the_page_spec_prompt_tells_the_model_to_set_open_work_on_open_counts():
    with open(NOTEBOOK, encoding="utf-8") as f:
        text = f.read()
    assert "- kpi open_work: true on each KPI that counts open work" in json.loads(text)["cells"][0]["source"][0] or \
        any("- kpi open_work: true on each KPI that counts open work" in "".join(c.get("source", [])) for c in json.loads(text)["cells"])
