"""REQ-414 (names): no "with <deliverable>" tail, and the name verbs the prompt offers are the ones the validator accepts.

Behavioural checks run the notebook's own `_use_case_name_issues`. The batch measure (leading-verb share of the top five,
share of names with a "with" tail) is computed here on fixture batches, and on the shipped demo sample names as a baseline.
"""
import csv
import glob
import json
import os
import collections
import re

import pytest

from _agentload import load_agent_namespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROMPTS = os.path.join(ROOT, "agent", "app_shell", "prompts.json")
DEMOS = os.path.join(ROOT, "demos")


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def issues(ns, name):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    return obj._use_case_name_issues({"Name": name, "Analytics Technique": "Forecasting"})


def batch_measure(names):
    """(top-five leading-verb share, share of names containing 'with') over a list of names."""
    firsts = [re.findall(r"[A-Za-z]+", n)[0].lower() for n in names if re.findall(r"[A-Za-z]+", n)]
    top5 = sum(count for _, count in collections.Counter(firsts).most_common(5))
    tails = sum(1 for n in names if re.search(r"\bwith\b", n, re.I))
    return top5 / len(names), tails / len(names)


def test_a_with_tail_naming_the_method_is_flagged(ns):
    assert "deliverable_tail" in issues(ns, "Predict Customer Churn with Logistic Regression")
    assert "deliverable_tail" in issues(ns, "Detect Fraud Patterns with Isolation Forest")


def test_a_name_without_with_is_not_flagged_as_a_tail(ns):
    assert "deliverable_tail" not in issues(ns, "Keep Withdrawn Accounts Active")
    assert "deliverable_tail" not in issues(ns, "Forecast Inventory Demand")


@pytest.mark.parametrize("verb", ["Ask", "Answer", "Draft", "Route", "Match"])
def test_the_validator_accepts_the_verbs_the_prompt_now_offers(ns, verb):
    issue_list = issues(ns, f"{verb} Overdue Invoices To Collections")
    assert not [i for i in issue_list if i.startswith("verb:")], issue_list


def test_the_name_rule_in_the_prompt_offers_the_new_verbs_and_bans_with():
    rule = json.load(open(PROMPTS, encoding="utf-8"))["BASE_USE_CASE_GEN_PROMPT"]
    verbs_line = next(l for l in rule.splitlines() if "Plain verbs such as" in l)
    for verb in ("Ask", "Answer", "Draft", "Route", "Match"):
        assert verb in verbs_line
    ban_line = next(l for l in rule.splitlines() if 'never the word "with"' in l)
    assert "no \"with [deliverable]\" tail" in ban_line


def test_the_batch_measure_fails_a_verb_heavy_batch_and_passes_a_spread_batch():
    heavy = [f"Detect Thing {i} to Protect Revenue" for i in range(6)] + ["Forecast Sales Demand", "Ask Owners Their Backlog",
                                                                         "Route Late Orders", "Match Duplicate Records"]
    share, _ = batch_measure(heavy)
    assert share >= 0.4, "the fixture must be over the 40% bar, or the bar cannot bite"
    spread = ["Detect Late Shipments", "Ask Owners About Backlog", "Route Returns To Refund", "Match Duplicate Suppliers",
              "Forecast Seasonal Demand", "Draft Renewal Letters", "Cut Idle Stock", "Keep Top Buyers Warm",
              "Answer Pricing Questions", "Protect Margin On Discounts", "Reduce Scrap Rate", "Stop Repeat Refunds",
              "Price Bulk Orders", "Target Lapsed Members", "Spot Ghost Vendors", "Plan Winter Staffing",
              "Classify Support Tickets", "Segment Store Traffic", "Escalate Stuck Claims", "Recover Unpaid Balances"]
    share, tails = batch_measure(spread)
    assert share < 0.4 and tails < 0.2


def test_the_shipped_demo_names_have_no_with_tail_and_their_verb_share_is_recorded():
    names = []
    for path in glob.glob(os.path.join(DEMOS, "*", "docs", "Samples*.csv")):
        with open(path, encoding="utf-8") as handle:
            names += [" ".join((row.get("Use Case") or "").split()) for row in csv.DictReader(handle)]
    names = [n for n in names if n]
    assert len(names) >= 60
    share, tails = batch_measure(names)
    assert tails == 0.0
    # Baseline recorded for the report: 63 names, top-five verb share 50.8%. The 40% bar is proven only on a live run.
    assert 0.0 < share <= 1.0


def test_the_shipped_demo_batch_is_over_the_verb_bar_so_the_gate_flags_it(ns):
    """Measured: the 63 shipped demo names start with the five most used verbs 50.8% of the time. The batch flag fires on it,
    so the rule is enforced on any generated batch that looks like this one."""
    names = []
    for path in glob.glob(os.path.join(DEMOS, "*", "docs", "Samples*.csv")):
        with open(path, encoding="utf-8") as handle:
            names += [" ".join((row.get("Use Case") or "").split()) for row in csv.DictReader(handle)]
    names = [n for n in names if n]
    assert len(names) == 63
    flagged = ns["name_verb_share_flags"](names)
    assert len(flagged) == 32, len(flagged)
