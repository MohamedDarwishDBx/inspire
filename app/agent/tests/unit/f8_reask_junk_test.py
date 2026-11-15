"""F8 / REQ-318: the data filter name re-ask never lets a junk answer pass silently.

rc7 (build 1dc9051e1) re-asked two names through DATA_FILTER_LABEL_RENAME_PROMPT. The model answered 140 characters that were not a
JSON list of Ref and Name, the answer was dropped with no retry and no log, and no NAME-LENGTH or DATA-FILTER-LABEL FIRED line reached
the info log: log_print writes the console only. Fixed here: one retry for an unusable answer, the names kept as written when the retry
also fails (the deterministic repair then runs and is counted as not renamed), every attempt logged through the logger, and the two
proof lines written through the logger. A re-ask never runs when no name needs one.

The rc7 answer bytes were not kept locally (only the parsed rows survived), so JUNK reproduces its class: prose and a Ref/Name list
that is not JSON.
"""
import json
import logging
import os

import pytest

USE_CASE_ORDERS = "main.s.orders"
SCOPE = {USE_CASE_ORDERS: {"columns": ["order_id", "brand"], "rows": [{"column": "brand", "op": "=", "values": ["Contoso"]}]}}
JUNK = 'Ref: "0" | Realign Supplier Territories\nRef: "1" | Merge Duplicate Franchises\nThese are the rewritten names, Title Case.'
GOOD = [{"Ref": "0", "Name": "Improve Contoso Customer Experience"}, {"Ref": "1", "Name": "Forecast Contoso Order Volume"}]
MISSED = [
    {"No": "1", "Name": "Improve customer experience using segmentation", "Primary Table": USE_CASE_ORDERS},
    {"No": "2", "Name": "Forecast order volume", "Primary Table": USE_CASE_ORDERS},
]
LONG = [
    {"No": "1", "Name": "Predict customer churn risk for each subscriber region and plan tier"},
    {"No": "2", "Name": "Forecast monthly demand across all distribution centres and channels"},
]


class _Stub:
    """Stands in for run_worker: records each call and returns the scripted answers in order, or raises the scripted error."""

    def __init__(self, answers=(), error=None):
        self.calls = []
        self.answers = list(answers)
        self.error = error

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]


@pytest.fixture
def scoped(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](json.dumps(SCOPE)))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def _labelled(ns, stub, names=MISSED):
    use_cases = [dict(uc) for uc in names]
    stats = ns["ensure_data_filter_labels"](use_cases, lambda uc: [], "Contoso", ns["INSPIRE_TABLE_SCOPES"],
                                            reask=lambda misses: ns["reask_data_filter_names"](stub, misses, "Contoso"))
    return use_cases, stats


def _lengths(ns, stub, names=LONG):
    use_cases = [dict(uc) for uc in names]
    stats = ns["ensure_name_lengths"](use_cases, reask=lambda misses: ns["reask_data_filter_names"](stub, misses, ""))
    return use_cases, stats


def test_the_recorded_junk_answer_is_retried_once_and_the_names_are_kept_not_renamed(scoped):
    stub = _Stub(answers=[JUNK])
    use_cases, stats = _labelled(scoped, stub)
    assert len(stub.calls) == 2, "an unusable answer is retried once, not dropped on the first try"
    assert all(call["skip_cache"] is True for call in stub.calls), "the retry bypasses the cache too"
    assert stats["reasked"] == 0 and stats["fallback"] == 2, "no junk name is applied; the deterministic repair counts both as not renamed"
    assert all("Contoso" in uc["Name"] for uc in use_cases), "the deterministic repair still puts the label in every name"
    assert "Realign Supplier Territories" not in " ".join(uc["Name"] for uc in use_cases), "the junk answer's names never reach a use case"


def test_a_good_answer_renames_every_miss_in_one_call(scoped):
    stub = _Stub(answers=[json.dumps(GOOD)])
    use_cases, stats = _labelled(scoped, stub)
    assert len(stub.calls) == 1, "a usable answer needs no retry"
    assert stats == {"affected": 2, "carried": 0, "reasked": 2, "fallback": 0, "kept_user_named": 0, "subtitled": 0}
    assert [uc["Name"] for uc in use_cases] == ["Improve Contoso Customer Experience", "Forecast Contoso Order Volume"]


def test_a_retry_that_then_answers_well_is_used(scoped):
    stub = _Stub(answers=[JUNK, json.dumps(GOOD)])
    use_cases, stats = _labelled(scoped, stub)
    assert len(stub.calls) == 2 and stats["reasked"] == 2 and stats["fallback"] == 0


def test_a_failed_call_is_retried_once_and_logged(scoped, caplog):
    caplog.set_level(logging.INFO)
    stub = _Stub(error=RuntimeError("endpoint timed out"))
    _labelled(scoped, stub)
    assert len(stub.calls) == 2
    assert any("re-ask attempt 1 of 2 failed" in r.getMessage() for r in caplog.records)
    assert any("re-ask gave no usable name after 2 attempts" in r.getMessage() for r in caplog.records)


def test_an_unusable_answer_is_logged_by_its_size_and_the_reason_never_by_its_text(scoped, caplog):
    caplog.set_level(logging.INFO)
    _labelled(scoped, _Stub(answers=[JUNK]))
    attempts = [r.getMessage() for r in caplog.records if "gave no usable name for" in r.getMessage()]
    assert len(attempts) == 2, "each unusable attempt is logged"
    assert f"the answer of {len(JUNK)} characters is not a JSON list" in attempts[0], "the log says why, by size, not by the model's text"
    assert "Realign Supplier" not in attempts[0], "model text is never written to the log"


def test_a_cancelled_retry_is_never_swallowed(scoped):
    stub = _Stub(error=scoped["SparkWorkCancelled"]("DataFilterLabel_Reask", "tag"))
    with pytest.raises(scoped["SparkWorkCancelled"]):
        scoped["reask_data_filter_names"](stub, [dict(uc) for uc in MISSED], "Contoso")
    assert len(stub.calls) == 1, "a cancelled run stops at once, no retry"


def test_a_long_name_with_a_junk_answer_is_kept_and_shortened_and_counted(scoped):
    stub = _Stub(answers=[JUNK])
    use_cases, stats = _lengths(scoped, stub)
    assert len(stub.calls) == 2
    assert stats["long"] == 2 and stats["reasked"] == 0 and stats["shortened"] == 2
    assert all(len(uc["Name"].split()) <= 6 for uc in use_cases), "the deterministic cut still brings each name within six words"


def test_a_long_name_with_a_good_answer_is_renamed_in_one_call(scoped):
    stub = _Stub(answers=[json.dumps([{"Ref": "0", "Name": "Predict Subscriber Churn Risk"},
                                      {"Ref": "1", "Name": "Forecast Monthly Distribution Demand"}])])
    use_cases, stats = _lengths(scoped, stub)
    assert len(stub.calls) == 1
    assert stats["reasked"] == 2 and stats["shortened"] == 0
    assert use_cases[0]["Name"] == "Predict Subscriber Churn Risk"


def test_no_reask_when_no_label_and_no_name_is_over_the_word_limit(scoped):
    stub = _Stub(answers=[json.dumps(GOOD)])
    short = [{"No": "1", "Name": "Predict Customer Churn", "Primary Table": USE_CASE_ORDERS}]
    use_cases, stats = _lengths(scoped, stub, names=short)
    assert stub.calls == [], "nothing needs a re-ask, so no LLM call is made"
    assert stats["long"] == 0 and use_cases[0]["Name"] == "Predict Customer Churn"


def test_no_reask_when_every_labelled_name_already_carries_the_label(scoped):
    stub = _Stub(answers=[json.dumps(GOOD)])
    carried = [{"No": "1", "Name": "Forecast Contoso Order Volume", "Primary Table": USE_CASE_ORDERS}]
    _, stats = _labelled(scoped, stub, names=carried)
    assert stub.calls == [] and stats["carried"] == 1 and stats["fallback"] == 0


def test_no_reask_without_a_label_even_when_the_scope_reads_filtered_tables(scoped):
    stub = _Stub(answers=[json.dumps(GOOD)])
    use_cases = [dict(uc) for uc in MISSED]
    stats = scoped["ensure_data_filter_labels"](use_cases, lambda uc: [], "", scoped["INSPIRE_TABLE_SCOPES"],
                                                reask=lambda misses: scoped["reask_data_filter_names"](stub, misses, ""))
    assert stub.calls == [] and stats["affected"] == 0


def test_both_proof_lines_reach_the_logger_with_a_label(scoped, caplog):
    caplog.set_level(logging.INFO)
    label_stats = {"affected": 2, "carried": 0, "reasked": 0, "fallback": 2, "kept_user_named": 0, "subtitled": 0}
    name_stats = {"long": 2, "reasked": 0, "shortened": 2, "kept_user_named": 0}
    lines = scoped["log_name_fix_lines"](scoped["logger"], label_stats, "Contoso", name_stats)
    messages = [r.getMessage() for r in caplog.records]
    assert any(m.startswith("[NAME-LENGTH] 2 names over 6 words: re-asked 0, could not rename 2, shortened 2") for m in messages)
    assert any(m.startswith('[DATA-FILTER-LABEL FIRED] 0 of 2 names carried the label "Contoso"') for m in messages)
    assert lines == [m for m in messages if m in lines], "the returned lines are the logged lines"


def test_the_name_length_line_appears_without_a_label_too(scoped, caplog):
    caplog.set_level(logging.INFO)
    scoped["log_name_fix_lines"](scoped["logger"], {}, "", {"long": 0, "reasked": 0, "shortened": 0, "kept_user_named": 0})
    messages = [r.getMessage() for r in caplog.records]
    assert any(m.startswith("[NAME-LENGTH] 0 names over 6 words") for m in messages)
    assert not any("DATA-FILTER-LABEL FIRED" in m for m in messages), "no label, no label line"


def test_the_call_site_writes_both_proof_lines_through_the_logger_not_the_console_only(agent_ns):
    here = os.path.dirname(os.path.abspath(__file__))
    notebook = os.path.join(os.path.dirname(os.path.dirname(here)), "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        source = "".join(json.load(handle)["cells"][1]["source"])
    assert "log_name_fix_lines(self.logger, label_stats, DATA_FILTER_LABEL[\"text\"], name_length_stats)" in source
    assert 'log_print(f"[NAME-LENGTH]' not in source, "log_print is console-only, so the NAME-LENGTH line must not use it"
