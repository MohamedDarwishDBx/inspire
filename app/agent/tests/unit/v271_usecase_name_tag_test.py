import ast
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace  # noqa: E402
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v130_genie_run_controls_test import _notebook  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "usecase_name_cases.json")
NAME_TAG = "dbx_inspire_ai_usecase_name"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _cases():
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)["cases"]


def test_the_python_encoder_matches_the_shared_parity_fixture(ns):
    for case in _cases():
        assert ns["inspire_usecase_name_tag"](case["name"], case["max"]) == case["expected"], case


def test_predict_customer_churn_and_non_latin_names(ns):
    tag = ns["inspire_usecase_name_tag"]
    assert tag("Predict Customer Churn") == "predict_customer_churn"
    assert tag("Café Résumé Scoring") == "cafe_resume_scoring"
    assert tag("客户流失") == ""
    assert ns["inspire_usecase_name_tags"]("客户流失") == {}, "a name with no ASCII letters writes no tag"


def test_a_long_name_is_cut_on_a_word_boundary_within_the_limit(ns):
    long = "Predict the probability that each active subscriber cancels within the next ninety days"
    assert ns["inspire_usecase_name_tag"](long, 40) == "predict_the_probability_that_each_active"
    assert len(ns["inspire_usecase_name_tag"](long)) <= ns["JobLauncher"].tag_value_max()


def test_a_discover_run_carries_no_use_case_name_tag(ns):
    discovery = ns["inspire_identity_tags"]("Acme", "42", "Inspire App")
    assert NAME_TAG not in discovery and "dbx_inspire_ai_usecase" not in discovery


def test_the_genie_job_tags_carry_the_name_next_to_the_id(ns):
    _inst, uc, nb = _notebook(ns, "Classification")
    controls = "".join(nb["cells"][-1]["source"])
    run = ast.literal_eval(controls.split("INSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0])
    expected = ns["inspire_usecase_name_tag"](uc["Name"])
    assert run["job_tags"][NAME_TAG] == expected == run["job_tags"]["dbx_inspire_ai_usecase"]
    assert run["job_tags"]["dbx_inspire_ai_usecase_id"] == uc["No"]


def test_the_implement_job_and_its_app_take_the_name_from_the_spec_tags(ns):
    inst = build_inspire(ns)
    spec_tags = {"job_tags": {**ns["inspire_usecase_name_tags"]("Predict Customer Churn"), "dbx_inspire_ai_usecase_id": "N01-U01"}}
    tags = inst._implement_tags(spec_tags, ("42", "b", 3), "/Shared/inspire-ai/dbx_inspire_ai_agent")
    assert tags[NAME_TAG] == "predict_customer_churn"
    assert ns["JobLauncher"].kind_tags({NAME_TAG: tags[NAME_TAG]}, "app") == {NAME_TAG: "predict_customer_churn"}


def test_the_name_tag_is_ranked_next_to_the_id_so_the_job_tag_cap_keeps_it(ns):
    job = ns["JobLauncher"]
    assert job.TAG_PRIORITY.index(NAME_TAG) == job.TAG_PRIORITY.index("dbx_inspire_ai_usecase_id") + 1
    tags = {f"dbx_inspire_ai_filler_{i}": "x" for i in range(30)}
    tags.update({NAME_TAG: "predict_customer_churn", "dbx_inspire_ai_usecase_id": "N01-U01", "dbx_inspire_ai_version": "v1"})
    kept, _dropped = job.capped_tags(tags)
    assert NAME_TAG in kept and "dbx_inspire_ai_usecase_id" in kept
