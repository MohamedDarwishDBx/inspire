"""REQ-416: the App page the agent builds carries the id of its use case kind, so the shell can draw the kind's App style.
A kind-built page carries its kind id; a use case with no kind carries no kind key (the shell then keeps today's layout)."""


def test_a_kind_built_page_carries_its_kind_id(agent_ns):
    page = agent_ns["implement_app_page"]({"title": "Variance desk"}, "N01-U01", {"use_case_kind": "variance_to_plan"}, "main.inspire.out")
    assert page["kind"] == "variance_to_plan"


def test_a_use_case_with_no_kind_builds_a_page_with_no_kind_key(agent_ns):
    page = agent_ns["implement_app_page"]({"title": "Desk"}, "N01-U01", {"Name": "Unclassified case"}, "main.inspire.out")
    assert "kind" not in page, "no kind is invented for a use case the registry does not name"
