"""REQ-373 (decision D): the person's join pairs are the required keys of a build. A use case over a joined group carries the pairs
into its Genie spec and prompt rule; a build statement that joins the linked tables on other keys is refused; no pair, no change.
Each test fails before this change."""
from v120_artifacts_support import CapturingLogger

CHILD, PARENT, OTHER = "main.sales.orders", "main.sales.customers", "main.sales.returns"
PAIR = (CHILD, "customer_id", PARENT, "customer_id")


def _inst(ns):
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    return inst


def test_a_build_join_on_other_keys_is_refused_with_the_keys_the_person_linked(agent_ns):
    cells = [("cell 3", "df = spark.sql('SELECT * FROM main.sales.orders o JOIN main.sales.customers c ON o.region = c.region')")]
    problems = agent_ns["implement_join_key_problems"](cells, [PAIR])
    assert len(problems) == 1 and "cell 3 joins main.sales.orders and main.sales.customers on other keys" in problems[0]
    assert "customer_id = customer_id" in problems[0]


def test_a_build_join_on_the_linked_keys_passes_in_either_order_and_with_aliases(agent_ns):
    check = agent_ns["implement_join_key_problems"]
    ok = "SELECT * FROM main.sales.orders AS o JOIN main.sales.customers AS c ON c.customer_id = o.customer_id"
    assert check([("cell 1", ok)], [PAIR]) == []
    assert check([("cell 1", "SELECT * FROM main.sales.orders JOIN main.sales.customers ON customer_id = customer_id")], [PAIR]) == []


def test_a_build_that_does_not_join_the_linked_tables_is_not_judged_by_the_pair(agent_ns):
    cells = [("cell 1", "SELECT COUNT(*) FROM main.sales.orders"), ("cell 2", "SELECT * FROM main.sales.returns r JOIN main.sales.orders o ON r.id = o.id")]
    assert agent_ns["implement_join_key_problems"](cells, [PAIR]) == [], "a pair is judged only where both its tables are joined"


def test_no_joined_pair_means_no_build_check_and_no_prompt_rule(agent_ns):
    cells = [("cell 1", "SELECT * FROM main.sales.orders o JOIN main.sales.customers c ON o.region = c.region")]
    assert agent_ns["implement_join_key_problems"](cells, []) == []
    assert agent_ns["genie_joined_keys_rule"]([]) == ""


def test_the_prompt_rule_names_each_pair_as_the_join_the_build_must_use(agent_ns):
    rule = agent_ns["genie_joined_keys_rule"]([PAIR])
    assert f"{CHILD}.customer_id = {PARENT}.customer_id" in rule
    assert "LEFT join" in rule and "A join on other keys is refused" in rule


def test_a_use_case_over_a_joined_group_carries_the_pairs_and_one_outside_it_carries_none(agent_ns, monkeypatch):
    inst = _inst(agent_ns)
    inst.discovery_evidence = {"joined_datasets": [{"status": "joined", "label": f"{PARENT} + {CHILD}", "joins": [PAIR]}]}
    tables = {"over": [CHILD, PARENT], "outside": [OTHER]}
    inst._genie_involved_tables = lambda use_case: tables[use_case["name"]]
    assert inst._genie_joins({"name": "over"}) == [PAIR], "the spec of a use case over the group carries the pair"
    assert inst._genie_joins({"name": "outside"}) == [], "a use case outside the group has no pair"


def test_a_per_table_record_without_a_join_carries_no_pair(agent_ns):
    inst = _inst(agent_ns)
    inst.discovery_evidence = {"joined_datasets": [{"status": "per_table", "reason": "the join fans out"}]}
    inst._genie_involved_tables = lambda use_case: [CHILD, PARENT]
    assert inst._genie_joins({}) == []
