"""The Use cases siblings: one shared filter in shell_sql gives the deploy-time list and the runtime read, and the App falls back to the deploy list."""
import os
import sys
import types

import pytest

SERVER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

ROWS = [
    {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
    {"use_case_id": "N04-U05", "app_name": "this-desk", "app_url": "https://this.example.com/"},
    {"use_case_id": "N06-U01", "app_name": "third-desk", "app_url": "http://insecure.example.com/"},
    {"use_case_id": "N07-U03", "app_name": "", "app_url": "https://seventh.example.com/"},
    {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
    "not a row",
]


def test_the_siblings_are_the_other_published_apps_and_never_this_use_case():
    assert shell_sql.sibling_items(ROWS, ["N04-U05"]) == [
        {"use_case_id": "N05-U02", "name": "second-desk", "url": "https://second.example.com/"},
        {"use_case_id": "N07-U03", "name": "N07-U03", "url": "https://seventh.example.com/"},
    ]
    assert shell_sql.sibling_items(None, ["N04-U05"]) == []


def test_the_siblings_query_reads_the_ready_apps_of_the_implement_table():
    sql = shell_sql.siblings_query("main.inspire.__inspire_implement")
    assert "FROM `main`.`inspire`.`__inspire_implement`" in sql and "`status` = 'ready'" in sql and "`app_url` IS NOT NULL" in sql
    with pytest.raises(ValueError):
        shell_sql.siblings_query("inspire.__inspire_implement")


class _Shell:
    def __init__(self, settings, rows=None, fail=False):
        self.settings = settings
        self.pages = [{"use_case_id": "N04-U05"}]
        self.rows, self.fail = rows, fail

    def session(self, headers):
        return "ws", "who"

    def run(self, ws, who, sql, params, limit, ttl=0, queued=False):
        if self.fail:
            raise RuntimeError("no read")
        return {"rows": self.rows}


def test_the_runtime_read_wins_when_the_table_is_readable_and_the_deploy_list_is_the_fallback():
    deploy = [{"use_case_id": "N05-U02", "name": "old", "url": "https://old.example.com/"}]
    settings = {"siblings": deploy, "siblings_table": "main.inspire.__inspire_implement"}
    live = _Shell(settings, rows=ROWS)
    assert [s["use_case_id"] for s in shell_core.Shell.siblings(live, {})] == ["N05-U02", "N07-U03"]
    assert shell_core.Shell.siblings(_Shell(settings, fail=True), {}) == deploy
    assert shell_core.Shell.siblings(_Shell({"siblings": deploy}), {}) == deploy


class _SiblingRow:
    def __init__(self, values):
        self.values = values

    def asDict(self):
        return dict(self.values)


class _SiblingSpark:
    """Records the SQL the agent runs; answers with the implement rows of the other use cases."""

    def __init__(self, rows):
        self.rows, self.sql_text = rows, []

    def sql(self, text, args=None):
        self.sql_text.append(text)
        rows = [_SiblingRow(row) for row in self.rows]

        class _Result:
            def collect(self_inner):
                return rows
        return _Result()


def test_the_agent_reads_the_siblings_from_the_implement_table_through_the_table_helper(agent_ns):
    """REQ-011 / REQ-354: the agent has no implement_table attribute (only the step writer has one), so reading it through the attribute
    returned an empty sibling list on every run and the App's use-case dropdown was always empty. The read goes through _implement_table_sql."""
    cls = agent_ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.inspire_database = "cat.db"
    obj.logger = agent_ns["logging"].getLogger("siblings-test")
    obj.spark = _SiblingSpark([{"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
                               {"use_case_id": "N04-U05", "app_name": "this-desk", "app_url": "https://this.example.com/"}])
    assert not hasattr(obj, "implement_table")
    modules = {"shell_sql": types.SimpleNamespace(sibling_items=lambda rows, ucs: [r for r in rows if r["use_case_id"] not in ucs])}
    items = obj._implement_siblings({"uc_id": "N04-U05"}, modules)
    assert items == [{"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"}]
    assert len(obj.spark.sql_text) == 1
    assert f"FROM {obj._implement_table_sql()} " in obj.spark.sql_text[0] and "__inspire_implement" in obj._implement_table_sql()
    assert "__inspire_usecases" not in obj.spark.sql_text[0]
