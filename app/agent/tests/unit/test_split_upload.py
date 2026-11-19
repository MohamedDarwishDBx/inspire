"""Offline tests for the split upload in rc_install.py. No workspace is touched: the workspace and the job runner are
stubs, and the join notebook is executed against a local directory standing in for /Workspace."""
import base64
import importlib
import json
import os
import pathlib
import sys
import tempfile
from types import SimpleNamespace

import pytest

HERE = pathlib.Path(__file__).resolve().parents[2] / "release"
sys.path.insert(0, str(HERE))

_settings_dir = pathlib.Path(tempfile.mkdtemp(prefix="rc_split_test_"))
_settings = _settings_dir / "settings.json"
_settings.write_text(json.dumps({
    "profile": "test", "warehouse": "wh", "catalog": "cat", "protected_apps": ["p"], "scratch_app": "scratch",
    "watched_service_principals": ["sp"], "workspace_folder": "folder", "work": str(_settings_dir / "work"),
}), encoding="utf-8")
os.environ["INSPIRE_RC_SETTINGS"] = str(_settings)
rc = importlib.import_module("rc_install")

FOLDER = "/Users/tester/inspire_test/v1.5.4-rc.2-split"
TAR = "inspire-assets.tar"


class FakeWorkspace:
    """Stores uploads on local disk under root. Upload paths map to root + path; the join notebook's /Workspace
    prefix is rewritten to root when it runs."""

    def __init__(self, root, fail_upload=None, tamper=None):
        self.root = pathlib.Path(root)
        self.fail_upload = fail_upload or {}
        self.tamper = tamper or {}
        self.upload_calls = []
        self.notebooks = {}
        self.deleted = []

    def _local(self, path):
        return self.root / path.lstrip("/")

    def upload(self, path, handle, format=None, overwrite=False):
        name = path.rsplit("/", 1)[1]
        self.upload_calls.append(name)
        if self.fail_upload.get(name):
            raise self.fail_upload[name].pop(0)
        data = handle.read()
        if name in self.tamper:
            data = self.tamper[name](data)
        target = self._local(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def import_(self, path, content, format=None, language=None, overwrite=False):
        self.notebooks[path] = base64.b64decode(content).decode()

    def delete(self, path):
        self.deleted.append(path.rsplit("/", 1)[1])
        self._local(path).unlink(missing_ok=True)


class FakeJobs:
    def __init__(self, ws):
        self.ws = ws
        self.states = {}
        self.next_id = 100

    def submit(self, run_name=None, tasks=None, environments=None):
        task = tasks[0].notebook_task
        code = self.ws.notebooks[task.notebook_path].replace("/Workspace", str(self.ws.root))
        self.next_id += 1
        run_id = self.next_id
        try:
            exec(compile(code, "join", "exec"), {})
            result = "SUCCESS"
        except Exception:
            result = "FAILED"
        self.states[run_id] = SimpleNamespace(life_cycle_state=SimpleNamespace(value="TERMINATED"),
                                              result_state=SimpleNamespace(value=result))
        return SimpleNamespace(response=SimpleNamespace(run_id=run_id))

    def get_run(self, run_id):
        return SimpleNamespace(state=self.states[run_id])


def fake_client(ws):
    return SimpleNamespace(workspace=ws, jobs=FakeJobs(ws))


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(rc.time, "sleep", lambda seconds: None)


def make_tar(path, size):
    data = bytes(range(256)) * (size // 256) + bytes(range(size % 256))
    path.write_bytes(data)
    return data


# splitting math

def test_part_ranges_cover_the_file_with_a_short_tail():
    assert rc.part_ranges(20, 8) == [(1, 0, 8), (2, 8, 8), (3, 16, 4)]


def test_part_ranges_exact_multiple_has_no_empty_tail():
    assert rc.part_ranges(16, 8) == [(1, 0, 8), (2, 8, 8)]


def test_part_ranges_file_smaller_than_one_part_is_one_part():
    assert rc.part_ranges(5, 8) == [(1, 0, 5)]


def test_part_ranges_rejects_non_positive_part_size():
    with pytest.raises(ValueError):
        rc.part_ranges(10, 0)


# default threshold and the env override

def test_threshold_is_64_mb():
    assert rc.SPLIT_THRESHOLD == 64 << 20


def test_default_splits_only_files_over_64_mb(monkeypatch):
    monkeypatch.delenv("INSPIRE_RC_SPLIT_UPLOAD", raising=False)
    assert rc.split_wanted(64 << 20) is False
    assert rc.split_wanted((64 << 20) + 1) is True
    assert rc.split_wanted(415_037_440) is True


def test_env_override_forces_or_disables_split(monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_SPLIT_UPLOAD", "1")
    assert rc.split_wanted(10) is True
    monkeypatch.setenv("INSPIRE_RC_SPLIT_UPLOAD", "0")
    assert rc.split_wanted(415_037_440) is False


def test_env_override_rejects_unknown_value(monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_SPLIT_UPLOAD", "yes")
    with pytest.raises(SystemExit):
        rc.split_wanted(10)


# join notebook content, executed against a local directory

def test_join_code_joins_in_order_and_replaces_only_after_sha_matches(tmp_path):
    parts = [b"aaaa", b"bbbb", b"cc"]
    base = tmp_path / TAR
    for i, data in enumerate(parts, start=1):
        pathlib.Path(f"{base}.part{i:03d}").write_bytes(data)
    want = __import__("hashlib").sha256(b"".join(parts)).hexdigest()
    exec(rc.join_code(str(base), len(parts), want), {})
    assert base.read_bytes() == b"".join(parts)
    assert not pathlib.Path(f"{base}.joining").exists()


def test_join_code_mismatch_raises_and_writes_no_target(tmp_path):
    base = tmp_path / TAR
    pathlib.Path(f"{base}.part001").write_bytes(b"aaaa")
    with pytest.raises(RuntimeError, match="parts are kept"):
        exec(rc.join_code(str(base), 1, "0" * 64), {})
    assert not base.exists()
    assert pathlib.Path(f"{base}.part001").exists()


# the whole split, through the stubs

def test_split_upload_end_to_end_joins_then_deletes_parts_and_notebook(tmp_path, monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_PART_MB", "1")
    tar = tmp_path / TAR
    data = make_tar(tar, int(2.5 * (1 << 20)))
    ws = FakeWorkspace(tmp_path / "ws")
    rc.split_upload(fake_client(ws), tar, FOLDER)
    installed = (tmp_path / "ws" / FOLDER.lstrip("/") / TAR).read_bytes()
    assert installed == data
    assert ws.upload_calls[:3] == [f"{TAR}.part001", f"{TAR}.part002", f"{TAR}.part003"]
    assert sorted(ws.deleted) == sorted([f"{TAR}.part001", f"{TAR}.part002", f"{TAR}.part003", "assets_join"])
    assert not (tmp_path / "ws" / FOLDER.lstrip("/") / f"{TAR}.joining").exists()


def test_split_upload_sha_mismatch_stops_install_and_keeps_parts(tmp_path, monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_PART_MB", "1")
    tar = tmp_path / TAR
    make_tar(tar, int(2.5 * (1 << 20)))
    ws = FakeWorkspace(tmp_path / "ws", tamper={f"{TAR}.part002": lambda data: data[:-1] + bytes([data[-1] ^ 1])})
    with pytest.raises(SystemExit, match="ended FAILED"):
        rc.split_upload(fake_client(ws), tar, FOLDER)
    installed = tmp_path / "ws" / FOLDER.lstrip("/") / TAR
    assert not installed.exists()
    assert (tmp_path / "ws" / FOLDER.lstrip("/") / f"{TAR}.part002").exists()
    assert "assets_join" not in ws.deleted


def test_part_retry_sends_only_the_failed_part_again(tmp_path, monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_PART_MB", "1")
    tar = tmp_path / TAR
    data = make_tar(tar, int(2.5 * (1 << 20)))
    ws = FakeWorkspace(tmp_path / "ws", fail_upload={f"{TAR}.part002": [OSError("connection reset"), OSError("timed out")]})
    rc.split_upload(fake_client(ws), tar, FOLDER)
    assert ws.upload_calls.count(f"{TAR}.part002") == 3
    assert ws.upload_calls.count(f"{TAR}.part001") == 1
    assert ws.upload_calls.count(f"{TAR}.part003") == 1
    assert (tmp_path / "ws" / FOLDER.lstrip("/") / TAR).read_bytes() == data


def test_part_retry_gives_up_after_the_attempt_limit(tmp_path, monkeypatch):
    monkeypatch.setenv("INSPIRE_RC_PART_MB", "1")
    tar = tmp_path / TAR
    make_tar(tar, int(2.5 * (1 << 20)))
    ws = FakeWorkspace(tmp_path / "ws", fail_upload={f"{TAR}.part002": [OSError("connection reset")] * rc.PART_ATTEMPTS})
    with pytest.raises(SystemExit, match="failed 4 times"):
        rc.split_upload(fake_client(ws), tar, FOLDER)
    assert ws.upload_calls.count(f"{TAR}.part002") == rc.PART_ATTEMPTS
    assert ws.upload_calls.count(f"{TAR}.part003") == 0
