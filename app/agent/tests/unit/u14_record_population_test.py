"""REQ-400: the record explanation compares the record with the whole list, from one deterministic read of the App's own table.
Numbers come from the aggregate, never from the model. The fixtures are small and industry-neutral."""
import copy

from v141_app_shell_test import PAGE, shell  # noqa: F401  (loads the shell module path)
import shell_core
import shell_sql


STATS = {"n": 5, "mean": 100, "sd": 50, "above": 1, "below": 3, "flagged": 5}


def test_the_population_sentence_states_mean_spread_sigma_rank_and_flagged_share_from_the_read():
    out = shell_core.population_summary(200, STATS)
    assert out == {"count": 5, "text": (
        "Compared to the rest: this record has 200 at stake. The 5 records on this list average 100, with a spread (standard "
        "deviation) of 50, so this record sits 2 sigma above the average (z-score +2.00). It ranks 2 of 5, above 60% of them. "
        "5 of 5 records are flagged.")}


def test_a_record_below_the_average_reads_below_with_a_negative_z():
    below_list = {"n": 5, "mean": 100, "sd": 50, "above": 4, "below": 0, "flagged": 5}
    text = shell_core.population_summary(50, below_list)["text"]
    assert "sits 1 sigma below the average (z-score -1.00)" in text
    assert "It ranks 5 of 5, above 0% of them." in text


def test_a_list_with_no_spread_says_so_and_shows_no_sigma():
    text = shell_core.population_summary(7, {"n": 4, "mean": 7, "sd": 0, "above": 0, "below": 0, "flagged": 4})["text"]
    assert "with no spread, so no sigma is shown" in text
    assert "sigma above" not in text and "sigma below" not in text


def test_a_record_with_no_stake_is_named_plainly_and_an_empty_list_says_nothing():
    assert shell_core.population_summary(None, STATS)["text"] == (
        "Compared to the rest: this record has no value at stake, so it cannot be placed against the 5 records on this list.")
    assert shell_core.population_summary(10, {"n": 0}) == {"count": 0, "text": ""}


def test_the_population_query_is_one_portable_aggregate_over_the_current_rows():
    sql, params = shell_sql.population_query("cat.sch.tbl", "value_at_stake", "tier", 200)
    assert "COUNT_IF" not in sql, "COUNT_IF is not portable to every backend this App runs on"
    assert "STDDEV_SAMP(d.s)" in sql and "SUM(CASE WHEN d.s > :p0 THEN 1 ELSE 0 END)" in sql
    assert "is_current AND change_source <> 'delete'" in sql
    assert params == [{"name": "p0", "value": 200, "type": "DOUBLE"}]


class _Rows:
    """Stands in for the App's execute(): the first call reads the record, the second reads the aggregate."""
    def __init__(self, record, stats):
        self.calls, self.record, self.stats = [], record, stats

    def __call__(self, ws, sql, params, limit, delta=False, **_):
        self.calls.append(sql)
        return {"rows": [self.record] if len(self.calls) == 1 else [self.stats]}


def test_population_of_reads_the_record_then_the_aggregate_and_returns_the_sentence():
    fake = _Rows({"record_key": "R1", "value_at_stake": 200, "tier": "Act now"}, STATS)
    s = shell_core.Shell.__new__(shell_core.Shell)
    s.execute = fake
    page = copy.deepcopy(PAGE)
    page["result_table"] = "cat.sch.tbl"
    page["records"] = dict(page.get("records") or {}, tier="tier")
    out = shell_core.Shell.population_of(s, object(), page, "R1")
    assert out["count"] == 5 and out["text"].startswith("Compared to the rest: this record has 200 at stake.")
    assert "record_key" in fake.calls[0] and "STDDEV_SAMP" in fake.calls[1]


def test_population_of_says_nothing_when_the_app_keeps_no_stake_column():
    fake = _Rows({"record_key": "R1", "tier": "Act now"}, STATS)
    s = shell_core.Shell.__new__(shell_core.Shell)
    s.execute = fake
    page = copy.deepcopy(PAGE)
    page["result_table"] = "cat.sch.tbl"
    page["records"] = dict(page.get("records") or {}, tier="tier")
    assert shell_core.Shell.population_of(s, object(), page, "R1") == {"count": 0, "text": ""}
    assert len(fake.calls) == 1


def test_the_model_prompt_for_a_record_carries_the_same_population_line():
    text = shell_core.explain_question("Pricing desk", PAGE, "record", "Item number 1",
                                       {"tier": "Act now", "population": population_line()})
    assert population_line() in text


def population_line() -> str:
    return shell_core.population_summary(200, STATS)["text"]
