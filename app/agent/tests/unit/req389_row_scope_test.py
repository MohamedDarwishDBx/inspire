"""REQ-389 (reopened): the scope the person chose is authoritative for the build. W10 build 487177179677073 chose Whole data and
removed the visa chip (spec data.filters = []), but the goal text said "only rows where paymentMethod = visa" and Genie built the
visa filter anyway. The build prompt now states the chosen scope and supersedes the goal's row condition, and the per-cell check
refuses a cell that filters a column or value the chosen scope does not keep. Each test fails before this change."""
import json
import pathlib

from v120_artifacts_support import CapturingLogger

NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"

VISA_GOAL = "Find the customers to win back. Work only on rows where paymentMethod = visa."
WHOLE = {"tables": {}, "removed_tables": [], "filters": [], "column_roles": {}, "window": {}}
KEPT_VISA = {"tables": {}, "removed_tables": [], "column_roles": {}, "window": {},
             "filters": [{"table": "main.sales.orders", "column": "paymentMethod", "op": "=", "values": ["visa"]}]}


def _spec(data, goal=VISA_GOAL):
    return {"use_case": {"goal": goal, "success_measures": []}, "data": data, "config": {}}


def _lines(agent_ns, data):
    return agent_ns["_implement_choice_lines"](_spec(data), True, None)


def test_whole_data_supersedes_the_goal_row_condition_and_says_so(agent_ns):
    lines = _lines(agent_ns, WHOLE)
    goal = [line for line in lines if line.startswith("- Goal:")]
    assert len(goal) == 1 and "superseded" in goal[0], goal
    rule = [line for line in lines if "Whole data" in line]
    assert len(rule) == 1 and "superseded" in rule[0] and "must not be applied" in rule[0]
    others = [line for line in lines if "visa" in line and not line.startswith("- Goal:")]
    assert others == [], "no line other than the goal states the visa condition as a requirement"


def test_a_kept_filter_is_the_only_row_filter_and_the_scope_rule_names_it(agent_ns):
    lines = _lines(agent_ns, KEPT_VISA)
    assert any("Keep only the rows of `main.sales.orders` where `paymentMethod` = 'visa'" in line for line in lines)
    rule = [line for line in lines if line.startswith("- The person's scope is the only row filter")]
    assert len(rule) == 1 and "superseded" in rule[0]


def test_the_scope_is_part_of_every_choice_prompt_once_a_data_step_exists(agent_ns):
    no_data_step = {"use_case": {"goal": VISA_GOAL}, "config": {}}
    lines = agent_ns["_implement_choice_lines"](no_data_step, True, None)
    assert not any("Whole data" in line or "only row filter" in line for line in lines), "a spec without a Data step keeps today's prompt"


def test_a_cell_filtering_a_removed_column_is_refused_with_a_plain_reason(agent_ns):
    cells = [("cell 4", "df = spark.table('main.sales.orders').where(col('paymentMethod') == 'visa')")]
    problems = agent_ns["implement_row_filter_problems"](cells, {})
    assert len(problems) == 1, problems
    assert problems[0].startswith("cell 4 line 1 filters `paymentMethod` to 'visa'"), problems[0]
    assert "does not keep" in problems[0] and "remove this row condition" in problems[0]


def test_a_kept_filter_value_is_allowed_and_another_value_of_it_is_refused(agent_ns):
    check = agent_ns["implement_row_filter_problems"]
    kept = agent_ns["implement_allowed_row_filters"](KEPT_VISA, {})
    assert kept == {"paymentmethod": ["visa"]}
    cells = [("cell 2", "df = spark.table('main.sales.orders').filter(col('paymentMethod') == 'visa')")]
    assert check(cells, kept) == []
    other = [("cell 2", "df = spark.table('main.sales.orders').filter(col('paymentMethod') == 'cash')")]
    assert len(check(other, kept)) == 1


def test_a_sql_where_on_a_removed_column_is_refused_and_a_kept_one_passes(agent_ns):
    check = agent_ns["implement_row_filter_problems"]
    sql = "SELECT customerID, amount FROM main.sales.orders o WHERE o.paymentMethod = 'visa' GROUP BY customerID"
    assert len(check([("cell 3", f"spark.sql(\"{sql}\")")], {})) == 1
    assert check([("cell 3", f"spark.sql(\"{sql}\")")], agent_ns["implement_allowed_row_filters"](KEPT_VISA, {})) == []


def test_whole_data_allows_every_row_and_no_data_step_skips_the_check(agent_ns):
    check = agent_ns["implement_row_filter_problems"]
    whole = agent_ns["implement_allowed_row_filters"](WHOLE, {})
    assert whole == {}
    assert check([("cell 1", "df.where(col('x') == 'y')")], whole) != []
    assert check([("cell 1", "df.where(col('x') == 'y')")], None) == [], "no Data step, no check"
    assert agent_ns["implement_allowed_row_filters"]({"tables": {}}, {}) is None


def test_comparisons_outside_a_row_filter_and_column_to_column_tests_are_not_refused(agent_ns):
    check = agent_ns["implement_row_filter_problems"]
    cells = [("cell 5", "label = 'visa'\nif label == 'visa':\n    print('x')\nrows = df.where(col('a') == col('b'))")]
    assert check(cells, {}) == []


def test_the_build_cell_check_refuses_a_removed_filter_through_the_chosen_scope(agent_ns):
    """Behaviour through the real per-cell check: the build loop's call passes the chosen scope, so a removed filter is refused."""
    cls = agent_ns["DatabricksInspire"]
    inst = cls.__new__(cls)
    inst.logger = CapturingLogger()
    cells = [("cell 4", "df = spark.table('main.sales.orders').where(col('paymentMethod') == 'visa')")]
    inst._implement_genie_cells = lambda path, purpose: cells
    refused = inst._implement_cell_problems("/Workspace/x.ipynb", row_scope={})
    assert any(p.startswith("cell 4 line 1 filters `paymentMethod`") for p in refused), refused
    kept = inst._implement_cell_problems("/Workspace/x.ipynb", row_scope={"paymentmethod": ["visa"]})
    assert not any("filters `paymentMethod`" in p for p in kept), kept


def test_the_build_loop_passes_the_chosen_scope_to_the_cell_check(agent_ns):
    """Wiring: the build loop's per-cell check call carries the scope (the check has a call site, not dead code)."""
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    code = "".join("".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code")
    assert code.count("row_scope=implement_allowed_row_filters(spec.get(\"data\"), INSPIRE_TABLE_SCOPES)") == 1
