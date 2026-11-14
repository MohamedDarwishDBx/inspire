"""REQ-204: a rebuild "as is" reuses the last published App page, with no Genie page round.

v6 of N01-U01 was published. v7 and v8 rebuilt "as is", and each asked Genie to write the page again, so each wrote a different page
and v8 failed. An as-is rebuild now publishes the last published copy (the newest snapshot of an earlier version) after it is checked
against the current results. A copy that no longer fits is named in the step and Genie rewrites the page. A rebuild with a change ask
still asks Genie.
"""
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from rc2_rebuild_as_is_test import DROPPED, NAMED_PAGE
from v167_untargeted_guard_test import GLOBE_ASK, GLOBE_SPLIT, PART, V3, _copy, _page_inspire, _Runner

ASK = "Rebuild the MVP as is"
PUBLISHED = 3
REBUILD = {"app": {"parts": [], "again": {PART: [ASK]}, "kept": {}, "file": "page.json", "based": True}}


def _published_spark(versions):
    """The implement table lists the earlier versions that have a row, newest first."""
    return FakeSpark(responder=lambda text: [{"spec_version": v} for v in versions] if "spec_version < " in text else [])


def _as_is_inst(agent_ns, tmp_path, *, ask_text=ASK, splits=None, prior=None, versions=(PUBLISHED,), rebuild=REBUILD):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=ask_text,
                                                    splits=splits or {ask_text: [dict(NAMED_PAGE)]})
    inst.spark = _published_spark(versions)
    inst._implement_table_sql = lambda: "main.inspire.implement"
    if prior is not None:
        inst._implement_snapshot = lambda key, name, version: {"artifact": _copy(prior), "spec_version": version}
    context["rebuild"] = _copy(rebuild) if rebuild else {}
    return inst, context, deployed, deploy


def _ids(items):
    return [item["id"] for item in items]


def test_an_as_is_rebuild_publishes_the_published_page_with_no_genie_page_round(agent_ns, tmp_path):
    inst, context, deployed, deploy = _as_is_inst(agent_ns, tmp_path)
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert runner.prompts == [], "an as-is rebuild must not ask Genie to write the App page"
    [page] = deployed
    assert _ids(page["kpis"]) == _ids(V3["kpis"]) and _ids(page["charts"]) == _ids(V3["charts"]), page
    assert _ids(page["filters"]) == _ids(V3["filters"]), page
    assert page["charts"] == V3["charts"], page["charts"]
    assert context["artifacts"]["app"]["charts"] == V3["charts"], "the published copy is what the App snapshot saves"


def test_a_rebuild_with_a_change_ask_still_asks_genie(agent_ns, tmp_path):
    inst, context, deployed, deploy = _as_is_inst(agent_ns, tmp_path, ask_text=GLOBE_ASK, splits={GLOBE_ASK: GLOBE_SPLIT},
                                                  rebuild={"app": {"parts": [], "again": {PART: [GLOBE_ASK]}, "kept": {}, "file": "page.json",
                                                                   "based": True}})
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert runner.prompts, "a rebuild that changes the App must still ask Genie"


def test_an_as_is_rebuild_without_a_rebuild_flag_is_not_reused(agent_ns, tmp_path):
    inst, context, _deployed, deploy = _as_is_inst(agent_ns, tmp_path, rebuild=None)
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert runner.prompts, "only a rebuild reuses the published copy; a first build still asks Genie"


def test_an_as_is_rebuild_with_no_published_copy_asks_genie(agent_ns, tmp_path):
    inst, context, _deployed, deploy = _as_is_inst(agent_ns, tmp_path, versions=())
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert runner.prompts, "with no earlier version to keep, Genie writes the page"


def test_a_published_page_that_no_longer_fits_the_current_results_hands_over_to_genie_with_the_reason(agent_ns, tmp_path):
    misfit = dict(_copy(V3), misfit=True)
    inst, context, deployed, deploy = _as_is_inst(agent_ns, tmp_path, prior=misfit)
    real = inst._implement_page_file

    def page_file(context, name, work, shell_sql, event_date, fresh=False):
        import json
        import os
        raw = json.load(open(os.path.join(work, "page.json"), encoding="utf-8"))
        if raw.get("misfit"):
            raise RuntimeError("page.json does not fit the App: a dataset of the page reads the versions of main.inspire.n01_u01_results")
        return real(context, name, work, shell_sql, event_date, fresh)

    inst._implement_page_file = page_file
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy)
    assert runner.prompts, "a copy that does not fit must fall back to Genie"
    steps = [e.get("message") or e.get("text") or "" for e in inst.emitted]
    assert any("does not fit the current results" in str(text) and "reads the versions of" in str(text) for text in map(str, inst.emitted)), \
        inst.emitted
