"""One write path: every record write the Work page or the record panel makes is built by the registry on the server (fail-pre/pass-post)."""
import inspect
import os
import re
import sys

WEB = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "web", "src")
SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_actions  # noqa: E402
import shell_core  # noqa: E402
import shell_sql  # noqa: E402

TODAY = None  # the builders here do not read the date for done, snooze, owner, note or update


def test_a_done_value_names_the_done_action_and_snooze_names_snooze():
    assert shell_actions.action_for_values({"action_status": shell_sql.DONE}) == "done"
    assert shell_actions.action_for_values({"snooze_until": "2026-12-01"}) == "snooze"


def test_a_panel_edit_with_more_than_one_field_is_the_update_action():
    assert shell_actions.action_for_values({"action_owner": "Ana", "action_status": shell_sql.DONE}) == "update"
    assert shell_actions.action_for_values(None) == "update"


def test_the_registry_builds_the_same_values_the_work_page_sends():
    for values in ({"action_status": shell_sql.DONE}, {"snooze_until": "2026-12-01"}, {"action_owner": "Ana"}):
        name = shell_actions.action_for_values(values)
        assert shell_actions.record_body(name, values, TODAY) == values


def test_skip_writes_nothing_and_the_registry_refuses_to_build_it():
    try:
        shell_actions.record_body("skip", {}, TODAY)
    except ValueError as error:
        assert "writes nothing" in str(error)
    else:
        raise AssertionError("skip must not build a write")


def test_the_records_act_route_builds_its_values_through_the_registry():
    source = inspect.getsource(shell_core.Shell.record_act)
    assert "shell_actions.record_body(" in source
    assert "shell_actions.action_for_values(" in source


def test_only_the_api_module_posts_records_act_on_the_web():
    posted = []
    for folder, _dirs, names in os.walk(WEB):
        for name in names:
            if not name.endswith((".js", ".jsx")) or ".test." in name:
                continue
            path = os.path.join(folder, name)
            if re.search(r"json\('POST', 'records/act'", open(path, encoding="utf-8").read()):
                posted.append(os.path.relpath(path, WEB))
    assert posted == ["api.js"], posted


def test_every_web_write_call_site_goes_through_act_or_actRecords():
    for name in ("Records.jsx", "Work.jsx", "KindParts.jsx"):
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        for call in re.findall(r"\bacts?\.act\(|\bactRecords\(", text):
            assert call
    work = open(os.path.join(WEB, "Work.jsx"), encoding="utf-8").read()
    assert "actRecords({ page: pageId, ...body, action, values })" in work, "the Work page's write names the registry action"


def test_a_done_or_snooze_keeps_the_note_the_person_wrote():
    assert shell_actions.record_body("done", {"action_status": shell_sql.DONE, "note": "Closed"}, TODAY) == {
        "action_status": shell_sql.DONE, "note": "Closed"}
    assert shell_actions.record_body("snooze", {"snooze_until": "2026-12-01", "note": "Waiting"}, TODAY) == {
        "snooze_until": "2026-12-01", "note": "Waiting"}


def test_an_explicit_action_whose_values_name_another_action_is_refused_not_silently_rewritten():
    try:
        shell_actions.record_body("done", {"action_owner": "Ana"}, TODAY)
    except ValueError as error:
        assert "do not say done" in str(error)
    else:
        raise AssertionError("a done write must not carry an owner change")


def test_the_contract_fixture_writes_are_named_by_their_values():
    """The rc2 usability contract carries no action field (int2's contract is the shape every version reads). The server names each
    of its writes from its values, so the action of every contract write is the one its values name."""
    import json
    fixture = json.load(open(os.path.join(os.path.dirname(__file__), "..", "fixtures", "app_usability_contract.json"), encoding="utf-8"))
    expected = {"act_keys": "update", "act_match": "done", "snooze": "snooze", "act_reviewed": "done"}
    for name, action in expected.items():
        body = fixture[name]["request"]["body"]
        assert "action" not in body or body["action"] == action, name
        assert shell_actions.action_for_values(body.get("values")) == action, name


def test_an_old_body_without_an_action_is_still_accepted_and_named_from_its_values():
    old = {"action_status": shell_sql.DONE}
    assert shell_actions.action_for_values(old) == "done"
    assert shell_actions.record_body(shell_actions.action_for_values(old), old, TODAY) == old
    assert shell_actions.action_for_values({"action_status": "In progress", "note": "x"}) == "update"


def test_the_work_page_sends_the_registry_action_id_on_every_write():
    work = open(os.path.join(WEB, "Work.jsx"), encoding="utf-8").read()
    assert "actRecords({ page: pageId, ...body, action, values })" in work
    assert "submit('done', { action_status: DONE }, 'done')" in work
    assert "submit('snooze', { snooze_until: until }, 'snooze')" in work
    records = open(os.path.join(WEB, "Records.jsx"), encoding="utf-8").read()
    assert "key, action });" in records and "run('done', { action_status: DONE }, 'done')" in records
