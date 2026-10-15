"""에이전트 설정(GET/PUT /api/team/config): 읽기, 검사, team.toml 다시 쓰기(머리 주석 유지·백업), 팀 즉시 재구성, hello 재전송.
실제 team.toml 은 건드리지 않도록 임시 폴더의 사본으로 서버를 만든다."""
import tomllib

import pytest
from fastapi.testclient import TestClient

from agentteam import Team
from conftest import ROOT
from server import create_app, teamcfg

TOML = '''# 팀 구성 설정 — 설명 주석은 저장해도 남아야 한다
# provider 종류 ...

[leader]
member = "claude"
guide = """
- 핵심은 claude
"""

[members.claude]
provider = "claude-cli"
model = "opus"
role = "팀장 겸 메인 담당"

[members.gpt]
provider = "codex-cli"
model = "default"
role = "디자이너"
'''


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("MOCK_DELAY", "0")
    cfg = tmp_path / "team.toml"
    cfg.write_text(TOML, encoding="utf-8")
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>web</h1>", encoding="utf-8")
    team = Team(cfg, mock=True)
    return cfg, team, TestClient(create_app(team, None, tmp_path / "runs", web))


def body(**over):
    cfg = {"leader": "claude", "guide": "- 핵심은 claude\n- 그림은 gpt",
           "members": [{"name": "claude", "provider": "claude-cli", "model": "sonnet", "role": "팀장"},
                       {"name": "gpt", "provider": "codex-cli", "model": "default", "role": "디자이너. 이미지·UI"},
                       {"name": "writer", "provider": "antigravity-cli", "model": "gemini-3.8-flash-medium", "role": "자료 정리·요약"}]}
    cfg.update(over)
    return {"config": cfg}


def test_get_config_reads_file_not_mock(setup):
    _, _, client = setup
    with client:
        j = client.get("/api/team/config").json()
    assert j["mock"] is True
    assert j["config"]["leader"] == "claude" and j["config"]["guide"] == "- 핵심은 claude"
    assert [(m["name"], m["provider"], m["model"]) for m in j["config"]["members"]] == [("claude", "claude-cli", "opus"), ("gpt", "codex-cli", "default")]
    ids = [p["id"] for p in j["providers"]]
    assert ids[:3] == ["claude-cli", "codex-cli", "antigravity-cli"] and all("ready" in p for p in j["providers"])


def test_put_rewrites_file_reloads_team_and_rebroadcasts_hello(setup):
    cfg, team, client = setup
    with client, client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        r = client.put("/api/team/config", json=body())
        assert r.status_code == 200, r.text
        hello = ws.receive_json()
    assert hello["type"] == "hello" and [m["name"] for m in hello["team"]["members"]] == ["claude", "gpt", "writer"]
    text = cfg.read_text(encoding="utf-8")
    assert text.startswith("# 팀 구성 설정 — 설명 주석은 저장해도 남아야 한다")
    data = tomllib.loads(text)
    assert data["leader"]["member"] == "claude" and data["leader"]["guide"].strip() == "- 핵심은 claude\n- 그림은 gpt"
    assert data["members"]["writer"] == {"provider": "antigravity-cli", "model": "gemini-3.8-flash-medium", "role": "자료 정리·요약"}
    assert (cfg.parent / "team.toml.bak").read_text(encoding="utf-8") == TOML
    assert set(team.members) == {"claude", "gpt", "writer"} and team.members["writer"].provider == "mock"  # 모의 실행은 유지
    assert "그림은 gpt" in team.guide


@pytest.mark.parametrize("over,msg", [
    ({"members": []}, "한 명 이상"),
    ({"leader": "nobody"}, "팀장"),
    ({"members": [{"name": "Claude!", "provider": "claude-cli", "model": "opus", "role": "x"}]}, "영문 소문자"),
    ({"members": [{"name": "a", "provider": "claude-cli", "model": "opus", "role": "x"}, {"name": "a", "provider": "codex-cli", "model": "default", "role": "y"}], "leader": "a"}, "겹칩니다"),
    ({"members": [{"name": "claude", "provider": "nope", "model": "opus", "role": "x"}]}, "AI 를 골라"),
    ({"members": [{"name": "claude", "provider": "claude-cli", "model": "claude-opus-5-5", "role": "x"}]}, "opus·sonnet·haiku"),
    ({"members": [{"name": "claude", "provider": "codex-cli", "model": "bad model", "role": "x"}]}, "모델 이름"),
    ({"members": [{"name": "claude", "provider": "codex-cli", "model": "default", "role": "  "}]}, "하는 일"),
    ({"guide": "x" * 2001}, "배정 원칙"),
])
def test_put_rejects_invalid(setup, over, msg):
    cfg, _, client = setup
    with client:
        r = client.put("/api/team/config", json=body(**over))
    assert r.status_code == 400 and msg in r.json()["detail"]
    assert cfg.read_text(encoding="utf-8") == TOML  # 파일은 그대로


def test_put_refused_while_running(setup):
    _, _, client = setup
    with client:
        client.app.state.chatting = True
        assert client.put("/api/team/config", json=body()).status_code == 409


def test_render_escapes_and_roundtrips():
    cfg = teamcfg.validate({"leader": "a", "guide": 'say "hi" \\ """triple"""',
                            "members": [{"name": "a", "provider": "codex-cli", "model": "default", "role": '따옴표 "역할"\n두 줄'}]})
    data = tomllib.loads(teamcfg.render(cfg, "# 머리"))
    assert data["leader"]["guide"] == 'say "hi" \\ """triple"""'
    assert data["members"]["a"]["role"] == '따옴표 "역할" 두 줄'  # 줄바꿈은 한 칸으로


def test_real_team_toml_is_readable():
    cfg = teamcfg.read_config(ROOT / "team.toml")
    assert teamcfg.validate(cfg)["leader"] == cfg["leader"]
