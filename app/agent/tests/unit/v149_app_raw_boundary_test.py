"""REQ-150 boundary: a user-authorization App whose pages read a source table directly is stopped by the real deploy boundary, with the exact reason."""
import json

import pytest

from v140_implement_test import CHURN_TABLES, _app_flow
from v150_app_owners_access_test import _disk_shell

RAW = "main.s.orders"
TAIL = "A user-authorization App cannot give its viewers access to a source table, so the build stops and no viewer is given raw table access."


def _user_app(agent_ns, tmp_path):
    payload, modules = _disk_shell(agent_ns, tmp_path)
    page = json.loads(json.dumps(payload["example"]))
    for dataset in page["datasets"]:
        for old, new in CHURN_TABLES.items():
            dataset["sql"] = dataset["sql"].replace(old, new)
    page["datasets"].append({"name": "raw_orders", "sql": f"SELECT order_id FROM {RAW}"})
    inst, context, seen = _app_flow(agent_ns, tmp_path, page=page, outputs={"app_access": "user"})
    inst._implement_app_shell = lambda: (payload, modules)
    # _app_flow's stub Genie loop catches RuntimeError, and ImplementBlocked is one, so it would hide the refusal. This loop runs the
    # deploy closure on the page the build wrote and lets the refusal reach the caller, as the real loop does.
    inst._implement_genie_loop = lambda context, runner, label, prompt, deploy, tools=None: deploy(str(tmp_path / "work"))
    return inst, context, seen


def test_an_unreadable_source_table_stops_the_user_app_build_with_its_cause_and_the_rebuild_action(agent_ns, tmp_path):
    inst, context, seen = _user_app(agent_ns, tmp_path)
    inst._implement_scope_columns = lambda table: []
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_app(context, None)
    rebuild = agent_ns["inspire_rebuild_action"]("the App")
    assert str(raised.value) == (f"the App's pages read {RAW} directly, but Inspire could not read the columns of {RAW}, so it gave them no "
                                 f"App-owned view. Make sure each table exists and the build can read its columns, then {rebuild}. {TAIL}")
    assert seen["deployed"] == [], "nothing is deployed, so no viewer is given the raw table"


def test_a_readable_source_table_the_views_do_not_cover_is_sent_to_table_filters_and_is_not_called_unreadable(agent_ns, tmp_path, monkeypatch):
    monkeypatch.setitem(agent_ns, "implement_app_read_scopes_for_pages", lambda *args, **kwargs: {})
    inst, context, seen = _user_app(agent_ns, tmp_path)
    assert inst._implement_scope_columns(RAW), "the premise: the columns of the table are readable"
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_app(context, None)
    rebuild = agent_ns["inspire_rebuild_action"]("the App")
    assert str(raised.value) == (f"the App's pages still read {RAW} directly after Inspire gave them App-owned views. Add each one under "
                                 "Table filters or Column roles in Data & results, which Open all settings on the Build page opens, "
                                 f"then {rebuild}. {TAIL}")
    assert seen["deployed"] == []
