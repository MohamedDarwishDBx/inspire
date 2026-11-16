"""REQ-327 class sweep: one date read (shell_facts.read_date) for the bounds, the scope probe, a filter's WHERE and the future rule. On
Spark it is TRY_CAST, then the text formats through TRY_TO_DATE. On Lakebase (Postgres) the same read is regex-guarded, so text that is not
a date reads NULL and never raises; the guarded branches run in Postgres 17 too (see the live check in the report)."""
import os
import shutil
import subprocess
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import pytest  # noqa: E402
import sqlglot  # noqa: E402

import shell_facts  # noqa: E402
import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE  # noqa: E402

FILTER_PAGE = dict(PAGE, filters=[dict(PAGE["filters"][0], columns={"trend": "trip_date"})] + PAGE["filters"][1:])


def _lakebase(sql: str) -> str:
    return sqlglot.parse_one(sql, read="databricks").sql(dialect=shell_pg._dialect())


def test_lakebase_renders_a_date_cast_as_a_guarded_read_never_a_bare_cast():
    out = _lakebase("SELECT x, TRY_CAST(x AS DATE) AS d FROM t")
    assert "~ '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})([ T].*)?$'" in out, out
    assert 'CAST("x" AS DATE)' not in out.replace('CAST(CAST("x" AS TEXT)', ""), "a bare CAST of text would raise on non-date text"


@pytest.mark.parametrize("text", shell_facts.DATE_TEXT_FORMATS)
def test_lakebase_renders_each_text_format_with_its_own_guard(text):
    out = _lakebase(f"SELECT TRY_TO_DATE(x, '{text}') AS d FROM t")
    assert "~ '" in out and "MAKE_DATE(" in out, out
    assert "TRY_TO_DATE" not in out and "TO_DATE(" not in out, "every format is rebuilt from its guarded parts"


def test_lakebase_refuses_a_text_format_it_does_not_know():
    with pytest.raises(shell_pg.NotServed):
        _lakebase("SELECT TRY_TO_DATE(x, 'dd.MM.yyyy') AS d FROM t")


def test_the_bounds_read_the_text_formats_on_spark():
    bounds_sql, _params = shell_sql.bounds_query(FILTER_PAGE, "run_date")
    for text in shell_facts.DATE_TEXT_FORMATS:
        assert f"TRY_TO_DATE(`trip_date`, '{text}')" in bounds_sql
    assert "COALESCE(TRY_CAST(`trip_date` AS DATE)" in bounds_sql


def test_the_future_rule_reads_the_same_date_as_the_bounds_and_never_compares_raw_text():
    sql = shell_facts.future_source(FILTER_PAGE, "trend", "SELECT trip_date, v FROM main.s.t")
    read = shell_facts.read_date("`trip_date`")
    assert f"WHERE `trip_date` IS NULL OR {read} <= current_date" in sql, sql
    assert "`trip_date` <= current_date" not in sql, "a text-date column is never compared raw, so it cannot raise"


def test_a_valid_date_keeps_its_kpi_rule_first_read_is_the_day_itself():
    # a DATE value (or ISO text) is read by TRY_CAST, the first branch, so its day and its comparison are what they were before
    read = shell_facts.read_date("`as_of_date`")
    assert read.startswith("COALESCE(TRY_CAST(`as_of_date` AS DATE), TRY_TO_DATE(`as_of_date`, 'MMM d yyyy')")


def test_the_left_out_count_uses_the_kpi_rule():
    # the line that counts rows dated after today reads the same date as the KPI, so the two never disagree on a text date
    page = dict(FILTER_PAGE, kpis=[{"id": "total", "label": "Total", "dataset": "trend", "expression": "SUM(loss)"}])
    found = shell_sql.money_left_out(page, page["kpis"][0], {})
    assert found is not None, "a dated page counts what its total leaves out"
    sql = found[0]
    assert "COALESCE(TRY_CAST(`trip_date` AS DATE)" in sql and "> current_date()" in sql, sql
    assert "`trip_date` > current_date()" not in sql


PSQL = shutil.which("psql")
PG_URL = os.environ.get("INSPIRE_PG_TEST_URL")


@pytest.mark.skipif(not (PSQL and PG_URL), reason="needs psql and INSPIRE_PG_TEST_URL (a throwaway Postgres 16+)")
def test_postgres_runs_the_rendered_read_and_matches_the_spark_result_for_each_value():
    values = {"2016-01-01 00:04:30": "2016-01-01", "2016-02-29": "2016-02-29", "2016-02-30": "", "May 3 2016": "2016-05-03",
              "5/3/2016": "2016-05-03", "25/05/2016": "2016-05-25", "2016/05/03": "2016-05-03", "junk": "", "": ""}
    read = _lakebase(f"SELECT x, {shell_facts.read_date('x')} AS d FROM (VALUES {', '.join(f'(%s)' % _quote(v) for v in values)}) AS t(x)")
    done = subprocess.run([PSQL, PG_URL, "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", read], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    got = dict(line.split("|", 1) if "|" in line else (line, "") for line in done.stdout.splitlines())
    for text, day in values.items():
        assert got.get(text, "") == day, (text, got)


def _quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"
