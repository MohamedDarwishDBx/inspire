"""REQ-259 class sweep (§3e): the App and dashboard pages store their held copy and snapshot in the base-table form, the same form the
Genie Agent stores, by reversing the candidate names with scope_held_pairs. The page flow's own test harness never carries a scoped source
name in a page's SQL, so the page sites are not covered by a fail-pre test here (see p70_result.md); this file pins the helper they call.
"""
import json

from rc2_fix_candidate_views_test import CANDIDATE, SOURCE, VIEW, _scopes


def test_the_held_pairs_turn_a_candidate_page_back_into_the_base_table(agent_ns):
    scopes = _scopes(agent_ns)
    quote = agent_ns["inspire_quote_identifier"]
    cand_ref = ".".join(quote(p) for p in CANDIDATE.split("."))
    page = {"datasets": [{"name": "kpi", "sql": f"SELECT SUM(amount) AS total FROM {cand_ref}"}]}
    held = agent_ns["scope_publish_rename"](json.loads(json.dumps(page)), agent_ns["scope_held_pairs"](scopes))
    text = json.dumps(held)
    base_ref = ".".join(quote(p) for p in SOURCE.split("."))
    assert "__candidate" not in text and base_ref in text, text


def test_the_held_pairs_never_name_a_versioned_view(agent_ns):
    """The stored form holds no __v<N> name, so a replay checks only names the replay itself creates."""
    scopes = _scopes(agent_ns)
    quote = agent_ns["inspire_quote_identifier"]
    versioned = ".".join(quote(p) for p in (VIEW + "__v4").split("."))
    page = {"datasets": [{"name": "kpi", "sql": f"SELECT 1 FROM {versioned}"}]}
    assert agent_ns["scope_publish_rename"](json.loads(json.dumps(page)), agent_ns["scope_held_pairs"](scopes)) == page, \
        "a name that is not a candidate is left as it is"
