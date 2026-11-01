import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agentteam import Team  # noqa: E402
from server import create_app  # noqa: E402


@pytest.fixture(autouse=True)
def no_real_claude(monkeypatch):
    """테스트가 이 컴퓨터의 실제 claude CLI(Gmail·Notion·캘린더 커넥터)를 부르지 않게. 필요한 테스트는 다시 덮어쓴다."""
    from server import connectors
    monkeypatch.setattr(connectors, "claude_exe", lambda: None)


@pytest.fixture
def runs_dir(tmp_path) -> Path:
    return tmp_path / "runs"


@pytest.fixture
def make_client(tmp_path, runs_dir, monkeypatch):
    """모의 팀으로 서버를 만든다. with 블록 안에서 써야 백그라운드 실행이 유지된다."""
    monkeypatch.setenv("MOCK_DELAY", "0")
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>web</h1>", encoding="utf-8")

    def make(access_key: str | None = None, dev: bool = False, peer: tuple[str, int] | None = None) -> TestClient:
        """peer: 접속한 쪽 주소(기본 'testclient'). 같은 컴퓨터 접속을 흉내 내려면 ("127.0.0.1", 50000)."""
        team = Team(ROOT / "team.toml", mock=True)
        app = create_app(team, access_key, runs_dir, web, dev=dev)
        return TestClient(app, client=peer) if peer else TestClient(app)

    return make


def collect(ws) -> list[dict]:
    """run_end 까지 이벤트를 모은다."""
    events = []
    while True:
        events.append(ws.receive_json())
        if events[-1]["type"] == "run_end":
            return events
