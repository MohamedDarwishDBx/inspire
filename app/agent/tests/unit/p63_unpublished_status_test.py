"""REQ-251 and REQ-252 (rc2 fix, from the FW2 walk on the scratch App). REQ-251: a widget range Genie wrote that is not a range form was
logged as "allowed 'a data value'", because the log redactor replaces every quoted, unknown text with the placeholder, so Genie's own
range text was never shown and the send-back named no fix. REQ-252: a build whose App did not publish ended ready_with_warnings with
app_url None. Offline, through the notebook namespace."""
import pytest


def _problems(agent_ns, allowed, default="6"):
    result = {"widgets": [{"name": "k_max", "type": "text", "default": default, "allowed": allowed}]}
    return agent_ns["normalize_genie_fill_widgets"](result, [])


def test_an_unreadable_range_is_named_with_its_default_and_the_forms_not_as_a_redacted_placeholder(agent_ns):
    problems = _problems(agent_ns, "at least k_min and at most the widest group")
    assert len(problems) == 1
    shown = agent_ns["inspire_redact_text"](problems[0], set(), "")
    assert "a data value" not in shown, shown
    assert "widget k_max" in shown and "its default 6" in shown
    assert "at least k_min and at most the widest group" in shown, "Genie must see the text it wrote, to know what to change"
    assert agent_ns["GENIE_ALLOWED_FORMS_TEXT"] in shown


def test_a_real_data_value_in_a_range_is_still_redacted_must_exclude(agent_ns):
    secret = "Franchise 3000000"
    problems = _problems(agent_ns, f"at least 1 and at most '{secret}'")
    shown = agent_ns["inspire_redact_text"](problems[0], set(), "", ())
    assert secret not in shown, "a quoted value from the data never reaches the status"


def test_a_range_genie_states_in_a_form_is_still_accepted(agent_ns):
    assert _problems(agent_ns, "whole number, 1 to 10") == []


@pytest.mark.parametrize("published, asked_state, held, warnings, expected", [
    (True, "failed", {"app": "page.json does not fit the App"}, [], "failed"),
    (True, "failed", {"app": "page.json does not fit the App"}, ["Notebook: a warning"], "failed"),
    (True, "ready", {}, ["Notebook: a warning"], "ready_with_warnings"),
    (True, "ready", {}, [], "ready"),
])
def test_an_unpublished_app_is_failed_and_a_published_app_with_warnings_stays_ready_with_warnings(
        agent_ns, published, asked_state, held, warnings, expected):
    status = {"app": {"state": asked_state}}
    assert agent_ns["implement_final_status"](["app"], status, held, 4, warnings) == expected


def test_a_dashboard_not_published_is_failed_too(agent_ns):
    assert agent_ns["implement_final_status"](["dashboard"], {}, {"dashboard": "the warehouse is stopped"}, 2, []) == "failed"


def test_the_failed_unpublished_status_says_the_next_step_in_plain_words(agent_ns):
    text = agent_ns["IMPLEMENT_UNPUBLISHED_NEXT"]
    assert text.startswith("Next step: press Try again") and "vibe" in text


def test_the_build_writes_the_final_status_through_the_helper_and_names_the_next_step_when_failed():
    from _agentload import agent_source
    source = agent_source()
    assert "status = implement_final_status(asked, asset_status, held_outputs, key[2], warnings)" in source
    assert 'if status == "failed":' in source and "IMPLEMENT_UNPUBLISHED_NEXT" in source
    assert "\"Done\", said_status if status != \"ready\" else" in source
