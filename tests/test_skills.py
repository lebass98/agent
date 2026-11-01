"""브레인 모드 스킬: 찾기 · SKILL.md 편집(직접 만든 것만) · 실행 기록 · 실행 규칙(가짜 실행)."""
import time
from pathlib import Path

import pytest

from server import brain, skills

SKILL = "---\nname: create-quotation\ndescription: 견적서 작성\nargument-hint: 고객사와 품목\n---\n본문"


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / "home"
    (h / ".claude/skills/create-quotation").mkdir(parents=True)
    (h / ".claude/skills/create-quotation/SKILL.md").write_text(SKILL, encoding="utf-8")
    (h / ".claude/plugins/x/skills/pdf").mkdir(parents=True)
    (h / ".claude/plugins/x/skills/pdf/SKILL.md").write_text("---\nname: pdf\ndescription: 설치함\n---", encoding="utf-8")
    real = brain.skills
    monkeypatch.setattr(brain, "skills", lambda project_root=None, home=None, internal=False: real(None, h, internal))
    return h


def test_find_read_write(home):
    sk = skills.find("claude", "create-quotation")
    assert sk["hint"] == "고객사와 품목" and Path(sk["dir"]).name == "create-quotation"
    assert "본문" in skills.read(sk)
    skills.write(sk, SKILL.replace("본문", "고친 본문"))
    assert "고친 본문" in skills.read(skills.find("claude", "create-quotation"))
    for bad in ("", "머리말 없음"):
        with pytest.raises(skills.SkillError):
            skills.write(sk, bad)
    with pytest.raises(skills.SkillError):
        skills.write(skills.find("claude", "pdf"), "---\nname: pdf\n---")     # 설치한 스킬은 못 고침
    with pytest.raises(skills.SkillError):
        skills.find("claude", "없는스킬")
    assert "dir" not in brain.skills()[0]                                      # 화면용 목록에는 실제 경로가 없다


def test_claude_rules_are_scoped(tmp_path):
    rules = skills.claude_rules(tmp_path / "out", tmp_path / "skill")
    assert f"Edit(/{tmp_path}/out/**)" in rules and f"Read(/{tmp_path}/skill/**)" in rules
    assert not any(r.startswith(("Bash", "Edit(/" + str(tmp_path / "skill"))) for r in rules)     # 셸·스킬 폴더 쓰기 없음
    assert all("send" not in r and "create" not in r and "update" not in r for r in rules)
    assert "Bash" not in skills.BUILTIN and "Task" not in skills.BUILTIN
    assert not any(r.startswith("mcp__") for r in rules)      # 웹과 함께 메일·노션을 주지 않는다(밖으로 새는 길 차단)


def test_codex_skill_runs_without_network(tmp_path, monkeypatch):
    import asyncio
    seen = {}

    async def fake_proc(cmd, prompt, folder, env):
        seen["cmd"] = cmd
        return ""
    monkeypatch.setattr(skills, "_proc", fake_proc)
    from agentteam import cli
    monkeypatch.setattr(cli, "which", lambda name: "/usr/bin/" + name)
    asyncio.run(skills.execute({"ai": "codex", "name": "demo", "dir": str(tmp_path)}, "", tmp_path))
    cmd = seen["cmd"]
    assert cmd[cmd.index("--sandbox") + 1] == "workspace-write" and "sandbox_workspace_write.network_access=false" in cmd


def test_skill_api(make_client, home, monkeypatch):
    async def fake_exec(skill, text, folder):
        (folder / "견적서.md").write_text("# 견적서", encoding="utf-8")
        return f"{skill['name']} 완료: {text}"
    monkeypatch.setattr(skills, "execute", fake_exec)
    with make_client() as c:
        sk = {s["name"]: s for s in c.get("/api/brain/skills").json()["skills"]}
        assert sk["create-quotation"]["input"] is True and sk["pdf"]["input"] is False and "dir" not in sk["pdf"]
        f = c.get("/api/brain/skills/file", params={"ai": "claude", "name": "create-quotation"}).json()
        assert f["editable"] and "본문" in f["content"]
        assert c.put("/api/brain/skills/file", json={"ai": "claude", "name": "pdf", "content": "---\nx\n---"}).status_code == 400
        assert c.put("/api/brain/skills/file", json={"ai": "claude", "name": "create-quotation", "label": "견적서 작성", "input": False}).json() == {"ok": True}
        again = {s["name"]: s for s in c.get("/api/brain/skills").json()["skills"]}["create-quotation"]
        assert again["label"] == "견적서 작성" and again["input"] is False
        run = c.post("/api/brain/skills/run", json={"ai": "claude", "name": "create-quotation", "input": "A사 로고 작업"}).json()
        assert run["status"] == "running" and "folder" not in run
        for _ in range(200):
            runs = c.get("/api/brain/skills/runs").json()["runs"]
            if runs[0]["status"] != "running":
                break
            time.sleep(.05)
        assert runs[0]["status"] == "done" and runs[0]["result"] == "create-quotation 완료: A사 로고 작업" and runs[0]["files"] == ["견적서.md"]
        got = c.get(f"/api/brain/skills/runs/{run['id']}/file", params={"path": "견적서.md"})
        assert got.status_code == 200 and "견적서" in got.text
        assert c.get(f"/api/brain/skills/runs/{run['id']}/file", params={"path": "../../../etc/passwd"}).status_code == 404
        assert c.post("/api/brain/skills/run", json={"ai": "claude", "name": "없음"}).status_code == 404


def test_labels_parse():
    keys = {"claude:a", "claude:b"}
    assert skills.parse_labels('이름: {"claude:a":"견적서 작성","claude:x":"모름","claude:b":"  "}', keys) == {"claude:a": "견적서 작성"}
    assert skills.parse_labels("없음", keys) == {}
    assert "한국어 짧은 이름" in skills.label_prompt([{"key": "claude:a", "desc": "Create quotation"}])
