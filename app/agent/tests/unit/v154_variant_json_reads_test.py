# v1.5.4 (lane U6): the get_json_object reads in shell_sql.py. get_json_object takes a STRING, so each read is correct only while its
# column is declared STRING where the code creates it. These tests pin those declarations and the reads the built SQL makes. If one
# column moves to VARIANT, the test fails and the read must switch to the colon path (CAST(col:path AS STRING)) in the same change.
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts  # noqa: E402
import shell_sql  # noqa: E402

NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
PAGE = {"result_table": "main.inspire.churn_out", "use_case_id": "U1", "session_id": "7", "inspire_database": "main.inspire"}


def _notebook_source():
    with open(NOTEBOOK, encoding="utf-8") as fh:
        return "\n".join("".join(cell.get("source", [])) for cell in json.load(fh)["cells"])


def test_action_batch_values_is_declared_string_and_the_batch_and_undo_reads_use_get_json_object():
    assert shell_sql.ACTION_TYPES[shell_facts.BATCH_VALUES] == "STRING"
    sql, _ = shell_sql.batches_query(PAGE)
    assert f"get_json_object(`{shell_facts.BATCH_VALUES}`, '$.{shell_facts.UNDO_KEY}')" in sql


def test_run_facts_is_declared_string_and_the_ahead_stamp_read_uses_get_json_object():
    assert shell_facts.FACTS_COLUMN == "run_facts"
    sql, _ = shell_sql.changed_ahead_query(PAGE)
    assert "get_json_object(z.`run_facts`, '$.stamp_us')" in sql


def test_value_assumptions_and_run_facts_are_declared_string_in_the_notebook_that_writes_them():
    source = _notebook_source()
    assert '("value_assumptions", "STRING")' in source, "value_assumptions must stay STRING: get_json_object reads it"
    assert '(INSPIRE_RUN_FACTS, "STRING")' in source, "run_facts must stay STRING: get_json_object reads it"


def test_every_get_json_object_in_shell_sql_reads_a_column_declared_string():
    text = open(os.path.join(SERVER, "shell_sql.py"), encoding="utf-8").read()
    reads = set(re.findall(r"get_json_object\(\s*(?:z\.|s\.)?`?\{?([A-Za-z_]+)", text))
    assert reads == {"BATCH_VALUES", "RUN_FACTS_COLUMN", "value_assumptions"}, reads

