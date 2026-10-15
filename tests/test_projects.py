"""프로젝트(폴더 접근): 폴더 고르기 목록, 위험 경로 거부, 동의 필수, 등록·이름 바꾸기·해제, 프로젝트 폴더에서 실행."""
import json
import os
from pathlib import Path

import pytest

from agentteam import providers
from conftest import collect
from server import projects


@pytest.fixture
def home(tmp_path, monkeypatch):
    """가짜 홈 폴더(실제 홈은 건드리지 않는다)."""
    h = tmp_path / "home"
    for d in ("Desktop", "Documents", "site/src", "site/.git", ".ssh/keys", "Library/Prefs"):
        (h / d).mkdir(parents=True)
    (h / "site" / "index.html").write_text("<p>secret?</p>", encoding="utf-8")
    monkeypatch.setenv("HOME", str(h))
    return h.resolve()


# ── 폴더 고르기 ────────────────────────────────────────
def test_fs_list_dirs_only_and_hidden(make_client, home):
    with make_client() as client:
        r = client.get("/api/fs/list", params={"path": str(home / "site")})
        assert r.status_code == 200
        data = r.json()
        assert data["path"] == str(home / "site") and data["parent"] == str(home)
        assert [d["name"] for d in data["dirs"]] == ["src"]          # 파일(index.html)·숨김 폴더(.git) 제외
        assert "secret" not in r.text and "index.html" not in r.text  # 파일 이름·내용은 내보내지 않는다
        assert data["selectable"] is True
        shown = client.get("/api/fs/list", params={"path": str(home / "site"), "hidden": 1}).json()
        assert [d["name"] for d in shown["dirs"]] == [".git", "src"]

        start = client.get("/api/fs/list").json()                      # 기본: 홈
        assert start["path"] == str(home) and start["selectable"] is False   # 홈 자체는 등록 불가
        names = [d["name"] for d in start["dirs"]]
        assert "site" in names and ".ssh" not in names
        assert next(d for d in start["dirs"] if d["name"] == "site")["has_children"] is True
        roots = {r["name"]: r["path"] for r in start["roots"]}
        assert roots["홈"] == str(home) and roots["데스크탑"] == str(home / "Desktop")
        assert roots["문서"] == str(home / "Documents") and "다운로드" not in roots and roots["상위 폴더"] == str(home.parent)

        assert client.get("/api/fs/list", params={"path": "relative/dir"}).status_code == 400
        assert client.get("/api/fs/list", params={"path": str(home / "nope")}).status_code == 400


# ── 위험 경로 ─────────────────────────────────────────
@pytest.mark.parametrize("path", ["/", "/System", "/usr/local", "/etc", "/private", "/private/tmp", "/Applications",
                                  "/Volumes", "/Users", "/bin", "/Library"])
def test_refuses_system_paths(home, path):
    if not Path(path).exists():
        pytest.skip("이 OS 에 없는 경로")
    with pytest.raises(projects.ProjectError):
        projects.check_path(path)


def test_refuses_home_and_secret_dirs(home, tmp_path):
    for p in (home, home / ".ssh", home / ".ssh" / "keys", home / "Library" / "Prefs"):
        with pytest.raises(projects.ProjectError):
            projects.check_path(str(p))
    with pytest.raises(projects.ProjectError, match="절대 경로"):
        projects.check_path("site")
    with pytest.raises(projects.ProjectError, match="폴더가 아닙니다"):
        projects.check_path(str(home / "site" / "index.html"))
    with pytest.raises(projects.ProjectError, match="없습니다"):
        projects.check_path(str(home / "missing"))
    repo = tmp_path / "repo"
    (repo / ".venv" / "lib").mkdir(parents=True)
    with pytest.raises(projects.ProjectError, match="가상환경"):
        projects.check_path(str(repo / ".venv" / "lib"), repo=repo)
    # 심볼릭 링크는 실제 위치로 검사한다
    link = home / "Desktop" / "keys-link"
    os.symlink(home / ".ssh", link)
    with pytest.raises(projects.ProjectError):
        projects.check_path(str(link))
    assert projects.check_path(str(home / "site")) == home / "site"


# ── 등록 · 이름 바꾸기 · 해제 ───────────────────────────
def test_project_crud_requires_consent(make_client, home, tmp_path):
    site = str(home / "site")
    with make_client() as client:
        r = client.post("/api/projects", json={"path": site})
        assert r.status_code == 400 and "동의" in r.json()["detail"]
        assert client.post("/api/projects", json={"path": str(home), "confirm": True}).status_code == 400
        assert client.post("/api/projects", json={"path": str(home / ".ssh"), "confirm": True}).status_code == 400

        r = client.post("/api/projects", json={"path": site + "/", "confirm": True})
        assert r.status_code == 200
        p = r.json()["project"]
        assert p["name"] == "site" and p["path"] == site and p["access"] == "full" and p["granted_at"]
        # 같은 폴더를 다시 추가하면 새로 만들지 않는다
        again = client.post("/api/projects", json={"path": site, "name": "내 사이트", "confirm": True}).json()["project"]
        assert again["id"] == p["id"] and again["name"] == "내 사이트"
        assert [x["id"] for x in client.get("/api/projects").json()["projects"]] == [p["id"]]

        r = client.patch(f"/api/projects/{p['id']}", json={"name": "  홈페이지  "})
        assert r.status_code == 200 and r.json()["project"]["name"] == "홈페이지"
        assert client.patch(f"/api/projects/{p['id']}", json={"name": "   "}).status_code == 400
        assert client.patch("/api/projects/nope", json={"name": "x"}).status_code == 404

        saved = json.loads((tmp_path / "projects.json").read_text(encoding="utf-8"))
        assert saved[0]["name"] == "홈페이지"

        assert client.delete(f"/api/projects/{p['id']}").json() == {"ok": True}
        assert client.delete(f"/api/projects/{p['id']}").status_code == 404
        assert client.get("/api/projects").json() == {"projects": []}


def test_projects_need_access_key(make_client, home):
    with make_client(access_key="s3cret") as client:
        assert client.get("/api/projects").status_code == 401
        assert client.get("/api/fs/list").status_code == 401
        assert client.get("/api/projects", headers={"X-Access-Key": "s3cret"}).status_code == 200


# ── 프로젝트 폴더에서 실행 ─────────────────────────────
def test_run_with_project_passes_workdir(make_client, home, runs_dir, monkeypatch):
    seen = []
    mock = providers._PROVIDERS["mock"]

    async def spy(m, prompt, system, workdir=None):
        seen.append((m.name, workdir, prompt))
        return await mock(m, prompt, system, workdir=workdir)

    monkeypatch.setitem(providers._PROVIDERS, "mock", spy)
    site = str(home / "site")
    with make_client() as client:
        pid = client.post("/api/projects", json={"path": site, "confirm": True}).json()["project"]["id"]
        assert client.post("/api/run", json={"goal": "x", "project_id": "nope"}).status_code == 404
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            r = client.post("/api/run", json={"goal": "폴더 정리", "project_id": pid})
            assert r.status_code == 200
            run_id = r.json()["run_id"]
            events = collect(ws)
        with client.websocket_connect("/ws") as ws:
            snap = ws.receive_json()["snapshot"]
        detail = client.get(f"/api/runs/{run_id}").json()
        listed = client.get("/api/runs").json()[0]

    project = {"id": pid, "name": "site", "path": site}
    assert events[0] == {"type": "run_start", "run_id": run_id, "goal": "폴더 정리", "project": project}
    assert events[-1]["ok"] is True and snap["project"] == project
    assert seen and all(w == site for _, w, _ in seen)                 # 계획·업무·검수 모두 프로젝트 폴더에서
    assert all(f"[프로젝트 폴더]\n{site}" in p for _, _, p in seen)     # 팀원에게 폴더 안내
    done = [e for e in events if e["type"] == "task_done"]
    assert done and all("‘site’" in e["result"] for e in done)         # 모의 결과에 폴더 이름
    assert "‘site’" in next(e for e in events if e["type"] == "report")["report"]
    assert detail["project"] == project and listed["project"] == "site"
    assert json.loads((runs_dir / run_id / "project.json").read_text(encoding="utf-8")) == project


def test_run_without_project_has_no_workdir(make_client, monkeypatch):
    seen = []
    mock = providers._PROVIDERS["mock"]

    async def spy(m, prompt, system, workdir=None):
        seen.append(workdir)
        return await mock(m, prompt, system)

    monkeypatch.setitem(providers._PROVIDERS, "mock", spy)
    with make_client() as client, client.websocket_connect("/ws") as ws:
        ws.receive_json()
        client.post("/api/run", json={"goal": "그냥 업무"})
        events = collect(ws)
    assert events[0]["project"] is None and seen and set(seen) == {None}


def test_run_refuses_project_whose_folder_vanished(make_client, home):
    d = home / "Documents" / "gone"
    d.mkdir()
    with make_client() as client:
        pid = client.post("/api/projects", json={"path": str(d), "confirm": True}).json()["project"]["id"]
        d.rmdir()
        r = client.post("/api/run", json={"goal": "x", "project_id": pid})
    assert r.status_code == 400 and "없습니다" in r.json()["detail"]
