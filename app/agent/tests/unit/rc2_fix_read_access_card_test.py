"""REQ-211: the Build card's read-access state lists only the grants the audience really lacks.

The user-authorization build recorded every grant the audience could need on the App-owned views as unread, whether or not it was held
or had just been granted. The card (asset_status.app.unread) and the App's settings then said "needs read access" for an App that reads.
The record is now read after the grant step from each view's privileges (group grants count), so a held grant is not listed and a real
gap still is.
"""
import logging

VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope"
AMR = "audience.person@example.com"
HELD_ROWS = [
    {"level": "catalog", "privilege": "USE CATALOG", "principal": AMR, "mine": "false"},
    {"level": "schema", "privilege": "USE SCHEMA", "principal": AMR, "mine": "false"},
    {"level": "table", "privilege": "SELECT", "principal": AMR, "mine": "false"},
    {"level": "table", "privilege": "READ METADATA", "principal": AMR, "mine": "false"},
    {"level": "table", "privilege": "OWNER", "principal": "Inspire", "mine": "false"},
]
NOTHING_HELD_ROWS = [{"level": "table", "privilege": "OWNER", "principal": "Inspire", "mine": "false"}]


def _obj(agent_ns, rows):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.logger = logging.getLogger("rc2-fix-read-access-card")
    obj._implement_access_rows = lambda view: rows
    obj._implement_principal_groups = lambda name: []
    return obj


AUDIENCE = [{"type": "user", "name": AMR}]


def test_a_grant_held_on_the_view_is_not_listed_as_unread(agent_ns):
    obj = _obj(agent_ns, HELD_ROWS)
    assert obj._implement_app_audience_unread([VIEW], AUDIENCE) == {}, \
        "the audience holds every read grant on the view, so the card must not say the App needs read access"


def test_a_real_denial_is_still_listed(agent_ns):
    obj = _obj(agent_ns, NOTHING_HELD_ROWS)
    unread = obj._implement_app_audience_unread([VIEW], AUDIENCE)
    assert set(unread) == {VIEW}
    assert f"GRANT SELECT ON TABLE" in " ".join(unread[VIEW]["grants"]) and f"TO `{AMR}`" in " ".join(unread[VIEW]["grants"]), \
        "a principal that cannot read the view keeps its grant in the record"
    assert unread[VIEW]["owner"] == "Inspire"


def test_a_view_whose_privileges_cannot_be_read_lists_every_grant(agent_ns):
    obj = _obj(agent_ns, None)
    unread = obj._implement_app_audience_unread([VIEW], AUDIENCE)
    assert unread[VIEW]["grants"], "Inspire cannot show the grants are held, so they are listed rather than dropped"


def test_a_group_that_holds_the_grant_counts_as_held(agent_ns):
    obj = _obj(agent_ns, [{"level": "table", "privilege": "OWNER", "principal": "Inspire", "mine": "false"},
                          {"level": "catalog", "privilege": "USE CATALOG", "principal": "viewers", "mine": "false"},
                          {"level": "schema", "privilege": "USE SCHEMA", "principal": "viewers", "mine": "false"},
                          {"level": "table", "privilege": "SELECT", "principal": "viewers", "mine": "false"},
                          {"level": "table", "privilege": "READ METADATA", "principal": "viewers", "mine": "false"}])
    obj._implement_principal_groups = lambda name: ["viewers"]
    assert obj._implement_app_audience_unread([VIEW], AUDIENCE) == {}


def test_the_user_path_records_the_real_gaps_not_every_grant(agent_ns):
    """Closing grep (the defect class): no user-authorization read record is built from every grant an audience could need."""
    import json
    from pathlib import Path
    notebook = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
    source = "\n".join("".join(c["source"]) for c in json.loads(notebook.read_text(encoding="utf-8"))["cells"] if c.get("cell_type") == "code")
    assert "user_reads = {view:" not in source, "user_reads must come from _implement_app_audience_unread"
    assert "self._implement_app_audience_unread(views, audience)" in source
