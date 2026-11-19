"""REQ-415 (D-BETA-3A): a per-workspace probe of the Beta AI functions, with a result the run can trust.

`probe_ai_functions` calls each Beta function with no arguments. A function that exists answers with an argument-count
error, a name the workspace does not know answers UNRESOLVED_ROUTINE, and anything else (a timeout, a dropped connection,
a permission error) is inconclusive. Only a definite answer is cached: an inconclusive result is probed again on the next
call, so a transient error is never shown as "unavailable" for good. Fixtures are a fake Spark session, no workspace.
"""
import logging

import pytest

from _agentload import load_agent_namespace

UNRESOLVED = "[UNRESOLVED_ROUTINE] Cannot resolve routine `{name}` on search path [`system`.`builtin`]"
WRONG_ARGS = "[WRONG_NUM_ARGS.WITHOUT_SUGGESTION] The `{name}` requires 2 parameters but the query provides 0 parameters."
TIMEOUT = "Request timed out while waiting for the warehouse to answer"
NOT_ENABLED = "The AI function {name} is not enabled for this workspace"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class FakeSpark:
    """Answers `SELECT <fn>()` from a per-function script: an exception to raise, or None for success."""

    def __init__(self, script=None, default=None):
        self.script = script or {}
        self.default = default
        self.sql_calls = []

    def sql(self, statement):
        name = statement.replace("SELECT", "").replace("(", "").replace(")", "").strip()
        self.sql_calls.append(name)
        outcome = self.script.get(name, self.default)
        if outcome is None:
            return _Frame()
        raise RuntimeError(outcome.format(name=name))


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
    return ns


def test_an_unknown_name_is_unavailable_and_an_argument_error_means_it_exists(fresh):
    classify = fresh["classify_ai_function_error"]
    assert classify(UNRESOLVED.format(name="ai_decide")) == "unavailable"
    assert classify(WRONG_ARGS.format(name="ai_decide")) == "available"


def test_a_function_the_workspace_says_is_not_enabled_is_unavailable(fresh):
    assert fresh["classify_ai_function_error"](NOT_ENABLED.format(name="ai_top_drivers")) == "unavailable"


def test_a_timeout_or_a_permission_error_is_inconclusive_never_unavailable(fresh):
    classify = fresh["classify_ai_function_error"]
    assert classify(TIMEOUT) == "error"
    assert classify("[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on schema `c`.`s`") == "error"
    assert classify("") == "error"


def test_probe_reports_every_function_available_when_each_answers_with_an_argument_error(fresh):
    spark = FakeSpark(default=WRONG_ARGS)
    result = fresh["probe_ai_functions"](spark, Log(), workspace_key="ws-a")
    assert set(result) == set(fresh["AI_BETA_FUNCTIONS"])
    assert set(result.values()) == {"available"}


def test_probe_marks_a_missing_function_unavailable_and_caches_that_answer_for_the_workspace(fresh):
    spark = FakeSpark(script={"ai_decide": UNRESOLVED}, default=WRONG_ARGS)
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "unavailable" and first["ai_similarity"] == "available"
    calls = len(spark.sql_calls)
    again = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert again["ai_decide"] == "unavailable"
    assert "ai_decide" not in spark.sql_calls[calls:], "a definite answer is cached, so the workspace is not probed again"


def test_a_probe_error_is_not_cached_so_it_is_probed_again_and_never_shown_unavailable_for_good(fresh):
    spark = FakeSpark(script={"ai_decide": TIMEOUT}, default=WRONG_ARGS)
    log = Log()
    first = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert first["ai_decide"] == "error"
    spark.script = {}
    second = fresh["probe_ai_functions"](spark, log, workspace_key="ws-a")
    assert second["ai_decide"] == "available", "the next probe finds the function after the transient error"


def test_the_cache_is_per_workspace(fresh):
    fresh["probe_ai_functions"](FakeSpark(script={"ai_decide": UNRESOLVED}, default=WRONG_ARGS), Log(), workspace_key="ws-a")
    other = fresh["probe_ai_functions"](FakeSpark(default=WRONG_ARGS), Log(), workspace_key="ws-b")
    assert other["ai_decide"] == "available"


def test_no_spark_session_is_an_error_and_is_not_cached(fresh):
    result = fresh["probe_ai_functions"](None, Log(), workspace_key="ws-a")
    assert set(result.values()) == {"error"}
    assert fresh["AI_FUNCTION_PROBE_CACHE"] == {}


def test_the_probe_logs_one_line_naming_what_is_available_and_what_falls_back_to_ai_query(fresh):
    log = Log()
    fresh["probe_ai_functions"](FakeSpark(script={"ai_decide": UNRESOLVED, "ai_enrich": TIMEOUT}, default=WRONG_ARGS),
                                log, workspace_key="ws-a")
    lines = [line for line in log.lines if "[AI-FUNCTION-PROBE FIRED]" in line]
    assert len(lines) == 1
    assert "ai_decide" in lines[0] and "ai_query fallback" in lines[0] and "ai_enrich" in lines[0]
    assert "ai_similarity" in lines[0].split("available:")[1].split(";")[0]


def test_the_probe_is_called_once_at_startup_next_to_the_endpoint_probe():
    """Behavioural wiring check: the agent constructor calls the probe, so the probe has a real call site."""
    import ast
    import _agentload
    calls = []
    for source in _agentload.code_cells():
        tree = ast.parse(source)
        calls += [node for node in ast.walk(tree) if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "probe_ai_functions"]
    assert calls, "probe_ai_functions has no call site in the agent notebook"
