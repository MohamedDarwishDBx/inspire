"""REQ-257 D5: a write must not be followed by a pre-write page state.

A list read after an act takes its stamp from page_state. If a lookup that started before the write
finishes after forget(), it used to re-cache the pre-write state for STAMP_TTL_S (15 s), so every list
read in that window served the rows from before the act.
"""
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

from v144_app_data_test import shell


def lookup_that_straddles_a_write(s, page, joins=False):
    """Start a state lookup that reads the pre-write state and blocks, then write (forget), then release it."""
    started, release, reads = threading.Event(), threading.Event(), []

    def read_state(ws, page, head=None):
        reads.append(1)
        if len(reads) == 1:
            started.set()
            release.wait(5)
            return {"row": {"v": "pre"}, "facts": None, "stamp": "pre", "error": ""}
        return {"row": {"v": "post"}, "facts": None, "stamp": "post", "error": ""}

    s.read_state = read_state
    early = []
    first = threading.Thread(target=lambda: early.append(s.page_state(None, "who", page)))
    first.start()
    assert started.wait(5)
    s.forget()  # the act
    return first, early, release, reads


def test_a_state_read_started_before_a_write_does_not_stay_cached_after_it(tmp_path):
    s, _ws, _made = shell(tmp_path)
    page = s.pages[0]
    first, _early, release, _reads = lookup_that_straddles_a_write(s, page)
    release.set()
    first.join(5)
    after = s.page_state(None, "who", page)
    assert after["stamp"] == "post", "the list read after the act must see the post-write state, not the cached pre-write one"


def test_a_state_read_after_a_write_does_not_join_a_lookup_started_before_it(tmp_path):
    s, _ws, _made = shell(tmp_path)
    page = s.pages[0]
    first, _early, release, _reads = lookup_that_straddles_a_write(s, page)
    got = []
    second = threading.Thread(target=lambda: got.append(s.page_state(None, "who", page)))
    second.start()
    second.join(2)
    joined_pre_write = second.is_alive() is True and not got
    release.set()
    second.join(5)
    first.join(5)
    assert not joined_pre_write, "a read after the act waited for the lookup that began before it"
    assert got and got[0]["stamp"] == "post"
