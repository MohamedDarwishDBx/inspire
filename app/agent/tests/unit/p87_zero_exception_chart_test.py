"""P87 (REQ-290): an all-zero ranked chart whose rule finds no exception in the whole scope is a plain note, never a publish failure.

The live N01-U01 rebuild (run 771503495550945, session 1794527946426377872) failed with 'chart exceptions_by_rule gives every group the
same Exceptions (0) at the default filters, so it ranks nothing'. Its latest run wrote 0 business rows and its preview tested 569 rows with
no exception. rule_finds_nothing fell back to the stake measures only when no run summary could be read, so a count labelled Exceptions
was never checked against the whole scope and the flat chart was sent back. The fallback must read exception counts too."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rc2_zero_chart_test import PLAIN_STAKE, TESTED, _page, _problems, _ranks_nothing, _shape  # noqa: E402

import shell_sql  # noqa: E402

EXCEPTIONS = {"label": "Exceptions", "expression": "COUNT(*)", "format": "integer"}
LIVE_EXCEPTION_IDS = ["exceptions_by_rule", "by_rule", "by_age"]


def test_all_zero_exception_chart_with_no_exception_in_the_scope_is_not_sent_back(tmp_path):
    # fails before the fix: no run summary is readable (the shape returns none), the Exceptions count is not a stake measure, so the
    # fallback never reads the whole scope and the flat chart is sent back as 'ranks nothing'
    page = _page([EXCEPTIONS, TESTED])
    assert _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=0.0))) == []


def test_as_is_rebuild_of_the_published_exception_page_passes_the_flat_chart_check(tmp_path):
    # the live page's chart ids and measures: an as-is rebuild of a page that has published before must pass the same check
    page = _page([EXCEPTIONS, TESTED], ids=LIVE_EXCEPTION_IDS)
    problems = _problems(tmp_path, page, _shape(page, unfiltered_money=0.0))
    assert _ranks_nothing(problems) == [], problems


def test_all_zero_exception_chart_with_an_exception_in_the_scope_stays_strict(tmp_path):
    # must-exclude: 7 exceptions exist in the whole scope while the default filters show 0, so every flat chart is still sent back
    page = _page([EXCEPTIONS, TESTED])
    flat = _ranks_nothing(_problems(tmp_path, page, _shape(page, unfiltered_money=7.0)))
    assert len(flat) == 3 and all("gives every group the same Exceptions (0)" in p for p in flat), flat


def test_exception_measure_reads_exception_counts_and_stake_but_not_tested_records():
    assert shell_sql.exception_measure(EXCEPTIONS) is True
    assert shell_sql.exception_measure({"label": "Exceptions", "format": "number"}) is True
    assert shell_sql.exception_measure(PLAIN_STAKE) is True
    assert shell_sql.exception_measure(TESTED) is False
    assert shell_sql.exception_measure({"label": "Exceptions tested", "format": "integer"}) is False
