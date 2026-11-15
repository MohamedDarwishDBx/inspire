# REQ-231 (close-out): when the preview overrun cancels a run, Inspire's "Stopped by Inspire because ..." reason reaches the implement row
# BEFORE the cancel is sent, so a read never sees a CANCELED run with no Inspire reason. A refused cancel overwrites the row with the refusal.


def _implementer(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    return cls.__new__(cls)


def test_the_stop_reason_is_recorded_before_the_cancel(agent_ns):
    # Fail-pre: before the fix the overrun path had no record hook, so the row was never written before the cancel.
    events = []
    impl = _implementer(agent_ns)
    impl._implement_api = lambda method, path, body=None, query=None: events.append(("cancel", path))
    impl._implement_preview_overran(777, {"status": "RUNNING"}, record=lambda text: events.append(("record", text)))
    assert [e[0] for e in events] == ["record", "cancel"], events
    assert events[0][1].startswith("Stopped by Inspire because the preview run 777 was still running"), events


def test_a_refused_cancel_overwrites_the_recorded_reason_with_the_refusal(agent_ns):
    events = []
    impl = _implementer(agent_ns)

    def refuse(method, path, body=None, query=None):
        raise RuntimeError("run already terminated")

    impl._implement_api = refuse
    outcome = impl._implement_preview_overran(777, {"status": "RUNNING"}, record=lambda text: events.append(text))
    assert events[0].startswith("Stopped by Inspire because"), events
    assert events[-1].startswith("Inspire could not stop the preview run 777"), events
    assert outcome["status"] == "failed" and "stopped_by" not in outcome, outcome


def test_no_record_is_written_when_the_run_is_the_builds_own_or_unreadable(agent_ns):
    events = []
    impl = _implementer(agent_ns)
    impl._implement_api = lambda *a, **k: events.append("cancel")
    impl._implement_preview_overran(777, {"status": "RUNNING"}, own_run_id="777", record=lambda text: events.append("record"))
    impl._implement_preview_overran(777, {"status": "UNREADABLE", "note": "x"}, record=lambda text: events.append("record"))
    assert events == [], "no record and no cancel for a run Inspire must not stop"
