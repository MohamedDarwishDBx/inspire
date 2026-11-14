"""Walk defect (coordinator, REQ-182 / REQ-175): a use case whose person-typed name (user_use_case_name) differs from its generated
Name must carry ONE name on every surface. The carried user name becomes Name at write time (the generated one is kept as
original_name), so the tracking row's Name and name_with_technique agree. Fail-pre: before the fix the carry left Name generated
while name_with_technique took the user name, so the two columns disagreed on the same row."""
from v120_gate_recalibration_test import make

GENERATED = "Correct Charging Errors to Protect Revenue"
TYPED = "Stop Duplicate and Mispriced Charges"


def _uc(**extra):
    return {"No": "N01-U01", "Name": GENERATED, "Analytics Technique": "Controls Testing", **extra}


def test_a_carried_user_name_becomes_the_name_and_the_row_agrees(agent_ns):
    obj = make(agent_ns)
    uc = _uc()
    obj.carry_user_use_case_names([uc], {"N01-U01": TYPED})
    assert uc["user_use_case_name"] == TYPED
    assert uc["Name"] == TYPED, "the typed name is the name on every surface, not only in name_with_technique"
    assert uc["original_name"] == GENERATED
    row = obj._tracking_row_source(uc)
    assert row["Name"] == row["name_with_technique"] == TYPED


def test_the_helper_is_idempotent_and_keeps_the_generated_name_once(agent_ns):
    uc = _uc(user_use_case_name=TYPED)
    assert agent_ns["inspire_apply_user_use_case_name"](uc) is True
    assert agent_ns["inspire_apply_user_use_case_name"](uc) is False
    assert uc["original_name"] == GENERATED and uc["Name"] == TYPED


def test_a_use_case_without_a_typed_name_keeps_its_generated_name(agent_ns):
    obj = make(agent_ns)
    uc = _uc()
    obj.carry_user_use_case_names([uc], {"N09-U09": TYPED})
    assert uc["Name"] == GENERATED and "original_name" not in uc
    row = obj._tracking_row_source(uc)
    assert row["Name"] == row["name_with_technique"] == GENERATED


# REQ-182 class (rc7 live walk, filtered Discover 317339574539724): N04-U03 "Align Staffing with Peak Hours" reached the tracking
# row as name_with_technique "Align Staffing with Peak Hours" while its use_case column read "Align Staffing". The use_case column
# came from _normalize_usecase, which cut every name at " with ". Both columns must be the same name, and no pass may shorten it
# to a vaguer head.
PEAK = "Align Staffing with Peak Hours"


def test_the_tracking_row_carries_the_full_name_in_use_case_and_name_with_technique(agent_ns):
    obj = make(agent_ns)
    uc = {"No": "N04-U03", "Name": PEAK, "Analytics Technique": "Queueing"}
    src = obj._tracking_row_source(uc)
    row = agent_ns["DatabricksInspire"]._uc_to_row(src, 1, obj._normalize_usecase)
    assert row[4] == row[5] == src["name_with_technique"] == PEAK, (row[4], row[5], src["name_with_technique"])


def test_the_title_normaliser_never_cuts_a_name_at_with(agent_ns):
    obj = make(agent_ns)
    assert obj._normalize_usecase(PEAK, PEAK) == PEAK, "a name is the title: it is never cut at with"
    assert obj._normalize_usecase("", PEAK) == PEAK
    assert obj._normalize_usecase("forecast daily bakery demand with prophet", "Forecast daily demand per store") == \
        "Forecast Daily Bakery Demand", "a separate headline still loses its with-technique tail"


def test_a_name_with_an_acronym_is_one_value_in_every_field_and_takes_the_title_rule(agent_ns):
    obj = make(agent_ns)
    uc = {"No": "N05-U01", "Name": "Forecast KPI Demand For Each Store"}
    agent_ns["set_use_case_name"](uc, uc["Name"])
    src = obj._tracking_row_source(uc)
    row = agent_ns["DatabricksInspire"]._uc_to_row(src, 1, obj._normalize_usecase)
    assert uc["usecase"] == uc["Name"] == row[4] == row[5] == src["name_with_technique"]
    assert uc["Name"] == agent_ns["inspire_title_case"]("Forecast KPI Demand For Each Store"), "one title-case rule, no second one"
    assert " for " in " " + uc["Name"] + " ", "a small word stays lower case after the first word"


def test_a_lower_case_llm_name_is_title_cased_once_and_agrees_in_every_field(agent_ns):
    obj = make(agent_ns)
    uc = {"No": "N05-U02", "Name": "predict customer churn in each region", "Analytics Technique": "Predictive Modeling"}
    agent_ns["set_use_case_name"](uc, uc["Name"])
    assert uc["Name"] == "Predict Customer Churn in Each Region"
    src = obj._tracking_row_source(uc)
    row = agent_ns["DatabricksInspire"]._uc_to_row(src, 1, obj._normalize_usecase)
    assert uc["usecase"] == row[4] == row[5] == src["name_with_technique"] == "Predict Customer Churn in Each Region"


def test_a_typed_name_is_kept_word_for_word_by_the_writer(agent_ns):
    uc = {"No": "N05-U03", "Name": "Predict Churn", "user_use_case_name": "my own words for churn"}
    agent_ns["inspire_apply_user_use_case_name"](uc)
    assert uc["Name"] == uc["usecase"] == uc["user_named"] == "my own words for churn"


def test_a_backtick_in_the_name_is_removed_from_every_field_at_write(agent_ns):
    obj = make(agent_ns)
    uc = {"No": "N06-U01", "Name": "Predict `Churn` Rate"}
    agent_ns["set_use_case_name"](uc, uc["Name"])
    assert uc["Name"] == uc["usecase"] == "Predict Churn Rate"
    assert obj._tracking_row_source(uc)["name_with_technique"] == uc["Name"]


def test_the_length_fallback_cuts_at_the_qualifier_so_the_head_stays_specific(agent_ns):
    uc = {"No": "N07-U01", "Name": "Predict Customer Churn in Each Region Every Single Month", "Primary Table": "main.s.orders"}
    agent_ns["ensure_name_lengths"]([uc], reask=None)
    assert uc["Name"] == uc["usecase"] == "Predict Customer Churn"


def test_a_name_the_person_typed_is_never_cut_at_a_qualifier(agent_ns):
    typed = "Predict Customer Churn in Each Region Every Single Month"
    uc = {"No": "N07-U02", "Name": "Predict Customer Churn", "user_use_case_name": typed}
    agent_ns["inspire_apply_user_use_case_name"](uc)
    agent_ns["ensure_name_lengths"]([uc], reask=None)
    assert uc["Name"] == typed


def test_a_replayed_row_with_a_cut_use_case_column_gets_the_one_name_back(agent_ns):
    """A row written before REQ-182 can hold use_case "Align Staffing" beside description "Align Staffing with Peak Hours".
    Replaying it must give the use case one name, the description, on every field."""
    obj = make(agent_ns)
    row = {"id": "N04-U03", "use_case": "Align Staffing", "description": PEAK, "analytics_technique": "Queueing", "session_id": 1}
    uc = obj._row_to_uc(row)
    assert uc["Name"] == uc["usecase"] == PEAK
