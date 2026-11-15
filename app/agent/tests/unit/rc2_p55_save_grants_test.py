"""A published App whose viewers sign in as themselves (app_access user) still gets MODIFY on the Settings companion table
(`<result>_assumptions`): a Settings save from a non-protected App is written by the App's service principal. MODIFY is granted
only on that companion table, never on the result table, unless decisions are switched on."""
from v140_implement_test import NO_AUDIENCE, READS, SHELL_FILES, _deploy_inspire, sdk_stub  # noqa: F401
from v142_look_test import DEPLOYED, NEW_APP, _user_context
from v150_app_owners_access_test import GRANT, Catalog

ASSUMPTIONS_MODIFY = GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out_assumptions`")
RESULT_MODIFY = GRANT.format("MODIFY", "TABLE `main`.`inspire`.`churn_out`")

CREATED = {"compute_status": {"state": "ACTIVE"}, "service_principal_client_id": "sp-1"}
READ = dict(CREATED, user_api_scopes=["sql:restricted-query", "genie"])


def _modify_grants(ns, statements):
    """MODIFY grants on the App's own tables, minus the value ledger and the feedback table, which their own steps grant."""
    ledger = ns["inspire_shell_facts"].ledger_table("main.inspire")
    return [s for s in statements if s.startswith("GRANT MODIFY ON TABLE") and ledger not in s and "_feedback" not in s]


def _per_user_deploy(ns, spark, modify=False, decisions=False):
    inst, context, _calls, _imported = _deploy_inspire(ns, NEW_APP + [CREATED, READ, NO_AUDIENCE] + DEPLOYED, access=[])
    inst.spark = spark
    fields = inst._implement_deploy_app(_user_context(ns, context, modify=modify, decisions=decisions), "churn-desk", SHELL_FILES, READS,
                                        "g1", poll_s=0)
    return inst, fields


def test_a_per_user_app_gets_modify_on_the_settings_companion_table_and_never_on_the_result_table(agent_ns, sdk_stub):
    spark = Catalog()
    _inst, fields = _per_user_deploy(agent_ns, spark)
    assert fields["app_url"] == "https://churn-desk.example"
    assert ASSUMPTIONS_MODIFY in spark.statements
    assert _modify_grants(agent_ns, spark.statements) == [ASSUMPTIONS_MODIFY], \
        "the only MODIFY grant is the companion table the Settings save writes; the result table gets MODIFY only for decisions"


def test_a_per_user_app_that_records_decisions_also_gets_modify_on_the_result_table(agent_ns, sdk_stub):
    spark = Catalog()
    _per_user_deploy(agent_ns, spark, decisions=True)
    assert set(_modify_grants(agent_ns, spark.statements)) == {RESULT_MODIFY, ASSUMPTIONS_MODIFY}


def test_a_per_user_app_whose_result_table_has_no_settings_gets_no_companion_grant(agent_ns, sdk_stub):
    spark = Catalog(schema=[("entity_id", "string"), ("units", "bigint")])
    _inst, _fields = _per_user_deploy(agent_ns, spark)
    assert not any("_assumptions" in s for s in spark.statements if s.startswith("GRANT")), \
        "without Settings and without value_at_stake there is no companion table to grant"
    assert _modify_grants(agent_ns, spark.statements) == []
