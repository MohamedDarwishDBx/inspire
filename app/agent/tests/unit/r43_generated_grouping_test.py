"""R43: a generated notebook with a non-"all" Grouping runs the one-value check without a NameError.

The generated notebook gets only the inlined sources (REDACT_SOURCE, the shell facts and IMPLEMENT_RESULT_HISTORY_SOURCE). The
Launch-scope one-value count used to call DatabricksInspire, which exists only in the agent, so every such run stopped with
"could not be checked for one value". This test execs the inlined sources the way a generated notebook does and runs the check.
"""
import pytest

from v207_app_reads_after_build_test import _inlined

pd = pytest.importorskip("pandas")


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class _LaunchSession:
    """Answers the one-value COUNT(DISTINCT ...) for the column named in the statement; anything else is refused."""

    def __init__(self, distinct):
        self.distinct, self.statements = distinct, []

    def sql(self, statement):
        self.statements.append(" ".join(str(statement).split()))
        for column, count in self.distinct.items():
            if f"`{column}`" in statement:
                return _Rows([{"distinct_values": count}])
        raise AssertionError(f"unexpected statement: {statement}")


def _generated(agent_ns):
    notebook = {"__name__": "generated"}
    exec(compile(_inlined(agent_ns), "<generated>", "exec"), notebook)
    return notebook


def test_a_generated_notebook_checks_one_value_for_a_non_all_grouping_without_a_name_error(agent_ns):
    notebook = _generated(agent_ns)
    frame = pd.DataFrame({"region": ["north", "south", "east"], "channel": ["web", "web", "web"]})
    session = _LaunchSession({"region": 3, "channel": 1})
    group_launch = {"session": session, "table": "main.sales.orders", "passed": ["region", "channel"], "joins": {}}
    held = notebook["inspire_group_one_value_held"](frame, ["region", "channel"], None, group_launch)
    assert held == ["channel"], "channel holds one value in the Launch scope, region does not"
    assert len(session.statements) == 2 and all("COUNT(DISTINCT" in s for s in session.statements)


def test_a_generated_notebook_refuses_a_one_value_count_that_fails_twice_instead_of_passing_it(agent_ns):
    notebook = _generated(agent_ns)

    class Broken(_LaunchSession):
        def sql(self, statement):
            raise RuntimeError("warehouse stopped")

    frame = pd.DataFrame({"region": ["north", "south"]})
    group_launch = {"session": Broken({}), "table": "main.sales.orders", "passed": ["region"], "joins": {}}
    with pytest.raises(RuntimeError, match="could not count the values of region"):
        notebook["inspire_group_one_value_held"](frame, ["region"], None, group_launch)
