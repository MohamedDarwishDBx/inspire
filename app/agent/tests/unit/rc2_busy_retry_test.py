"""REQ-326: a busy or rate-limit answer in any build step is asked again with bounded exponential backoff, and only when the retries run
out does the build stop, with the plain sentence failureCauses.js shows. A non-busy error is never asked again as busy, and the
Python busy markers are pinned to the busy and server kinds of failureCauses.js, so the two sides cannot drift apart.

A Genie round that Databricks refused as busy after the CLI's own retries used to count as a failed build round: the busy text went
back to Genie as code to fix, and three of those failed the build (live MVP run, 42 minutes)."""
import os
import re
import sys
import time
import types

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _FakeRunner, _loop_inspire, LOOP_CONTEXT  # noqa: E402
from v220_genie_crash_test import _runner, _scripted_genie  # noqa: E402

LIMIT = "Genie error: REQUEST_LIMIT_EXCEEDED: the workspace is over its request limit"
DENIED = "Genie error: PERMISSION_DENIED: User does not have USE CATALOG on catalog main"
QUOTA = "Genie error: RESOURCE_EXHAUSTED: quota exceeded for the endpoint"
FAILURE_CAUSES = os.path.join(TESTS, "..", "..", "agent", "app_shell", "web", "src", "failureCauses.js")
PLAIN_BUSY = "Databricks is busy right now, so wait a minute and try again"


def busy_round(said):
    return {"exit": 1, "errors": [said]}


def test_a_busy_genie_round_is_run_again_without_using_a_build_round(agent_ns, tmp_path, monkeypatch):
    slept = []
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: slept.append(seconds) or False)
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([busy_round(LIMIT), {"exit": 0}])
    deployed = []
    fields = inst._implement_genie_loop(LOOP_CONTEXT, runner, "Dashboard", "write it",
                                        lambda work: deployed.append(work) or {"dashboard_id": "d1"})
    assert fields == {"dashboard_id": "d1"} and len(deployed) == 1, "the build continues after the busy round"
    assert len(runner.prompts) == 2
    assert "Inspire tried to use what you wrote" not in runner.prompts[1], "a busy answer is not code for Genie to fix (must-exclude)"
    assert len(slept) == 1 and 20 <= slept[0] <= 25, slept
    assert any("[GENIE-BUSY-ROUND FIRED]" in line for _level, line in inst.logger.records)


def test_a_busy_genie_that_keeps_failing_stops_after_its_busy_retries_with_the_plain_message(agent_ns, tmp_path, monkeypatch):
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: False)
    inst = _loop_inspire(agent_ns, tmp_path)
    tries = agent_ns["IMPLEMENT_BUSY_ROUNDS"] + 1
    runner = _FakeRunner([busy_round(LIMIT)] * tries)
    with pytest.raises(agent_ns["ImplementBusy"]) as raised:
        inst._implement_genie_loop(LOOP_CONTEXT, runner, "Dashboard", "write it", lambda work: pytest.fail("a busy Genie never deploys"))
    text = str(raised.value)
    assert text.startswith(PLAIN_BUSY), text
    assert len(runner.prompts) == tries, "one run per busy retry, then the build stops: bounded, never an endless loop"
    assert agent_ns["implement_failure_origin"](raised.value) == "platform", "never a person error (must-exclude)"
    assert agent_ns["implement_known_repair"](raised.value, text)["kind"] == "stop", "the retries already ran, so the attempt does not repeat them"


@pytest.mark.parametrize("said", [DENIED, QUOTA, "Genie error: unknown field tools"])
def test_a_round_error_that_is_not_busy_is_never_asked_again_as_busy(agent_ns, tmp_path, monkeypatch, said):
    slept = []
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: slept.append(seconds) or False)
    inst = _loop_inspire(agent_ns, tmp_path)
    runner = _FakeRunner([busy_round(said)] * agent_ns["IMPLEMENT_MAX_GENIE_ROUNDS"])
    with pytest.raises(RuntimeError, match="still failed after"):
        inst._implement_genie_loop(LOOP_CONTEXT, runner, "Dashboard", "write it", lambda work: pytest.fail("a failed Genie never deploys"))
    assert slept == [] and len(runner.prompts) == agent_ns["IMPLEMENT_MAX_GENIE_ROUNDS"], "each failure is a build round, as before"


def test_the_genie_cli_asks_again_on_too_many_requests_with_the_busy_backoff(agent_ns, tmp_path, monkeypatch):
    slept, prompts = [], []
    monkeypatch.setitem(agent_ns, "_cancellable_sleep", lambda seconds: slept.append(seconds) or False)
    runner = _runner(agent_ns, tmp_path, "https://workspace.example.com",
                     _scripted_genie([(1, "TOO_MANY_REQUESTS: slow down"), (0, "")], prompts))
    runner.relay_factory = lambda host, logger, loopback: None
    assert runner.run("build it", str(tmp_path / "w"), label="build")["exit"] == 0
    assert len(prompts) == 2 and 20 <= slept[0] <= 25, slept


def test_a_rest_call_asks_again_on_busy_with_the_busy_schedule_and_never_on_a_denial(agent_ns, tmp_path, monkeypatch):
    slept = []
    monkeypatch.setattr(time, "sleep", slept.append)
    inst = _loop_inspire(agent_ns, tmp_path)
    calls = []

    def busy_then_answers():
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("REQUEST_LIMIT_EXCEEDED: over the limit")
        return {"ok": True}

    assert inst._implement_retried(busy_then_answers, "GET /api/x") == {"ok": True}
    assert len(calls) == 3 and len(slept) == 2, "a busy SQL or App call is asked again, bounded"
    assert 20 <= slept[0] <= 25 and 40 <= slept[1] <= 50, slept

    denied = []

    def refused():
        denied.append(1)
        raise RuntimeError("PERMISSION_DENIED: User does not have USE CATALOG")

    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        inst._implement_retried(refused, "GET /x")
    assert denied == [1], "a denial is never asked again (must-exclude)"


def _failure_cause_samples(kind):
    """The literal alternatives of one failureCauses.js kind, each turned into a sample text the regex matches."""
    source = open(FAILURE_CAUSES, encoding="utf-8").read()
    found = re.search(r"kind: '%s'[^\n]*?test: /([^\n]*?)/i," % kind, source)
    assert found, f"failureCauses.js has no kind '{kind}' with a test regex"
    samples = []
    for alt in found.group(1).split("|"):
        text = re.sub(r"\(\?:[^)]*\)\?", "", alt).replace("\\b", "").replace("[0-4]", "0")
        samples.append(text.replace("\\(", "(").replace("\\)", ")"))
    return samples


def test_the_python_busy_markers_agree_with_the_busy_and_server_kinds_of_failure_causes(agent_ns):
    busy, server = _failure_cause_samples("busy"), _failure_cause_samples("server")
    assert len(busy) == 7 and len(server) == 5, f"the parse must find every alternative (no vacuous pass): {busy} {server}"
    for sample in busy + server:
        assert agent_ns["implement_busy"](sample), f"failureCauses.js calls {sample!r} transient, Python must too"


@pytest.mark.parametrize("sample", ["RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED", "quota exceeded", "PERMISSION_DENIED: no grant",
                                    "TABLE_OR_VIEW_NOT_FOUND: main.x.y", "UNAUTHENTICATED: token expired", "syntax error near FROM"])
def test_a_quota_denial_or_missing_object_is_never_busy_in_python_either(agent_ns, sample):
    assert agent_ns["implement_busy"](sample) is False, f"{sample!r} must not be asked again as busy (must-exclude)"


def test_the_plain_busy_sentence_the_build_stops_with_is_the_busy_kind_failure_causes_shows(agent_ns):
    error = agent_ns["ImplementBusy"]("Dashboard", 4, "REQUEST_LIMIT_EXCEEDED: over the limit")
    source = open(FAILURE_CAUSES, encoding="utf-8").read()
    found = re.search(r"kind: 'busy'[^\n]*?test: /([^\n]*?)/i,", source)
    assert found and re.search(found.group(1), str(error), re.IGNORECASE), "failureCauses.js maps the stop to the busy sentence"
    assert str(error).startswith(PLAIN_BUSY)


def test_a_rate_limited_model_call_is_asked_again_on_the_busy_schedule_and_a_refusal_is_not(agent_ns, tmp_path, monkeypatch):
    slept, calls = [], []
    monkeypatch.setattr(time, "sleep", slept.append)
    inst = _loop_inspire(agent_ns, tmp_path)

    def rate_limited_then_answers(**kwargs):
        calls.append(kwargs["prompt_name"])
        if len(calls) == 1:
            raise RuntimeError("REQUEST_LIMIT_EXCEEDED: Exceeded workspace input tokens per minute rate limit for databricks-gpt-5-6-sol")
        return '{"ok": true}'

    inst.ai_agent = types.SimpleNamespace(_call_ai_query=rate_limited_then_answers)
    assert inst._implement_llm_object("implement_vibes_repair", "Implement_Vibes_Repair", "p", {}) == {"ok": True}
    assert len(calls) == 2 and 20 <= slept[0] <= 25, slept

    refused = []

    def refusal(**kwargs):
        refused.append(1)
        raise RuntimeError("Invalid parameter: max_tokens must be at most 500")

    inst.ai_agent = types.SimpleNamespace(_call_ai_query=refusal)
    with pytest.raises(RuntimeError, match="max_tokens"):
        inst._implement_llm_object("implement_vibes_repair", "Implement_Vibes_Repair", "p", {})
    assert refused == [1], "a model refusal is never asked again (must-exclude)"


@pytest.mark.parametrize("text", ["Invalid parameter: max_tokens must be at most 500", "the table holds 503 rows of 429 columns"])
def test_a_bare_number_in_a_sentence_is_not_a_status_code_and_a_stated_status_still_is(agent_ns, text):
    assert agent_ns["implement_busy"](text) is False, f"{text!r} is a bad request, not a busy answer (must-exclude)"
    assert agent_ns["implement_busy"]("unexpected status 503 Service Unavailable") is True
    assert agent_ns["implement_busy"]("HTTP 502 from the gateway") is True
