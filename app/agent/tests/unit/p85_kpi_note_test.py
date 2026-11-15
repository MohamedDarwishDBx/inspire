"""P85 (REQ-286): a vibe that asks for a plain note under each KPI lands as that KPI's caption. Genie is told the caption field, the page
spec checks its length, and the served page meta the vibe checklist reads carries it, offline."""
import os
import sys

from v140_implement_test import _app_flow, _churn_page

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

NOTE = "Stores on the list at the latest run"


def test_the_app_prompt_tells_genie_a_kpi_caption_is_the_plain_note_under_each_number(agent_ns, tmp_path):
    # Before P85 the prompt described each KPI's fields but never named caption, so Genie reached for text blocks instead.
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    inst._implement_app(context, None)
    assert ("- kpi caption: optional, at most 160 characters, the plain note printed under the KPI's number that says what it counts, "
            "such as 'Stores on the list at the latest run'. A vibe that asks for a note under each KPI sets a caption on every KPI it "
            "names, never a block: a block placed after a KPI is a tile in the KPI row, not a note under the number.\n") in seen["prompt"]


def test_a_kpi_caption_longer_than_the_text_limit_is_a_spec_problem(agent_ns):
    page = _churn_page(agent_ns)
    page["kpis"][0]["caption"] = NOTE
    assert not [p for p in shell_sql.spec_problems(page) if "caption" in p]
    page["kpis"][0]["caption"] = "x" * (shell_sql.TEXT_LIMITS["caption"] + 1)
    assert [p for p in shell_sql.spec_problems(page) if "caption" in p]


def test_the_served_page_meta_the_vibe_checklist_reads_carries_each_kpi_caption(agent_ns):
    page = _churn_page(agent_ns)
    page["kpis"][0]["caption"] = NOTE
    served = shell_core.public_page(page)["kpis"]
    assert served[0]["caption"] == NOTE
    assert "caption" in served[1], "a KPI without a note still serves the key, so the checklist sees it is empty"
