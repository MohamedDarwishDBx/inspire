"""REQ-083: the groups of an App's service principal are read once per principal, and every grant check in one build reads that memo.

Before the memo, each grant plan (the App's own table, the reports table, the Genie grants) called the platform's service-principal
listing again for the same principal. The fail-pre: the listing runs once per principal, however many plans ask for its groups.
"""
import types

from v120_artifacts_support import make_inspire


def _inspire(agent_ns, listed):
    inst = make_inspire(agent_ns, spark=None)
    calls = []

    def service_principals_list(filter=None):
        calls.append(filter)
        return [types.SimpleNamespace(groups=[types.SimpleNamespace(display=g) for g in listed])]

    inst.w_client = types.SimpleNamespace(service_principals=types.SimpleNamespace(list=service_principals_list))
    inst.logger = types.SimpleNamespace(warning=lambda *a, **k: None, info=lambda *a, **k: None)
    return inst, calls


def test_the_groups_of_one_service_principal_are_listed_once_for_every_grant_plan_in_a_build(agent_ns):
    inst, calls = _inspire(agent_ns, ["app-readers", "analysts"])
    first = inst._implement_principal_groups("sp-1")
    second = inst._implement_principal_groups("sp-1")
    third = inst._implement_principal_groups("sp-1")
    assert first == second == third == ["analysts", "app-readers"]
    assert calls == ['applicationId eq "sp-1"'], "the platform is asked once for sp-1, whatever number of grant plans ask"


def test_each_service_principal_has_its_own_groups_and_its_own_single_listing(agent_ns):
    inst, calls = _inspire(agent_ns, ["app-readers"])
    inst._implement_principal_groups("sp-1")
    inst._implement_principal_groups("sp-2")
    inst._implement_principal_groups("sp-2")
    assert calls == ['applicationId eq "sp-1"', 'applicationId eq "sp-2"']


def test_the_returned_list_is_a_copy_so_a_caller_cannot_change_the_memo(agent_ns):
    inst, _calls = _inspire(agent_ns, ["app-readers"])
    inst._implement_principal_groups("sp-1").append("intruder")
    assert inst._implement_principal_groups("sp-1") == ["app-readers"]
