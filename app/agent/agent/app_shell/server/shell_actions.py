"""The one registry of every action the App's UI can take.

The Work page, the record panel and the Agent all name an action from this list. Each action says which fields it needs,
which route it writes through and what values or body that route takes. A record action writes its values through
records/act (the same write the Work page makes); an app action writes through its own route (settings, alerts, run).
Nothing else builds a write body for these actions.
"""
import re
from dataclasses import dataclass

import shell_sql

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RECORD_ROUTE = "records/act"
TARGET_SETTING = "kpi_target_value"  # the same name as shell_core.KPI_TARGET_SETTING; a test keeps them equal
RECORD = "record"
APP = "app"


@dataclass(frozen=True)
class Action:
    id: str
    label: str
    fields: tuple = ()
    route: str = RECORD_ROUTE
    writes: bool = True
    scope: str = RECORD


REGISTRY = {a.id: a for a in (
    Action("done", "Mark done"),
    Action("snooze", "Snooze", ("until",)),
    Action("assign", "Assign", ("owner",)),
    Action("skip", "Skip", writes=False),
    Action("not_an_issue", "Mark not an issue", ("reason",)),
    Action("reopen", "Reopen"),
    Action("override", "Override with a reason", ("status", "reason")),
    Action("add_note", "Add note", ("note",)),
    Action("set_target", "Set target", ("value",), route="settings/save", scope=APP),
    Action("create_alert", "Create alert", ("watch", "schedule"), route="alerts/save", scope=APP),
    Action("run_again", "Run again", (), route="settings/run", scope=APP),
)}

RECORD_ACTIONS = tuple(a.id for a in REGISTRY.values() if a.scope == RECORD)
APP_ACTIONS = tuple(a.id for a in REGISTRY.values() if a.scope == APP)


def action_of(name) -> Action:
    if name not in REGISTRY:
        raise ValueError(f"action is one of {', '.join(REGISTRY)}")
    return REGISTRY[name]


def _text(raw: dict, field: str, what: str) -> str:
    value = raw.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(what)
    return value.strip()


def record_values(name: str, raw: dict, today) -> dict:
    """The values records/act writes for a record action. reopen and skip are handled by the caller."""
    if name == "done":
        return {"action_status": shell_sql.DONE}
    if name == "snooze":
        until = raw.get("until")
        if not isinstance(until, str) or not DATE.match(until):
            raise ValueError("a snooze needs a date as YYYY-MM-DD; ask the person until when")
        return {"snooze_until": until}
    if name == "assign":
        return {"action_owner": _text(raw, "owner", "assigning records needs the person to assign them to")}
    if name == "not_an_issue":
        return {"action_status": shell_sql.DISMISSED, "dismiss_reason": _text(raw, "reason", "marking records not an issue needs the person's reason; ask them for it")}
    if name == "override":
        status = raw.get("status")
        if status not in shell_sql.ACTION_STATUSES:
            raise ValueError(f"override sets a status: one of {', '.join(shell_sql.ACTION_STATUSES)}")
        reason = _text(raw, "reason", "an override needs the person's reason; ask them for it")
        out = {"action_status": status, "action_note": reason}
        if status == shell_sql.DISMISSED:
            out["dismiss_reason"] = reason
        return out
    if name == "add_note":
        return {"action_note": _text(raw, "note", "a note needs the text the person wants to keep")}
    raise ValueError(f"{name} is not a record action")


def app_body(name: str, page_id: str, raw: dict) -> dict:
    """The body the app action's route takes."""
    if name == "set_target":
        try:
            value = float(raw.get("value"))
        except (TypeError, ValueError) as error:
            raise ValueError("a target is a number") from error
        return {"page": page_id, "name": TARGET_SETTING, "value": value}
    if name == "create_alert":
        watch, schedule = raw.get("watch"), raw.get("schedule")
        if not isinstance(watch, dict) or not watch:
            raise ValueError("an alert says what it watches: what, filters, operator, threshold and basis")
        return {"page": page_id, "watch": watch, "schedule": _text(raw, "schedule", "an alert needs a schedule"), "paused": False}
    if name == "run_again":
        return {"page": page_id}
    raise ValueError(f"{name} is not an app action")
