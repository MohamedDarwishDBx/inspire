"""REQ-373 (decision D, persisted): the person's join pairs are the required keys of a build. A use case's saved table_joins carry
its person pairs with the discovery results, so a build in a later run reads them too. A build statement that joins the linked
tables on other keys is refused through the existing per-round check. A session without person joins is unchanged.
Each test fails before this change."""
import json
import pathlib
import threading
from collections import defaultdict

from v120_artifacts_support import CapturingLogger

CHILD, PARENT, OTHER = "main.sales.orders", "main.sales.customers", "main.sales.returns"
PAIR = (CHILD, "customer_id", PARENT, "customer_id")
NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


def _inst(ns):
    cls = ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    return inst


def _saved(person=True):
    joins = [{"table": CHILD, "column": "customer_id", "ref_table": PARENT, "ref_column": "customer_id",
              "source": "person" if person else "declared", "confidence": 1.0},
             {"table": CHILD, "column": "region_id", "ref_table": OTHER, "ref_column": "region_id", "source": "declared", "confidence": 1.0}]
    return json.dumps(joins)


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


def test_a_build_in_a_later_run_gets_the_pairs_saved_with_its_use_case(agent_ns):
    """The use case comes back from the tracking row: no discovery run, no loader. Its saved table_joins (JSON text) carry the pair."""
    inst = _inst(agent_ns)
    inst.data_loader = None
    row_use_case = {"No": "AI-01-U01", "table_joins": _saved()}
    assert inst._genie_joins(row_use_case) == [PAIR]


def test_a_session_without_person_joins_carries_no_pair(agent_ns):
    inst = _inst(agent_ns)
    inst.data_loader = None
    assert inst._genie_joins({"No": "AI-01-U02", "table_joins": _saved(person=False)}) == []
    assert inst._genie_joins({"No": "AI-01-U03"}) == [], "a use case saved before joins existed carries none"


def test_discovery_saves_a_person_join_with_source_person_and_a_declared_key_as_declared(agent_ns):
    """The table_joins written at discovery: the person's join is marked person, so the build can tell it from a declared key."""
    cls = agent_ns["DataLoader"]
    loader = cls.__new__(cls)
    loader.logger = CapturingLogger()
    loader._metadata_lock = threading.RLock()
    loader.foreign_key_graph = defaultdict(list)
    loader._inferred_fk = {}
    loader._person_relations = []
    loader._person_fk = set()
    loader._column_tags = {}
    loader.set_person_relationships(agent_ns["parse_person_relationships"](json.dumps(
        [{"from": {"table": CHILD, "column": "customer_id"}, "to": {"table": PARENT, "column": "customer_id"}}])))
    loader.foreign_key_graph[tuple(p.lower() for p in CHILD.split("."))].append(
        tuple(p.lower() for p in CHILD.split(".")) + ("region_id",) + tuple(p.lower() for p in OTHER.split(".")) + ("region_id",))
    inst = _inst(agent_ns)
    inst.data_loader = loader
    inst._genie_involved_tables = lambda use_case: [CHILD, PARENT, OTHER]
    saved = {(j["ref_table"], j["source"]) for j in inst._use_case_table_joins({})}
    assert (PARENT, "person") in saved and (OTHER, "declared") in saved


def test_a_refused_build_join_reaches_the_existing_per_round_check_as_one_more_problem(agent_ns):
    """_implement_cell_problems is the round's check: the join refusal is returned in the same list as the other build problems, so
    it takes the same path (the round's feedback to Genie, then the round's retry), and no new retry is added."""
    inst = _inst(agent_ns)
    cells = [("cell 1", "SELECT * FROM main.sales.orders o JOIN main.sales.customers c ON o.region = c.region")]
    inst._implement_genie_cells = lambda path, why: cells
    problems = inst._implement_cell_problems("/Workspace/nb", joins=[PAIR])
    assert any("joins main.sales.orders and main.sales.customers on other keys" in p for p in problems)
    assert all("other keys" not in p for p in inst._implement_cell_problems("/Workspace/nb", joins=[])), "no pair, no join refusal"


def test_the_round_passes_the_spec_pairs_to_the_check(agent_ns):
    """The round's caller reads the pairs from the Genie spec it built, so the refusal works in every round."""
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    source = "".join("".join(cell["source"]) for cell in nb["cells"])
    assert 'joins=spec_nb.get("joins")' in source, "the check call passes the spec's pairs"
    assert '"joins": self._genie_joins(use_case),' in source, "the Genie spec carries the use case's pairs"
