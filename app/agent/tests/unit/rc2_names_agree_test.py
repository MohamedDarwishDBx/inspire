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
