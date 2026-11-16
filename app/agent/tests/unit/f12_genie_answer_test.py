"""REQ-330 / REQ-269: the Ask answer. The table is the Genie columns and rows (one table, headers over their values), the steps
never open the answer text, and a whole-table count is never labelled sample-based."""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

import shell_agent  # noqa: E402
import shell_sql  # noqa: E402
from v211_genie_agent_test import AgentWorkspace, FakeLLM, agent_shell, ask, said, tool_call, topic_of  # noqa: E402

# A four-column Genie answer, with fake names and values.
COLUMNS = [{"name": "product_name", "type": "STRING"}, {"name": "franchise_revenue_per_sale", "type": "DECIMAL"},
           {"name": "peer_median_revenue_per_sale", "type": "DECIMAL"}, {"name": "gap_to_peer_median", "type": "DECIMAL"}]
ROWS = [{"product_name": "Product A", "franchise_revenue_per_sale": 3.0, "peer_median_revenue_per_sale": 18.38, "gap_to_peer_median": -15.38},
        {"product_name": "Product B", "franchise_revenue_per_sale": 12.43, "peer_median_revenue_per_sale": 17.45, "gap_to_peer_median": -5.03}]
# The model wrote its own table with headers that do not match the values (the REQ-330 defect), and a sample label.
MISALIGNED = ("Product gaps for franchise F-101 (sample-based).\n\n"
              "| Product | Franchise | Peer median | Gap |\n|---|---|---|---|\n"
              "| Product A | $3.00 | $18.38 | -$15.38 |\n| Product B | $3.00 | $17.45 | -$5.03 |")


class FourColumns(AgentWorkspace):
    def genie_message(self, space, conversation, message, row_limit=50):
        self.genie.append((space, conversation, message, row_limit))
        return {"state": "done", "text": "", "sql": "SELECT product_name, franchise_revenue_per_sale FROM t GROUP BY product_name",
                "columns": COLUMNS, "rows": ROWS, "truncated": False}


def test_a_four_column_genie_answer_keeps_its_columns_and_rows_aligned_and_drops_the_models_table(tmp_path):
    llm = FakeLLM([tool_call("ask_genie", {"question": "Split the gap by product for F-101"}), said(MISALIGNED)], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=FourColumns(llm=llm))
    turn = ask(s, "Split the gap by product for F-101")
    names = [c["name"] for c in turn["genie"]["columns"]]
    assert names == [c["name"] for c in COLUMNS], "the headers are the Genie columns, in Genie's order"
    assert all(set(row) == set(names) for row in turn["genie"]["rows"]), "every row carries one value per Genie column, under its own name"
    assert "|" not in turn["answer"], "the model's own table is not shown beside the Genie table (one table, no duplicate)"
    assert "$3.00" not in turn["answer"], "a value written by the model never replaces the Genie value"


def test_a_table_whose_body_rows_do_not_match_its_header_is_never_shown(tmp_path):
    text = "Read them below.\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 |\n| 3 | 4 | 5 |"
    assert shell_agent.drop_tables(text) == "Read them below.\n"
    assert shell_agent.drop_tables(text, [{"rows": []}]) == "Read them below.\n"


def test_a_consistent_table_stays_when_the_App_has_no_genie_rows_to_show():
    table = "Here is the split.\n\n| Region | Loss |\n|---|---|\n| East | 120 |\n| West | 40 |"
    assert shell_agent.drop_tables(table) == table, "a plain answer with its own consistent table is kept"


def test_a_genie_answer_with_rows_shows_its_rows_once_and_no_text_table(tmp_path):
    text = "Ranked by the gap.\n\n| Region | Loss |\n|---|---|\n| East | 120 |"
    out = shell_agent.finish_text(text, "Ranked?", genie=[{"sql": "SELECT region, loss FROM t", "rows": [{"region": "East", "loss": 120}]}])
    assert "|" not in out and "Ranked by the gap." in out


def test_the_steps_never_open_the_answer_text(tmp_path):
    llm = FakeLLM([tool_call("ask_genie", {"question": "Which region lost the most?"}), said("East lost the most.")], related=topic_of)
    s, _ws, _made = agent_shell(tmp_path, ws=AgentWorkspace(llm=llm))
    turn = ask(s, "Which region lost the most?")
    assert turn["steps"][0]["text"] == "Asked Genie: Which region lost the most?", "the narration stays in the step log"
    assert "Asked Genie" not in turn["answer"], "must-exclude: the relay wording never reaches the person's answer"
    assert "Looked at" not in turn["answer"]


def test_a_whole_table_count_is_never_labelled_sample_based():
    text = "Mobile App leads on 2026-10-15 with 3,156 transactions (sample-based)."
    out = shell_agent.finish_text(text, "Split by channel?", genie=[{"sql": "SELECT channel, COUNT(*) FROM sales_transactions GROUP BY channel",
                                                                    "rows": [], "scope": {"scope": "records", "records": 1000}}])
    assert "sample" not in out.casefold(), out
    assert out == "Mobile App leads on 2026-10-15 with 3,156 transactions.\n\nCounted over the whole sales transactions table."


def test_a_sample_label_stays_only_when_the_count_read_a_run_scoped_slice():
    text = "Mobile App leads with 1,000 transactions (sample-based)."
    scope = {"scope": "records", "records": 1000}
    sampled = [{"sql": f"SELECT COUNT(*) FROM t WHERE {shell_sql.RUN_COLUMN} = '{shell_sql.RUN_LATEST}'", "rows": [], "scope": scope}]
    assert shell_agent.read_sample(sampled) is True
    assert shell_agent.finish_text(text, "Q?", genie=sampled) == (
        "Mobile App leads with 1,000 transactions (sample-based).\n\nCounted over the first-run sample of 1,000 records."), "a count that read the sample keeps its label and names it"
    assert shell_agent.read_sample([{"sql": "SELECT COUNT(*) FROM t", "rows": []}]) is False


def test_the_model_is_no_longer_told_the_sample_rule_because_the_code_gates_the_label():
    assert "sample-based" not in shell_agent.SYSTEM and "sampled" not in shell_agent.SYSTEM


GENIE_COLUMNS = COLUMNS  # the recorded four-column shape
GENIE_ROWS_2 = ROWS


def test_a_model_pivot_that_is_not_the_genie_rows_is_kept():
    pivot = "Gap by month.\n\n| Product | Jan | Feb |\n|---|---|---|\n| Product A | -4 | -11 |\n| Product B | -2 | -3 |"
    genie = [{"sql": "SELECT 1", "rows": GENIE_ROWS_2, "columns": GENIE_COLUMNS}]
    assert shell_agent.drop_tables(pivot, genie) == pivot, "a pivot with other columns is the model's own table and stays"


def test_a_model_table_that_repeats_the_genie_rows_under_wrong_headers_is_dropped():
    misaligned = "Gaps.\n\n| Product | Franchise | Peer median | Gap |\n|---|---|---|---|\n| Product A | $3.00 | $18.38 | -$15.38 |\n| Product B | $3.00 | $17.45 | -$5.03 |"
    genie = [{"sql": "SELECT 1", "rows": GENIE_ROWS_2, "columns": GENIE_COLUMNS}]
    assert shell_agent.drop_tables(misaligned, genie) == "Gaps.\n"


def test_a_model_table_whose_header_names_the_genie_columns_is_dropped():
    named = "Gaps.\n\n| product_name | franchise_revenue_per_sale | peer_median_revenue_per_sale | gap_to_peer_median |\n|---|---|---|---|\n| Product A | 3 | 18.38 | -15.38 |"
    genie = [{"sql": "SELECT 1", "rows": GENIE_ROWS_2, "columns": GENIE_COLUMNS}]
    assert shell_agent.drop_tables(named, genie) == "Gaps.\n"


def test_a_split_must_name_a_filter_the_question_names():
    franchise = {"id": "franchise", "label": "Franchise"}
    assert shell_agent.named_in_question(franchise, "Which payment method has the most flagged records?") is False, "never split by franchise when the question asks by payment method"
    assert shell_agent.named_in_question(franchise, "Split the flagged records by franchise") is True
    assert shell_agent.named_in_question({"id": "payment_method", "label": "Payment method"}, "Which payment method has the most?") is True
