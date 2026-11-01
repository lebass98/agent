"""브레인 모드 바로가기: Vercel 프로젝트 가져오기(가짜 API)."""
import json

from server import gmail, vercel


def test_projects_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(gmail, "ENV_FILE", tmp_path / "none.env")
    monkeypatch.setenv("VERCEL_TOKEN", "tok")
    calls = []

    def fake_get(path, tok):
        calls.append(path)
        assert tok == "tok"
        if path.startswith("/v2/teams"):
            return {"teams": [{"id": "team_1", "name": "WordNCode"}]}
        if "teamId=team_1" in path:
            return {"projects": [{"name": "groupware", "targets": {"production": {"alias": ["groupware.vercel.app", "gw.example.com"]}}}]}
        return {"projects": [{"name": "agent-office", "targets": {"production": {"alias": ["agent-office.vercel.app"]}}}, {"name": "moxie"}, {"name": ""}]}
    monkeypatch.setattr(vercel, "_get", fake_get)
    out = vercel.projects()
    assert [(p["name"], p["url"], p["abbr"]) for p in out] == [
        ("agent-office", "https://agent-office.vercel.app", "AO"), ("moxie", "https://moxie.vercel.app", "Mo"),
        ("groupware", "https://gw.example.com", "Gr")]                    # 사용자 도메인이 있으면 그 주소
    assert vercel.token() == ("tok", "env")


def test_token_from_cli_login(monkeypatch, tmp_path):
    monkeypatch.setattr(gmail, "ENV_FILE", tmp_path / "none.env")
    monkeypatch.delenv("VERCEL_TOKEN", raising=False)
    auth = tmp_path / "auth.json"
    monkeypatch.setattr(vercel, "_cli_auth_files", lambda: [tmp_path / "x.json", auth])
    assert vercel.token() is None
    auth.write_text(json.dumps({"token": "cli-tok"}))
    assert vercel.token() == ("cli-tok", "cli")
    monkeypatch.setattr(vercel, "_cli_auth_files", lambda: [])
    try:
        vercel.projects()
        raise AssertionError("로그인 정보가 없으면 안내")
    except vercel.VercelError as e:
        assert "vercel login" in str(e)


def test_import_api(make_client, monkeypatch):
    monkeypatch.setattr(vercel, "projects", lambda: [{"name": "a", "url": "https://a.vercel.app", "abbr": "A", "color": "#5558e6", "team": ""},
                                                     {"name": "b", "url": "https://b.vercel.app", "abbr": "B", "color": "#5558e6", "team": ""}])
    c = make_client()
    c.put("/api/brain/shortcuts", json={"items": [{"name": "이미", "url": "https://a.vercel.app/"}]})
    r = c.post("/api/brain/shortcuts/vercel").json()
    assert r["added"] == 1 and r["found"] == 2 and [s["name"] for s in r["shortcuts"]] == ["이미", "b"]
    assert c.post("/api/brain/shortcuts/vercel").json()["added"] == 0
    monkeypatch.setattr(vercel, "projects", lambda: (_ for _ in ()).throw(vercel.VercelError("Vercel 로그인이 만료됐어요.")))
    bad = c.post("/api/brain/shortcuts/vercel")
    assert bad.status_code == 400 and "만료" in bad.json()["detail"]
