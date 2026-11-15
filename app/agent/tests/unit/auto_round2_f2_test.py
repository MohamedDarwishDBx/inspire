# AUTO round 2 (F2): the App's read list, the owner matched by id, and the builder's grants on every object the build created.
import logging
from types import SimpleNamespace

SCHEMA = "main.inspire"
SOURCE = "main.s.sales_transactions"
SCOPE_VIEW = "main.inspire.sales_transactions__scope"
VIEW = "main.inspire.n01_u01_results__signal"
BUILDER = "builder@example.com"
OWNER = "owner@example.com"
OWNER_ID = "b2b3b070-1da5-45c3-b5b6-81a2feaf85bb"
OWNER_ROWS = [
    {"level": "catalog", "privilege": "OWNER", "principal": OWNER_ID, "mine": "false", "me": OWNER},
    {"level": "schema", "privilege": "OWNER", "principal": OWNER_ID, "mine": "false", "me": OWNER},
    {"level": "table", "privilege": "OWNER", "principal": OWNER_ID, "mine": "false", "me": OWNER},
]


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        return None


def _page(sql):
    return {"id": "n01_u01", "datasets": [{"name": "records", "sql": sql}]}


def test_a_user_app_lists_no_use_case_source_it_only_reads_through_its_genie_space(agent_ns):
    # The deployed App reads its scope views; its Genie space names only those views (rc7 evidence). The use case's sources are not
    # direct reads of the App, so they must not be recorded as read directly (REQ-301).
    page = _page(f"SELECT * FROM {SCOPE_VIEW}")
    read = agent_ns["implement_app_read_list"](page, [page], [SOURCE], True, True)
    assert SOURCE not in read


def test_a_service_principal_app_keeps_its_genie_grants_on_every_use_case_source(agent_ns):
    page = _page(f"SELECT * FROM {SCOPE_VIEW}")
    read = agent_ns["implement_app_read_list"](page, [page], [SOURCE], True, False)
    assert SOURCE in read


def test_a_dataset_that_reads_a_source_directly_in_user_mode_is_refused_before_deploy(agent_ns):
    # The check that makes "reads through its view" a rule, not a prompt hope: a raw source read survives the rewrite and blocks.
    page = _page(f"SELECT * FROM {SOURCE}")
    assert agent_ns["implement_app_raw_reads"]([page], {}, (), [SOURCE]) == [SOURCE]


def test_the_access_plan_recognises_the_owner_by_identity_id_as_well_as_by_email(agent_ns):
    plan = agent_ns["implement_access_plan"](SCOPE_VIEW, OWNER_ROWS, OWNER, agent_ns["IMPLEMENT_SOURCE_NEEDS"], aliases=[OWNER_ID])
    assert plan["grants"] == [] and plan["gaps"] == [], "the owner needs no grant on the object she owns"


def test_the_build_audience_check_matches_the_owner_by_directory_id_not_by_email(agent_ns):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = FakeSpark()
    obj.logger = logging.getLogger("auto-round2")
    obj.w_client = SimpleNamespace(
        users=SimpleNamespace(list=lambda filter=None, **_: [SimpleNamespace(id=OWNER_ID)]),
        service_principals=SimpleNamespace(list=lambda filter=None, **_: []),
    )
    obj._implement_access_rows = lambda view: OWNER_ROWS
    assert obj._implement_app_audience_unread([SCOPE_VIEW], [{"type": "user", "name": OWNER}]) == {}


def test_the_builder_gets_select_and_read_metadata_on_every_object_the_build_created(agent_ns):
    obj = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    obj.spark = FakeSpark()
    obj.logger = logging.getLogger("auto-round2")
    obj._implement_builder = lambda: BUILDER
    ran = []
    assert obj._implement_builder_object_grants([VIEW], ran) == []
    statements = obj.spark.statements
    assert any(s.startswith("GRANT SELECT ON TABLE") and s.endswith(f"TO `{BUILDER}`") for s in statements), statements
    assert any(s.startswith("GRANT READ METADATA ON TABLE") and s.endswith(f"TO `{BUILDER}`") for s in statements), statements
