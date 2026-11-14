"""REQ-186: a rebuild whose only ask keeps the App as it is must carry every element of the built page forward.

v5 of N01-U01 ("Rebuild the MVP as is") published with 7 elements of v4 missing. Genie is seeded with the built page.json, but the
deterministic restore (implement_untargeted_targets) and the keep-the-rest verdict both return None for a whole-page ask the split
marks as a change with no element to name (or a page name). None means "cannot tell what the ask touches", so nothing is put back
and the judge alone decides. An "as is" ask touches nothing, so the built page must be kept element for element.
"""
import json

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v167_untargeted_guard_test import PART, V3, _Runner, _copy, _page_inspire

ASK = "Rebuild the MVP as is"
NAMED_PAGE = {"ask": ASK, "check": {"kind": "page", "value": "the MVP"}, "keep": False, "where": ""}
BARE = {"ask": ASK, "check": None, "keep": False, "where": ""}
KEEP = {"ask": ASK, "check": None, "keep": True, "where": ""}
LABEL = "App page n02_u01"
# Genie's rebuild: cash buffer KPI, the outlook, priority and tier charts and the action tier filter are all gone.
DROPPED = dict(_copy(V3), kpis=[V3["kpis"][0]], charts=[V3["charts"][1]], filters=[V3["filters"][0]])


def _ids(items):
    return [item["id"] for item in items]


def _shell():
    import shell_sql
    return shell_sql


def test_an_as_is_ask_splits_into_a_keep_ask_and_nothing_else_changes(agent_ns):
    for split in (NAMED_PAGE, BARE, KEEP):
        normalized = agent_ns["implement_vibes_as_is_ask"](dict(split))
        assert normalized["keep"] is True and normalized["check"] is None and normalized["where"] == "", split


def test_only_a_bare_as_is_rebuild_is_read_as_keep_and_other_asks_stay_as_the_split_made_them(agent_ns):
    as_is = agent_ns["implement_vibes_as_is_ask"]
    for text in ("Rebuild the MVP as is", "rebuild the mvp as it is", "Keep the Customer filter as it is.",
                 "Leave the page as it was now", "Recreate the App as it is"):
        assert as_is({"ask": text, "check": None, "keep": False, "where": ""})["keep"] is True, text
    for text in ("Make it calmer", "Rebuild the MVP as is, and add a chart of expected takings", "Show the page as it is",
                 "Restore the Customer filter as it was", "Make the chart as it should be"):
        ask = {"ask": text, "check": {"kind": "page", "value": "the MVP"}, "keep": False, "where": "the MVP"}
        assert as_is(dict(ask)) == ask, text


def test_an_as_is_rebuild_of_the_whole_page_has_targets_so_the_untouched_elements_are_put_back(agent_ns):
    targets = agent_ns["implement_untargeted_targets"]
    for split in (NAMED_PAGE, BARE):
        found = targets("app", [(PART, agent_ns["implement_vibes_as_is_ask"](dict(split)))], V3, DROPPED, "records", _shell())
        assert found is not None and found["keys"] == set(), (split, found)
        changes = agent_ns["implement_untargeted_changes"]("app", V3, DROPPED, found, "records")
        assert {c["key"] for c in changes} == {"kpis:cash_buffer", "charts:takings_outlook", "charts:buffer_priority",
                                               "charts:buffer_by_tier", "filters:priority_tier"}, changes


def test_the_keep_the_rest_verdict_flags_every_dropped_element_without_the_judge(agent_ns):
    as_is = [(PART, agent_ns["implement_vibes_as_is_ask"](dict(NAMED_PAGE)))]
    verdict = agent_ns["implement_vibes_rest_kept"]("app", as_is, V3, DROPPED, LABEL, _shell())
    assert verdict is not None and verdict[0] == "missing", verdict
    assert "and 4 other changes no ask names" in verdict[1], verdict
    intact = agent_ns["implement_vibes_rest_kept"]("app", as_is, V3, _copy(V3), LABEL, _shell())
    assert intact == ("done", f"nothing on the built {LABEL} that the other asks did not name changed from the version before"), intact


def test_a_whole_page_rebuild_as_is_keeps_every_element_genie_drops_in_the_deployed_app(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=ASK, splits={ASK: [dict(NAMED_PAGE)]})
    inst._implement_page_spec(context, _Runner([DROPPED]), "app", deploy)
    [page] = deployed
    assert _ids(page["kpis"]) == _ids(V3["kpis"]), page["kpis"]
    assert _ids(page["charts"]) == _ids(V3["charts"]), page["charts"]
    assert _ids(page["filters"]) == _ids(V3["filters"]), page["filters"]
    assert len(context["untargeted"]["app"]["restored"]) == 5, context["untargeted"]["app"]
    assert context["untargeted"]["app"]["blocked"] == []


def test_a_bare_as_is_rebuild_keeps_every_element_too(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=ASK, splits={ASK: [dict(BARE)]})
    inst._implement_page_spec(context, _Runner([DROPPED]), "app", deploy)
    [page] = deployed
    assert _ids(page["kpis"]) == _ids(V3["kpis"]) and _ids(page["charts"]) == _ids(V3["charts"]), page


def test_a_rebuild_retry_of_the_as_is_ask_is_still_a_keep_ask(agent_ns, tmp_path):
    inst, context, _deployed, _deploy = _page_inspire(agent_ns, tmp_path, ask_text=ASK, splits={ASK: [dict(NAMED_PAGE)]})
    context["spec"]["retry_asks"] = {PART: [ASK]}
    asks = inst._implement_output_asks(context, "app")
    assert asks and all(asset == PART and ask["keep"] is True and ask["check"] is None for asset, ask in asks), asks


def test_the_round_that_judges_the_as_is_ask_gets_it_as_keep_the_rest(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_vibes_llm = lambda kind, prompt, schema: {"asks": [dict(NAMED_PAGE)]}
    item = {"asset": PART, "text": ASK, "artifact": DROPPED, "built_before": _copy(V3), "tools": {"shell_sql": _shell()}}
    asks = inst._implement_round_asks({}, item)
    assert [(a["ask"], a["keep"], a["check"], a["where"]) for a in asks] == [(ASK, True, None, "")], asks
