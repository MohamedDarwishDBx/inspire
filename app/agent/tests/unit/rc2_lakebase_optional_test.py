DENIED = "permission denied for database databricks_postgres"
BUILDER = "builder@example.com"


def test_the_lakebase_fallback_grant_is_marked_optional_so_the_build_page_does_not_gate_on_it(agent_ns):
    # REQ-216: the App falls back to Delta with a warning when Lakebase is refused, so its grant entry is optional.
    entry = agent_ns["implement_lakebase_permission_entry"](RuntimeError(DENIED), BUILDER)
    assert entry is not None and entry["statements"], entry
    assert entry.get("optional") is True, entry


def test_a_plain_permission_entry_is_not_optional(agent_ns):
    # The optional flag is set only on the Lakebase fallback entry, never on a grant the person must act on.
    entry = agent_ns["implement_permission_entry"]("app-sp", ["GRANT SELECT ON TABLE a.b.c TO `app-sp`"], "why")
    assert not entry.get("optional")


def test_the_optional_entry_keeps_the_exact_grant_and_the_copy_text(agent_ns):
    entry = agent_ns["implement_lakebase_permission_entry"](RuntimeError(DENIED), BUILDER)
    assert entry["statements"] == [f'GRANT CREATE ON DATABASE databricks_postgres TO "{BUILDER}"']
    assert entry["why"].startswith("Optional: pages load faster with Lakebase. Until then the App reads Delta tables:")
    assert "needs this grant first" not in entry["why"]
