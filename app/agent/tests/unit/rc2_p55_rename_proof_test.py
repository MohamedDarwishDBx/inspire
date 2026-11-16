"""REQ-208 rename proof: "Money at stake" is gone from every person-facing source (notebook, App shell server and web, frontend
source, translations in every language, kinds.json, shipped docs). A hit in any of them fails this test. Test fixtures are not
person-facing and are not scanned."""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # app/
AGENT = os.path.join(ROOT, "agent")
PHRASE = re.compile(r"money\s+at\s+stake", re.IGNORECASE)
SOURCES = [
    os.path.join(AGENT, "dbx_inspire_ai_agent.ipynb"),
    os.path.join(ROOT, "dbx_inspire_ai_agent.ipynb"),
    os.path.join(AGENT, "agent", "app_shell", "translations.json"),
    os.path.join(AGENT, "agent", "app_shell", "kinds.json"),
    os.path.join(AGENT, "agent", "app_shell", "prompts.json"),
    *glob.glob(os.path.join(AGENT, "agent", "app_shell", "server", "*.py")),
    *glob.glob(os.path.join(AGENT, "agent", "app_shell", "web", "src", "**", "*.*"), recursive=True),
    *glob.glob(os.path.join(ROOT, "frontend", "src", "**", "*.*"), recursive=True),
    *glob.glob(os.path.join(ROOT, "backend", "lib", "*.js")),
    *glob.glob(os.path.join(ROOT, "backend", "*.js")),
    *glob.glob(os.path.join(ROOT, "docs", "**", "*.md"), recursive=True),
    *glob.glob(os.path.join(AGENT, "docs", "**", "*.md"), recursive=True),
    *glob.glob(os.path.join(AGENT, "agent", "docs", "**", "*.md"), recursive=True),
]


def test_money_at_stake_is_gone_from_every_person_facing_source():
    hits = []
    for path in sorted(set(SOURCES)):
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            for number, line in enumerate(handle, 1):
                if PHRASE.search(line):
                    hits.append(f"{os.path.relpath(path, ROOT)}:{number}")
    assert hits == [], hits


def test_the_proof_scans_the_sources_it_claims_to_scan():
    scanned = [p for p in set(SOURCES) if os.path.isfile(p)]
    assert len(scanned) >= 60, len(scanned)
    assert any(p.endswith("translations.json") for p in scanned) and any(p.endswith(".ipynb") for p in scanned)
    assert any(p.endswith("prompts.json") for p in scanned)



def test_the_publisher_renames_the_retired_label_in_every_case_and_leaves_value_at_stake_alone():
    # D-208 (REQ-208): the published ledger quotes asks, so the publisher applies the rename the product applied.
    import sys
    scripts = os.path.join(ROOT, "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    import ledger_publish as lp  # noqa: E402

    text, counts = lp.sanitize("Money at Stake, money at stake, MONEY AT STAKE and value at stake stay.")
    assert text == "Value at Stake, value at stake, Value AT STAKE and value at stake stay.", text
    assert counts.get("retired label (D-208)") == 3, counts
