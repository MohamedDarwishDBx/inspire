"""REQ-187: a run that flags no candidate alerts (k = 0) has no top-k stability to measure. The metric is not applicable there: it is
never scored 0 and never NaN, the run is judged on its other criteria, and the App publishes with the plain line. A run with k above 0
and a stability below its bar still fails acceptance (the must-exclude guard). The same not-applicable treatment covers every
acceptance metric that is undefined when its denominator is 0 (AUC without both outcomes, PR-AUC lift with no positives, precision
lift with no popularity hits, MASE with a zero naive error, and so on)."""
import types

import pytest

from v120_artifacts_support import FakeSpark

TABLE = "main.inspire.churn_out"
K_ZERO_LINE = "No unusual records found in this data; stability is not measured when nothing is flagged."
# threshold widget -> (bar, a measured value that fails it)
SWEPT = {
    "min_topk_stability": ("0.6", 0.3), "min_auc": ("0.6", 0.4), "min_auc_gain": ("0.02", 0.01), "min_pr_auc_lift": ("1.5", 1.0),
    "min_c_index": ("0.6", 0.4), "min_precision_lift": ("1.1", 0.9), "min_silhouette": ("0.15", 0.05),
    "min_bootstrap_ari": ("0.6", 0.3), "min_segment_share": ("0.03", 0.01), "max_mase": ("1", 1.5), "max_ai_error_rate": ("0.02", 0.05),
}


def _frame():
    return types.SimpleNamespace(schema=types.SimpleNamespace(fields=[]), write=types.SimpleNamespace(
        mode=lambda *_a: types.SimpleNamespace(option=lambda *_b: types.SimpleNamespace(saveAsTable=lambda *_c: None))))


def _write(ns, widgets, **kw):
    """Runs inspire_write_result on an empty frame and returns what it hands the merge: nothing_to_act, accepted and the rest."""
    seen = []
    ns["INSPIRE_SETTINGS_APPLIED"] = widgets
    ns["inspire_merge_run"] = lambda spark, table, stage, **given: seen.append(given) or 3
    ns["inspire_write_result"](_frame(), TABLE, spark_session=FakeSpark(), out=lambda *_a: None, **kw)
    return seen[0]


def test_k_zero_has_no_top_k_stability_to_score(fresh_ns):
    # no candidate alerts on either fit: the agreement is not applicable, so it is None, never 0 and never NaN
    assert fresh_ns["inspire_topk_stability"]([], [], 0) is None
    assert fresh_ns["inspire_topk_stability"](["a"], ["a"], 0) is None


def test_k_positive_measures_the_share_of_the_first_top_k_that_the_second_fit_also_flags(fresh_ns):
    assert fresh_ns["inspire_topk_stability"](["a", "b", "c"], ["x", "y", "c"], 3) == pytest.approx(1 / 3)
    assert fresh_ns["inspire_topk_stability"](["a", "b"], ["b", "a"], 2) == 1.0
    assert fresh_ns["inspire_topk_stability"](["a", "b"], ["x", "y"], 2) == 0.0


def test_k_zero_run_publishes_with_the_plain_line_and_its_stability_is_not_applicable(fresh_ns):
    widgets = {"max_alerts_per_run": "200", "min_topk_stability": "0.6"}
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = widgets
    assert fresh_ns["inspire_topk_stability"]([], [], 0) is None
    accepted, missed = fresh_ns["inspire_accepted"]({"max_alerts_per_run": 0, "min_topk_stability": None})
    assert (accepted, missed) == (True, None)
    given = _write(fresh_ns, widgets, accepted=True, not_applicable=["min_topk_stability"])
    assert given["accepted"] is True
    assert given["nothing_to_act"] == K_ZERO_LINE
    assert fresh_ns["inspire_not_reliable"]({"records": 0, "flagged_records": 0}, True, given["nothing_to_act"]) is None


def test_k_positive_low_stability_still_fails_acceptance_and_holds_the_app(fresh_ns):
    # must-exclude guard: k above 0 and a stability of 0 or 0.33 are applicable and below the 0.6 bar, so the run fails
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"max_alerts_per_run": "200", "min_topk_stability": "0.6"}
    for measured in (0.0, 1 / 3):
        accepted, missed = fresh_ns["inspire_accepted"]({"max_alerts_per_run": 3, "min_topk_stability": measured})
        assert accepted is False and set(missed) == {"min_topk_stability"} and missed["min_topk_stability"] == measured
    text = _write(fresh_ns, {"min_topk_stability": "0.6"}, accepted=False, missed={"min_topk_stability": 1 / 3})["nothing_to_act"]
    assert text.startswith("No model passed this use case's acceptance check in the last run: Minimum top-k stability is 0.6, and this run measured")
    assert fresh_ns["inspire_not_reliable"]({"records": 5, "flagged_records": 0}, False, text) == text


def test_a_failing_applicable_metric_is_never_laundered_into_not_applicable(fresh_ns):
    with pytest.raises(ValueError, match="takes missed= only with accepted=False"):
        _write(fresh_ns, {"min_topk_stability": "0.6"}, accepted=True, missed={"min_topk_stability": 0.2})
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"min_topk_stability": "0.6"}
    with pytest.raises(ValueError, match="takes a number, or None when the criterion does not apply"):
        fresh_ns["inspire_accepted"]({"min_topk_stability": float("nan")})
    with pytest.raises(ValueError, match="not_applicable="):
        _write(fresh_ns, {"min_topk_stability": "0.6"}, accepted=False, missed={"min_topk_stability": None})


def test_a_not_applicable_name_the_helper_does_not_know_is_refused(fresh_ns):
    with pytest.raises(ValueError, match="takes not_applicable= threshold widgets from"):
        _write(fresh_ns, {"min_unknown": "0.6"}, accepted=True, not_applicable=["min_unknown"])


@pytest.mark.parametrize("name", sorted(SWEPT))
def test_every_swept_metric_is_not_applicable_at_zero_and_still_fails_when_applicable(fresh_ns, name):
    bar, failing = SWEPT[name]
    assert name in fresh_ns["INSPIRE_NOT_APPLICABLE_NOTES"], "the swept metric is in the shared not-applicable registry"
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {name: bar}
    fresh_ns["inspire_record_denominator"](fresh_ns["INSPIRE_DENOMINATOR_RULES"][name][0], 0)
    assert fresh_ns["inspire_accepted"]({name: None}) == (True, None)
    given = _write(fresh_ns, {name: bar}, accepted=True, not_applicable=[name])
    assert given["nothing_to_act"] == fresh_ns["INSPIRE_NOT_APPLICABLE_NOTES"][name] and given["nothing_to_act"].endswith(".")
    assert fresh_ns["inspire_accepted"]({name: failing}) == (False, {name: failing})
    passing = float(bar) * (0.5 if name.startswith("max_") else 2)
    assert fresh_ns["inspire_accepted"]({name: passing}) == (True, None)


def test_the_registry_covers_exactly_the_swept_metrics(fresh_ns):
    assert set(fresh_ns["INSPIRE_NOT_APPLICABLE_NOTES"]) == set(SWEPT)


def test_ratio_is_none_when_its_denominator_is_zero_and_refuses_nan(fresh_ns):
    ratio = fresh_ns["inspire_ratio"]
    assert ratio(0, 0) is None and ratio(3, 0) is None and ratio(0, 0.0) is None
    assert ratio(1, 4) == 0.25
    with pytest.raises(ValueError):
        ratio(float("nan"), 4)
    with pytest.raises(ValueError):
        ratio(1, float("nan"))


def test_the_genie_rules_tell_genie_to_pass_none_and_use_the_shared_helpers(agent_ns):
    rule = agent_ns["GENIE_MEASURED_TIER_RULE"]
    assert "inspire_accepted" in rule and "not_applicable=" in rule and "None" in rule
    assert "inspire_topk_stability" in agent_ns["DatabricksInspire"]._GENIE_ACCEPTANCE_TEXT["B"]
    assert "not applicable" in agent_ns["DatabricksInspire"]._GENIE_ACCEPTANCE_TEXT["B"]


def _zero_k_run(fresh_ns, **kw):
    """Genie's k = 0 run: the helper computes k from empty fit lists and records it, then the write gets what Genie wrote."""
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"max_alerts_per_run": "200", "min_topk_stability": "0.6"}
    assert fresh_ns["inspire_topk_stability"]([], [], 0) is None
    return _write(fresh_ns, fresh_ns["INSPIRE_SETTINGS_APPLIED"], **kw)


@pytest.mark.parametrize("measured", [0, 0.0, float("nan")])
def test_genie_writes_stability_0_or_nan_with_k_zero_and_the_run_still_publishes_with_the_plain_line(fresh_ns, measured):
    # the guard reads the recorded k, never the number Genie wrote: k is 0, so the criterion does not apply
    given = _zero_k_run(fresh_ns, accepted=False, missed={"min_topk_stability": measured})
    assert given["accepted"] is True
    assert given["nothing_to_act"] == K_ZERO_LINE
    assert fresh_ns["inspire_not_reliable"]({"records": 0, "flagged_records": 0}, given["accepted"], given["nothing_to_act"]) is None


def test_k_positive_stability_of_0_2_still_fails_acceptance_after_the_guard(fresh_ns):
    # must-exclude guard: five candidate alerts, one shared by the second fit, so the stability is 0.2 and the 0.6 bar fails
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"max_alerts_per_run": "200", "min_topk_stability": "0.6"}
    assert fresh_ns["inspire_topk_stability"](["a", "b", "c", "d", "e"], ["a", "x", "y", "z", "w"], 5) == pytest.approx(0.2)
    given = _write(fresh_ns, fresh_ns["INSPIRE_SETTINGS_APPLIED"], accepted=False, missed={"min_topk_stability": 0.2})
    assert given["accepted"] is False and "measured 0.2" in given["nothing_to_act"]
    assert fresh_ns["inspire_not_reliable"]({"records": 5, "flagged_records": 0}, given["accepted"], given["nothing_to_act"])


def test_a_zero_stability_with_no_recorded_k_stays_a_failed_criterion_fail_closed(fresh_ns):
    # no helper recorded k, so the run cannot show the denominator is zero: the failure stands and the App is held
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"min_topk_stability": "0.6"}
    given = _write(fresh_ns, fresh_ns["INSPIRE_SETTINGS_APPLIED"], accepted=False, missed={"min_topk_stability": 0.0})
    assert given["accepted"] is False and "measured 0" in given["nothing_to_act"]


def test_a_not_applicable_claim_with_a_nonzero_recorded_k_is_refused(fresh_ns):
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"min_topk_stability": "0.6"}
    fresh_ns["inspire_topk_stability"](["a", "b", "c"], ["a", "b", "c"], 3)
    with pytest.raises(ValueError, match="the denominator recorded for it is 3"):
        _write(fresh_ns, fresh_ns["INSPIRE_SETTINGS_APPLIED"], accepted=True, not_applicable=["min_topk_stability"])


def test_a_not_applicable_claim_with_no_recorded_denominator_is_refused(fresh_ns):
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"min_topk_stability": "0.6"}
    with pytest.raises(ValueError, match="its denominator is not recorded this run"):
        _write(fresh_ns, fresh_ns["INSPIRE_SETTINGS_APPLIED"], accepted=True, not_applicable=["min_topk_stability"])


@pytest.mark.parametrize("name", sorted(SWEPT))
def test_every_swept_metric_with_a_zero_recorded_denominator_is_not_applicable_even_when_written_as_zero_or_nan(fresh_ns, name):
    bar, _failing = SWEPT[name]
    key = fresh_ns["INSPIRE_DENOMINATOR_RULES"][name][0]
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {name: bar}
    fresh_ns["inspire_record_denominator"](key, 0)
    for written in (0.0, float("nan")):
        given = _write(fresh_ns, {name: bar}, accepted=False, missed={name: written})
        assert given["accepted"] is True and given["nothing_to_act"] == fresh_ns["INSPIRE_NOT_APPLICABLE_NOTES"][name], (name, written)


def test_the_app_publishes_a_k_zero_summary_row_with_the_plain_line(agent_ns):
    # App publish check: the summary row the write leaves (not_reliable empty, nothing_to_act the plain line) publishes the App
    from v207_unreliable_app_test import _build
    status, final, _emitted, built = _build(agent_ns, "", {"not_reliable": None, "nothing_to_act": K_ZERO_LINE})
    assert "app" in built and agent_ns["IMPLEMENT_NOT_RELIABLE"] not in final["asset_status"]
