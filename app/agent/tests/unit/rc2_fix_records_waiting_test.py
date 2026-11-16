"""REQ-236: an App that is waiting for access answers the records list with the waiting state, never a 502.

POST records is the decision-list read. It was listed in WRITE_ROUTE_NAMES with the record writes, so an access refusal on the list
skipped the waiting conversion and the App showed a 502 on every load. Only the record writes (records/act, records/undo, records/draft)
are writes. A refusal the list raises in any spelling the App's SQL uses (INSUFFICIENT_PERMISSIONS, or a plain 'does not have SELECT
privilege') answers the waiting state; a non-permission failure still answers 502.
"""
import json

from v141_app_shell_test import PAGE, shell
from v236_waiting_for_access_test import refused_shell

import shell_core  # noqa: E402  (v141 puts the App shell server on sys.path)
import shell_db  # noqa: E402


def _records(s, data=None):
    body = json.dumps(dict({"page": PAGE["id"]}, **(data or {}))).encode()
    return s.handle("POST", "records", {"page": PAGE["id"]}, {}, body)


def test_the_records_list_is_a_read_route_and_the_record_writes_stay_writes():
    assert not shell_core.is_write_route("POST", "records")
    for name in ("records/act", "records/undo", "records/draft"):
        assert shell_core.is_write_route("POST", name), name


def test_the_records_list_answers_the_waiting_state_when_the_App_cannot_read_its_data(tmp_path):
    s = refused_shell(tmp_path)
    status, body = _records(s)
    assert status == 200, (status, body)
    assert body["state"] == "waiting_for_access" and body["message"] == shell_core.WAITING_FOR_ACCESS
    assert "GRANT" not in json.dumps(body) and "@" not in json.dumps(body)


def test_the_records_list_waiting_state_keeps_the_owners_of_the_unreadable_tables(tmp_path):
    s = refused_shell(tmp_path)
    s.settings["unread_owners"] = {"main.s.orders": "data-eng"}
    status, body = _records(s)
    assert status == 200 and body["state"] == "waiting_for_access" and body["owners"] == ["data-eng"]


def test_a_permission_refusal_in_plain_words_is_a_waiting_state_too(tmp_path):
    assert shell_core.access_refusal("User does not have SELECT privilege on table main.s.orders")
    s, sp_ws, user_ws, _made = shell(tmp_path)

    def plain(*args, **kwargs):
        raise shell_db.QueryError("User does not have SELECT privilege on table main.s.orders")
    for ws in (sp_ws, user_ws):
        ws.run_sql = plain
        ws.call = plain
    status, body = _records(s)
    assert status == 200 and body.get("state") == "waiting_for_access", (status, body)


def test_a_failure_that_is_not_a_refusal_stays_a_502_on_the_records_list(tmp_path):
    s, sp_ws, user_ws, _made = shell(tmp_path)

    def broken(*args, **kwargs):
        raise shell_db.QueryError("warehouse stopped")
    for ws in (sp_ws, user_ws):
        ws.run_sql = broken
        ws.call = broken
    status, body = _records(s)
    assert status == 502 and "error" in body and "waiting_for_access" != body.get("state")
