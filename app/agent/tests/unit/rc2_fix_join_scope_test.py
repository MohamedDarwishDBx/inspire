"""REQ-247: a join spec names the tables it joins the way the Genie Agent holds them.

scope_genie_space rewrites every data_sources table of a Genie Agent to its Table Scope view, but it left each join spec's left and
right identifier on the base table. The grounding check then compared the base name with the scope views the space holds, so a join
on a scoped table failed with "not a table of the Genie Agent" on every round.
The join identifiers now go through the same scope map as data_sources. A join to a table the Genie Agent does not hold still fails.
"""
import json

SALES = "inspire_kinds_rc7._inspire.sales_transactions"
CUSTOMERS = "inspire_kinds_rc7._inspire.sales_customers"
UNRELATED = "inspire_kinds_rc7._inspire.sales_regions"
SALES_COLUMNS = ["sales_id", "customer_id", "amount"]
CUSTOMER_COLUMNS = ["customer_id", "name"]


class FakeSpark:
    def __init__(self):
        self.statements = []

    def sql(self, statement):
        self.statements.append(statement)
        return self


def _scopes(agent_ns):
    return agent_ns["parse_table_scopes"](json.dumps({SALES: {"columns": SALES_COLUMNS}}), "inspire_kinds_rc7._inspire",
                                          view_tag="uc_a")


def _space(left=SALES, right=CUSTOMERS, tables=(SALES, CUSTOMERS)):
    join = {"left": {"identifier": left, "alias": "sales"}, "right": {"identifier": right, "alias": "customers"},
            "sql": ["`sales`.`customer_id` = `customers`.`customer_id`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"]}
    return {"data_sources": {"tables": [{"identifier": t} for t in tables]},
            "instructions": {"join_specs": [join]}, "config": {}}


def _grounded_problems(agent_ns, space, view_columns):
    """The grounding check the way implement_genie_space_grounding runs it, on the space after scope_genie_space.

    view_columns maps each table identifier the space holds (lowercase) to its columns."""
    plain = agent_ns["_implement_plain_table"]
    tables = {plain(t["identifier"]).lower(): plain(t["identifier"]) for t in space["data_sources"]["tables"]}
    real = {key: {c.lower(): (c, "string", "") for c in view_columns.get(key, [])} for key in tables}
    aliases = agent_ns["implement_genie_aliases"](list(tables.values()))
    return agent_ns["_implement_genie_join_problems"](space["instructions"], tables, real,
                                                      {k: aliases[k] for k in tables}, list(tables))


def test_join_spec_on_a_base_table_whose_scope_view_the_genie_agent_holds_passes(agent_ns):
    scopes = _scopes(agent_ns)
    space = agent_ns["scope_genie_space"](_space(), FakeSpark(), scopes)
    view = next(iter(scopes.values()))["view"]
    assert space["data_sources"]["tables"][0]["identifier"] == view
    assert space["instructions"]["join_specs"][0]["left"]["identifier"] == view, "the join names the scope view the space holds"
    columns = {view.lower(): SALES_COLUMNS, CUSTOMERS.lower(): CUSTOMER_COLUMNS}
    assert _grounded_problems(agent_ns, space, columns) == []


def test_join_spec_on_a_table_the_genie_agent_does_not_hold_still_fails(agent_ns):
    """Must-exclude: a join to a table outside the Genie Agent's tables is refused, whether or not the other side is scoped."""
    scopes = _scopes(agent_ns)
    space = agent_ns["scope_genie_space"](_space(right=UNRELATED), FakeSpark(), scopes)
    view = next(iter(scopes.values()))["view"]
    problems = _grounded_problems(agent_ns, space, {view.lower(): SALES_COLUMNS, CUSTOMERS.lower(): CUSTOMER_COLUMNS})
    assert any(f"a join spec joins {UNRELATED}, which is not a table of the Genie Agent" == p for p in problems), problems


def test_join_spec_between_unscoped_tables_is_unchanged(agent_ns):
    """Must-exclude: a table with no Table Scope keeps its name; the rewrite only maps scoped tables."""
    space = agent_ns["scope_genie_space"](_space(left=CUSTOMERS, right=UNRELATED, tables=(CUSTOMERS, UNRELATED)), FakeSpark(),
                                          _scopes(agent_ns))
    join = space["instructions"]["join_specs"][0]
    assert (join["left"]["identifier"], join["right"]["identifier"]) == (CUSTOMERS, UNRELATED)
