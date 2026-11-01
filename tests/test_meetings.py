"""브레인 모드 회의록: Claude 의 Notion 연결 결과 해석 · 회의 지정 · /api/brain/meetings(가짜 연결)."""
import time

from server import brain, connectors, meetings

PID = "1a2b3c4d5e6f708192a3b4c5d6e7f809"


def test_parse_keeps_safe_values():
    text = ('정리했어요 [{"id":"1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809","source":"주간회의","title":"11월 1주 주간회의","url":"javascript:alert(1)",'
            '"date":"2026-11-02","attendees":"6명","points":["랜딩 오픈 확정"],"actions":[{"text":"IR 자료 정리","owner":"나","done":false},{"text":""}]},'
            '{"id":"짧은아이디"},{"id":"' + PID + '","title":"중복"}]')
    out = meetings.parse(text)
    assert len(out) == 1                                   # 이상한 ID·중복은 버린다
    m = out[0]
    assert m["id"] == PID and m["url"] == f"https://www.notion.so/{PID}"   # 노션 주소가 아니면 페이지 ID 로 만든다
    assert m["points"] == ["랜딩 오픈 확정"] and m["actions"] == [{"text": "IR 자료 정리", "owner": "나", "done": False}]
    assert meetings.parse("없음") == [] and "고치거나 지우지" in meetings.prompt(meetings.DEFAULT)
    assert "notion-search" in meetings.READ_TOOLS and "create" not in meetings.READ_TOOLS and "update" not in meetings.READ_TOOLS


def test_meeting_sources_validated(tmp_path):
    s = brain.Store(tmp_path / "brain.json")
    out = s.put("meetings", [{"name": "주간회의", "ref": "https://www.notion.so/team/abc"}, {"name": "디자인", "ref": "디자인팀 미팅"}])
    assert [m["name"] for m in out["meetings"]] == ["주간회의", "디자인"]
    try:
        s.put("meetings", [{"name": "x", "ref": "https://evil.example/a"}])
        raise AssertionError("거부해야 함")
    except brain.BrainError:
        pass


def test_meetings_api(make_client, monkeypatch):
    monkeypatch.setattr(connectors, "claude_exe", lambda: "/usr/bin/claude")
    seen = []

    async def fake_fetch(sources, model="haiku"):
        seen.append([s["name"] for s in sources])
        return meetings.parse('[{"id":"' + PID + '","source":"' + sources[0]["name"] + '","title":"주간회의","date":"2026-11-02","points":["요점"],"actions":[{"text":"할 일"}]}]')
    monkeypatch.setattr(meetings, "fetch", fake_fetch)
    with make_client() as c:
        first = c.get("/api/brain/meetings").json()
        assert first["enabled"] and first["loading"] and not first["custom"]
        for _ in range(200):
            got = c.get("/api/brain/meetings").json()
            if got["items"]:
                break
            time.sleep(.05)
        assert seen == [["최근 회의록"]] and got["items"][0]["actions"][0]["done"] is False
        assert c.post("/api/brain/meetings/check", json={"key": f"{PID}:0", "done": True}).json() == {"ok": True}
        assert c.get("/api/brain/meetings").json()["items"][0]["actions"][0]["done"] is True     # 체크는 이 앱에 남는다
        assert c.post("/api/brain/meetings/check", json={"key": "../x", "done": True}).status_code == 400
        c.put("/api/brain/meetings", json={"items": [{"name": "주간회의", "ref": "주간회의"}]})
        got = c.get("/api/brain/meetings").json()                  # 지정이 바뀌면 다시 읽는다
        assert got["custom"] and got["loading"]
        for _ in range(200):
            if len(seen) == 2:
                break
            time.sleep(.05)
        assert seen[-1] == ["주간회의"]
    monkeypatch.setattr(connectors, "claude_exe", lambda: None)
    with make_client() as c:
        assert c.get("/api/brain/meetings").json() == {"enabled": False}
