"""One action registry: every Work-page write and every registry action is reachable through the Agent, with no pending list."""
import os
import re
import sys

WEB = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "web", "src")
SERVER = os.path.join(os.path.dirname(__file__), "..", "..", "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_actions  # noqa: E402
import shell_agent  # noqa: E402

# Work-page write ids -> the registry action each one is.
WORK_TO_REGISTRY = {"done": "done", "snoozed": "snooze", "skipped": "skip"}


def work_writes():
    ids = set()
    for name in ("Records.jsx", "Work.jsx"):
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        ids |= set(re.findall(r"run\('([a-z_]+)'", text))
        ids |= set(re.findall(r'write="work:([a-z_]+)"', text))
    return ids


def test_every_work_write_is_a_registry_action():
    unmapped = sorted(i for i in work_writes() if i not in WORK_TO_REGISTRY)
    assert unmapped == [], f"Work-page writes not in the registry map: {unmapped}"
    for registry_id in WORK_TO_REGISTRY.values():
        assert registry_id in shell_actions.REGISTRY


def test_every_registry_record_action_is_reachable_through_the_agent():
    for name in shell_actions.RECORD_ACTIONS:
        assert name in shell_agent.ACTIONS, name
        assert name in shell_agent.TOOLS["propose_action"]["parameters"]["properties"]["action"]["enum"], name


def test_every_registry_app_action_is_reachable_through_the_agent():
    for name in shell_actions.APP_ACTIONS:
        assert name in shell_agent.ACTIONS_APP, name
        assert name in shell_agent.TOOLS["propose_app_action"]["parameters"]["properties"]["action"]["enum"], name


def test_the_agent_offers_the_full_registry_and_nothing_else():
    internal = {a.id for a in shell_actions.REGISTRY.values() if not a.agent}
    # Exemption (REQ-414 part B, governance): approve and reject are a person's click on a pending row, never offered to the agent.
    assert internal == {"update"} | set(shell_actions.APPROVAL_ACTIONS), "the record panel's free edit and the approval clicks are internal"
    assert set(shell_agent.ACTIONS) | set(shell_agent.ACTIONS_APP) == set(shell_actions.REGISTRY) - internal


def test_the_web_offers_every_agent_record_action_it_can_prepare():
    js = open(os.path.join(WEB, "agentBlocks.js"), encoding="utf-8").read()
    for name in shell_actions.RECORD_ACTIONS:
        assert f"{name}:" in js or f"'{name}'" in js or f'"{name}"' in js, name
