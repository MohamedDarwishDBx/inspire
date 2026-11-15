"""F13 / REQ-337: the data filter name re-ask asks for one format (a JSON list of Ref and Name) and parses it.

rc7 (build fbdb909e1) re-asked one name through DATA_FILTER_LABEL_RENAME_PROMPT. The answer was 80 characters: a JSON list of one
object, Ref "0", with a 7-word name. F8 logged that as "not a JSON list", retried at temperature 0 with the cache skipped, and got the
same 80 characters back. Root cause: the re-ask sent no response schema (JSON mode off), so the endpoint never enforced the list, and
the parser folded a well-formed answer that broke the word rule into the format failure. The retry carried no reason, so it repeated the
answer. Fixed here: the re-ask passes the JSON array schema, the parser reports why an answer was refused, and the retry carries that
reason to the model. The name-length re-ask keeps the Data Filter label rule.

The recorded answer is rebuilt from the logged facts (a JSON list, Ref "0", the 7-word name, 80 characters); the step row kept the
parsed rows, not the raw bytes.
"""
import json
import logging

import pytest

USE_CASE_ORDERS = "main.s.orders"
LABEL = "Tokyo Tidbits"
RECORDED = '```json\n[{"Name":"Rank Tokyo Tidbits Customers by Future Value","Ref":"0"}]\n```\n'
MISSED = [{"No": "1", "Name": "Rank Customers by Future Value and Tier", "Primary Table": USE_CASE_ORDERS}]
PROSE_BAD = "Ref: 0 | Rank Tokyo Tidbits Customers\nThese are the rewritten names, Title Case."
GOOD = [{"Ref": "0", "Name": "Forecast Tokyo Tidbits Order Volume"}]
SCOPE = {USE_CASE_ORDERS: {"columns": ["order_id", "brand"], "rows": [{"column": "brand", "op": "=", "values": ["Contoso"]}]}}


class _Stub:
    """Stands in for run_worker: records each call and returns the scripted answers in order."""

    def __init__(self, answers=()):
        self.calls = []
        self.answers = list(answers)

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]


@pytest.fixture
def ns(agent_ns):
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()
    agent_ns["INSPIRE_TABLE_SCOPES"].update(agent_ns["parse_table_scopes"](json.dumps(SCOPE)))
    yield agent_ns
    agent_ns["INSPIRE_TABLE_SCOPES"].clear()


def _reask(ns, stub, misses=None, label=LABEL):
    return ns["reask_data_filter_names"](stub, misses if misses is not None else [dict(uc) for uc in MISSED], label)


def test_the_recorded_answer_is_eighty_characters_and_names_the_rule_not_the_format(ns, caplog):
    """The recorded 80-character answer is a JSON list: its refusal says the name broke the rule, not that the format was wrong."""
    caplog.set_level(logging.INFO)
    assert len(RECORDED) == 80
    stub = _Stub(answers=[RECORDED])
    answers = _reask(ns, stub)
    assert answers == [None], "a 7-word name is refused (2 to 6 words), so the miss is kept as written"
    lines = [r.getMessage() for r in caplog.records if "gave no usable name for" in r.getMessage()]
    assert len(lines) == 2, "each refused attempt is logged"
    assert "is a JSON list, but no name in it fits the rule" in lines[0], "the log names the real reason"
    assert "is not a JSON list" not in lines[0], "a well-formed list is never called a format failure"
    assert "Ref 0 has 7 words" in lines[0], "the log says which name broke which rule, by count, never by the model's text"
    assert "Rank Tokyo" not in " ".join(lines), "model text is never written to the log"


def test_the_re_ask_asks_for_the_json_array_schema_on_every_attempt(ns):
    """Both attempts run with the JSON array response schema, so the endpoint enforces the list (the run_worker facility)."""
    stub = _Stub(answers=[RECORDED])
    _reask(ns, stub)
    assert len(stub.calls) == 2
    for call in stub.calls:
        assert call["response_schema"] is ns["JSON_ARRAY_RESPONSE_SCHEMA"], "JSON mode is requested, not left to prose"
        assert call["skip_cache"] is True


def test_the_retry_carries_the_reason_so_it_is_not_the_same_answer(ns):
    """The second attempt is told why the first was refused; an identical retry at temperature 0 is what F8 shipped."""
    stub = _Stub(answers=[RECORDED, json.dumps(GOOD)])
    answers = _reask(ns, stub)
    assert answers == ["Forecast Tokyo Tidbits Order Volume"], "the corrected second answer is used"
    first, second = stub.calls
    assert first["prompt_vars"]["retry_note"] == "", "the first attempt has no earlier answer to correct"
    note = second["prompt_vars"]["retry_note"]
    assert "a JSON list, but no name in it fits the rule" in note and "Ref 0 has 7 words" in note
    assert "Rank Tokyo" not in note, "the note carries the reason, never the model's wording"


def test_a_json_list_wrapped_in_a_fence_or_prose_parses(ns):
    """A usable answer parses whether it is fenced, wrapped in prose, or the endpoint's {"results": [...]} wrapper."""
    variants = [
        "```json\n" + json.dumps(GOOD) + "\n```",
        "Here are the names: " + json.dumps(GOOD) + " Thanks.",
        json.dumps({"results": GOOD}),
    ]
    for raw in variants:
        stub = _Stub(answers=[raw])
        answers = _reask(ns, stub)
        assert answers == ["Forecast Tokyo Tidbits Order Volume"], raw
        assert len(stub.calls) == 1, "a usable answer needs no retry"


def test_a_truly_bad_answer_is_still_refused_and_the_names_are_kept(ns, caplog):
    """Prose or a Ref/Name table is refused twice, logged as not a JSON list, and the miss is kept as written."""
    caplog.set_level(logging.INFO)
    stub = _Stub(answers=[PROSE_BAD])
    answers = _reask(ns, stub)
    assert answers == [None]
    assert len(stub.calls) == 2
    assert stub.calls[0]["prompt_vars"]["retry_note"] == ""
    lines = [r.getMessage() for r in caplog.records if "gave no usable name for" in r.getMessage()]
    assert len(lines) == 2 and all(f"the answer of {len(PROSE_BAD)} characters is not a JSON list" in x for x in lines)
    assert "is not a JSON list of Ref and Name naming a miss" in stub.calls[1]["prompt_vars"]["retry_note"]


def test_a_name_without_the_label_is_refused_in_the_name_length_re_ask(ns):
    """The name-length re-ask keeps the label rule the label gate set: a label-less answer is refused, not applied."""
    label_less = json.dumps([{"Ref": "0", "Name": "Rank Customers by Future Value"}])
    stub = _Stub(answers=[label_less])
    answers = _reask(ns, stub)
    assert answers == [None], "the label is required when the Data Filter label is set"
    assert "lacks the label" in stub.calls[1]["prompt_vars"]["retry_note"]


def test_the_name_length_call_site_passes_the_label():
    """Wiring: the Final Gate's name-length re-ask passes the Data Filter label, so the label survives the second rename."""
    from _agentload import agent_source
    agent_src = agent_source()
    length_call = agent_src[agent_src.index("name_length_stats = ensure_name_lengths("):]
    length_call = length_call[:length_call.index("log_name_fix_lines(")]
    assert "reask_data_filter_names(self.ai_agent.run_worker, misses, DATA_FILTER_LABEL[\"text\"]" in length_call
    assert "misses, \"\", strategy_rule" not in length_call


def test_a_fallback_the_label_could_not_fit_is_not_counted_as_carried(ns):
    """The label gate counts a set-directly fallback only when the new name carries the label; insert_label_into_name returns a
    name unchanged when the label would push it past six words."""
    use_cases = [{"No": "1", "Name": "Rank Customers by Future Value and Tier Level Risk"}]
    use_cases[0]["Primary Table"] = USE_CASE_ORDERS
    stats = ns["ensure_data_filter_labels"](use_cases, lambda uc: [], LABEL, ns["INSPIRE_TABLE_SCOPES"],
                                            reask=lambda misses: [None] * len(misses))
    assert stats["fallback"] == 0, "the label did not fit, so this name is not counted as carrying it"
    assert "Tokyo Tidbits" not in use_cases[0]["Name"]
