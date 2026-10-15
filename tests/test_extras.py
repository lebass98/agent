"""팀 실행 보강: 자동 재시도 · 팀장 보완 요청 · 중단된 업무 이어 하기 · 사용량 기록 · 결과 알림(웹훅) · 외부 도구(MCP) 승인."""
import asyncio
import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import agentteam.team as team_mod
from agentteam import Team, cli, providers
from conftest import ROOT, collect
from server import mcptools

LOCAL = ("127.0.0.1", 50000)


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(team_mod, "RETRY_DELAY", 0)
    monkeypatch.delenv("MOCK_REWORK", raising=False)
    monkeypatch.delenv("MOCK_FAIL_ONCE", raising=False)
    providers._MOCK_FAILED.clear()


def run_events(client, goal="보강 테스트", **body) -> tuple[str, list[dict]]:
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        r = client.post("/api/run", json={"goal": goal, **body})
        assert r.status_code == 200, r.text
        return r.json()["run_id"], collect(ws)


# ── 1. 자동 재시도 · 보완 요청 ─────────────────────────────
def test_transient_failure_is_retried(make_client, monkeypatch):
    monkeypatch.setenv("MOCK_FAIL_ONCE", "핵심 기능 구현")
    with make_client() as client:
        _, events = run_events(client)
    retry = [e for e in events if e["type"] == "retry"]
    assert retry and retry[0]["stage"] == "task" and retry[0]["id"] == 2 and retry[0]["attempt"] == 2
    done = {e["id"]: e for e in events if e["type"] == "task_done"}
    assert done[2]["ok"] is True and done[2]["usage"]["ms"] >= 0


def test_no_retry_for_setup_errors():
    assert not team_mod._retryable(RuntimeError("'claude' CLI 가 없습니다. 설치하세요"))
    assert not team_mod._retryable(ValueError("알 수 없는 provider: x"))
    assert team_mod._retryable(RuntimeError("claude 응답 시간 초과(900초)"))


def test_leader_requests_rework(make_client, monkeypatch, runs_dir):
    monkeypatch.setenv("MOCK_REWORK", "1")
    with make_client() as client:
        run_id, events = run_events(client)
        with client.websocket_connect("/ws") as ws:
            snap = ws.receive_json()["snapshot"]
    types = [e["type"] for e in events]
    assert "rework" in types and types.index("rework") < types.index("review_start")
    rw = next(e for e in events if e["type"] == "rework")
    assert rw["round"] == 1 and len(rw["tasks"]) == 1
    t = rw["tasks"][0]
    assert t["id"] == 5 and t["of"] == 1 and t["title"].startswith("보완: ") and t["feedback"] and "instruction" not in t
    assert any(e["type"] == "task_done" and e["id"] == 5 and e["ok"] for e in events)
    assert len(snap["tasks"]) == 5 and snap["phase"] == "done"
    state = json.loads((runs_dir / run_id / "state.json").read_text(encoding="utf-8"))
    assert state["status"] == "done" and state["rework_round"] == 1 and state["extra_tasks"][0]["of"] == 1


def test_rework_can_be_turned_off(make_client, monkeypatch):
    monkeypatch.setenv("MOCK_REWORK", "1")
    monkeypatch.setenv("AGENT_REWORK", "0")
    with make_client() as client:
        _, events = run_events(client)
    assert "rework" not in [e["type"] for e in events]


# ── 2. 이어 하기 ─────────────────────────────────────────
def test_interrupted_run_can_be_resumed(make_client, monkeypatch, runs_dir):
    real = providers._PROVIDERS["mock"]

    async def cut(m, prompt, system, workdir=None):
        if "테스트 시나리오" in prompt:  # 마지막 업무 도중 서버가 꺼진 것처럼
            raise asyncio.CancelledError()
        return await real(m, prompt, system, workdir)

    monkeypatch.setitem(providers._PROVIDERS, "mock", cut)
    team = Team(ROOT / "team.toml", mock=True)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(team.run("이어 하기 목표", runs_dir, run_id="20260101-000000"))
    d = runs_dir / "20260101-000000"
    assert json.loads((d / "state.json").read_text(encoding="utf-8"))["status"] == "interrupted"
    monkeypatch.setitem(providers._PROVIDERS, "mock", real)

    with make_client() as client:
        runs = client.get("/api/runs/resumable").json()["runs"]
        assert runs[0]["run_id"] == "20260101-000000" and runs[0]["goal"] == "이어 하기 목표"
        assert runs[0]["total"] == 4 and runs[0]["done"] == 3
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            assert client.post("/api/runs/20260101-000000/resume", json={}).status_code == 200
            events = collect(ws)
        assert client.get("/api/runs/resumable").json()["runs"] == []
    types = [e["type"] for e in events]
    assert "plan_start" not in types and events[0]["resumed"] is True
    plan = next(e for e in events if e["type"] == "plan")
    assert plan["resumed"] is True and len(plan["tasks"]) == 4
    resumed = {e["id"] for e in events if e["type"] == "task_done" and e.get("resumed")}
    fresh = {e["id"] for e in events if e["type"] == "task_done" and not e.get("resumed")}
    assert resumed == {1, 2, 3} and fresh == {4}
    assert events[-1]["ok"] is True and (d / "report.md").is_file()


def test_running_state_is_marked_interrupted_on_startup(make_client, runs_dir):
    d = runs_dir / "20260102-000000"
    d.mkdir(parents=True)
    (d / "goal.txt").write_text("끊긴 업무", encoding="utf-8")
    (d / "state.json").write_text(json.dumps({"status": "running", "stage": "plan"}), encoding="utf-8")
    with make_client() as client:
        runs = client.get("/api/runs/resumable").json()["runs"]
        assert runs and runs[0]["status"] == "interrupted" and runs[0]["total"] == 0
        assert client.post("/api/runs/20260102-000000/dismiss").json() == {"ok": True}
        assert client.get("/api/runs/resumable").json()["runs"] == []
        assert client.post("/api/runs/20260102-000000/resume", json={}).status_code == 400


# ── 3. 사용량 ─────────────────────────────────────────────
def test_usage_is_recorded_and_aggregated(make_client, runs_dir):
    with make_client() as client:
        run_id, events = run_events(client)
        rep = client.get("/api/usage", params={"days": 7}).json()
        detail = client.get(f"/api/runs/{run_id}").json()
    data = json.loads((runs_dir / run_id / "usage.json").read_text(encoding="utf-8"))
    stages = [c["stage"] for c in data["calls"]]
    assert stages.count("plan") == 1 and stages.count("task") == 4 and stages.count("review") == 1 and "check" in stages
    assert data["total"]["calls"] == len(stages) and data["total"]["input_tokens"] > 0
    assert rep["runs"] >= 1 and rep["total"]["calls"] >= len(stages)
    assert set(rep["by_member"]) >= {"claude", "gpt", "gemini"} and "task" in rep["by_stage"]
    assert detail["usage"]["calls"] == len(stages) and detail["status"] == "done"
    assert events[-1]["usage"]["calls"] == len(stages)


# ── 4. 결과 알림(웹훅) ────────────────────────────────────
@pytest.fixture
def hook():
    got: list[tuple[dict, dict]] = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers["Content-Length"]))
            got.append((dict(self.headers), json.loads(body)))
            got[-1][0]["_raw"] = body
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/hook", got
    srv.shutdown()


def test_notify_on_run_end_with_signature(make_client, hook):
    url, got = hook
    with make_client() as client:
        assert client.put("/api/notify", json={"url": "ftp://x", "enabled": True}).status_code == 400
        pub = client.put("/api/notify", json={"url": url, "enabled": True, "secret": "s3cret"}).json()
        assert pub == {"url": url, "enabled": True, "has_secret": True, "last": None}
        test = client.post("/api/notify/test").json()
        assert test["ok"] is True and got[-1][1]["event"] == "test"
        run_id, _ = run_events(client, "알림 목표")
        for _ in range(50):
            if len(got) >= 2:
                break
            time.sleep(0.05)
        assert client.get("/api/notify").json()["last"]["run_id"] == run_id
    headers, payload = got[-1]
    assert payload["event"] == "run_end" and payload["run_id"] == run_id and payload["ok"] is True
    assert payload["goal"] == "알림 목표" and "최종 결과물" in payload["report"] and payload["usage"]["calls"] > 0
    sig = "sha256=" + hmac.new(b"s3cret", headers["_raw"], hashlib.sha256).hexdigest()
    assert headers["X-Agent-Signature"] == sig


def test_notify_off_sends_nothing(make_client, hook):
    url, got = hook
    with make_client() as client:
        client.put("/api/notify", json={"url": url, "enabled": False})
        run_events(client)
        time.sleep(0.2)
    assert got == []


# ── 5. 외부 도구(MCP) ─────────────────────────────────────
def test_tools_register_local_only_and_hide_secrets(make_client):
    cfg = {"command": "npx", "args": ["-y", "some-mcp"], "env": {"API_KEY": "secret"}}
    with make_client() as client:
        assert client.put("/api/tools/mail", json={"config": cfg}).status_code == 403  # 다른 기기
    with make_client(peer=LOCAL) as client:
        assert client.put("/api/tools/Bad Name", json={"config": cfg}).status_code == 400
        assert client.put("/api/tools/web", json={"config": {"url": "file:///etc"}}).status_code == 400
        r = client.put("/api/tools/mail", json={"config": cfg, "description": "메일 보내기"})
        assert r.status_code == 200
        client.put("/api/tools/composio", json={"config": {"type": "http", "url": "https://mcp.example.com/x", "headers": {"Authorization": "Bearer t"}}})
        listed = client.get("/api/tools").json()
        assert [s["name"] for s in listed["servers"]] == ["composio", "mail"]
        assert "secret" not in json.dumps(listed) and "Bearer" not in json.dumps(listed)
        assert listed["servers"][1]["kind"] == "stdio" and listed["servers"][0]["target"] == "mcp.example.com"
        assert client.post("/api/run", json={"goal": "x", "tools": ["nope"]}).status_code == 400
        assert client.delete("/api/tools/mail").json() == {"ok": True}
        assert client.delete("/api/tools/mail").status_code == 404


def test_approved_tools_reach_only_tool_capable_members(make_client, monkeypatch):
    seen = []
    real = providers._PROVIDERS["mock"]

    async def spy(m, prompt, system, workdir=None, mcp=None):
        seen.append((m.name, m.provider, mcp, prompt))
        return await real(m, prompt, system, workdir)

    monkeypatch.setitem(providers._PROVIDERS, "mock", spy)
    monkeypatch.setattr(providers, "MCP_PROVIDERS", {"mock"})  # 모의 팀원도 도구를 받을 수 있게(실제로는 claude-cli 만)
    with make_client(peer=LOCAL) as client:
        client.put("/api/tools/mail", json={"config": {"command": "mail-mcp"}})
        _, events = run_events(client, tools=["mail"])
    assert events[0]["tools"] == ["mail"]
    assert seen and all(mcp == {"mail": {"command": "mail-mcp", "args": []}} for _, _, mcp, _ in seen)
    assert all("[외부 도구]" in p and "mail" in p for *_, p in seen if "[업무]" in p)
    assert any("(외부 도구 사용 가능)" in p for *_, p in seen if "##PLAN##" in p)


def test_member_without_tool_support_gets_no_mcp(monkeypatch):
    got = {}

    async def fake(m, prompt, system, **kw):
        got.update(kw)
        return "ok"

    monkeypatch.setitem(providers._PROVIDERS, "codex-cli", fake)
    m = providers.Member(name="g", provider="codex-cli", model="default", role="r")
    assert asyncio.run(m.ask("hi", mcp={"x": {"command": "y"}})) == "ok" and "mcp" not in got


def test_claude_args_with_tools():
    m = providers.Member(name="c", provider="claude-cli", model="opus", role="r")
    plain = cli.claude_args(m, "sys")
    assert "mcp__*" in plain and "--mcp-config" not in plain
    a = cli.claude_args(m, "sys", None, "/tmp/m.json", ["mail", "web"])
    assert a[a.index("--mcp-config") + 1] == "/tmp/m.json" and "--strict-mcp-config" in a
    assert "mcp__mail" in a and "mcp__web" in a and "mcp__*" not in a
    assert a[a.index("--max-turns") + 1] == str(cli.PROJECT_TURNS)
    p = cli.claude_args(m, "sys", "/w", "/tmp/m.json", ["mail"])
    assert "mcp__*" not in p and "Bash" in p and "mcp__mail" in p


def test_store_select(tmp_path):
    s = mcptools.Store(tmp_path / "m.json")
    s.put("a", {"url": "https://x.dev/mcp"})
    assert s.select(["a"]) == {"a": {"type": "http", "url": "https://x.dev/mcp"}}
    assert s.select(None) == {}
    with pytest.raises(mcptools.ToolError):
        s.select(["b"])
