from v120_genie_support import build_inspire

SALES = "inspire_kinds_rc7._inspire.sales_transactions"
STORES = "main.x.store_locations"


def _inst(agent_ns):
    inst = build_inspire(agent_ns)
    inst._implement_builder = lambda: "builder@example.com"
    inst._implement_mvp_dirs = lambda uc, key: {"use_case": "/W/acme/session_5150/sales/N01-U01", "mvp": "/W/acme/session_5150/sales/N01-U01/mvp",
                                                 "version": f"/W/acme/session_5150/sales/N01-U01/mvp/v{key[2]}"}
    columns = {SALES: ["franchise", "TotalPrice", "transaction_id"], STORES: ["store_id", "city"]}
    inst._implement_scope_columns = lambda table: columns.get(table, [])
    return inst


def test_a_generated_builds_app_settings_carry_every_source_table_with_its_columns(agent_ns):
    inst = _inst(agent_ns)
    use_case = {"Name": "Plan Weekly Product Supply", "Tables Involved": f"{STORES}", "Primary Table": SALES}
    context = {"uc_id": "N05-U02", "key": (5150, "N05-U02", 3), "use_case": use_case, "job_id": 77, "spec": {"outputs": {"app_access": "sp"}}, "urls": {},
               "app_host": {"name": "supply-desk-ab12", "merged": False}}
    core = type("Core", (), {"SETTINGS_VERSION": 2})
    written = inst._implement_app_settings(context, {"shell_core": core}, {"id": "n05_u02"}, None, "off", {"app_access": "sp"})
    assert written["scope_sources"] == [{"table": STORES, "columns": ["store_id", "city"]},
                                        {"table": SALES, "columns": ["franchise", "TotalPrice", "transaction_id"]}]
