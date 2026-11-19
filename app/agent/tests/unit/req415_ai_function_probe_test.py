"""REQ-415 (D-BETA-3A): the AI-function probe makes one minimal documented call per function and classifies what came back.

Stubs stand in for the workspace: `FakeSpark.sql` answers DESCRIBE FUNCTION from one script and the minimal call from another.
Classes: success = available; not-found, not-enabled or region answers = unavailable; a timeout or any other error = unknown,
which is never cached. A DESCRIBE answer that the function does not exist skips its call. Available and unavailable are cached
per workspace. No workspace is contacted.
"""
import logging
import re

import pytest

from _agentload import load_agent_namespace

NOT_FOUND = "[ROUTINE_NOT_FOUND] The routine `{name}` cannot be found."
UNRESOLVED = "[UNRESOLVED_ROUTINE] Cannot resolve routine `{name}` on search path [`system`.`builtin`]"
NOT_ENABLED = "The AI function {name} is not enabled for this workspace"
REGION = "This function is only available in some regions, see AI function availability."
CLASSIC = "This function is not available on Databricks SQL Classic."
RAN_BUT_BAD_DATA = "[AI_PREDICT_INSUFFICIENT_TRAINING_DATA] Not enough labelled rows to train {name}."
TIMEOUT = "[function probe {name}] Spark work timed out after 30.0s (budget 30)"
PERMISSION = "[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on schema `c`.`s`"
NAME = re.compile(r"\b(ai_top_drivers|ai_decide|ai_predict_class|ai_predict_value|ai_detect_anomalies|ai_enrich|ai_similarity|"
                  r"ai_forecast|vector_search)\b", re.IGNORECASE)


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class FakeSpark:
    """`describe` maps a name to the error its DESCRIBE raises (absent = it describes). `calls` maps a name to the error its minimal
    call raises (absent = the call returns)."""

    def __init__(self, describe=None, calls=None):
        self.describe = describe or {}
        self.calls = calls or {}
        self.call_log = []
        self.describe_log = []

    def sql(self, statement):
        name = NAME.search(statement).group(1).lower()
        if statement.startswith("DESCRIBE FUNCTION"):
            self.describe_log.append(name)
            if name in self.describe:
                raise RuntimeError(self.describe[name].format(name=name))
            return _Frame()
        self.call_log.append(name)
        if name in self.calls:
            raise RuntimeError(self.calls[name].format(name=name))
        return _Frame()


class _Frame:
    def collect(self):
        return []


class Log:
    def __init__(self):
        self.lines = []

    def info(self, message, *args, **kwargs):
        self.lines.append(str(message))

    def warning(self, message, *args, **kwargs):
        self.lines.append(str(message))


@pytest.fixture
def fresh(ns):
    ns["AI_FUNCTION_PROBE_CACHE"].clear()
    ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)
    yield ns
    ns["AI_FUNCTION_PROBE_CACHE"].clear()
    ns["TECHNICAL_CONTEXT"].pop("ai_function_status", None)


def test_the_probe_list_is_the_documented_names_without_bare_ai_predict(fresh):
    names = fresh["AI_BETA_FUNCTIONS"]
    assert set(names) == {"ai_top_drivers", "ai_decide", "ai_predict_class", "ai_predict_value", "ai_detect_anomalies", "ai_enrich",
                          "ai_similarity", "ai_forecast", "vector_search"}
    assert "ai_predict" not in names
    assert set(fresh["AI_FUNCTION_PROBE_CALLS"]) == set(names), "every probed name has one minimal call"


@pytest.mark.parametrize("error,status", [
    (None, "available"),
    (UNRESOLVED.format(name="ai_decide"), "unavailable"),
    (NOT_FOUND.format(name="ai_decide"), "unavailable"),
    (NOT_ENABLED.format(name="ai_enrich"), "unavailable"),
    (REGION, "unavailable"),
    (CLASSIC, "unavailable"),
    (RAN_BUT_BAD_DATA.format(name="ai_predict_class"), "available"),
    (TIMEOUT.format(name="ai_decide"), "unknown"),
    (PERMISSION, "unknown"),
    ("", "unknown"),
])
def test_the_result_of_the_minimal_call_classifies_the_function(fresh, error, status):
    assert fresh["classify_ai_function_result"](error) == status


def test_every_call_that_returns_makes_its_function_available_and_each_is_called_once(fresh):
    spark = FakeSpark()
    result = fresh["probe_ai_functions"](spark, Log(), workspace_key="ws-a")
    assert set(result.values()) == {"available"}
    assert sorted(spark.call_log) == sorted(fresh["AI_BETA_FUNCTIONS"])
    assert fresh["TECHNICAL_CONTEXT"]["ai_function_status"] == result


def test_a_call_that_says_unresolved_is_unavailable_and_cached_for_the_workspace(fresh):
    spark = FakeSpark(calls={"ai_decide": UNRESOLVED})
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "unavailable" and first["ai_similarity"] == "available"
    assert fresh["TECHNICAL_CONTEXT"]["ai_function_status"]["ai_decide"] == "unavailable"
    before = len(spark.call_log)
    again = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert again["ai_decide"] == "unavailable"
    assert "ai_decide" not in spark.call_log[before:], "a cached answer is not probed again"


@pytest.mark.parametrize("message", [NOT_ENABLED, REGION])
def test_a_not_enabled_or_region_answer_is_unavailable(fresh, message):
    spark = FakeSpark(calls={"ai_similarity": message})
    assert fresh["probe_ai_functions"](spark, Log(), workspace_key="ws-a")["ai_similarity"] == "unavailable"


def test_a_timeout_is_unknown_is_not_cached_and_the_next_probe_calls_again(fresh):
    spark = FakeSpark(calls={"ai_decide": TIMEOUT})
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "unknown"
    assert ("ws-a", "ai_decide") not in fresh["AI_FUNCTION_PROBE_CACHE"]
    spark.calls = {}
    second = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert second["ai_decide"] == "available", "the next probe makes the call again and finds the function"


def test_a_describe_that_finds_no_function_skips_its_call(fresh):
    spark = FakeSpark(describe={"ai_forecast": NOT_FOUND})
    result = fresh["probe_ai_functions"](spark, Log(), workspace_key="ws-a")
    assert result["ai_forecast"] == "unavailable"
    assert "ai_forecast" in spark.describe_log
    assert "ai_forecast" not in spark.call_log, "the minimal call is skipped when the function does not exist"
    assert fresh["AI_FUNCTION_PROBE_CACHE"][("ws-a", "ai_forecast")] == "unavailable"


def test_the_cache_is_per_workspace(fresh):
    fresh["probe_ai_functions"](FakeSpark(calls={"ai_decide": UNRESOLVED}), Log(), workspace_key="ws-a")
    other = fresh["probe_ai_functions"](FakeSpark(), Log(), workspace_key="ws-b")
    assert other["ai_decide"] == "available"


def test_no_spark_session_is_unknown_and_nothing_is_cached(fresh):
    result = fresh["probe_ai_functions"](None, Log(), workspace_key="ws-a")
    assert set(result.values()) == {"unknown"}
    assert fresh["AI_FUNCTION_PROBE_CACHE"] == {}


def test_the_log_line_names_the_calls_their_cost_and_what_falls_back(fresh):
    log = Log()
    fresh["probe_ai_functions"](FakeSpark(calls={"ai_decide": UNRESOLVED, "ai_enrich": TIMEOUT}), log, workspace_key="ws-a")
    lines = [line for line in log.lines if "[AI-FUNCTION-PROBE FIRED]" in line]
    assert len(lines) == 1
    line = lines[0]
    assert "calls=9" in line
    assert "model-backed, one tiny request each: 3" in line
    assert "no token cost" in line
    head, tail = line.split("available:")[1].split("ai_query fallback:")
    assert "ai_decide" in tail and "ai_enrich" in tail and "ai_similarity" in head


def test_the_probe_is_called_at_startup_so_it_has_a_real_call_site():
    import ast
    import _agentload
    calls = []
    for source in _agentload.code_cells():
        tree = ast.parse(source)
        calls += [node for node in ast.walk(tree) if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "probe_ai_functions"]
    assert calls, "probe_ai_functions has no call site in the agent notebook"
