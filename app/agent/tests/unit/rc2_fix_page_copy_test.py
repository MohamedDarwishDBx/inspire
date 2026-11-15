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


def test_the_build_check_problems_name_the_page_by_title_and_match_it_by_title(agent_ns):
    """ShellCore.check renders each App page by its title; the build's broken-page match reads the same title."""
    pages = [{"id": PAGE_ID, "title": TITLE}, {"id": "n07_u02", "title": "Stock on hand"}]
    problems = [f"{agent_ns['inspire_shell_facts'].page_label(pages[0])}: 3 charts are empty",
                f"{agent_ns['inspire_shell_facts'].page_label(pages[1])}: 1 filter is missing"]
    assert problems == [f"page {TITLE}: 3 charts are empty", "page Stock on hand: 1 filter is missing"]
    assert internal_hits(" ".join(problems)) == [] and PAGE_ID not in " ".join(problems)


def test_the_vibe_refusal_for_another_page_names_no_page_id(agent_ns):
    target, reason = agent_ns["implement_vibes_target"](f"app:page:{PAGE_ID}", {"id": "n07_u02", "title": "Stock on hand"})
    assert target is None and "Stock on hand" in reason
    assert "n07_u02" not in reason and PAGE_ID not in reason and internal_hits(reason) == []


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
