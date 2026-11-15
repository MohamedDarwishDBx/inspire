import json

from v142_genie_test import COLUMNS, LATEST, ORDERS, RESULT, _rich_space

SCOPED = {"scope": "records", "key": "records:0123456789abcdef",
          "text": "1,000 records of main.s.trips spread across the whole table, picked by a stable hash of each record"}
RUN_TABLES = [{"table": "main.s.trips", "rows": 1000, "rows_total": 21932}]


class _Frame:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class _Spark:
    def __init__(self, rows):
        self.rows, self.statements = rows, []

    def sql(self, text):
        self.statements.append(text)
        return _Frame(self.rows)


def _columns(*extra):
    return {k.lower(): v for k, v in dict(COLUMNS, **{c: "STRING" for c in extra}).items()}


def _instruction_text(space):
    return "".join(space["instructions"]["text_instructions"][0]["content"])


def test_a_first_run_build_names_the_sample_its_answers_cover_and_how_many_records(agent_ns):
    fact = agent_ns["implement_run_scope_fact"](SCOPED, RUN_TABLES)
    assert fact.startswith("This table is a First run sample, not every record: the latest run covered "
                           "1,000 records of main.s.trips spread across the whole table")
    assert ", which read 1,000 records of main.s.trips." in fact
    assert "Every count, total, average and list in the answer covers those records only." in fact
    assert "Never extrapolate" in fact
    assert not any(ch in fact for ch in "–—"), "no dashes in Genie-facing text"


def test_a_scoped_build_genie_space_carries_the_scope_sentence_and_record_count_once(agent_ns):
    space = _rich_space()
    fact = agent_ns["implement_run_scope_fact"](SCOPED, RUN_TABLES)
    columns = _columns("data_quality_flag", "held_back")
    problems = agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, "", "",
                                                           run_scope=fact)
    agent_ns["implement_genie_space_grounding"](space, columns, RESULT, [RESULT, ORDERS], (), LATEST, "", "", run_scope=fact)
    text = _instruction_text(space)
    assert problems == [] and text.count(fact) == 1
    assert "1,000 records of main.s.trips" in text


def test_a_full_data_build_carries_no_scope_sentence(agent_ns):
    assert agent_ns["implement_run_scope_fact"](None, RUN_TABLES) == ""
    assert agent_ns["implement_run_scope_fact"]({"scope": "all", "text": "all the records"}, RUN_TABLES) == ""
    assert agent_ns["implement_run_scope_fact"]({"scope": "records", "text": ""}, RUN_TABLES) == ""
    space = _rich_space()
    problems = agent_ns["implement_genie_space_grounding"](space, _columns("data_quality_flag", "held_back"), RESULT,
                                                           [RESULT, ORDERS], (), LATEST, "", "", run_scope="")
    assert problems == []
    assert "First run sample" not in _instruction_text(space)


def test_the_latest_run_scope_is_read_from_the_run_log_the_run_wrote(agent_ns):
    row = {"run_segments": json.dumps([{"column": "region", "values": ["EU"]}, SCOPED]), "run_tables": json.dumps(RUN_TABLES)}
    spark = _Spark([row])
    scope, tables = agent_ns["implement_latest_run_scope"](spark, RESULT, "uc-7")
    assert scope == SCOPED and tables == RUN_TABLES
    assert "WHERE use_case_id = 'uc-7'" in spark.statements[0]


def test_a_full_data_run_leaves_no_scope_to_read_and_a_missing_run_log_reads_as_none(agent_ns):
    full = _Spark([{"run_segments": json.dumps([{"column": "region", "values": ["EU"]}]), "run_tables": "[]"}])
    assert agent_ns["implement_latest_run_scope"](full, RESULT, "uc-7") == (None, [])
    assert agent_ns["implement_latest_run_scope"](_Spark([]), RESULT, "uc-7") == (None, [])
