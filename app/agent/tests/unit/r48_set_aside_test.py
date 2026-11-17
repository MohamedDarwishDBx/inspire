"""REQ-404 part 2: one page with a problem is set aside, the App starts. An App-level problem still refuses the App.

A problem that names one page (page <id>: ...) sets only that page aside. The App starts and serves every other page. The set-aside
page stays in the nav with a notice, and its routes answer that notice instead of erroring. Problems of the App as a whole (settings,
shared datasets, no page left) still refuse the App, and so does a problem with the page the build is for."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, app_dir, call, page, shell  # noqa: E402

BROKEN = page(kpis=[])
OTHER = page(id="n01_u06", use_case_id="N01-U06", title="Sales desk")
BOTH = dict(SETTINGS, pages=["n01_u05", "n01_u06"])
NOTICE = f"page {PAGE['title']} needs its use case built again. The App keeps this page set aside until then."


def test_one_broken_page_is_set_aside_and_the_app_still_starts(tmp_path, capsys):
    settings, pages, aside = shell_core.load_app(app_dir(tmp_path, BOTH, [BROKEN, OTHER]))
    assert [p["id"] for p in pages] == ["n01_u06"], "the App starts with the page that works"
    assert [p["id"] for p, _problems in aside] == ["n01_u05"]
    assert aside[0][1] and all(t.startswith("page n01_u05:") for t in aside[0][1]), "the set-aside page keeps its own problems"
    assert "[APP-SET-ASIDE] page=n01_u05 page n01_u05:" in capsys.readouterr().err


def test_the_shell_serves_the_other_page_and_the_set_aside_page_answers_its_notice(tmp_path):
    s, _sp, _user, _made = shell(tmp_path, BOTH, [BROKEN, OTHER])
    status, info = call(s, "GET", "app", headers={"x-forwarded-email": "a@example.com"})
    assert status == 200
    assert [p["id"] for p in info["pages"]] == ["n01_u05", "n01_u06"], "the set-aside page stays in the nav, in the App's order"
    assert info["pages"][0]["set_aside"] == NOTICE and "kpis" not in info["pages"][0]
    assert "set_aside" not in info["pages"][1]
    assert call(s, "POST", "page", body={"page": "n01_u05", "filters": {}}) == (200, {"set_aside": NOTICE})
    assert call(s, "GET", "summary", query={"page": "n01_u05"}) == (200, {"set_aside": NOTICE})
    status, out = call(s, "POST", "records/act", body={"page": "n01_u05"})
    assert status == 409 and out["error"] == NOTICE, "a write to the set-aside page changes nothing and says why"
    status, data = call(s, "POST", "page", body={"page": "n01_u06", "filters": {}})
    assert status == 200 and "set_aside" not in data


def test_an_app_level_problem_still_refuses_the_app_even_with_a_broken_page(tmp_path):
    with pytest.raises(ValueError, match="do not hold together"):
        shell_core.load_app(app_dir(tmp_path, dict(BOTH, style="z"), [BROKEN, OTHER]))


def test_when_every_page_is_set_aside_no_page_is_left_and_the_app_still_refuses(tmp_path):
    with pytest.raises(ValueError, match="no page is left to show"):
        shell_core.load_app(app_dir(tmp_path, dict(SETTINGS, pages=["n01_u05"]), [BROKEN]))


def test_the_split_refuses_the_pages_own_problem_and_sets_another_pages_problem_aside():
    own_id = "n01_u05"
    own, kept = shell_core.page_problems_split(["page n01_u05: kpi x failed"], [BROKEN, OTHER], own_id)
    assert own == ["page n01_u05: kpi x failed"] and kept == [], "this build's own page refuses"
    own, kept = shell_core.page_problems_split(["page n01_u06: chart y failed"], [BROKEN, OTHER], own_id)
    assert own == [] and [(p["id"], texts) for p, texts in kept] == [("n01_u06", ["page n01_u06: chart y failed"])]
    own, kept = shell_core.page_problems_split(["the App has no pages"], [BROKEN, OTHER], own_id)
    assert own == ["the App has no pages"] and kept == [], "an App-level problem refuses"
    text = "page n01_u05: the join reads page n01_u06: E"
    own, kept = shell_core.page_problems_split([text], [BROKEN, OTHER], own_id)
    assert own == [text] and kept == [], "a problem that touches this page is never waved through"


def test_with_no_build_page_every_page_named_problem_sets_its_page_aside():
    own, kept = shell_core.page_problems_split(["page n01_u05: kpi x failed", "the App has no pages"], [BROKEN, OTHER], None)
    assert own == ["the App has no pages"]
    assert [p["id"] for p, _texts in kept] == ["n01_u05"]


def test_the_set_aside_notice_names_the_page_and_says_it_needs_its_use_case_built_again():
    assert shell_core.set_aside_notice(BROKEN) == NOTICE
    assert shell_core.set_aside_notice({}) == (
        "the App page needs its use case built again. The App keeps this page set aside until then.")
