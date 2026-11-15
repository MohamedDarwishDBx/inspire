"""REQ-307 (r21): a class must never define two methods with one name.

In Python the later `def` silently replaces the earlier one. P87 round 3 (5b5770ba5) added a second `Shell.run_summary(self, ws, who, page)`
next to the route's `Shell.run_summary(self, headers, ident)`, so every route call (`self.run_summary(headers, page_id)`) raised
`missing 1 required positional argument: 'page'` (46 Python failures on int2 2500f3565). The sweep covers every module the App shell ships
and every class in the agent notebook. A property and its setter share one name on purpose and are not a duplicate.
"""
import ast
import collections
import glob
import os

from _agentload import agent_source

SERVER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent", "app_shell", "server")


def duplicate_methods(tree):
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        names = collections.Counter()
        for item in node.body:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if any(isinstance(d, ast.Attribute) and d.attr in ("setter", "deleter") for d in item.decorator_list):
                continue
            names[item.name] += 1
        found += [(node.name, name) for name, count in names.items() if count > 1]
    return found


def test_no_app_shell_class_defines_a_method_twice():
    problems = {}
    for path in sorted(glob.glob(os.path.join(SERVER_DIR, "*.py"))):
        with open(path, encoding="utf-8") as handle:
            found = duplicate_methods(ast.parse(handle.read()))
        if found:
            problems[os.path.basename(path)] = found
    assert not problems, f"a class defines one method name twice, so the later def shadows the earlier one: {problems}"


def test_no_agent_notebook_class_defines_a_method_twice():
    found = duplicate_methods(ast.parse(agent_source()))
    assert not found, f"the agent notebook defines a method twice in one class: {found}"


def test_the_detector_flags_a_shadowed_method_and_allows_a_property_setter():
    shadowed = ast.parse("class A:\n    def f(self, x): ...\n    def f(self, x, y): ...\n")
    assert duplicate_methods(shadowed) == [("A", "f")]
    prop = ast.parse("class A:\n    @property\n    def v(self): ...\n    @v.setter\n    def v(self, value): ...\n")
    assert duplicate_methods(prop) == []
