"""Agent page answer blocks: the server accepts only the typed catalog, and every reference must be on the page."""
import os
import sys

import pytest

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_blocks  # noqa: E402

CTX = {"keys": {"r1", "r2"}, "act_rows": 50, "charts": {"trend": "Loss trend"}, "kpis": {"loss"},
       "columns": ["category", "value"], "actions": {"done", "snooze", "assign"}}


def run(raw, ctx=None):
    return shell_blocks.validate(raw, dict(CTX, **(ctx or {})))


def test_an_unknown_block_becomes_a_text_block_that_names_it_and_is_not_dropped():
    blocks, problems = run([{"type": "iframe", "src": "https://x"}])
    assert blocks[0]["type"] == "text" and "iframe" in blocks[0]["markdown"]
    assert any("iframe" in p for p in problems)


def test_a_ticket_on_a_record_the_person_cannot_see_is_left_out():
    blocks, problems = run([{"type": "ticket", "record_key": "secret"}])
    assert blocks == []
    assert any("cannot see" in p for p in problems)


def test_a_ticket_keeps_only_whitelisted_fields_and_strips_markup_from_text():
    blocks, _ = run([{"type": "ticket", "record_key": "r1", "label": "<b>Unit 7</b>", "why": "late <script>x</script>", "evil": "drop me"}])
    ticket = blocks[0]
    assert ticket["label"] == "Unit 7"
    assert ticket["why"] == "late x"
    assert "evil" not in ticket


def test_text_is_capped_and_markup_is_stripped():
    blocks, _ = run([{"type": "text", "markdown": "<script>alert(1)</script>" + "a" * 5000}])
    assert len(blocks[0]["markdown"]) <= shell_blocks.TEXT_CHARS
    assert "<script>" not in blocks[0]["markdown"]


def test_more_than_eight_blocks_keeps_eight_and_says_so():
    blocks, problems = run([{"type": "text", "markdown": str(i)} for i in range(9)])
    assert len(blocks) == shell_blocks.MAX_BLOCKS
    assert any("at most 8" in p for p in problems)


def test_actions_keep_only_the_actions_the_app_offers_and_readable_records():
    blocks, problems = run([{"type": "actions", "record_keys": ["r1", "nope"], "actions": ["done", "delete_all"]}])
    assert blocks[0] == {"type": "actions", "record_keys": ["r1"], "actions": ["done"]}


def test_actions_with_no_offered_action_are_dropped_not_sent():
    blocks, problems = run([{"type": "actions", "record_keys": ["r1"], "actions": ["delete_all"]}])
    assert blocks == []
    assert problems


def test_a_chart_must_be_a_chart_of_this_page():
    blocks, problems = run([{"type": "chart", "chart_id": "made_up"}])
    assert blocks == []
    blocks, _ = run([{"type": "chart", "chart_id": "trend", "highlight_keys": ["r2", "x"]}])
    assert blocks[0] == {"type": "chart", "chart_id": "trend", "title": "Loss trend", "highlight_keys": ["r2"]}


def test_a_kpi_must_be_a_kpi_of_this_page():
    assert run([{"type": "kpi", "kpi_id": "not_here", "value": "9"}])[0] == []
    assert run([{"type": "kpi", "kpi_id": "loss", "value": "9"}])[0][0]["kpi_id"] == "loss"


def test_a_table_takes_only_page_columns_and_keeps_readable_rows_only():
    blocks, _ = run([{"type": "table", "columns": ["category", "invented"], "record_keys": ["r1", "zz"], "limit": 500}])
    assert blocks[0]["columns"] == ["category"]
    assert blocks[0]["record_keys"] == ["r1"]
    assert blocks[0]["limit"] == 50


def test_an_email_names_a_first_name_or_a_role_and_never_an_address():
    assert run([{"type": "email", "to_label": "ana@example.com", "subject": "s", "body": "b"}])[0] == []
    blocks, _ = run([{"type": "email", "to_label": "Ana", "subject": "s", "body": "b"}])
    assert blocks[0]["copyable"] is True and blocks[0]["to_label"] == "Ana"


def test_a_choice_needs_two_options_and_each_needs_an_id():
    assert run([{"type": "choice", "prompt": "Which?", "options": [{"id": "a", "label": "A"}]}])[0] == []
    blocks, problems = run([{"type": "choice", "prompt": "Which?", "options": [{"id": "a", "label": "A"}, {"label": "no id"}]}])
    assert blocks == [] and problems


def test_multi_select_clamps_min_and_max_to_the_option_count():
    raw = {"type": "multi_select", "prompt": "Pick", "min": 9, "max": 0,
           "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}
    block = run([raw])[0][0]
    assert block["min"] == 2 and block["max"] >= block["min"]


def test_non_numeric_counts_fall_back_instead_of_raising():
    raw = {"type": "multi_select", "min": "lots", "max": [1], "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}
    block = run([raw])[0][0]
    assert block["min"] == 0 and block["max"] == 2


def test_a_block_that_is_not_an_object_is_left_out_and_reported():
    blocks, problems = run(["text"])
    assert blocks == [] and problems


def test_an_empty_or_non_list_answer_is_refused():
    blocks, problems = run([])
    assert blocks == [] and problems == ["render_answer takes a non-empty list of blocks"]


def test_text_of_gives_the_plain_words_for_the_saved_answer():
    blocks = [{"type": "text", "markdown": "Act on the top one."}, {"type": "ticket", "record_key": "r1", "label": "Unit 7", "why": "late"},
              {"type": "email", "to_label": "Ana", "subject": "Unit 7", "body": "x"}]
    text = shell_blocks.text_of(blocks)
    assert "Act on the top one." in text and "Unit 7: late" in text and "Draft to Ana: Unit 7" in text
