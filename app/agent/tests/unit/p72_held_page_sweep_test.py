"""REQ-259 class sweep, page site (fail-pre): a held App or dashboard page stores its scoped source in the base-table form.

A build attempt checks its page against the candidate scope view (CANDIDATE). The held copy and the snapshot of a kept page used to
store that candidate name as it was, so a replay that makes no candidate view again named a view that does not exist. The stored copy
must name the base table (the reverse of scope_held_pairs), the same form the Genie Agent stores.
"""
import json

from rc2_fix_candidate_views_test import CANDIDATE, SOURCE, _scopes
from v140_implement_test import _churn_page
from v142_dash_test import _flow, _runner


def _page_on_candidate(ns):
    quote = ns["inspire_quote_identifier"]
    candidate_ref = ".".join(quote(part) for part in CANDIDATE.split("."))
    page = _churn_page(ns)
    page["datasets"][0]["sql"] = f"SELECT amount, region FROM {candidate_ref}"
    return page


def test_a_held_page_stores_its_scoped_source_in_the_base_table_form(agent_ns, tmp_path):
    inst, context, _seen = _flow(agent_ns, tmp_path)
    scopes = _scopes(agent_ns)
    inst._implement_build_scopes = lambda _context: scopes
    context["allowed"] = list(context["allowed"]) + [CANDIDATE]
    candidates = {key: dict(scope, ready=True) for key, scope in agent_ns["candidate_scopes"](scopes).items()}
    inst._implement_candidate_scopes = lambda _context, _scopes: candidates
    deploy = lambda work, page, gate: {"dashboard_id": "d1"}
    page = _page_on_candidate(agent_ns)
    inst._implement_page_spec(context, _runner(page, page, page), "dashboard", deploy)
    stored = json.dumps(context["candidate_artifacts"]["dashboard"])
    quote = agent_ns["inspire_quote_identifier"]
    base_ref = ".".join(quote(part) for part in SOURCE.split("."))
    assert "__candidate" not in stored, stored
    assert base_ref in stored, stored
