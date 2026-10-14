import json

import pytest
from starlette.websockets import WebSocketDisconnect

from conftest import collect

KEY = {"X-Access-Key": "s3cret"}


def test_team(make_client):
    with make_client() as client:
        r = client.get("/api/team")
    assert r.status_code == 200
    team = r.json()
    assert team["leader"] == "claude"
    assert {m["name"] for m in team["members"]} == {"claude", "gpt", "gemini"}


def test_static_index(make_client):
    with make_client() as client:
        r = client.get("/")
    assert r.status_code == 200 and "<h1>web</h1>" in r.text


@pytest.mark.parametrize("body", [{"goal": ""}, {"goal": "   \n "}, {}, {"goal": "가" * 4001}])
def test_run_rejects_bad_goal(make_client, body):
    with make_client() as client:
        r = client.post("/api/run", json=body)
    assert r.status_code == 400 and r.json()["detail"]


def test_full_mock_run(make_client):
    with make_client() as client:
        with client.websocket_connect("/ws") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello" and hello["mock"] is True and hello["snapshot"] is None
            assert hello["team"]["leader"] == "claude"

            r = client.post("/api/run", json={"goal": "  모의 목표  "})
            assert r.status_code == 200
            run_id = r.json()["run_id"]
            events = collect(ws)

            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

        # 나중에 접속한 사람도 마지막 결과를 본다
        with client.websocket_connect("/ws") as ws:
            snap = ws.receive_json()["snapshot"]

    types = [e["type"] for e in events]
    assert types[:3] == ["run_start", "plan_start", "plan"]
    assert types[-3:] == ["review_start", "report", "run_end"]
    assert events[0] == {"type": "run_start", "run_id": run_id, "goal": "모의 목표"}
    assert events[-1] == {"type": "run_end", "run_id": run_id, "ok": True}

    tasks = {t["id"]: t for t in events[2]["tasks"]}
    started, done = set(), set()
    for e in events[3:-3]:
        assert e["type"] in ("task_start", "task_done")
        if e["type"] == "task_start":
            assert e["id"] not in started and set(tasks[e["id"]]["depends_on"]) <= done
            started.add(e["id"])
        else:
            assert e["id"] in started and e["id"] not in done and e["ok"] is True
            done.add(e["id"])
    assert started == done == set(tasks)

    assert snap["run_id"] == run_id and snap["phase"] == "done" and snap["ok"] is True
    assert snap["report"] and all(t["state"] == "done" and t["result"] for t in snap["tasks"])


def test_conflict_while_running(make_client, monkeypatch):
    monkeypatch.setenv("MOCK_DELAY", "0.2")
    with make_client() as client, client.websocket_connect("/ws") as ws:
        ws.receive_json()
        assert client.post("/api/run", json={"goal": "첫 업무"}).status_code == 200
        r = client.post("/api/run", json={"goal": "둘째 업무"})
        assert r.status_code == 409 and r.json()["detail"] == "이미 진행 중인 업무가 있습니다."
        assert collect(ws)[-1]["ok"] is True
        r = client.post("/api/run", json={"goal": "끝난 뒤 업무"})  # 끝나면 다시 시작 가능
        assert r.status_code == 200


def test_access_key(make_client):
    with make_client("s3cret") as client:
        for method, url in [("GET", "/api/team"), ("GET", "/api/runs"),
                            ("GET", "/api/runs/20261014-160000"), ("POST", "/api/run")]:
            for headers in ({}, {"X-Access-Key": "wrong"}):
                r = client.request(method, url, headers=headers, json={"goal": "x"})
                assert r.status_code == 401 and r.json()["detail"] == "접속 키가 필요합니다."
        assert client.get("/api/team", headers=KEY).status_code == 200
        assert client.get("/").status_code == 200  # 정적 파일은 공개

        for url in ("/ws", "/ws?key=wrong"):
            with pytest.raises(WebSocketDisconnect) as e:
                with client.websocket_connect(url) as ws:
                    ws.receive_json()
            assert e.value.code == 4401

        with client.websocket_connect("/ws?key=s3cret") as ws:
            assert ws.receive_json()["type"] == "hello"
            assert client.post("/api/run", json={"goal": "키로 실행"}, headers=KEY).status_code == 200
            assert collect(ws)[-1]["ok"] is True


def test_runs_list_and_detail(make_client, runs_dir):
    # 예전 실행 기록(실패 포함)과 무관한 폴더를 미리 만든다
    for name in ("20200101-000000", "20200101-000000-2", "20200101-000000-10"):
        (runs_dir / name).mkdir(parents=True)
        (runs_dir / name / "goal.txt").write_text(f"옛 목표 {name}", encoding="utf-8")
    (runs_dir / "20200101-000000-2" / "error.txt").write_text("API 오류", encoding="utf-8")
    (runs_dir / "notes").mkdir()

    with make_client() as client:
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            run_id = client.post("/api/run", json={"goal": "기록 테스트"}).json()["run_id"]
            collect(ws)
        runs = client.get("/api/runs").json()
        detail = client.get(f"/api/runs/{run_id}").json()
        failed = client.get("/api/runs/20200101-000000-2").json()

    assert [r["run_id"] for r in runs] == [run_id, "20200101-000000-10", "20200101-000000-2", "20200101-000000"]
    assert runs[0]["goal"] == "기록 테스트" and runs[0]["has_report"] and not runs[0]["has_error"]
    assert runs[2]["has_error"] and not runs[2]["has_report"]
    assert runs[3]["created"] == "2020-01-01T00:00:00"

    assert detail["goal"] == "기록 테스트" and detail["error"] is None
    assert detail["plan"]["tasks"] and "기록 테스트" in detail["report"]
    assert len(detail["tasks"]) == len(detail["plan"]["tasks"])
    assert [t["file"][:7] for t in detail["tasks"]] == [f"task-{t['id']:02d}" for t in detail["plan"]["tasks"]]
    assert failed == {"run_id": "20200101-000000-2", "goal": "옛 목표 20200101-000000-2", "plan": None,
                      "tasks": [], "report": None, "error": "API 오류"}


@pytest.mark.parametrize("url", [
    "/api/runs/../x", "/api/runs/..%2F..%2Fteam.toml", "/api/runs/%2e%2e", "/api/runs/abc",
    "/api/runs/20200101-000000x", "/api/runs/20200101-000000%0A", "/api/runs/29991231-235959",
])
def test_bad_run_id(make_client, runs_dir, tmp_path, url):
    (tmp_path / "x").mkdir()
    (runs_dir / "20200101-000000").mkdir(parents=True)
    with make_client() as client:
        r = client.get(url)
    assert r.status_code == 404


def test_empty_runs(make_client):
    with make_client() as client:
        assert client.get("/api/runs").json() == []


def test_ws_ignores_garbage(make_client):
    with make_client() as client, client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_text("not json")
        ws.send_bytes(b"\x00")
        ws.send_text(json.dumps({"type": "ping"}))
        assert ws.receive_json() == {"type": "pong"}
