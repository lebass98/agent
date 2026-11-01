"""브레인 모드: 설정 저장(바로가기·루틴·중요 일정·캘린더 구독)·통합 캘린더(iCal)·스킬 목록."""
from datetime import date, timedelta

from server import brain

DAY = date.today()
ICS = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//KO
BEGIN:VEVENT
UID:a1
DTSTART:{DAY:%Y%m%d}T100000
DTEND:{DAY:%Y%m%d}T110000
SUMMARY:주간회의
LOCATION:회의실 1
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;VALUE=DATE:{DAY + timedelta(days=2):%Y%m%d}
DTEND;VALUE=DATE:{DAY + timedelta(days=3):%Y%m%d}
SUMMARY:랜딩 오픈
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART:{DAY:%Y%m%d}T150000
DTEND:{DAY:%Y%m%d}T160000
SUMMARY:취소된 일정
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
""".encode()


def test_parse_ics_expands_repeats_and_skips_cancelled():
    evs = brain.parse_ics(ICS, DAY, DAY + timedelta(days=15))
    titles = [e["title"] for e in evs]
    assert titles.count("주간회의") == 3          # 매주 반복 3번
    assert "취소된 일정" not in titles
    allday = next(e for e in evs if e["title"] == "랜딩 오픈")
    assert allday["allDay"] and allday["start"].startswith((DAY + timedelta(days=2)).isoformat())
    first = min((e for e in evs if e["title"] == "주간회의"), key=lambda e: e["start"])
    assert first["start"].endswith("10:00") and first["where"] == "회의실 1"


def test_store_validates_and_hides_calendar_url(tmp_path):
    s = brain.Store(tmp_path / "brain.json")
    out = s.put("calendars", [{"name": "회사", "kind": "google", "url": "webcal://cal.example.com/secret/basic.ics"}])
    cal = out["calendars"][0]
    assert "url" not in cal and cal["host"] == "cal.example.com"
    assert s.load()["calendars"][0]["url"].startswith("https://")        # webcal → https
    # 주소 없이 다시 저장하면(이름만 바꾸기) 기존 주소를 지킨다
    s.put("calendars", [{"id": cal["id"], "name": "회사 일정", "kind": "google"}])
    assert s.load()["calendars"][0]["url"] == "https://cal.example.com/secret/basic.ics"
    for bad in ([{"name": "x", "url": "file:///etc/passwd"}], [{"name": "", "url": "https://a.b/c.ics"}]):
        try:
            s.put("calendars", bad)
            raise AssertionError("거부해야 함")
        except brain.BrainError:
            pass


def test_routines_and_checks(tmp_path):
    s = brain.Store(tmp_path / "brain.json")
    out = s.put("routines", [{"name": "오늘 회고", "kind": "check", "at": "18:00"}])
    rid = out["routines"][0]["id"]
    assert out["routines"][0]["days"] == list(brain.DAYS)
    out = s.check(rid, DAY.isoformat(), True)
    assert out["routines"][0]["checks"] == {DAY.isoformat(): True}
    out = s.check(rid, DAY.isoformat(), False)
    assert out["routines"][0]["checks"] == {}
    try:
        s.put("routines", [{"name": "자동", "kind": "auto", "at": "09:00"}])   # 자동 실행은 맡길 업무가 필요
        raise AssertionError("거부해야 함")
    except brain.BrainError:
        pass
    try:
        s.put("routines", [{"name": "x", "at": "25:00"}])
        raise AssertionError("거부해야 함")
    except brain.BrainError:
        pass


def test_calendar_merges_manual_and_reports_errors(tmp_path, monkeypatch):
    s = brain.Store(tmp_path / "brain.json")
    s.put("calendars", [{"name": "회사", "kind": "google", "url": "https://ok.example/a.ics"}, {"name": "깨짐", "kind": "phone", "url": "https://bad.example/b.ics"}])
    s.put("events", [{"title": "주간회의", "start": f"{DAY}T10:00", "end": f"{DAY}T11:00"}, {"title": "치과", "start": f"{DAY}T17:00", "end": f"{DAY}T18:00", "star": True}])

    def fake(url):
        if "bad" in url:
            raise brain.BrainError("캘린더 서버에 연결하지 못했어요.")
        return ICS
    monkeypatch.setattr(brain, "_fetch", fake)
    out = brain.calendar(s)
    today = [e for e in out["events"] if e["start"].startswith(DAY.isoformat())]
    assert [e["title"] for e in today].count("주간회의") == 1          # 구독·직접 입력 겹침은 하나로
    assert any(e["title"] == "치과" and e["star"] and e["src"] == "manual" for e in today)
    st = {x["ok"] for x in out["status"]}
    assert st == {True, False}


def test_skills_scan(tmp_path):
    home = tmp_path / "home"
    (home / ".claude/skills/my-skill").mkdir(parents=True)
    (home / ".claude/skills/my-skill/SKILL.md").write_text("---\nname: my-skill\ndescription: >\n  내가 만든\n  스킬\n---\n본문", encoding="utf-8")
    (home / ".claude/plugins/x/skills/pdf").mkdir(parents=True)
    (home / ".claude/plugins/x/skills/pdf/SKILL.md").write_text("---\nname: pdf\ndescription: 설치한 스킬\n---", encoding="utf-8")
    (home / ".codex/skills/copy").mkdir(parents=True)
    (home / ".codex/skills/copy/SKILL.md").write_text("---\nname: copy\ndescription: 카피\n---", encoding="utf-8")
    (home / ".codex/skills/.system/imagegen").mkdir(parents=True)
    (home / ".codex/skills/.system/imagegen/SKILL.md").write_text("---\nname: imagegen\n---", encoding="utf-8")
    out = brain.skills(home=home)
    by = {s["name"]: s for s in out}
    assert by["my-skill"]["mine"] and by["my-skill"]["desc"] == "내가 만든 스킬" and by["my-skill"]["ai"] == "claude"
    assert not by["pdf"]["mine"]
    assert by["copy"]["ai"] == "gpt" and by["copy"]["mine"]
    assert not by["imagegen"]["mine"]                                       # .system 은 기본 내장
    assert out[0]["mine"]                                                    # 직접 만든 것이 먼저


def test_brain_api(make_client):
    c = make_client()
    assert c.get("/api/brain").json() == {"shortcuts": [], "routines": [], "pins": [], "calendars": [], "events": [], "meetings": [], "skillnotes": []}
    r = c.put("/api/brain/shortcuts", json={"items": [{"name": "에이전트 오피스", "url": "https://agent.example.app"}]})
    assert r.status_code == 200 and r.json()["shortcuts"][0]["abbr"] == "에이"
    assert c.put("/api/brain/shortcuts", json={"items": [{"name": "x", "url": "javascript:alert(1)"}]}).status_code == 400
    assert c.put("/api/brain/unknown", json={"items": []}).status_code == 422
    rid = c.put("/api/brain/routines", json={"items": [{"name": "회고", "at": "18:00"}]}).json()["routines"][0]["id"]
    assert c.post(f"/api/brain/routines/{rid}/check", json={"day": DAY.isoformat()}).json()["routines"][0]["checks"]
    assert "skills" in c.get("/api/brain/skills").json()
    cal = c.get("/api/brain/calendar").json()
    assert cal["events"] == [] and cal["status"] == []


def test_brain_api_needs_key(make_client):
    c = make_client(access_key="k")
    assert c.get("/api/brain").status_code == 401
    assert c.get("/api/brain", headers={"X-Access-Key": "k"}).status_code == 200


def test_calendar_connector(make_client, monkeypatch):
    """Claude 의 Notion 캘린더 연결로 받은 일정(Google 포함)을 합친다."""
    import time
    from server import calconn, connectors
    monkeypatch.setattr(connectors, "claude_exe", lambda: "/usr/bin/claude")
    got = calconn.parse(f'[{{"title":"투자사 미팅","start":"{DAY}T14:00:00","end":"{DAY}T15:00","calendar":"회사","provider":"google"}},'
                        f'{{"title":"x","start":"어제"}},{{"title":"노션 일정","start":"{DAY}T09:00","end":"{DAY}T08:00","provider":"notion"}}]')
    assert [(e["title"], e["src"], e["end"][11:]) for e in got] == [("투자사 미팅", "google", "15:00"), ("노션 일정", "notion", "09:00")]
    assert "만들거나 고치거나 취소하지" in calconn.prompt(DAY, DAY) and "create" not in calconn.READ_TOOLS and "cancel" not in calconn.READ_TOOLS

    async def fake_fetch(*a, **k):
        return got
    monkeypatch.setattr(calconn, "fetch", fake_fetch)
    with make_client() as c:
        first = c.get("/api/brain/calendar").json()
        assert first["conn"]["enabled"] and first["conn"]["loading"]
        for _ in range(50):
            out = c.get("/api/brain/calendar").json()
            if out["events"]:
                break
            time.sleep(.05)
        assert {e["title"] for e in out["events"]} == {"투자사 미팅", "노션 일정"} and out["conn"]["count"] == 2
