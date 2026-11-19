"""REQ-415 (D-BETA-3A): a per-workspace probe of the Beta and Public Preview AI functions, with one status record the run reads.

`probe_ai_functions` runs DESCRIBE FUNCTION for each name. A name the workspace does not know, or a function it reports as not
enabled, is "unavailable" and is cached for the run. Any other failure (a timeout, a dropped connection, a permission error) is
"error": it is never cached, so it is probed again. The result is written to TECHNICAL_CONTEXT["ai_function_status"], the one record
the generated code reads (ai_function_fallback_sentence). ai_predict has no documentation page, so it is not probed.
Fixtures: a fake Spark session, no workspace.
"""
import logging

import pytest

from _agentload import load_agent_namespace

UNRESOLVED = "[UNRESOLVED_ROUTINE] Cannot resolve routine `{name}` on search path [`system`.`builtin`]"
NOT_FOUND = "[ROUTINE_NOT_FOUND] The routine `{name}` cannot be found."
NOT_ENABLED = "The AI function {name} is not enabled for this workspace"
TIMEOUT = "Request timed out while waiting for the warehouse to answer"
PERMISSION = "[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on schema `c`.`s`"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class FakeSpark:
    """Answers `DESCRIBE FUNCTION <name>` from a script: an error message to raise per name, anything else describes the function."""

    def __init__(self, script=None):
        self.script = script or {}
        self.sql_calls = []

    def sql(self, statement):
        name = statement.replace("DESCRIBE FUNCTION", "").strip()
        self.sql_calls.append(name)
        if name in self.script:
            raise RuntimeError(self.script[name].format(name=name))
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


def test_the_probe_list_is_the_documented_beta_and_preview_names_without_bare_ai_predict(fresh):
    names = fresh["AI_BETA_FUNCTIONS"]
    assert set(names) == {"ai_top_drivers", "ai_decide", "ai_predict_class", "ai_predict_value", "ai_detect_anomalies", "ai_enrich",
                          "ai_similarity", "ai_forecast", "vector_search"}
    assert "ai_predict" not in names


def test_unknown_names_and_not_enabled_functions_classify_as_unavailable(fresh):
    classify = fresh["classify_ai_function_error"]
    assert classify(UNRESOLVED.format(name="ai_decide")) == "unavailable"
    assert classify(NOT_FOUND.format(name="ai_decide")) == "unavailable"
    assert classify(NOT_ENABLED.format(name="ai_top_drivers")) == "unavailable"


def test_a_timeout_or_a_permission_error_is_inconclusive_never_unavailable(fresh):
    classify = fresh["classify_ai_function_error"]
    assert classify(TIMEOUT) == "error"
    assert classify(PERMISSION) == "error"
    assert classify("") == "error"


def test_every_function_that_describes_is_available(fresh):
    result = fresh["probe_ai_functions"](FakeSpark(), Log(), workspace_key="ws-a")
    assert set(result) == set(fresh["AI_BETA_FUNCTIONS"])
    assert set(result.values()) == {"available"}
    assert fresh["TECHNICAL_CONTEXT"]["ai_function_status"] == result


def test_a_missing_function_is_unavailable_in_the_run_record_and_is_cached(fresh):
    spark = FakeSpark({"ai_decide": UNRESOLVED})
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "unavailable" and first["ai_similarity"] == "available"
    assert fresh["TECHNICAL_CONTEXT"]["ai_function_status"]["ai_decide"] == "unavailable"
    calls = len(spark.sql_calls)
    again = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert again["ai_decide"] == "unavailable"
    assert "ai_decide" not in spark.sql_calls[calls:], "a definite answer is cached, so the workspace is not probed again"


def test_a_probe_error_is_not_cached_and_is_probed_again(fresh):
    spark = FakeSpark({"ai_decide": TIMEOUT})
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "error"
    spark.script = {}
    second = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert second["ai_decide"] == "available", "the next probe finds the function after the transient error"


def test_the_cache_is_per_workspace(fresh):
    fresh["probe_ai_functions"](FakeSpark({"ai_decide": UNRESOLVED}), Log(), workspace_key="ws-a")
    other = fresh["probe_ai_functions"](FakeSpark(), Log(), workspace_key="ws-b")
    assert other["ai_decide"] == "available"


def test_no_spark_session_is_an_error_and_is_not_cached(fresh):
    result = fresh["probe_ai_functions"](None, Log(), workspace_key="ws-a")
    assert set(result.values()) == {"error"}
    assert fresh["AI_FUNCTION_PROBE_CACHE"] == {}


def test_the_probe_logs_one_line_naming_what_is_available_and_what_falls_back(fresh):
    log = Log()
    fresh["probe_ai_functions"](FakeSpark({"ai_decide": NOT_FOUND, "ai_enrich": TIMEOUT}), log, workspace_key="ws-a")
    lines = [line for line in log.lines if "[AI-FUNCTION-PROBE FIRED]" in line]
    assert len(lines) == 1
    head, tail = lines[0].split("available:")[1].split("ai_query fallback:")
    assert "ai_decide" in tail and "ai_enrich" in tail and "ai_similarity" in head


def test_the_probe_is_called_at_startup_so_it_has_a_real_call_site():
    import ast
    import _agentload
    calls = []
    for source in _agentload.code_cells():
        tree = ast.parse(source)
        calls += [node for node in ast.walk(tree) if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "probe_ai_functions"]
    assert calls, "probe_ai_functions has no call site in the agent notebook"
