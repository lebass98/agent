"""브레인 자료 Firebase 백업: 비밀 빼기 · 바뀐 파일만 올리기 · 없는 파일 되살리기(네트워크 없이 가짜 Firestore)."""
import base64
import gzip
import json
import os

from server import firebase


class FakeAuth:
    def get(self):
        return "tok"


def fake_store(monkeypatch, sync):
    docs, calls = {}, []

    def call(url, method="GET", body=None):
        calls.append(method)
        name = url.split("/agent-brain")[-1].lstrip("/").split("?")[0]
        if method == "PATCH":
            docs[name] = body
            return {}
        return {"documents": [{"name": f"x/agent-brain/{k}", **v} for k, v in docs.items()]}
    monkeypatch.setattr(sync, "_call", call)
    return docs, calls


def test_push_strips_calendar_url_and_skips_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    (tmp_path / "brain.json").write_text(json.dumps({"calendars": [{"name": "회사", "url": "https://secret.example/basic.ics"}]}), encoding="utf-8")
    (tmp_path / "notify.json").write_text("{}", encoding="utf-8")          # 브레인 파일이 아니면 올리지 않는다
    sync = firebase.Sync(tmp_path, FakeAuth())
    docs, calls = fake_store(monkeypatch, sync)
    assert sync.push() == 1 and list(docs) == ["brain.json"]
    up = json.loads(gzip.decompress(base64.b64decode(docs["brain.json"]["fields"]["data"]["bytesValue"])))
    assert up == {"calendars": [{"name": "회사"}]}                          # 캘린더 비공개 주소는 빠진다
    assert json.loads((tmp_path / "brain.json").read_text())["calendars"][0]["url"]   # 이 컴퓨터 파일은 그대로
    assert sync.push() == 0 and sync.push(force=True) == 1                 # 안 바뀌면 다시 올리지 않는다
    assert sync.status()["enabled"] and sync.status()["project"] == "demo-project"


def test_restore_only_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    src, dst = tmp_path / "a", tmp_path / "b"
    src.mkdir()
    (src / "brain-mail-store.json").write_text('{"items": [1]}', encoding="utf-8")
    (src / "brain.json").write_text('{"shortcuts": []}', encoding="utf-8")
    up = firebase.Sync(src, FakeAuth())
    docs, _ = fake_store(monkeypatch, up)
    up.push()
    dst.mkdir()
    (dst / "brain.json").write_text('{"local": true}', encoding="utf-8")
    down = firebase.Sync(dst, FakeAuth())
    monkeypatch.setattr(down, "_call", lambda url, method="GET", body=None: {"documents": [{"name": f"x/agent-brain/{k}", **v} for k, v in docs.items()]})
    assert down.restore() == ["brain-mail-store.json"]                     # 이 컴퓨터에 있는 파일은 덮어쓰지 않는다
    assert json.loads((dst / "brain-mail-store.json").read_text()) == {"items": [1]}
    assert json.loads((dst / "brain.json").read_text()) == {"local": True}


def test_off_without_project(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "")
    (tmp_path / "brain.json").write_text("{}", encoding="utf-8")
    sync = firebase.Sync(tmp_path, FakeAuth())
    assert sync.push() == 0 and sync.restore() == [] and sync.status()["enabled"] is False


def test_api_status(make_client):
    with make_client() as c:
        assert c.get("/api/brain/firebase").json()["enabled"] is False
        assert c.post("/api/brain/firebase/sync").status_code == 400
