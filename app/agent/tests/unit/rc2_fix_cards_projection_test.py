"""REQ-264 round 4: a segment card table must show only columns its dataset selects, not just read the companion table.

The App fit check (part_table_problems) checked that a card table shows segment_id, label, size and value and that its dataset reads the
companion table. It did not check that the dataset returns those columns, so a dataset that reads the companion but omits or renames a
card column passed the check and failed when the App ran. Each fail-pre test fails on the code before this change.
"""
import copy

from rc2_fix_segment_companion_test import _shell_sql


def _cards_page(agent_ns):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    return copy.deepcopy(payload["examples"]["segment_explorer"])


def _set_cards_sql(page, sql):
    for dataset in page["datasets"]:
        if dataset["name"] == "segments":
            dataset["sql"] = sql
    return page


def test_a_card_dataset_that_omits_a_card_column_is_refused(agent_ns, tmp_path):
    """Fail-pre: the dataset reads the companion but does not select value, which the card shows. Post-fix: the check names value."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    page = _set_cards_sql(_cards_page(agent_ns), "SELECT s.segment_id, s.label, s.size FROM main.sales.customer_segments_out__segments AS s")
    problems = shell_sql.part_table_problems(page, "segment_cards")
    assert any("does not select" in p and "value" in p for p in problems), problems


def test_a_card_dataset_that_renames_a_card_column_is_refused(agent_ns, tmp_path):
    """Fail-pre: label is selected under another name, so the card's label column is empty. Post-fix: label is named."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    page = _set_cards_sql(_cards_page(agent_ns),
                          "SELECT s.segment_id, s.label AS segment_label, s.size, s.value FROM main.sales.customer_segments_out__segments AS s")
    problems = shell_sql.part_table_problems(page, "segment_cards")
    assert any("does not select" in p and "label" in p for p in problems), problems


def test_the_shipped_card_dataset_that_selects_every_card_column_passes(agent_ns, tmp_path):
    """Must-keep: the example's own cards dataset selects every card column, with the treatment column computed by CASE."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    page = _cards_page(agent_ns)
    assert not [p for p in shell_sql.part_table_problems(page, "segment_cards") if "does not select" in p]


def test_a_card_dataset_with_a_star_is_not_refused_because_its_columns_cannot_be_read(agent_ns, tmp_path):
    """Must-exclude: a star select list is unreadable, so the check does not guess a missing column from it."""
    shell_sql = _shell_sql(agent_ns, tmp_path)
    page = _set_cards_sql(_cards_page(agent_ns), "SELECT s.*, 1 AS suggested_treatment FROM main.sales.customer_segments_out__segments AS s")
    assert not [p for p in shell_sql.part_table_problems(page, "segment_cards") if "does not select" in p]
