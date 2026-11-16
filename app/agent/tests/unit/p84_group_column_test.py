"""REQ-263 (reopened, live rc7 N04-U01, run 9000000000000002): the Grouping the person chose (Data groups = product) reached
inspire_group_records without a product column, and the error that reached Genie hid the column name as "a data value".

(a) A Grouping column must reach inspire_group_records: the grouping rule names each Grouping column as one Genie must keep on
    the records, and a Grouping column that holds one value (a scope filter) is not treated as a constant to drop.
(b) Redaction keeps a column name, which is schema, and still hides a data value that is not a schema name.
Offline, on the real notebook functions (agent_ns) and the platform rules Genie is given."""
from v120_genie_support import build_inspire, make_uc
from v130_genie_run_controls_test import INSTRUCTION

GROUPING = {"applies": True, "columns": ["product", "paymentMethod"], "default": "product", "recommended": [], "time_column": "",
            "chosen_by": "person", "link": "https://inspire.example.com/?review=7&uc=N04-U01"}
ONE_VALUE_FLAGS = ["Q3_R24_CONSTANT_COLUMN:product", "Q3_R24_CONSTANT_COLUMN:status"]
RECORDS_ERROR = ("group_by is 'product', but the records passed to inspire_group_records have no column product; group_by takes these "
                 "records' own column names, coarse to fine, such as region, country, or all")


def _grouped_uc(**fields):
    return make_uc("N04-U01", **{"Analytics Technique": "Anomaly Detection", "_implement_grouping": dict(GROUPING), **fields})


def _run_controls(agent_ns):
    """The Run controls namespace Genie's notebook runs: the failure text Genie reads is built there, not in agent_ns."""
    inst = build_inspire(agent_ns)
    uc = _grouped_uc()
    source = inst._genie_run_controls_source(uc, inst._genie_notebook_spec(uc), INSTRUCTION)
    ns = {}
    exec(compile(source.rstrip().rsplit("\n", 1)[0], "run_controls", "exec"), ns)
    return ns


def test_the_grouping_rule_tells_genie_to_keep_every_grouping_column_on_the_records(agent_ns):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(_grouped_uc())
    rules = inst._genie_platform_rules(spec)
    assert "every Grouping column (`product`, `paymentMethod`)" in rules, "the records sentence must name each Grouping column"
    assert "even where it holds one value" in rules and "an earlier step that selected features or aggregated the rows" in rules


def test_a_grouping_column_that_holds_one_value_is_not_listed_as_a_column_to_drop(agent_ns):
    inst = build_inspire(agent_ns)
    uc = _grouped_uc(gate_flags=list(ONE_VALUE_FLAGS))
    assert inst._genie_constant_columns(uc) == ["status"], "product is the Grouping, so it is kept, not a constant to drop"
    spec = inst._genie_notebook_spec(uc)
    assert spec.get("constant_columns") == ["status"], spec.get("constant_columns")


def test_the_error_that_reaches_genie_names_the_grouping_column(agent_ns):
    ns = _run_controls(agent_ns)
    assert ns["INSPIRE_RUN"]["grouping"]["columns"] == ["product", "paymentMethod"]
    text = ns["inspire_failure_text"](ValueError(RECORDS_ERROR))
    assert "group_by is 'product'" in text and "have no column product" in text, text
    assert ns["INSPIRE_REDACTED_VALUE"] not in text, text
    pair = ns["inspire_failure_text"](ValueError(RECORDS_ERROR.replace("'product'", "'product, paymentMethod'")))
    assert "group_by is 'product, paymentMethod'" in pair, pair


def test_a_column_of_a_table_scope_is_schema_and_is_kept_in_the_error(agent_ns):
    ns = _run_controls(agent_ns)
    ns["INSPIRE_RUN"] = {}
    ns["INSPIRE_TABLE_SCOPES"] = {"main.sales.orders": {"columns": ["product", "quantity"]}}
    text = ns["inspire_failure_text"](ValueError("group_by is 'product', but the records have no column product"))
    assert "group_by is 'product'" in text, text


def test_redaction_still_hides_a_data_value_when_a_grouping_column_is_named(agent_ns):
    ns = _run_controls(agent_ns)
    person = ns["inspire_failure_text"](ValueError("group_by is 'Ana Lopez', but the records have no column product"))
    assert "Ana Lopez" not in person and "group_by is 'a data value'" in person, person
    mixed = ns["inspire_failure_text"](ValueError("group_by is 'product, Ana Lopez', but the records have no column product"))
    assert "Ana Lopez" not in mixed and "'a data value'" in mixed, mixed
    region = ns["inspire_failure_text"](ValueError("group_by is 'zqv_north_region', but the records have no column product"))
    assert "zqv_north_region" not in region, region


def test_the_shared_redactor_keeps_a_quoted_list_of_known_column_names_only(agent_ns):
    redact = agent_ns["inspire_redact_text"]
    assert redact("group_by is 'product, paymentMethod'", set(), "product\npaymentMethod") == "group_by is 'product, paymentMethod'"
    assert redact("group_by is 'product, Ana Lopez'", set(), "product\npaymentMethod") == "group_by is 'a data value'"
