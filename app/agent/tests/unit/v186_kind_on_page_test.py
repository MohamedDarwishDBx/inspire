"""The App page carries its kind's question, which the Agent page shows as a chip, and a kind picks its chart (fail-pre/pass-post)."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402

NOTEBOOK = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")


def test_the_page_writer_sets_the_kind_question_from_the_kind_catalogue():
    raw = open(NOTEBOOK, encoding="utf-8").read()
    assert raw.count('out[\\"kind_question\\"] = str(kind.get(\\"question\\") or \\"\\")') == 1


def test_the_outlier_kind_maps_to_the_outlier_chart_family():
    assert shell_agent.PAGE_KIND_FAMILY["anomaly"] == "outlier"
    assert shell_agent.PAGE_KIND_FAMILY["forecast"] == "forecast"
    assert shell_agent.PAGE_KIND_FAMILY["segmentation"] == "segment"


class Shell:
    def __init__(self, page):
        self.pages = {page["id"]: page}

    def page(self, ident):
        return self.pages[ident]

    def workspace(self, headers):
        return (None, "who")

    def decides(self, page):
        return True


def test_the_briefing_offers_the_kind_question_first_as_a_chip():
    page = {"id": "p", "title": "Anomaly", "kind": "anomaly", "kind_question": "Which values break their expected range?", "records": {}, "questions": []}
    ag = shell_agent.Agent.__new__(shell_agent.Agent)
    ag.shell = Shell(page)
    chips = ag.briefing({}, "p")["chips"]
    assert chips[0] == "Which values break their expected range?"


def test_a_page_without_a_kind_question_has_no_kind_chip():
    page = {"id": "p", "title": "Loss", "records": {}, "questions": []}
    ag = shell_agent.Agent.__new__(shell_agent.Agent)
    ag.shell = Shell(page)
    assert shell_agent.AGENT_CHIPS[0] == ag.briefing({}, "p")["chips"][0]
