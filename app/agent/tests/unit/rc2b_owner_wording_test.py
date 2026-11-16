"""REQ-185: the waiting page never names a service principal id as whom to ask.

An App-owned view is owned by Inspire's own identity, so its waiting card says the plain action (press Check again after a rebuild, or
Inspire grants it on the next build). A raw principal id is dropped from every owner list the page can show.
"""
import os
import sys
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402

UUID_OWNER = "b2b3b070-1da5-45c3-b5b6-81a2feaf85bb"
VIEW = "inspire_kinds_rc7._inspire.inspire_kinds_rc7__inspire_sales_transactions__n01_u01__implement_scope"
RESULTS = "inspire_kinds_rc7._inspire.inspire_walk_v153_e2e_n01_u01_n01_u01_results__signal__n01_u01__implement_scope"


def test_an_inspire_owned_view_gets_the_plain_action_and_no_principal_id(  ):
    text = shell_core.card_waiting_text(["Inspire"])
    assert text == shell_core.CARD_WAITING_INSPIRE
    assert "Check again" in text and "Inspire grants it on the next build" in text
    assert UUID_OWNER not in text and " to grant it" not in text


def test_a_named_owner_keeps_the_ask_sentence_and_nobody_known_falls_back_to_your_data_owner():
    assert shell_core.card_waiting_text(["Data Owners Group"]) == "This App is waiting for access to this data. Ask Data Owners Group to grant it."
    assert shell_core.card_waiting_text([]) == "This App is waiting for access to this data. Ask your data owner to grant it."


def test_the_page_owner_list_drops_a_principal_id_and_keeps_inspire():
    stub = SimpleNamespace(settings={"unread_owners": {VIEW: UUID_OWNER, RESULTS: "Inspire"}})
    owners = shell_core.Shell.access_owners(stub, [f"No access to {VIEW}, {RESULTS}"])
    assert owners == ["Inspire"]
    assert UUID_OWNER not in str(owners)


def test_the_grant_refusal_owner_never_names_a_principal_id():
    assert shell_core.access_owners([{"owner": UUID_OWNER}]) == "your data owner"
    assert shell_core.access_owners([{"owner": UUID_OWNER}, {"owner": "Inspire"}]) == "Inspire"
    assert shell_core.access_owners([{"owner": "dana@example.com"}]) == "dana@example.com"
