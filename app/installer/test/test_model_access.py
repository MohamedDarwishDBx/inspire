"""REQ-405: the installer grants the App's service principal CAN_QUERY on the chat model the agent would pick."""
import pathlib
import types
import unittest

import support

setup = support.load_setup()
NOTEBOOK = pathlib.Path(support.INSTALLER_DIR).parent / "agent" / "agent" / "dbx_inspire_ai_agent.ipynb"
SP = "11111111-2222-3333-4444-555555555555"


def endpoint(name, eid, task="llm/v1/chat"):
    return types.SimpleNamespace(name=name, id=eid, task=task, state=None, config=None)


def resp(status=200, text=""):
    return types.SimpleNamespace(status_code=status, text=text)


def workspace(endpoints=None, listing_error=None):
    def listed():
        if listing_error:
            raise listing_error
        return iter(endpoints or [])
    return types.SimpleNamespace(serving_endpoints=types.SimpleNamespace(list=listed))


def recording(status=200):
    calls = []

    def api(method, path, body=None):
        calls.append((method, path, body))
        return resp(status)
    return api, calls


class ModelAccessTest(unittest.TestCase):
    def setUp(self):
        self.notebook = NOTEBOOK.read_text(encoding="utf-8")
        self.endpoints = [
            endpoint("databricks-claude-sonnet-4-5", "id-sonnet-45"),
            endpoint("databricks-claude-sonnet-4-6", "id-sonnet-46"),
            endpoint("databricks-gpt-oss-120b", "id-gpt-120"),
            endpoint("databricks-bge-large-en", "id-embed", task="llm/v1/embeddings"),
            endpoint("my-custom-model", "id-custom", task="llm/v1/chat"),
        ]

    def test_every_chat_model_of_each_family_is_granted_newest_first_and_nothing_else(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace(self.endpoints), SP, self.notebook)
        granted = [path for _method, path, _body in calls]
        self.assertEqual(granted, ["/api/2.0/permissions/serving-endpoints/id-sonnet-46", "/api/2.0/permissions/serving-endpoints/id-sonnet-45",
                                   "/api/2.0/permissions/serving-endpoints/id-gpt-120"],
                         "both Claude Sonnet versions (newest first) and the GPT OSS 120b endpoint, and no embeddings or custom endpoint")
        for _method, _path, body in calls:
            self.assertEqual(body, {"access_control_list": [{"service_principal_name": SP, "permission_level": "CAN_QUERY"}]})
        self.assertTrue(any("CAN_QUERY for the App's service principal" in line for line in lines))

    def test_an_endpoint_the_installer_cannot_manage_is_logged_and_the_install_goes_on(self):
        api, calls = recording(status=403)
        lines = setup.grant_model_access(api, workspace(self.endpoints), SP, self.notebook)
        self.assertEqual(len(calls), 3, "every pick is still attempted")
        self.assertTrue(any("CAN_QUERY not granted (403" in line and "Permission Required" in line for line in lines), lines)

    def test_a_family_with_one_member_is_granted_and_an_endpoint_outside_the_families_is_not(self):
        api, calls = recording()
        only = [endpoint("databricks-claude-haiku-4-5", "id-haiku"), endpoint("unrelated-serving", "id-other")]
        setup.grant_model_access(api, workspace(only), SP, self.notebook)
        self.assertEqual([path for _m, path, _b in calls], ["/api/2.0/permissions/serving-endpoints/id-haiku"])

    def test_a_failed_listing_is_logged_not_raised(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace(listing_error=RuntimeError("PERMISSION_DENIED")), SP, self.notebook)
        self.assertEqual(calls, [], "nothing is granted when the endpoints cannot be listed")
        self.assertTrue(lines and lines[0].startswith("⚠️ not granted: the installer could not list"), lines)

    def test_a_workspace_with_no_chat_model_says_so_and_grants_nothing(self):
        api, calls = recording()
        lines = setup.grant_model_access(api, workspace([endpoint("databricks-bge-large-en", "id-embed", task="llm/v1/embeddings")]), SP,
                                         self.notebook)
        self.assertEqual(calls, [])
        self.assertTrue(lines[0].startswith("⚠️ not granted: no chat model endpoint is listed"), lines)

    def test_the_family_matching_is_the_notebook_own_and_a_missing_definition_is_named(self):
        matching = setup.agent_model_matching(self.notebook)
        self.assertEqual(setup.model_endpoints_to_grant(self.endpoints, matching),
                         ["databricks-claude-sonnet-4-6", "databricks-claude-sonnet-4-5", "databricks-gpt-oss-120b"])
        broken = self.notebook.replace("def _family_endpoints(", "def _renamed_family_endpoints(")
        lines = setup.grant_model_access(recording()[0], workspace(self.endpoints), SP, broken)
        self.assertTrue(lines[0].startswith("⚠️ not granted: the bundled agent notebook does not say which models"), lines)


if __name__ == "__main__":
    unittest.main()
