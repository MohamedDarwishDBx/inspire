"""REQ-250: the App-fit check accepts the use case's own result companions, and no other use case's table.

A segmentation build's page reads its result table's companion tables (the result table with __segments, __assign, __migration). The
App-fit check (implement_app_page_problems) judged every dataset table against the use case's allowed tables, the source tables and the
result table, so each companion failed as "outside this use case" and the App was not published.
The check now allows the companions the App reads and is granted (implement_app_result_reads), and implement_use_case_table accepts their
live, candidate and versioned forms by root. A table of another use case, or an unrelated table, still fails.
"""
RESULT = "inspire_kinds_rc7._inspire.segment_results"
OTHER_RESULT = "inspire_kinds_rc7._inspire.other_results"
SOURCE = "inspire_kinds_rc7._inspire.sales_customers"
UNRELATED = "inspire_kinds_rc7._inspire.sales_regions"


class ShellSql:
    RECORDS_DATASET = "records"

    def spec_problems(self, page, stored):
        return []

    def decision_problems(self, page):
        return []

    def quality_problems(self, page, event_date, fanning):
        return []

    def driver_charts(self, page):
        return []


def _page(*reads):
    return {"id": "seg", "title": "Segments", "result_table": RESULT, "use_case_id": "UC-A",
            "datasets": [{"name": f"d{i}", "sql": f"SELECT * FROM {table}"} for i, table in enumerate(reads)], "kpis": [], "charts": []}


def _problems(agent_ns, page):
    return agent_ns["implement_app_page_problems"](page, ShellSql(), [RESULT, SOURCE], False, many=())


def _outside(problems):
    return [p for p in problems if "outside this use case" in p]


def test_app_fit_accepts_the_result_tables_own_companions(agent_ns):
    companions = [f"{RESULT}__segments", f"{RESULT}__assign", f"{RESULT}__migration"]
    assert _outside(_problems(agent_ns, _page(*companions))) == []


def test_app_fit_accepts_the_live_candidate_and_versioned_forms_of_a_companion(agent_ns):
    forms = [f"{RESULT}__segments__candidate", f"{RESULT}__assign__v7"]
    assert _outside(_problems(agent_ns, _page(*forms))) == []


def test_app_fit_still_refuses_a_companion_of_another_use_case(agent_ns):
    """Must-exclude: another use case's companion is another use case's table."""
    problems = _outside(_problems(agent_ns, _page(f"{OTHER_RESULT}__segments")))
    assert problems and f"{OTHER_RESULT}__segments" in problems[0], problems


def test_app_fit_still_refuses_an_unrelated_table(agent_ns):
    """Must-exclude: a table that is neither a source of the use case nor its result's companion."""
    problems = _outside(_problems(agent_ns, _page(UNRELATED)))
    assert problems and UNRELATED in problems[0], problems
