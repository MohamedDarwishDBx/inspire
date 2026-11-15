"""REQ-223 (b) follow-up / P52b: a snoozed row carries its snooze date on every tracked list, including a column-sorted one.

The snooze date used to ride only on windowed lists (WINDOW_EXTRA), so a list sorted by a column had no snooze date and no Wake now.
"""
import datetime
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

PAGE = {"result_table": "c.s.t", "records": {"key": "entity_id", "label": "entity_label", "rank": "rank"},
        "datasets": [{"name": shell_sql.RECORDS_DATASET, "sql": "SELECT * FROM c.s.records"}]}
NAMES = ["entity_id", "entity_label", "rank", "action_owner", "action_status", "action_due", "snooze_until", "record_key",
         "valid_from", "is_current", "change_source", "action_note"]
FIELDS = [{"name": n, "kind": "text", "role": "business", "type": "STRING"} for n in NAMES]
NOW = datetime.datetime(2026, 11, 15, 12, 0, 0)


def _plan(sort_key=None, with_snooze=True):
    fields = [f for f in FIELDS if with_snooze or f["name"] != "snooze_until"]
    names = [f["name"] for f in fields]
    context = shell_sql.list_context(PAGE, names + ["record_key"], fields, True)
    data = {"limit": 25}
    if sort_key:
        data["sort"] = {"key": sort_key, "dir": "asc"}
    request = shell_sql.list_request(PAGE, data, context, NOW)
    return shell_sql.list_queries(PAGE, {}, request, context, "editor@example.com")


def test_a_column_sorted_list_selects_the_snooze_date_for_wake_now():
    assert "`_inspire_snooze`" in _plan(sort_key="rank")["rows"][0]


def test_the_default_list_selects_the_snooze_date_too():
    assert "`_inspire_snooze`" in _plan()["rows"][0]


def test_a_table_without_a_snooze_column_selects_no_snooze_date():
    assert "_inspire_snooze" not in _plan(sort_key="rank", with_snooze=False)["rows"][0]
