"""REQ-059: no customer copy in the agent notebook carries an internal term (batch/depth/attempt numbers, prompt keys,
Inspire's own tables, log tags). The terms are shared with the frontend gate (backend/test/customerJargon.test.js) through
tests/fixtures/customer_jargon_terms.json. Log calls are exempt: the run log is a technical view by design.
"""
import ast
import json
import os
import re

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
SPEC = json.load(open(os.path.join(ROOT, "tests", "fixtures", "customer_jargon_terms.json"), encoding="utf-8"))
TERMS = [(t["id"], re.compile(t["pattern"], re.I if "i" in t["flags"] else 0)) for t in SPEC["terms"] if t.get("scope") != "run_output"]
SQL = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|WITH|SHOW|DESCRIBE)\b|\bFROM\b", re.I)
LOG_CALLS = {"info", "debug", "warning", "error", "exception", "critical", "log_print", "print"}


def _code_cells():
    cells = json.load(open(NOTEBOOK, encoding="utf-8"))["cells"]
    return [("".join(c["source"]), i) for i, c in enumerate(cells) if c["cell_type"] == "code"]


# Customer-visible sinks: a string reaches a person only through one of these. Prompt text sent to the LLM, log lines and
# other code strings are not sinks, so they are not copy.
SINK_CALLS = {"emit_step", "_emit_pipeline_status", "_emit_prompt_status", "_emit_runtime_warning", "_implement_emit",
              "_pipeline_step", "T", "ValueError", "RuntimeError", "Exception", "PermissionError"}
SINK_LISTS = {"errors", "warnings", "validation_errors", "problems", "notes", "held_outputs"}
RETURNED_TEXT_FUNCS = re.compile(r"(line|label|message|text|reason|note|copy|why)", re.I)
# Builders whose text is written for the model and read by no person (named, so an exemption stays visible).
LLM_TEXT_FUNCS = {"_kinds_checklist_lines"}
SINK_DICTS = re.compile(r"^(PROMPT_STORY_\w+|PROMPT_TRACKING_\w+)$")


def _call_name(node):
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr, func.value.id if isinstance(func.value, ast.Name) else ""
    return getattr(func, "id", ""), ""


def customer_strings(source):
    """(line, text) for every string literal that reaches a customer-visible sink and has a space and is not SQL."""
    out = []

    def collect(node):
        for sub in ast.walk(node):
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and re.search(r"\s", sub.value) and not SQL.search(sub.value):
                out.append((sub.lineno, sub.value))

    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.FunctionDef) and RETURNED_TEXT_FUNCS.search(node.name) and "prompt" not in node.name.lower() and node.name not in LLM_TEXT_FUNCS:
            # line and label builders return the text the App shows (the REQ-119 label line reaches Monitor this way).
            # Prompt builders return LLM instructions, which no person reads, so they are not sinks.
            for sub in ast.walk(node):
                if isinstance(sub, ast.Return) and sub.value is not None:
                    collect(sub.value)
        if isinstance(node, ast.Call):
            name, receiver = _call_name(node)
            if name == "implement_gate":
                # REQ-227: a gate's problems (argument 1) and failure text (argument 4) reach the App. Its feedback (argument 2)
                # is the repair prompt Genie reads, so it is not copy. A notebook gate's problems are the verdict Genie reads
                # with exact object names, so they are not copy either: the person's copy is made plain where the warning is
                # written (implement_plain_change_text), and req227_status_words_test pins that. AI and reply problems stay copy.
                notebook = bool(node.args) and isinstance(node.args[0], ast.Constant) and node.args[0].value == "notebook"
                for position in ((4,) if notebook else (1, 4)):
                    if len(node.args) > position:
                        collect(node.args[position])
            elif name in SINK_CALLS or (name in {"append", "extend"} and receiver in SINK_LISTS):
                for arg in list(node.args) + [kw.value for kw in node.keywords]:
                    collect(arg)
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and SINK_DICTS.match(t.id) for t in node.targets):
            collect(node.value)
        elif isinstance(node, ast.Raise) and node.exc is not None:
            collect(node.exc)
    return sorted(set(out))


def customer_form(text):
    """The sentence a person sees: the log tag is dropped, exactly as inspire_customer_line drops it at the App sink."""
    return re.sub(r"^\[[A-Z0-9_ -]+ FIRED\]\s*", "", text)


def internal_hits(text):
    return [term_id for term_id, rx in TERMS if rx.search(text)]


def test_positive_controls_catch_the_rc7_strings():
    assert internal_hits("Filter Business Tables batch 1 depth0 attempt1") == ["step_code"]
    assert internal_hits("Inspire is working on FILTER_BUSINESS_TABLES_PROMPT") == ["prompt_key"]
    assert "internal_table" in internal_hits("Read it from __inspire_session")
    assert internal_hits("Write the __constraints dashboard companion") == ["internal_object", "companion"], "REQ-227 class"
    assert internal_hits("[DATA-FILTER-LABEL FIRED] 12 of 12 names") == ["log_tag"]
    assert internal_hits("Discovery: the AI sees the summary figures") == [], "the plain Discovery label is clean (must-include)"


def test_no_customer_string_in_the_notebook_carries_an_internal_term():
    hits = [f"cell {index} line {line} [{term}] {text.strip()[:140]}"
            for source, index in _code_cells() for line, text in customer_strings(source)
            for term in internal_hits(customer_form(text))]
    assert hits == []


@pytest.fixture
def story(agent_ns):
    return object.__new__(agent_ns["DatabricksInspire"])


def test_the_filter_step_reads_plain_words_not_its_batch_depth_and_attempt(story):
    assert story._story_status_line("started", "", "Filter_Business_Tables_Batch_1_Depth0_Attempt1") == "In progress: filter business tables"
    assert story._story_clean_text("Goal_Alignment_Filter_Batch_3_Attempt2") == "Goal Alignment Filter"


def test_the_unmapped_prompt_gets_a_plain_title_and_no_prompt_key(story):
    stage, title, sub = story._story_prompt_labels("DATA_FILTER_LABEL_RENAME_PROMPT", "DataFilterLabel_Reask", "started", "")
    assert (stage, title) == ("Use Case Prioritization", "Tidying Data Filter Labels")
    assert sub == "In progress: data filter label reask"
    stage, title, sub = story._story_prompt_labels("NOT_A_MAPPED_PROMPT", "", "started", "")
    assert "PROMPT" not in title and "NOT" not in title, "an unmapped prompt key never reaches the title"


def test_every_prompt_template_has_a_customer_title(agent_ns):
    unmapped = sorted(set(agent_ns["PROMPT_TEMPLATES"]) - set(agent_ns["PROMPT_STORY_TITLES"]))
    assert unmapped == [], "every prompt the run calls has a title the Monitor can show"


def test_every_story_title_and_started_message_is_clean(agent_ns):
    texts = [t for pair in agent_ns["PROMPT_STORY_TITLES"].values() for t in pair] + list(agent_ns["PROMPT_STORY_STARTED_MESSAGES"].values())
    assert [t for t in texts if internal_hits(t)] == []


def test_the_log_keeps_the_fired_tag_and_the_customer_message_drops_it(agent_ns):
    """The proof tag is a developer log marker: _implement_emit logs the full line, and the App message is the same sentence without it."""
    inst = object.__new__(agent_ns["DatabricksInspire"])
    logged, emitted = [], []
    inst.logger = type("L", (), {"warning": lambda self, msg: logged.append(msg), "info": lambda self, msg: logged.append(msg),
                                 "error": lambda self, msg: logged.append(msg)})()
    inst._emit_pipeline_status = lambda **kw: emitted.append(kw["message"]) or 1
    inst._implement_emit("N01-U01", "App", "[UNRELIABLE-HOLD FIRED] the latest run's results are not reliable yet", "ended_warning")
    assert any("[UNRELIABLE-HOLD FIRED] the latest run's results" in line for line in logged), "the log keeps the tag"
    assert emitted == ["the latest run's results are not reliable yet"], "the customer message has no tag"


def test_the_data_filter_line_keeps_its_tag_in_the_log_and_reads_plainly_for_the_app(agent_ns):
    line = agent_ns["data_filter_label_line"]({"carried": 12, "affected": 12, "reasked": 0, "fallback": 0, "kept_user_named": 0}, "Tokyo Tidbits")
    assert line.startswith("[DATA-FILTER-LABEL FIRED] ")
    customer = agent_ns["inspire_customer_line"](line)
    assert customer.startswith("12 of 12 names carried the label"), customer
    for internal in ("re-asked", "rewrite", "deterministic"):
        assert internal not in customer, f"{internal} is internal wording"
