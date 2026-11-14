"""REQ-199 and REQ-200 (live rebuild on the rc7 scratch App, use case N06-U02). REQ-199: a rebuild vibe that named the Grouping
("Use Global grouping: fit one model for all groups") was not applied, because the planned Grouping stayed at the first build's
paymentMethod, and Genie wrote that as the widget default. REQ-200: the status said "v2 is published with 1 unmet ask" while the
App was not published (app_url null). Offline, through the vibe router and the status composer."""
import json

import pytest

from v143_vibes_test import _locked
from v152_mvp_vibe_test import _llm, _vibe

GLOBAL = "Use Global grouping: fit one model for all groups, not one per group."
PLANNED = "paymentMethod"
MISSED = [{"n": 1, "requirement": GLOBAL, "status": "not_met", "part": "", "where": "", "evidence": "the grouping control defaults to paymentMethod",
           "rounds": 3}]


def _grouped(previous, text, grouping=PLANNED):
    spec = _vibe(previous, text)
    return dict(spec, config={"widgets": {"group_by": grouping}})


@pytest.mark.parametrize("text,expected", [
    (GLOBAL, ["all"]),
    ("No grouping, the whole table is one group.", ["all"]),
    ("Grouping is all.", ["all"]),
    ("Grouping: paymentMethod.", ["paymentMethod"]),
    ("Group by product, region.", ["product, region"]),
    ("Grouping by paymentMethod.", ["paymentMethod"]),
], ids=["global", "no_grouping", "grouping_all", "grouping_colon", "group_by_leading", "grouping_by"])
def test_a_vibe_that_names_the_grouping_gives_it(agent_ns, text, expected):
    assert agent_ns["implement_vibe_grouping"]([text]) == expected


@pytest.mark.parametrize("text", [
    "Show a bar chart of sales grouped by region.",
    "Show the top 10 clerks by sales.",
    "Put the riskiest customers first.",
], ids=["chart_grouped_by", "chart_by", "unrelated"])
def test_a_vibe_that_does_not_name_the_grouping_names_none_must_exclude(agent_ns, text):
    assert agent_ns["implement_vibe_grouping"]([text]) == [], "a chart's own grouping and unrelated asks keep the planned Grouping (REQ-183)"


def test_two_different_groupings_in_one_vibe_are_both_reported_so_the_router_can_refuse_them(agent_ns):
    assert agent_ns["implement_vibe_grouping"]([GLOBAL, "Grouping: paymentMethod."]) == ["all", "paymentMethod"]


def test_the_planned_grouping_is_set_on_the_spec_and_the_rest_of_the_spec_is_untouched(agent_ns):
    spec = {"outputs": {"app_name": "x"}, "config": {"widgets": {"group_by": PLANNED, "result_table": "a.b"}}, "retry_outputs": []}
    got = agent_ns["implement_apply_vibe_grouping"](spec, "all")
    assert got["config"]["widgets"] == {"group_by": "all", "result_table": "a.b"}
    assert got["outputs"] == spec["outputs"] and spec["config"]["widgets"]["group_by"] == PLANNED, "the input spec is not mutated"


def test_a_rebuild_vibe_that_names_the_global_grouping_plans_all_and_the_default_follows(agent_ns):
    inst, previous = _locked(agent_ns)
    _llm(inst, {"notebook": GLOBAL})
    spec = agent_ns["validate_implement_spec"](_grouped(previous, GLOBAL))[0]
    routed, _vibe_state, _changed = inst._implement_route_vibe((5150, "N06-U02", 3), spec, {"checklist": []}, False)
    assert routed["config"]["widgets"]["group_by"] == "all", "the vibe overrides the planned Grouping (CLAUDE.md 3c)"
    grouping = agent_ns["implement_grouping_plan"]("", [], routed["config"]["widgets"]["group_by"])
    assert grouping["default"] == "all" and grouping["chosen_by"] == "person"


def test_a_vibe_that_does_not_name_the_grouping_keeps_the_planned_one_must_exclude(agent_ns):
    inst, previous = _locked(agent_ns)
    _llm(inst, {"notebook": "Put the riskiest customers first"})
    spec = agent_ns["validate_implement_spec"](_grouped(previous, "Put the riskiest customers first."))[0]
    routed, _vibe_state, _changed = inst._implement_route_vibe((5150, "N06-U02", 3), spec, {"checklist": []}, False)
    assert routed["config"]["widgets"]["group_by"] == PLANNED, "a vibe that does not name the Grouping never changes it (REQ-183)"


def test_conflicting_groupings_in_one_vibe_are_refused_before_the_router_is_called(agent_ns):
    inst, previous = _locked(agent_ns)
    calls = []
    inst._implement_vibes_llm = lambda *args: calls.append(args) or {}
    spec = agent_ns["validate_implement_spec"](_grouped(previous, f"{GLOBAL} Grouping: paymentMethod."))[0]
    with pytest.raises(agent_ns["ImplementBlocked"], match="names two Groupings"):
        inst._implement_route_vibe((5150, "N06-U02", 3), spec, {"checklist": []}, False)
    assert calls == []


def test_the_unmet_ask_text_never_says_published_when_the_app_was_not_published(agent_ns):
    text = agent_ns["implement_unmet_published_text"](MISSED, 2, False)
    assert text.startswith("v2 is not fully published, with 1 unmet ask (not met or could not be checked): "), text
    assert "published with" not in text and "rest of the vibe is in place" not in text


def test_a_published_build_still_reports_published_must_exclude(agent_ns):
    text = agent_ns["implement_unmet_published_text"](MISSED, 2)
    assert text.startswith("v2 is published with 1 unmet ask (not met or could not be checked), the rest of the vibe is in place: ")


def test_an_app_that_failed_to_publish_is_unpublished_and_a_live_one_is_not(agent_ns):
    failed = {"app": {"state": "failed", "error": "the App files do not hold together"}}
    assert agent_ns["implement_unpublished"](["app"], failed, {}, 2) is True
    assert agent_ns["implement_unpublished"](["app"], {"app": {"state": "ready"}}, {}, 2) is False, "a published App is published"
    assert agent_ns["implement_unpublished"](["genie_space"], failed, {}, 2) is False, "only outputs that publish count"
    assert agent_ns["implement_unpublished"]([], failed, {}, 2) is False
