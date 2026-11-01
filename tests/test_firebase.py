"""브레인 자료 Firebase 양방향 동기화: 두 컴퓨터(집·회사)가 가짜 Firestore 하나를 같이 쓴다(네트워크 없음)."""
import base64
import gzip
import json
import os
import time

from server import firebase


class FakeAuth:
    def get(self):
        return "tok"


class FakeFirestore:
    def __init__(self):
        self.docs = {}       # (컬렉션, 이름) → body

    def attach(self, sync):
        def call(url, method="GET", body=None):
            path = url.split("/documents/", 1)[1].split("?")[0]
            coll, _, name = path.partition("/")
            if method == "PATCH":
                self.docs[(coll, name)] = body
                return {}
            return {"documents": [{"name": f"x/{c}/{n}", **b} for (c, n), b in self.docs.items() if c == coll]}
        sync._call = call
        return sync

    def data(self, name):
        return json.loads(gzip.decompress(base64.b64decode(self.docs[("agent-brain", name)]["fields"]["data"]["bytesValue"])))


def write(p, d, ago=0):
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    t = time.time() - ago
    os.utime(p, (t, t))


def machine(fs, d, host, pulled=None):
    d.mkdir(exist_ok=True)
    return fs.attach(firebase.Sync(d, FakeAuth(), host=host, on_pull=(pulled.append if pulled is not None else None)))


def test_two_way_sync_between_home_and_office(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    fs, pulled = FakeFirestore(), []
    home, office = tmp_path / "home", tmp_path / "office"
    h = machine(fs, home, "home")
    write(home / "brain.json", {"shortcuts": [1], "calendars": [{"id": "c1", "name": "회사", "url": "https://secret.example/a.ics"}]}, ago=100)
    write(home / "brain-skill-runs.json", [])                                  # 컴퓨터마다 따로라 올리지 않는다
    assert h.sync() == {"pulled": [], "pushed": ["brain.json"]}
    assert fs.data("brain.json")["calendars"] == [{"id": "c1", "name": "회사"}]   # 비공개 주소는 올라가지 않는다

    o = machine(fs, office, "office", pulled)
    assert o.sync()["pulled"] == ["brain.json"] and pulled == ["brain.json"]   # 회사 컴퓨터는 받아 온다
    assert json.loads((office / "brain.json").read_text())["shortcuts"] == [1]
    assert o.others == ["home"] and o.status()["others"] == ["home"]           # 집 서버도 켜져 있다고 알린다

    write(office / "brain.json", {"shortcuts": [1, 2], "calendars": [{"id": "c1", "name": "회사"}]})
    assert o.sync()["pushed"] == ["brain.json"]                                # 회사에서 바꾸면 올리고
    assert h.sync()["pulled"] == ["brain.json"]                                # 집에서 받는다
    got = json.loads((home / "brain.json").read_text())
    assert got["shortcuts"] == [1, 2] and got["calendars"][0]["url"] == "https://secret.example/a.ics"   # 집의 비공개 주소는 지킨다
    assert h.sync() == {"pulled": [], "pushed": []} and o.sync() == {"pulled": [], "pushed": []}        # 더 할 게 없다


def test_conflict_newer_wins_and_loser_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    fs = FakeFirestore()
    h, o = machine(fs, tmp_path / "home", "home"), machine(fs, tmp_path / "office", "office")
    write(h.dir / "brain.json", {"v": 0}, ago=500)
    h.sync(), o.sync()
    write(h.dir / "brain.json", {"v": "home"}, ago=60)                         # 둘 다 고쳤지만 회사가 더 최근
    write(o.dir / "brain.json", {"v": "office"}, ago=5)
    o.sync()
    assert h.sync()["pulled"] == ["brain.json"]
    assert json.loads((h.dir / "brain.json").read_text()) == {"v": "office"}
    kept = list((h.dir / "firebase-conflicts").glob("brain.local.*.json"))
    assert len(kept) == 1 and json.loads(kept[0].read_text()) == {"v": "home"}   # 진 쪽은 지우지 않고 남긴다


def test_state_survives_restart(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    fs = FakeFirestore()
    h = machine(fs, tmp_path / "home", "home")
    write(h.dir / "brain-mail-store.json", {"items": [1]})
    h.sync()
    again = machine(fs, tmp_path / "home", "home")                             # 서버를 다시 켜도 다시 올리지 않는다
    assert again.sync() == {"pulled": [], "pushed": []}


def test_off_without_project(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "")
    (tmp_path / "brain.json").write_text("{}", encoding="utf-8")
    sync = firebase.Sync(tmp_path, FakeAuth())
    assert sync.sync() == {"pulled": [], "pushed": []} and sync.status()["enabled"] is False


def test_api_status(make_client):
    with make_client() as c:
        assert c.get("/api/brain/firebase").json()["enabled"] is False
        assert c.post("/api/brain/firebase/sync").status_code == 400


def test_accumulating_files_are_merged(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    fs = FakeFirestore()
    h, o = machine(fs, tmp_path / "home", "home"), machine(fs, tmp_path / "office", "office")
    write(h.dir / "brain-mail-store.json", {"items": [{"id": "a", "date": "2026-11-01"}], "at": 1, "span": 30}, ago=300)
    write(h.dir / "brain-meet-done.json", {"p:0": True}, ago=300)
    h.sync(), o.sync()
    write(h.dir / "brain-mail-store.json", {"items": [{"id": "a", "date": "2026-11-01"}, {"id": "h", "date": "2026-11-02"}], "at": 5, "span": 30}, ago=60)
    write(o.dir / "brain-mail-store.json", {"items": [{"id": "a", "date": "2026-11-01"}, {"id": "o", "date": "2026-11-03"}], "at": 9, "span": 30}, ago=5)
    write(h.dir / "brain-meet-done.json", {"p:0": True, "p:1": True}, ago=60)
    write(o.dir / "brain-meet-done.json", {"p:0": True, "q:2": True}, ago=5)
    o.sync(), h.sync(), o.sync()                                              # 양쪽 다 바뀐 쌓이는 파일은 합친다
    for d in (h.dir, o.dir):
        assert [m["id"] for m in json.loads((d / "brain-mail-store.json").read_text())["items"]] == ["o", "h", "a"]
        assert json.loads((d / "brain-meet-done.json").read_text()) == {"p:0": True, "p:1": True, "q:2": True}


def test_first_sync_keeps_overwritten_remote(tmp_path, monkeypatch):
    monkeypatch.setattr(firebase, "project", lambda: "demo-project")
    fs = FakeFirestore()
    h = machine(fs, tmp_path / "home", "home")
    write(h.dir / "brain.json", {"v": "home"}, ago=500)
    h.sync()
    o = machine(fs, tmp_path / "office", "office")
    write(o.dir / "brain.json", {"v": "office"}, ago=5)                        # 처음 맞출 때 이쪽이 더 최근이면 올리되
    o.sync()
    kept = list((o.dir / "firebase-conflicts").glob("brain.remote.*.json"))
    assert len(kept) == 1 and json.loads(kept[0].read_text()) == {"v": "home"}   # 덮어쓴 Firestore 쪽을 남긴다
