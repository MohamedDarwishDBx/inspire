"""REQ-357 / REQ-374: a driver or measure with one value in the data is named as the reason, Discover drops such a use case,
the readiness step measures the distinct values it needs, and a use case whose technique fits a model must read its training rows
unnarrowed."""
import pytest

from v200_kinds_signal_test import COLUMNS, IMPACT, ORDERS, answer, deep_inspire, uc
from v120_genie_redesign_notebook_test import make_uc, build_inspire

PRICE_CHECK = {"kind": "COLUMN_HAS_TWO_VALUES", "table": ORDERS, "column": "price", "statement": "the price effect can be measured"}


# --- generator: the readiness detail appears only for a distinct-value assumption --------------------------------------
@pytest.mark.parametrize("assumptions,expected", [
    ([PRICE_CHECK], True),
    ([{"kind": "KEY_HAS_REPEATED_ROWS", "table": ORDERS, "column": "order_id", "statement": "x"}], False),
    ([], False),
])
def test_the_generator_asks_for_the_value_fact_only_when_a_distinct_value_assumption_is_declared(agent_ns, assumptions, expected):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "Regression Analysis"}))
    spec["runtime_assumptions"] = assumptions
    text = inst._genie_threshold_text(spec)
    assert ("inspire_note_value_fact('price', scoped, whole" in text) is expected, text
    assert ("purpose='training')" in text) is expected


# --- training read: a model-fitting technique must read its training rows ------------------------------------------------
# One representative technique per family of the generator's catalog. A to E fit or train a model on their read, and so do the
# two F techniques that fit a slope or trend line; every other F, G, H, I, J, K and L technique reads without fitting.
FAMILY_FITS = [
    ("A", "Classification", True), ("B", "Anomaly Detection", True), ("C", "Clustering", True),
    ("D", "Recommendation", True), ("E", "Forecasting", True), ("F", "Regression Analysis", True), ("F", "Trend Analysis", True),
    ("F", "Correlation Analysis", False), ("G", "Sentiment Analysis", False), ("H", "Simulation", False),
    ("I", "Causal Impact", False), ("J", "Process Mining", False), ("K", "Controls Testing", False), ("L", "Data Agent", False),
]


@pytest.mark.parametrize("family,technique,fits", FAMILY_FITS)
def test_each_family_says_whether_its_techniques_fit_a_model_on_their_read(agent_ns, family, technique, fits):
    assert agent_ns["TECHNIQUE_EXECUTION_FAMILY"][technique] == family
    assert agent_ns["implement_fits_a_model"]({"Analytics Technique": technique}) is fits
    assert agent_ns["implement_fits_a_model"](None) is False


def test_the_training_read_check_fires_for_a_fitted_model_on_a_first_run_and_not_otherwise(agent_ns):
    fits = agent_ns["implement_fits_a_model"]({"Analytics Technique": "Regression Analysis"})
    assert agent_ns["implement_training_read_checked"]({}, {"first_run": True}, fits) is True
    assert agent_ns["implement_training_read_checked"]({}, {"first_run": False}, fits) is False
    assert agent_ns["implement_training_read_checked"]({"data": {"notes": "rows as given"}}, {"first_run": True}, fits) is False
    assert agent_ns["implement_training_read_checked"]({}, {"first_run": True}, False) is False


def test_the_notebook_that_fits_a_model_on_the_first_run_read_is_rejected_and_one_with_a_training_read_passes(agent_ns):
    cells_scoring_only = [("cell", "frame = inspire_read_source('main.s.orders')\nslope = frame.count()\n")]
    cells_training = [("cell", "frame = inspire_read_source('main.s.orders', purpose='training')\n")]
    assert agent_ns["implement_training_read_problems"](cells_scoring_only, required=True)
    assert agent_ns["implement_training_read_problems"](cells_training, required=True) == []
    assert agent_ns["implement_training_read_problems"](cells_scoring_only, required=False) == []


# --- Discover: a driver or measure with one value in the data is not proposed --------------------------------------------
def _regression_uc(**extra):
    return uc("N02-U01", "Regression Analysis", elite_assessment={"runtime_assumptions": [PRICE_CHECK]}, **extra)


GROUPS_SCOPED = {"n": 1000, "groups": 6, "reportable_groups": 6, "periods": 60}


def test_discover_drops_a_use_case_whose_named_measure_holds_one_value_in_the_data(agent_ns):
    rows = {"AS reportable_groups": GROUPS_SCOPED, "COUNT(DISTINCT `price`)": {"k": 1}}
    inst, agent, _spark = deep_inspire(agent_ns, [{"results": [answer("N02-U01", IMPACT)]}], rows)
    kept, dropped = inst._check_data_signal([_regression_uc()], [])
    assert kept == [] and [u["No"] for u in dropped] == ["N02-U01"]
    assert dropped[0]["selection_drop_reason"] == ("the data shows no signal: price holds 1 distinct value in main.s.orders, and the use "
                                                   "case needs at least 2 distinct values to show the price effect can be measured"), \
        dropped[0]["selection_drop_reason"]


def test_discover_keeps_a_use_case_whose_named_measure_holds_several_values(agent_ns):
    rows = {"AS reportable_groups": GROUPS_SCOPED, "COUNT(DISTINCT `price`)": {"k": 6}}
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": [answer("N02-U01", IMPACT)]}], rows)
    kept, dropped = inst._check_data_signal([_regression_uc()], [])
    assert [u["No"] for u in kept] == ["N02-U01"] and dropped == []


def _shape_uc():
    """The judge verified the price column as the use case's signal column; no runtime assumption is declared."""
    return uc("N02-U01", "Regression Analysis", elite_assessment={"signal_columns": [ORDERS + ".price"], "runtime_assumptions": []})


def test_discover_drops_the_price_response_shape_when_its_named_driver_has_one_price_in_the_data(agent_ns):
    """The W7 shape: a price-response use case on a table where every product has one price. The verified signal column is the
    price, and the judge declared no distinct-value assumption."""
    shape = answer("N02-U01", {"group": "store", "time": "event_time", "measure": "price"})
    rows = {"AS reportable_groups": GROUPS_SCOPED, "COUNT(DISTINCT `price`)": {"k": 1}}
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": [shape]}], rows)
    kept, dropped = inst._check_data_signal([_shape_uc()], [])
    assert kept == [] and [u["No"] for u in dropped] == ["N02-U01"]
    assert dropped[0]["selection_drop_reason"] == ("the data shows no signal: price holds 1 distinct value in main.s.orders, and the use "
                                                   "case needs at least 2 distinct values to show its effect"), \
        dropped[0]["selection_drop_reason"]


def test_discover_keeps_the_price_response_shape_when_the_named_driver_varies(agent_ns):
    shape = answer("N02-U01", {"group": "store", "time": "event_time", "measure": "price"})
    rows = {"AS reportable_groups": GROUPS_SCOPED, "COUNT(DISTINCT `price`)": {"k": 6}}
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": [shape]}], rows)
    kept, dropped = inst._check_data_signal([_shape_uc()], [])
    assert [u["No"] for u in kept] == ["N02-U01"] and dropped == []


def test_discover_never_counts_a_personal_signal_column_even_when_the_judge_names_it(agent_ns):
    """The guard that keeps personal columns out of every read holds on the signal-column path too."""
    rows = {"AS reportable_groups": GROUPS_SCOPED, "COUNT(DISTINCT `birth_year`)": {"k": 1}}
    shape = answer("N02-U01", {"group": "store", "time": "event_time"})
    use_case = uc("N02-U01", "Regression Analysis", elite_assessment={"signal_columns": [ORDERS + ".birth_year"],
                                                                     "runtime_assumptions": []})
    inst, _agent, spark = deep_inspire(agent_ns, [{"results": [shape]}], rows)
    kept, _dropped = inst._check_data_signal([use_case], [])
    assert [u["No"] for u in kept] == ["N02-U01"]
    assert not any("birth_year" in s and "COUNT(DISTINCT" in s for s in spark.statements), spark.statements
