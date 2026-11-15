"""REQ-237 (REQ-059 / REQ-227 class): person copy names an App page and its charts by their names, never by their internal ids.

The build status 'where', the vibe evidence and warnings, the App check problems, the dashboard chart failure and the App page name
used to print 'page n06_u01' or 'chart limits_used'. One naming rule now serves every person-facing site (shell_facts.page_names,
chart_names, plain_check_text): a title names the item; a title that two siblings share, or no title, is told apart by position
('the second Overview page', 'one chart'). Genie reads the exact ids (D-NAMES), so the Genie-facing evidence keeps them.
"""
import pytest

from customer_jargon_test import internal_hits
from v141_app_shell_test import PAGE, call, shell  # noqa: F401  (puts the App shell server on sys.path)

import shell_facts  # noqa: E402

PAGE_ID = "n06_u01"
OTHER_ID = "n07_u02"
TITLE = "Monthly revenue by region"
CHART_ID = "limits_used"
CHART_TITLE = "Credit limits used"
PAGES = [{"id": PAGE_ID, "title": TITLE, "charts": [{"id": CHART_ID, "title": CHART_TITLE, "type": "bar"}]},
         {"id": OTHER_ID, "title": "Stock on hand", "charts": []}]


def test_the_build_status_where_names_the_app_page_by_its_title(agent_ns):
    where = agent_ns["implement_checklist_where"](f"app:page:{PAGE_ID}", "", PAGES)
    assert where == f"page {TITLE}"
    assert PAGE_ID not in where and internal_hits(where) == []


def test_a_page_with_no_title_says_the_app_page_in_plain_words(agent_ns):
    where = agent_ns["implement_checklist_where"](f"app:page:{PAGE_ID}", "Show the total", [{"id": PAGE_ID, "title": ""}])
    assert where == "the App page, Show the total" and PAGE_ID not in where


def test_a_check_problem_keeps_its_id_key_and_the_person_reads_the_page_and_chart_names(agent_ns):
    """The check keys each problem by page id (the build matches on it); the person copy names the page and its chart by name."""
    shell_facts = agent_ns["inspire_shell_facts"]
    raw = f"page {PAGE_ID}: chart {CHART_ID} draws one group at the default filters; page {OTHER_ID}: 1 filter is missing"
    person = shell_facts.plain_check_text(raw, PAGES)
    assert person == (f"page {TITLE}: chart {CHART_TITLE} draws one group at the default filters; "
                      "page Stock on hand: 1 filter is missing")
    assert PAGE_ID not in person and CHART_ID not in person and internal_hits(person) == []


def test_two_pages_with_the_same_title_are_told_apart_by_position_not_by_id(agent_ns):
    shell_facts = agent_ns["inspire_shell_facts"]
    pages = [{"id": PAGE_ID, "title": TITLE}, {"id": OTHER_ID, "title": TITLE}, {"id": "n08_u03", "title": ""}]
    assert shell_facts.page_names(pages) == {PAGE_ID: f"the first {TITLE} page", OTHER_ID: f"the second {TITLE} page",
                                             "n08_u03": "the App page"}
    person = shell_facts.plain_check_text(f"page {PAGE_ID}: 2 charts are empty; page {OTHER_ID}: 1 KPI failed", pages)
    assert person == f"the first {TITLE} page: 2 charts are empty; the second {TITLE} page: 1 KPI failed"
    assert PAGE_ID not in person and OTHER_ID not in person


def test_a_chart_with_no_title_is_one_chart_and_a_shared_title_is_told_apart_by_position(agent_ns):
    shell_facts = agent_ns["inspire_shell_facts"]
    page = {"id": PAGE_ID, "charts": [{"id": "a1", "title": "Revenue"}, {"id": "a2", "title": "Revenue"}, {"id": "a3"}]}
    assert shell_facts.chart_names(page) == {"a1": "the first Revenue chart", "a2": "the second Revenue chart", "a3": "one chart"}


def test_a_page_id_is_not_rewritten_inside_a_longer_id(agent_ns):
    shell_facts = agent_ns["inspire_shell_facts"]
    assert shell_facts.plain_check_text(f"page {PAGE_ID}2 is not this page", PAGES) == f"page {PAGE_ID}2 is not this page"


def test_the_vibe_refusal_is_a_genie_verdict_so_it_keeps_the_exact_page_id(agent_ns):
    """The refusal is sent back to Genie (D-NAMES: Genie reads exact names), so it keeps the page id and is not person copy."""
    target, reason = agent_ns["implement_vibes_target"](f"app:page:{PAGE_ID}", {"id": OTHER_ID, "title": "Stock on hand"})
    assert target is None
    assert "builds the App page n07_u02" in reason and f"the page {PAGE_ID} is not one Inspire builds here" in reason


def test_the_page_spot_is_the_one_wording_for_an_app_page(agent_ns):
    assert agent_ns["inspire_shell_facts"].page_spot(TITLE) == f"page {TITLE}"
    assert agent_ns["inspire_shell_facts"].page_spot("  ") == "the App page"


def test_the_shared_jargon_term_catches_a_literal_page_id_in_customer_copy():
    assert internal_hits(f"Check the page {PAGE_ID} before you build") == ["page_id"]
    assert internal_hits("Check the page Monthly revenue before you build") == []


def test_the_app_shell_names_a_page_by_its_title_in_its_messages():
    shell_facts_mod = __import__("shell_facts")
    assert shell_facts_mod.page_label({"id": PAGE_ID, "title": TITLE}) == f"page {TITLE}"
    assert shell_facts_mod.page_label({"id": PAGE_ID, "title": "  "}) == "the App page"
    assert PAGE_ID not in shell_facts_mod.page_label({"id": PAGE_ID, "title": TITLE})


def test_a_page_with_no_decision_list_is_described_by_its_title_and_never_its_id():
    import shell_core
    page = {"id": PAGE_ID, "title": TITLE, "kpis": [{"id": "k1", "label": "Total", "expression": "SUM(amount)"}], "datasets": []}
    text = shell_core.informational_text(page)
    assert text.startswith(f"page {TITLE}"), text
    assert PAGE_ID not in text and internal_hits(text) == [], text


def test_the_vibe_evidence_is_one_record_with_a_genie_rendering_and_a_person_rendering(agent_ns):
    """The same evidence is sent to Genie (exact ids, D-NAMES) and shown on the checklist (names)."""
    asset = f"app:page:{PAGE_ID}"
    done = f"page {PAGE_ID}: {TITLE}"
    missing = f"the built App is the page {PAGE_ID} ({TITLE}), not 3 charts"
    person = agent_ns["implement_person_evidence"]
    assert person(done, asset, PAGES) == f"page {TITLE}"
    assert person(missing, asset, PAGES) == f"the built App is page {TITLE}, not 3 charts"
    resend = {asset: [{"ask": "show revenue", "evidence": missing}]}
    genie = agent_ns["implement_vibes_missed_text"](resend)
    assert f"the page {PAGE_ID} ({TITLE})" in genie, "Genie reads the exact id"
    assert internal_hits(person(missing, asset, PAGES)) == []


def test_a_title_two_pages_share_is_told_apart_by_position_on_the_checklist(agent_ns):
    asset = f"app:page:{PAGE_ID}"
    pages = [{"id": PAGE_ID, "title": TITLE}, {"id": OTHER_ID, "title": TITLE}]
    missing = f"the built App is the page {PAGE_ID} ({TITLE}), not 3 charts"
    person = agent_ns["implement_person_evidence"](missing, asset, pages)
    assert person == f"the built App is the first {TITLE} page, not 3 charts"
    assert PAGE_ID not in person


def test_a_non_page_asset_is_shown_as_evidence_says(agent_ns):
    text = f"page {PAGE_ID}: {TITLE}"
    assert agent_ns["implement_person_evidence"](text, "dashboard:chart1", PAGES) == text


def test_a_chart_id_in_the_checklist_evidence_becomes_the_chart_name_and_genie_keeps_it(agent_ns):
    """REQ-237: 'the built App has no bar chart; its charts are bar chart limits_used' reads 'Credit limits used' on the checklist."""
    asset = f"app:page:{PAGE_ID}"
    evidence = f"the built App has no line chart; its charts are bar chart {CHART_ID}"
    person = agent_ns["implement_person_evidence"](evidence, asset, PAGES)
    assert person == f"the built App has no line chart; its charts are bar chart {CHART_TITLE}"
    assert CHART_ID not in person and internal_hits(person) == []
    genie = agent_ns["implement_vibes_missed_text"]({asset: [{"ask": "a line chart", "evidence": evidence}]})
    assert CHART_ID in genie, "Genie reads the exact chart id"


def test_a_status_warning_never_shows_a_page_or_chart_id(agent_ns):
    """The live build showed 'page n02_u01: chart limits_used ...' in a ready_with_warnings status. The person copy has no id."""
    raw = f"page {PAGE_ID}: chart {CHART_ID} draws one group at the default filters, so it compares nothing; chart a column with 2 or more values"
    person = agent_ns["implement_person_text"](raw, PAGES)
    assert person == f"page {TITLE}: chart {CHART_TITLE} draws one group at the default filters, so it compares nothing; chart a column with 2 or more values"
    assert PAGE_ID not in person and CHART_ID not in person and internal_hits(person) == []
    assert agent_ns["implement_person_text"](raw, []) == raw, "with no App pages known nothing is rewritten"


def test_the_dashboard_chart_failure_names_the_chart_not_its_id(agent_ns):
    """The chart failure is shown in the build status, so it names the chart by its name (the chart name is the page's chart name)."""
    assert agent_ns["inspire_shell_facts"].chart_names(PAGES[0])[CHART_ID] == f"chart {CHART_TITLE}"


def test_the_app_page_name_in_a_refusal_has_no_id_when_the_page_has_no_title(agent_ns):
    name = agent_ns["implement_app_page_name"]({"id": PAGE_ID, "title": "", "use_case_id": "N01-U01"})
    assert PAGE_ID not in name and name == "the App page of use case N01-U01"
    assert agent_ns["implement_app_page_name"]({"id": PAGE_ID, "title": TITLE, "use_case_id": "N01-U01"}) == f"'{TITLE}' of use case N01-U01"
