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
    # Every build context carries its result table (3c7f2bdd6 reads it for the as-is Genie Agent normalizer check).
    context["result_table"] = "main.inspire.churn_out"
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


def test_an_app_copy_that_fails_the_deploy_time_app_check_hands_over_to_genie(agent_ns, tmp_path):
    """The App's own check (run at the default filters) runs before anything is published; a copy that fails it is rewritten."""
    inst, context, deployed, deploy = _as_is_inst(agent_ns, tmp_path)
    real_deploy = deploy

    attempts = []

    def deploy_checked(work, page, gate=lambda: None):
        attempts.append(page.get("stale_default_filter"))
        if len(attempts) == 1:
            raise RuntimeError("the App was run at its default filters and page n02_u01: the kpi reads a column that is gone")
        return real_deploy(work, page, gate)

    inst._implement_snapshot = lambda key, name, version: {"artifact": dict(_copy(V3), stale_default_filter=True), "spec_version": version}
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "app", deploy_checked)
    assert runner.prompts, "a copy that fails the App check must be rewritten by Genie"
    assert any("default filters" in str(e) for e in inst.emitted), inst.emitted
    assert "app" not in (context.get("as_is") or set()) and "app" not in (context.get("replay") or {})


def test_a_dashboard_as_is_rebuild_publishes_the_published_dashboard_with_no_genie_round(agent_ns, tmp_path):
    inst, context, deployed, deploy = _page_inspire(agent_ns, tmp_path, ask_text=ASK, splits={ASK: [dict(NAMED_PAGE)]})
    context["spec"]["outputs"] = {"dashboard": True, "dashboard_vibes": ASK}
    context["asset_status"]["dashboard"] = {"state": "ready", "spec_version": 3, "snapshot": True}
    inst.spark = _published_spark([PUBLISHED])
    inst._implement_table_sql = lambda: "main.inspire.implement"
    context["rebuild"] = {"dashboard": {"parts": [], "again": {"dashboard": [ASK]}, "kept": {}, "file": "page.json", "based": True}}
    runner = _Runner([DROPPED])
    inst._implement_page_spec(context, runner, "dashboard", deploy)
    assert runner.prompts == [], "an as-is dashboard rebuild must not ask Genie"
    [page] = deployed
    assert _ids(page["charts"]) == _ids(V3["charts"]) and _ids(page["kpis"]) == _ids(V3["kpis"]), page


def test_a_genie_space_that_does_not_pass_the_normalizer_is_not_reused(agent_ns, tmp_path):
    inst, context, _deployed, _deploy = _as_is_inst(agent_ns, tmp_path)
    inst._implement_candidate_scopes = lambda context, scopes: scopes
    inst._genie_scopes = lambda use_case: {}
    context["allowed"] = ["main.inspire.churn_out"]
    assert inst._implement_as_is_space_fits(context, (PUBLISHED, {"artifact": {"version": 2, "config": {}, "data_sources": {"tables": [
        {"identifier": "main.not_allowed.table"}]}}})) is False
    assert any("so Genie rewrites it" in str(e) for e in inst.emitted), inst.emitted


def test_an_as_is_alert_rebuild_keeps_the_published_condition_with_no_genie_round(agent_ns, tmp_path):
    from v140_implement_test import ALERT, _alert_inspire, _output_context
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path)
    published = {"condition_text": "", "condition_sql": "SELECT 1 AS triggered", "name": "Churn alert", "trigger": "fires on weekdays only"}
    inst._implement_as_is_base = lambda context, name: (2, {"artifact": published, "vibes": "", "spec_version": 2}) if name == "alert" else None
    asked = []

    class Runner:
        def run(self, prompt, work, schema, label=""):
            asked.append(prompt)
            raise AssertionError("an as-is alert rebuild must not ask Genie")

    context = dict(_output_context(agent_ns, **ALERT), assets={"alert": "al-1"}, rebuild={"alert": {"again": {"alert": ["Rebuild the alert as is"]}}})
    context["asset_status"] = {"alert": {"state": "ready", "spec_version": 2, "snapshot": True}}
    fields = inst._implement_alert(context, Runner())
    assert asked == [] and fields, fields
    assert queries and any("SELECT 1 AS triggered" in q for q in queries), queries
