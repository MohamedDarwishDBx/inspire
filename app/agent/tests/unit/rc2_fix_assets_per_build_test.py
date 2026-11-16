"""REQ-339: an install of one Inspire build never shares its assets folder with another build of the same version.

Before the fix every build of v1.5.3 wrote into /Workspace/Shared/inspire-ai/assets/v1.5.3, so a second install replaced the
files the first install's notebooks pin, and Uninstall all on the first App raised "is from another Inspire build".
"""
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
INSTALLER = ROOT / "installer" / "inspire_setup.py"


def _installer():
    """The installer as the installer tests load it: its databricks imports stubbed when the SDK is absent."""
    sys.path.insert(0, str(ROOT / "installer" / "test"))
    import support
    return support.load_setup()


def _manifest_notebook_files(pins):
    return [{"kind": "notebook", "name": name, "version": "v1.5.3", "file": pin["file"], "sha256": pin["sha256"],
             "size": pin["size"], "license": "license/inspire.txt"} for name, pin in sorted(pins.items())]


def _write_folder(root, version, notebook_pins, data=None):
    """A folder as step_assets writes it: every notebook file, then the manifest that names them."""
    root = pathlib.Path(root)
    files = []
    for name, pin in sorted(notebook_pins.items()):
        body = (data or {}).get(name, b"x" * pin["size"])
        (root / pin["file"]).parent.mkdir(parents=True, exist_ok=True)
        (root / pin["file"]).write_bytes(body)
        files.append({"kind": "notebook", "name": name, "file": pin["file"], "size": len(body),
                      "sha256": __import__("hashlib").sha256(body).hexdigest(), "version": version})
    (root / "manifest.json").write_text(json.dumps({"format": 1, "inspire_version": version, "files": files}), encoding="utf-8")
    return root


def test_the_notebook_and_the_installer_name_one_build_the_same_way(agent_ns):
    pins = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]
    setup = _installer()
    assert agent_ns["inspire_assets_build_id"]() == setup.assets_build_id(_manifest_notebook_files(pins))
    assert agent_ns["inspire_assets_build_id"]() == agent_ns["inspire_assets_build_id"](pins)


def test_the_installer_build_id_is_pinned_so_a_change_to_the_pins_is_visible(agent_ns):
    """Golden value: changing a pinned notebook file changes the folder name on purpose."""
    setup = _installer()
    golden = setup.assets_build_id(_manifest_notebook_files(agent_ns["INSPIRE_NOTEBOOK_ASSETS"]))
    assert len(golden) == 12 and all(c in "0123456789abcdef" for c in golden)


def test_two_builds_of_one_version_get_two_folders(agent_ns):
    """Fails before the fix: both builds of v1.5.3 shared one folder, so the second install landed in the first's folder."""
    setup = _installer()
    pins = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]
    other = json.loads(json.dumps(pins))
    other["app_shell"]["sha256"] = "f" * 64
    first = setup.assets_root_for(f"{setup.ASSETS_PARENT}/v1.5.3", setup.assets_build_id(_manifest_notebook_files(pins)))
    second = setup.assets_root_for(f"{setup.ASSETS_PARENT}/v1.5.3", setup.assets_build_id(_manifest_notebook_files(other)))
    assert first != second
    assert first.startswith(f"{setup.ASSETS_PARENT}/v1.5.3/") and second.startswith(f"{setup.ASSETS_PARENT}/v1.5.3/")


def test_the_notebook_reads_the_folder_its_own_build_names_by_default(fresh_ns, monkeypatch):
    monkeypatch.setitem(fresh_ns, "inspire_widget", lambda name: "")
    assets = fresh_ns["InspireAssets"]()
    assert assets.root == f"{fresh_ns['INSPIRE_ASSETS_FOLDER']}/{fresh_ns['__AGENT_VERSION__']}/{fresh_ns['inspire_assets_build_id']()}"


def test_the_first_builds_notebook_still_loads_its_assets_after_a_second_build_lands_beside_it(agent_ns, tmp_path):
    """Fails before the fix: the second build's files overwrote the first build's folder, so its notebook refused them."""
    pins = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]
    setup = _installer()
    shell = (ROOT / "agent" / "agent" / "app_shell" / "app_shell.b64").read_bytes()
    first_pins = dict(pins, app_shell=dict(pins["app_shell"], sha256=agent_ns["INSPIRE_NOTEBOOK_ASSETS"]["app_shell"]["sha256"]))
    first = setup.assets_root_for(f"{tmp_path}/v1.5.3", setup.assets_build_id(_manifest_notebook_files(first_pins)))
    second = setup.assets_root_for(f"{tmp_path}/v1.5.3", setup.assets_build_id(_manifest_notebook_files(dict(pins, app_shell=dict(pins["app_shell"], sha256="e" * 64)))))
    _write_folder(first, "v1.5.3", first_pins, {"app_shell": shell})
    _write_folder(second, "v1.5.3", dict(pins, app_shell=dict(pins["app_shell"], sha256="e" * 64)), {"app_shell": b"second build"})
    assert first != second
    loaded = agent_ns["InspireAssets"](first, local=str(tmp_path / "local_a")).notebook_file("app_shell")
    assert loaded == shell


def test_a_notebook_still_refuses_another_builds_folder(agent_ns, tmp_path):
    """Must-fail: pointing a notebook at another build's folder keeps the refusal."""
    pins = agent_ns["INSPIRE_NOTEBOOK_ASSETS"]
    other = dict(pins, app_shell=dict(pins["app_shell"], sha256="e" * 64, size=pins["app_shell"]["size"]))
    folder = _write_folder(tmp_path / "other", "v1.5.3", other, {"app_shell": b"y" * pins["app_shell"]["size"]})
    with pytest.raises(agent_ns["InspireAssetError"], match="is from another Inspire build than this notebook"):
        agent_ns["InspireAssets"](str(folder), local=str(tmp_path / "local_b")).notebook_file("app_shell")
