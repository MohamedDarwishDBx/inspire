"""REQ-408: the agent notebook's dialog choke point (implement_permission_entry) asks at schema level, with the same rule and fixture as
backend/lib/grantScope.js. The notebook's cell 1 is read and only the grant helpers are run, so the test needs no Spark.
"""
import ast
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve()
NOTEBOOK = HERE.parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"
FIXTURE = HERE.parents[3] / "backend" / "test" / "support" / "grantScopeCases.json"


def notebook_helpers():
    cell = json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"][1]
    tree = ast.parse("".join(cell["source"]))
    names = {"inspire_coarse_grants", "implement_permission_entry", "INSPIRE_GRANT_LINE", "INSPIRE_UC_NAME_PART", "INSPIRE_UC_NAME_SHAPE",
             "INSPIRE_READ_PRIVILEGES"}
    keep = [n for n in tree.body
            if (isinstance(n, ast.FunctionDef) and n.name in names)
            or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in names for t in n.targets))]
    namespace = {"re": re}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(NOTEBOOK), "exec"), namespace)
    return namespace


def test_the_notebook_normaliser_matches_the_shared_fixture_for_every_case():
    ns = notebook_helpers()
    for case in json.loads(FIXTURE.read_text()):
        assert ns["inspire_coarse_grants"](case["input"], case["wholeCatalogs"]) == case["expected"], case["name"]


def test_a_notebook_dialog_entry_asks_for_the_schema_and_keeps_write_grants_exact():
    ns = notebook_helpers()
    p = "`app-sp`"
    entry = ns["implement_permission_entry"]("app-sp", [f"GRANT SELECT ON TABLE `c`.`s`.`t1` TO {p}", f"GRANT SELECT ON TABLE `c`.`s`.`t2` TO {p}",
                                                 f"GRANT MODIFY ON TABLE `c`.`s`.`out` TO {p}"], "why")
    assert entry["statements"] == [f"GRANT SELECT ON SCHEMA `c`.`s` TO {p}", f"GRANT MODIFY ON TABLE `c`.`s`.`out` TO {p}"]
    assert entry["principal"] == "app-sp" and entry["why"] == "why"


def test_a_lakebase_statement_with_double_quotes_is_not_coarsened():
    ns = notebook_helpers()
    pg = 'GRANT SELECT ON TABLE "app"."orders", "app"."items" TO "client_id"'
    assert ns["inspire_coarse_grants"]([pg]) == [pg]
