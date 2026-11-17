"""REQ-R46: every code cell of the agent notebook, except the last, ends with a newline.

Databricks runs each cell on its own, but the offline suite and the release tooling read the notebook as one text
(cell sources joined end to end, or joined with no separator). A cell whose last line has no newline then fuses with the
next cell's first line: `IMPLEMENT_REBUILD_ACTION = inspire_rebuild_action()if __name__ == "__main__":` is a SyntaxError.
The last cell is exempt: nothing follows it, and Jupyter writes the final line without one.
"""
import ast
import copy
import json
import os

import pytest

from _nbload import strip_magic_lines

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENT_COPY = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
APP_COPY = os.path.join(ROOT, "..", "dbx_inspire_ai_agent.ipynb")


def _load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _source(cell):
    src = cell.get("source") or []
    return "".join(src) if isinstance(src, list) else str(src)


def cells_missing_newline(nb):
    """Indexes of code cells that are followed by another code cell and do not end with a newline."""
    code = [i for i, cell in enumerate(nb["cells"]) if cell.get("cell_type") == "code"]
    return [i for i in code[:-1] if not _source(nb["cells"][i]).endswith("\n")]


def test_every_code_cell_of_the_agent_notebook_ends_with_a_newline():
    assert cells_missing_newline(_load(AGENT_COPY)) == []


def test_both_notebook_copies_are_identical_and_clean():
    with open(AGENT_COPY, "rb") as a, open(APP_COPY, "rb") as b:
        assert a.read() == b.read(), "the two notebook copies must stay byte-identical"
    assert cells_missing_newline(_load(APP_COPY)) == []


def test_the_joined_notebook_text_parses_as_python():
    # The offline suite joins code cells end to end; the joined text must parse, which only holds when every cell ends in a newline.
    nb = _load(AGENT_COPY)
    joined = "".join(strip_magic_lines(_source(c)) for c in nb["cells"] if c.get("cell_type") == "code")
    ast.parse(joined)


def test_a_planted_cell_without_a_trailing_newline_is_caught():
    nb = copy.deepcopy(_load(AGENT_COPY))
    code = [i for i, cell in enumerate(nb["cells"]) if cell.get("cell_type") == "code"]
    victim = nb["cells"][code[0]]
    victim["source"] = [_source(victim).rstrip("\n")]
    assert cells_missing_newline(nb) == [code[0]]
    with pytest.raises(SyntaxError):
        ast.parse("".join(strip_magic_lines(_source(c)) for c in nb["cells"] if c.get("cell_type") == "code"))
