"""REQ-295: three fallbacks for a segmentation build on small data, each fixed at its root.

1. A widget range that names another widget ("whole number, at least k_min") is read as that widget's default, so the range is a readable
   form and the repair does not loop on it (live: k_max's range text was not readable in the third build).
2. Under three usable numeric features the method guidance falls back to the Baseline and says so, instead of stopping the run.
3. An acceptance failure on data the readiness gate called short names that shortfall as its cause.
Each fail-pre test fails on the code before this change.
"""
from v120_artifacts_support import make_inspire

LIVE_WIDGETS = [
    {"name": "k_min", "default": "2", "allowed": "whole number, 1 to 10", "type": "number"},
    {"name": "k_max", "default": "6", "allowed": "whole number, at least k_min", "type": "number"},
]


def test_a_range_that_names_another_widget_is_read_as_that_widgets_default(agent_ns):
    """Fail-pre: the k_max range was left as 'whole number, at least k_min', which no range form reads, so every repair round refused it."""
    widgets = [dict(w) for w in LIVE_WIDGETS]
    problems = agent_ns["normalize_genie_fill_widgets"]({"widgets": widgets}, [])
    assert problems == [], problems
    by_name = {w["name"]: w for w in widgets}
    assert by_name["k_max"]["allowed"] == "whole number, at least 2"
    assert agent_ns["genie_allowed_rule"](by_name["k_max"]["allowed"]) == (2, None, True, False, False)


def test_a_range_that_names_a_widget_without_a_numeric_default_is_still_refused(agent_ns):
    """Must-exclude: a bound with no number to read is still a problem, so Genie is told to write a number."""
    widgets = [{"name": "k_min", "default": "", "allowed": "", "type": "number"},
               {"name": "k_max", "default": "6", "allowed": "whole number, at least k_min", "type": "number"}]
    problems = agent_ns["normalize_genie_fill_widgets"]({"widgets": widgets}, [])
    assert any("k_max" in p and "allowed range Inspire cannot read" in p for p in problems), problems


def test_the_segmentation_and_clustering_guidance_falls_back_to_the_baseline_under_three_numeric_features(agent_ns):
    """Fail-pre: the guidance said 'stop the run at the readiness gate', so Genie stopped or improvised, and the third build failed acceptance
    with no reason. Post-fix: under three numeric features the guidance uses the Baseline and says so in the run's summary."""
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    for technique in ("Segmentation", "Clustering"):
        text = guidance[technique]
        assert "stop the run at the readiness gate" not in text, technique
        assert "fewer than three usable numeric features: use the Baseline instead" in text, technique
        assert "Baseline: quantile tiers" in text, technique


def _spec(ns):
    return {"family": sorted(ns["INSPIRE_MODEL_FAMILIES"])[0], "decision_basis": "predicted"}


def test_an_acceptance_failure_on_short_data_names_the_shortfall(agent_ns, tmp_path):
    """Fail-pre: the warning said only 'no model passed acceptance'. Post-fix: it carries the readiness reason the data gate recorded."""
    inst = make_inspire(agent_ns, spark=None, session_id=5150)
    inst.local_log_output_dir = str(tmp_path)
    inst._implement_trains_model = lambda use_case: True
    inst._implement_latest_run_methods = lambda table: {"methods": [("Baseline", 6)], "kinds": 1, "versioned_rows": False}
    short = {"state": "short", "data_minimum": "Too few usable numeric features exist (2); at least 3 are needed to form segments."}
    warning = inst._implement_fallback_warning("N04-U01", "main.s.t", {}, _spec(agent_ns), short)
    assert warning.startswith("Notebook: no model passed acceptance on the latest run"), warning
    assert warning.endswith("Why: Too few usable numeric features exist (2); at least 3 are needed to form segments.")


def test_an_acceptance_failure_on_ready_data_names_no_shortfall(agent_ns, tmp_path):
    """Must-exclude: a ready data state adds no cause, so the warning does not invent one."""
    inst = make_inspire(agent_ns, spark=None, session_id=5150)
    inst.local_log_output_dir = str(tmp_path)
    inst._implement_trains_model = lambda use_case: True
    inst._implement_latest_run_methods = lambda table: {"methods": [("Baseline", 6)], "kinds": 1, "versioned_rows": False}
    warning = inst._implement_fallback_warning("N04-U01", "main.s.t", {}, _spec(agent_ns), {"state": "ready", "data_minimum": ""})
    assert "Why:" not in warning and warning.startswith("Notebook: no model passed acceptance")
