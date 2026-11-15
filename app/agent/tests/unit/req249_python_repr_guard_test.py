"""REQ-249: a text value that reads as a Python or pandas object dump never reaches a results table or a row explanation.

Write-time guard: inspire_require_no_python_repr (called by inspire_write_result and inspire_write_companion) fails the write
before it runs. Explanation guard: inspire_ai_checks flags an AI explanation that carries a dump, so the AI gate sends it back.
The frame is a fake: it evaluates the one SQL shape the guard emits with Python's re, using the same pattern.
"""
import re

import pytest

DUMP = "<bound method Series.prod of inspire_group 0 1\nName: 165, dtype: object>"
PLAIN = "Average transaction value rose 12% to 340 USD over the last 30 days."
EXPR = re.compile(r"^max\(CAST\(`(?P<col>[^`]+)` RLIKE '(?P<lit>(?:[^'\\]|\\.)*)' AS INT\)\) AS c(?P<i>\d+)$")


class _Type:
    def __init__(self, kind):
        self.kind = kind

    def typeName(self):
        return self.kind


class _Field:
    def __init__(self, name, kind):
        self.name, self.dataType = name, _Type(kind)


class _Row(tuple):
    pass


class _Frame:
    def __init__(self, fields, rows):
        self.schema = type("Schema", (), {"fields": [_Field(n, k) for n, k in fields]})()
        self.rows = rows
        self.exprs = []

    def selectExpr(self, *exprs):
        self.exprs.append(list(exprs))
        frame = self

        class _Result:
            def first(self):
                values = []
                for expr in exprs:
                    match = EXPR.match(expr)
                    assert match, f"the guard emitted an unexpected expression: {expr}"
                    pattern = re.sub(r"\\(.)", r"\1", match.group("lit"))
                    hits = [int(bool(re.search(pattern, str(row[match.group("col")])))) for row in frame.rows
                            if row.get(match.group("col")) is not None]
                    values.append(max(hits) if hits else None)
                return _Row(values)

        return _Result()


def test_the_guard_fails_a_dump_in_a_text_column_before_the_write(agent_ns):
    frame = _Frame([("use_case_id", "string"), ("ai_facts", "string"), ("value", "double")],
                   [{"use_case_id": "N01", "ai_facts": PLAIN, "value": 1.0},
                    {"use_case_id": "N01", "ai_facts": DUMP, "value": 2.0}])
    with pytest.raises(ValueError) as error:
        agent_ns["inspire_require_no_python_repr"](frame, "the result frame for main.s.out")
    assert "ai_facts" in str(error.value), "the message names the column"
    assert "bound method" not in str(error.value) and "dtype" not in str(error.value), "the message never echoes the dump"


def test_a_plain_sentence_passes_the_guard(agent_ns):
    frame = _Frame([("use_case_id", "string"), ("ai_explanation", "string")], [{"use_case_id": "N01", "ai_explanation": PLAIN}])
    assert agent_ns["inspire_require_no_python_repr"](frame, "the result frame for main.s.out") is None


def test_numeric_columns_and_empty_frames_are_not_scanned(agent_ns):
    numeric = _Frame([("value", "double")], [{"value": 2.0}])
    assert agent_ns["inspire_require_no_python_repr"](numeric, "x") is None
    assert numeric.exprs == [], "no SQL is sent when the frame has no text column"
    empty = _Frame([("ai_facts", "string")], [])
    assert agent_ns["inspire_require_no_python_repr"](empty, "x") is None, "an empty frame has no dump"


def test_the_pattern_catches_each_dump_shape_and_keeps_plain_text(agent_ns):
    pattern = agent_ns["INSPIRE_PYTHON_REPR"]
    for dump in (DUMP, "value <function score at 0x7f3a>", "handle <built-in method sum>", "dtype: object", "<class 'int'>"):
        assert re.search(pattern, dump), f"must-fail: {dump}"
    for text in (PLAIN, "Name: Acme Corp, the largest account in the region", "dtype is a column word in a sentence"):
        assert not re.search(pattern, text), f"must-keep: {text}"


def test_the_explanation_check_flags_a_dump_in_the_ai_text(agent_ns):
    checks = agent_ns["inspire_ai_checks"]({"categories": {}})
    labels = [label for label, _test, _detail in checks]
    assert labels.count("explanation reads as a Python object dump") == 1
    assert "evidence reads as a Python object dump" in labels
    test_sql = dict((label, test) for label, test, _detail in checks)["explanation reads as a Python object dump"]
    assert f"RLIKE {agent_ns['inspire_sql_literal'](agent_ns['INSPIRE_PYTHON_REPR'])}" in test_sql, "the check tests the repr pattern"
