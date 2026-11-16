"""Saved threads: one companion table per use case, rows per person, grouped into threads (fail-pre/pass-post)."""
import os
import sys

SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_agent  # noqa: E402
import shell_core  # noqa: E402
import shell_sql  # noqa: E402

PAGE = {"id": "p", "use_case_id": "uc1", "result_table": "main.loss.out"}


def test_the_threads_live_in_their_own_companion_table_of_the_result_table():
    assert shell_sql.threads_table(PAGE) == "`main`.`loss`.`out_agent_threads`"


def test_the_first_save_creates_the_table_and_the_second_does_not():
    calls = {"ddl": 0, "writes": 0}

    class Stub:
        def __init__(self):
            self.created = False

        def write_saved(self, ws, table, sql, params):
            calls["writes"] += 1
            if not self.created:
                raise shell_core.HttpError(409, "[TABLE_OR_VIEW_NOT_FOUND] " + table)

        def decision_writer(self, ws):
            return "writer"

        def execute(self, writer, sql, params, limit, delta=False):
            calls["ddl"] += 1
            assert sql.startswith("CREATE TABLE IF NOT EXISTS") and writer == "writer"
            self.created = True
            return {"rows": []}

    stub = Stub()
    sql, params = shell_sql.thread_event_write(PAGE, "ana@corp.example", "t" * 32, "Q", "A", "[]")
    shell_core.Shell.save_thread_row(stub, None, PAGE, sql, params)
    assert calls == {"ddl": 1, "writes": 2}, "the first save creates the table, then writes"
    shell_core.Shell.save_thread_row(stub, None, PAGE, sql, params)
    assert calls == {"ddl": 1, "writes": 3}, "the second save writes without creating it again"


def test_the_publish_does_not_create_it_and_the_save_no_longer_refuses_a_missing_table():
    import inspect
    source = inspect.getsource(shell_core.Shell.agent_thread_save)
    assert "409" not in source and "does not exist yet" not in source


def test_a_saved_turn_writes_its_own_person_and_thread_as_parameters_not_text():
    sql, params = shell_sql.thread_event_write(PAGE, "ana@corp.example", "t" * 32, "Why?", "Because", "[]")
    assert "INSERT INTO" in sql and "current_timestamp()" in sql
    values = {p["value"] for p in params}
    assert "ana@corp.example" in values and "Why?" in values
    assert "ana@corp.example" not in sql, "the person is a parameter, never spliced into the SQL"


def test_a_person_reads_only_their_own_turns_of_this_use_case():
    sql, params = shell_sql.thread_events_query(PAGE, "ana@corp.example")
    assert "`person` = :p" in sql and "`use_case_id` = :p" in sql
    assert {p["value"] for p in params} == {"uc1", "ana@corp.example"}


def test_threads_group_turns_newest_thread_first_with_the_first_question_as_the_title():
    rows = [
        {"event_id": "1", "thread_id": "a", "question": "First?", "answer": "A1", "blocks": "[]", "changed_at": "2026-11-01"},
        {"event_id": "2", "thread_id": "b", "question": "Other", "answer": "B1", "blocks": '[{"type":"text"}]', "changed_at": "2026-11-05"},
        {"event_id": "3", "thread_id": "a", "question": "Follow up", "answer": "A2", "blocks": "[]", "changed_at": "2026-11-02"},
    ]
    threads = shell_sql.threads_of(rows)
    assert [t["thread_id"] for t in threads] == ["b", "a"]
    assert threads[1]["title"] == "First?"
    assert [t["question"] for t in threads[1]["turns"]] == ["First?", "Follow up"]
    assert threads[0]["turns"][0]["blocks"] == [{"type": "text"}]


def test_a_broken_block_field_opens_as_no_blocks_not_a_crash():
    rows = [{"event_id": "1", "thread_id": "a", "question": "Q", "answer": "A", "blocks": "not json", "changed_at": "x"}]
    assert shell_sql.threads_of(rows)[0]["turns"][0]["blocks"] == []


def test_the_turn_records_the_question_it_answers():
    turn = shell_agent.Turn("who", "p")
    assert turn.question == ""
    turn.question = "Tell me what to do"
    assert turn.question == "Tell me what to do"
