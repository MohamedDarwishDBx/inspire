# REQ-231: Inspire never reports an unreadable run as running, never cancels a run it could not read, never cancels the build's own run,
# and every stop it issues names Inspire as the stopper with the reason.
import sys
import types
import pytest


class _Unreadable:
    def get_run(self, run_id):
        raise RuntimeError("Too Many Requests")


class _Launcher:
    pass


def _launcher(agent_ns):
    return agent_ns["JobLauncher"].__new__(agent_ns["JobLauncher"])


def _implementer(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    return cls.__new__(cls)


def test_an_unreadable_run_is_reported_unreadable_not_running(agent_ns, monkeypatch):
    # Fail-pre: before the fix the wait returned {"status": "RUNNING", "note": ...} after five read errors.
    fake_sdk = types.ModuleType("databricks.sdk")
    fake_sdk.WorkspaceClient = lambda: _Unreadable()
    monkeypatch.setitem(sys.modules, "databricks.sdk", fake_sdk)
    waited = _launcher(agent_ns).wait_for_run(42, timeout_s=0, poll_s=0, out=lambda m: None)
    assert waited["status"] == "UNREADABLE", waited


def test_an_unreadable_run_is_never_cancelled(agent_ns):
    # Fail-pre: before the fix the overrun path sent POST /jobs/runs/cancel for a run it could not read.
    calls = []
    launcher = _implementer(agent_ns)
    launcher._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body))
    outcome = launcher._implement_preview_overran(777, {"status": "UNREADABLE", "note": "run state unreadable: Too Many Requests"})
    assert calls == [], calls
    assert outcome["status"] == "failed" and "did not stop the run" in outcome["error"], outcome
    assert "stopped_by" not in outcome


def test_the_build_own_run_is_never_cancelled(agent_ns):
    calls = []
    launcher = _implementer(agent_ns)
    launcher._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body))
    outcome = launcher._implement_preview_overran(555, {"status": "RUNNING"}, own_run_id=555)
    assert calls == [], calls
    assert "build's own run" in outcome["error"], outcome


def test_an_overran_preview_is_cancelled_once_and_the_status_names_inspire(agent_ns):
    calls = []
    launcher = _implementer(agent_ns)
    launcher._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, body))
    outcome = launcher._implement_preview_overran(777, {"status": "RUNNING"}, own_run_id=555)
    assert calls == [("POST", "/api/2.2/jobs/runs/cancel", {"run_id": 777})], calls
    assert outcome["stopped_by"] == "inspire"
    assert outcome["error"].startswith("Stopped by Inspire because the preview run 777 was still running"), outcome


def test_a_refused_cancel_of_an_overran_preview_says_so(agent_ns):
    launcher = _implementer(agent_ns)

    def refuse(method, path, body=None, query=None):
        raise RuntimeError("PERMISSION_DENIED")

    launcher._implement_api = refuse
    outcome = launcher._implement_preview_overran(777, {"status": "RUNNING"})
    assert "could not stop the preview run 777" in outcome["error"] and "PERMISSION_DENIED" in outcome["error"], outcome
    assert "stopped_by" not in outcome
