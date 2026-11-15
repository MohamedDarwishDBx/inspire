"""REQ-285: a bulk status change (Mark my open done) never reads back as a custom choice such as Merge, and a merge happens only on an
explicit Merge. The entity-matching choices below are the kinds.json ones: Merge is the only Done choice, so before the fix every
status-only Done row was counted and labelled as a merge."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql
from v147_app_ai_test import _sqlite_run, _version
from v222_app_shell_work_tabs_test import _context, _page
from v223_app_shell_choices_test import _own

ENTITY = [{"id": "merge", "label": "Merge", "status": "Done"},
          {"id": "review_later", "label": "Needs review", "status": "In progress"},
          {"id": "not_duplicate", "label": "Keep separate", "status": "Dismissed", "reasons": ["Different company"]}]


def _row(key, status, choice=None):
    return dict(_version(key, None, current=True), action_owner=None, action_status=status, action_choice=choice,
                action_batch_note=None, dismiss_reason=None, valid_to=None, changed_by="run", run_id="r1")


def _counts(page, rows):
    context = _context(page)
    request = shell_sql.list_request(page, {}, context)
    tables = {"loss_desk_out": rows}  # the table name the fixture SQL reads, as v223 names it
    return shell_sql.status_counts_of(_sqlite_run(*shell_sql.status_counts_query(page, {}, request, context, ""), tables),
                                      shell_sql.status_choices(page))


def _merged_then_bulk_done():
    merged = [_row(f"m{i}", "Done", choice="merge") for i in range(2)]
    bulk = [_row(f"b{i}", "Done") for i in range(24)]
    return merged + bulk


def test_a_bulk_done_on_entity_rows_leaves_the_merge_tab_at_its_two_merged_rows():
    page = _own(ENTITY)
    got = _counts(page, _merged_then_bulk_done())
    assert got["statuses"]["Done"] == 26
    assert got["choices"]["merge"] == 2, got


def test_a_status_only_done_row_is_labelled_done_and_an_explicit_merge_row_is_labelled_merge():
    page = _own(ENTITY)
    assert shell_sql.status_text(page, {"action_status": "Done"}) == "Done"
    assert shell_sql.status_text(page, {"action_status": "Done", "action_choice": "merge"}) == "Merge"


def test_a_bulk_done_sends_no_choice_so_the_stored_choice_is_cleared():
    choices = shell_sql.status_choices(_own(ENTITY))
    values = shell_sql.action_values({"action_status": "Done"}, None, choices)
    assert values["action_status"] == "Done"
    assert values["action_choice"] is None, "a status-only Done must never store the Merge choice"


def test_an_explicit_merge_still_merges_and_is_counted_as_a_merge():
    choices = shell_sql.status_choices(_own(ENTITY))
    assert shell_sql.action_values({"action_status": "Done", "action_choice": "merge"}, None, choices)["action_choice"] == "merge"
    page = _own(ENTITY)
    got = _counts(page, [_row("m1", "Done", choice="merge"), _row("m2", "Done", choice="merge"), _row("b1", "Done")])
    assert got["choices"]["merge"] == 2 and got["statuses"]["Done"] == 3, got


def test_a_row_with_no_action_suggestion_is_never_merged_by_a_status_change():
    page = _own(ENTITY)
    rows = [_row("n1", "Dismissed"), _row("n2", "In progress"), _row("n3", None), _row("n4", "Done")]
    got = _counts(page, rows)
    assert got["choices"]["merge"] == 0, got
    assert got["choices"]["not_duplicate"] == 0, got


def test_a_default_page_still_counts_a_status_only_row_as_its_default_choice():
    page = _page()
    got = _counts(page, [_row("d1", "Done"), _row("d2", "Done"), _row("d3", "In progress")])
    assert got["choices"]["done"] == 2, got
    assert shell_sql.status_text(page, {"action_status": "Done"}) == "Done"
