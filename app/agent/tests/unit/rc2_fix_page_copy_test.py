"""REQ-237 (REQ-059 / REQ-227 class): person copy names an App page by its title, never by its internal id ('page n06_u01').

The build status line 'where' for an App page, the vibe evidence and refusal text, and the App's check problems the person reads all used
the page id. They now use the page title (implement_page_spot), and the App shell's messages use shell_facts.page_label. The shared jargon
fixture carries a page_id term, so a literal page id in customer copy fails the notebook gate and the frontend gate alike.
"""
import pytest

from customer_jargon_test import internal_hits
from v141_app_shell_test import PAGE, call, shell  # noqa: F401  (puts the App shell server on sys.path)

import shell_facts  # noqa: E402

PAGE_ID = "n06_u01"
TITLE = "Monthly revenue by region"


def test_the_build_status_where_names_the_app_page_by_its_title(agent_ns):
    where = agent_ns["implement_checklist_where"](f"app:page:{PAGE_ID}", "", TITLE)
    assert where == f"page {TITLE}"
    assert PAGE_ID not in where and internal_hits(where) == []


def test_a_page_with_no_title_says_the_app_page_in_plain_words(agent_ns):
    where = agent_ns["implement_checklist_where"](f"app:page:{PAGE_ID}", "Show the total")
    assert where == "the App page, Show the total" and PAGE_ID not in where


def test_a_check_problem_keeps_its_id_key_and_the_person_reads_the_page_title(agent_ns):
    """The check keys each problem by page id (the build matches on it); the person copy names the page by its title."""
    shell_facts = agent_ns["inspire_shell_facts"]
    pages = [{"id": PAGE_ID, "title": TITLE}, {"id": "n07_u02", "title": "Stock on hand"}]
    raw = f"page {PAGE_ID}: 3 charts are empty; page n07_u02: 1 filter is missing"
    assert shell_facts.plain_check_text(raw, pages) == f"page {TITLE}: 3 charts are empty; page Stock on hand: 1 filter is missing"
    assert internal_hits(shell_facts.plain_check_text(raw, pages)) == []


def test_two_pages_with_the_same_title_keep_their_ids_so_no_problem_is_attributed_to_the_wrong_page(agent_ns):
    shell_facts = agent_ns["inspire_shell_facts"]
    pages = [{"id": PAGE_ID, "title": TITLE}, {"id": "n07_u02", "title": TITLE}, {"id": "n08_u03", "title": ""}]
    assert shell_facts.check_names(pages) == {PAGE_ID: f"page {PAGE_ID}", "n07_u02": "page n07_u02", "n08_u03": f"page n08_u03"}
    raw = f"page {PAGE_ID}: 2 charts are empty; page n07_u02: 1 KPI failed"
    assert shell_facts.plain_check_text(raw, pages) == f"page {PAGE_ID}: 2 charts are empty; page n07_u02: 1 KPI failed"


def test_a_page_id_is_not_rewritten_inside_a_longer_id(agent_ns):
    shell_facts = agent_ns["inspire_shell_facts"]
    pages = [{"id": PAGE_ID, "title": TITLE}]
    assert shell_facts.plain_check_text(f"page {PAGE_ID}2 is not this page", pages) == f"page {PAGE_ID}2 is not this page"


def test_the_vibe_refusal_is_a_genie_verdict_so_it_keeps_the_exact_page_id(agent_ns):
    """The refusal is sent back to Genie (D-NAMES: Genie reads exact names), so it keeps the page id and is not person copy."""
    target, reason = agent_ns["implement_vibes_target"](f"app:page:{PAGE_ID}", {"id": "n07_u02", "title": "Stock on hand"})
    assert target is None
    assert f"builds the App page n07_u02" in reason and f"the page {PAGE_ID} is not one Inspire builds here" in reason


def test_the_page_spot_is_the_one_wording_for_an_app_page(agent_ns):
    assert agent_ns["inspire_shell_facts"].page_spot(TITLE) == f"page {TITLE}"
    assert agent_ns["inspire_shell_facts"].page_spot("  ") == "the App page"


def test_the_shared_jargon_term_catches_a_literal_page_id_in_customer_copy():
    assert internal_hits(f"Check the page {PAGE_ID} before you build") == ["page_id"]
    assert internal_hits("Check the page Monthly revenue before you build") == []


def test_the_app_shell_names_a_page_by_its_title_in_its_messages():
    assert shell_facts.page_label({"id": PAGE_ID, "title": TITLE}) == f"page {TITLE}"
    assert shell_facts.page_label({"id": PAGE_ID, "title": "  "}) == "the App page"
    assert PAGE_ID not in shell_facts.page_label({"id": PAGE_ID, "title": TITLE})


def test_a_page_with_no_decision_list_is_described_by_its_title_and_never_its_id():
    import shell_core
    page = {"id": PAGE_ID, "title": TITLE, "kpis": [{"id": "k1", "label": "Total", "expression": "SUM(amount)"}], "datasets": []}
    text = shell_core.informational_text(page)
    assert text.startswith(f"page {TITLE}"), text
    assert PAGE_ID not in text and internal_hits(text) == [], text
