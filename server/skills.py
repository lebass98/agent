"""브레인 모드 스킬: 실행 · 결과 보관 · SKILL.md 편집.

- 실행: Claude 스킬은 `claude -p "/<스킬> <입력>"`, GPT(codex) 스킬은 `codex exec` 로 스킬 이름을 불러 실행한다.
  스킬마다 전용 결과 폴더(runs/skills/<시각>-<이름>/)에서 돌리고, 허용 도구는 그 폴더 안 파일 읽기·쓰기 · 웹 검색 ·
  메일·노션·캘린더 '읽기'뿐이다(셸 명령·하위 에이전트·보내기·고치기 도구는 허용하지 않는다). 결과는 마지막 답(마크다운)과 만든 파일.
- 편집: 직접 만든 스킬(mine)의 SKILL.md 만 저장할 수 있다. 설치한 스킬(플러그인·동기화·기본 내장)은 읽기만.
- 입력 받기: SKILL.md 의 `argument-hint` 가 있으면 실행 전에 입력 창을 띄운다(화면에서 바꿀 수 있다 — 브레인 설정 skillnotes).
"""
import asyncio
import json
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

from . import brain

BUILTIN = "Skill,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch"   # 쓸 수 있는 기본 도구(셸·하위 에이전트 없음)
READ_ONLY_MCP = ["mcp__claude_ai_Gmail__search_threads", "mcp__claude_ai_Gmail__get_thread",
                 "mcp__claude_ai_Notion__notion-search", "mcp__claude_ai_Notion__notion-fetch",
                 "mcp__claude_ai_Notion__notion-calendar-list-events", "mcp__claude_ai_Notion__notion-calendar-list-calendars"]


def claude_rules(folder: Path, skill_dir: Path) -> list[str]:
    """허용 규칙: 파일은 결과 폴더(읽기·쓰기)와 스킬 폴더(읽기)만. 절대 경로 규칙은 '//' 로 시작한다."""
    out, sk = "/" + str(folder).rstrip("/") + "/**", "/" + str(skill_dir).rstrip("/") + "/**"
    return ["Skill", "WebSearch", "WebFetch", f"Read({out})", f"Edit({out})", f"Read({sk})", *READ_ONLY_MCP]
TIMEOUT = 1200            # 스킬 실행 최대 20분
FILE_LIMIT = 200_000      # SKILL.md 최대 크기
RESULT_LIMIT = 60_000
KEEP = 30                 # 보관할 실행 기록 수


class SkillError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def find(ai: str, name: str, project_root: Path | None = None, home: Path | None = None) -> dict:
    for s in brain.skills(project_root, home, internal=True):
        if s["ai"] == ai and s["name"] == name:
            return s
    raise SkillError("스킬을 찾을 수 없어요.")


def read(skill: dict) -> str:
    try:
        return (Path(skill["dir"]) / "SKILL.md").read_text(encoding="utf-8", errors="replace")[:FILE_LIMIT]
    except OSError:
        raise SkillError("SKILL.md 를 읽지 못했어요.")


def write(skill: dict, content: str) -> None:
    if not skill["mine"]:
        raise SkillError("설치한 스킬은 고칠 수 없어요. 직접 만든 스킬만 편집할 수 있어요.")
    if not content.strip() or len(content) > FILE_LIMIT:
        raise SkillError("SKILL.md 내용이 비었거나 너무 길어요.")
    if not content.lstrip().startswith("---"):
        raise SkillError("SKILL.md 는 맨 위에 --- 로 시작하는 머리말(name·description)이 있어야 해요.")
    f = Path(skill["dir"]) / "SKILL.md"
    tmp = f.with_suffix(".md.tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, f)


# ───────── 실행 ─────────
class Runs:
    """스킬 실행 기록(최근 KEEP 개). cache/brain-skill-runs.json 에 남긴다."""

    def __init__(self, file: Path, root: Path):
        self.file, self.root = Path(file), Path(root)
        self.items: list[dict] = []
        self.tasks: dict[str, asyncio.Task] = {}
        try:
            self.items = [r | ({"status": "error", "result": "서버가 다시 켜져 실행이 끊겼어요."} if r.get("status") == "running" else {})
                          for r in json.loads(self.file.read_text(encoding="utf-8"))]
        except (OSError, ValueError, TypeError):
            self.items = []

    def save(self) -> None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(self.items[-KEEP:], ensure_ascii=False), encoding="utf-8")

    def public(self) -> list[dict]:
        return [{k: v for k, v in r.items() if k != "folder"} for r in reversed(self.items[-KEEP:])]

    def get(self, rid: str) -> dict:
        r = next((r for r in self.items if r["id"] == rid), None)
        if not r:
            raise SkillError("실행 기록을 찾을 수 없어요.")
        return r

    def start(self, skill: dict, text: str) -> dict:
        if sum(1 for r in self.items if r["status"] == "running") >= 2:
            raise SkillError("스킬이 이미 2개 실행 중이에요. 끝난 뒤 다시 실행하세요.")
        if skill["ai"] == "gemini":
            raise SkillError("Gemini 스킬 실행은 아직 지원하지 않아요.")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        rid = f"{stamp}-{re.sub(r'[^a-z0-9-]', '-', skill['name'].lower())[:36]}-{secrets.token_hex(2)}"
        folder = self.root / rid
        folder.mkdir(parents=True, exist_ok=True)
        run = {"id": rid, "ai": skill["ai"], "name": skill["name"], "input": text[:2000], "status": "running",
               "started": datetime.now().isoformat(timespec="seconds"), "ended": "", "result": "", "files": [], "folder": str(folder)}
        self.items.append(run)
        self.items = self.items[-KEEP:]
        self.save()
        self.tasks[rid] = asyncio.create_task(self._go(run, skill))
        return run

    async def _go(self, run: dict, skill: dict) -> None:
        t0 = time.time()
        try:
            run["result"] = (await execute(skill, run["input"], Path(run["folder"])))[:RESULT_LIMIT]
            run["status"] = "done"
        except SkillError as e:
            run.update(status="error", result=str(e))
        except Exception as e:
            run.update(status="error", result=f"실행 중 오류가 났어요: {str(e)[-400:]}")
        run["ended"] = datetime.now().isoformat(timespec="seconds")
        run["secs"] = round(time.time() - t0)
        run["files"] = files_of(Path(run["folder"]))
        self.save()

    def path_of(self, rid: str, rel: str) -> Path:
        run = self.get(rid)
        base = Path(run["folder"]).resolve()
        f = (base / rel).resolve()
        if base not in f.parents or not f.is_file():
            raise SkillError("파일을 찾을 수 없어요.")
        return f


def files_of(folder: Path) -> list[str]:
    out = []
    for p in sorted(folder.rglob("*")):
        if p.is_file() and not any(x.startswith(".") for x in p.relative_to(folder).parts):
            out.append(str(p.relative_to(folder)))
        if len(out) >= 50:
            break
    return out


async def _proc(cmd: list[str], stdin: str, cwd: Path, env: dict) -> str:
    proc = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE, cwd=str(cwd), env=env)
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin.encode()), TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise SkillError(f"스킬이 {TIMEOUT // 60}분 안에 끝나지 않았어요.")
    if proc.returncode:
        raise SkillError(f"스킬 실행이 실패했어요: {(err.decode('utf-8', 'replace') or out.decode('utf-8', 'replace')).strip()[-400:]}")
    return out.decode("utf-8", "replace")


async def execute(skill: dict, text: str, folder: Path) -> str:
    from agentteam import cli
    note = "결과 파일은 지금 작업 폴더 안에만 만드세요. 메일을 보내거나 노션·캘린더를 고치지 마세요."
    if skill["ai"] == "claude":
        exe = cli.which("claude")
        if not exe:
            raise SkillError("claude CLI 가 없어요.")
        model = os.getenv("BRAIN_SKILL_MODEL", "sonnet")
        cmd = [exe, "-p", "--model", model, "--tools", BUILTIN, "--add-dir", str(folder), "--permission-mode", "dontAsk",
               "--allowedTools", ",".join(claude_rules(folder, Path(skill["dir"]))), "--disallowedTools", "Bash,Task,NotebookEdit",
               "--max-turns", "60", "--no-session-persistence", "--output-format", "json"]
        out = await _proc(cmd, f"/{skill['name']} {text}".strip() + f"\n\n({note})", folder, cli._env("ANTHROPIC_API_KEY"))
        try:
            d = json.loads(out)
        except ValueError:
            raise SkillError("스킬 결과를 읽지 못했어요.")
        if d.get("is_error"):
            raise SkillError(f"스킬이 끝까지 실행되지 못했어요: {str(d.get('result', ''))[-300:]}")
        return str(d.get("result", ""))
    exe = cli.which("codex")
    if not exe:
        raise SkillError("codex CLI 가 없어요.")
    last = folder / ".last.txt"
    cmd = [exe, "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", str(folder), "-o", str(last), "-"]
    await _proc(cmd, f"${skill['name']} 스킬을 사용하세요. {text}\n\n({note})", folder, cli._env("OPENAI_API_KEY"))
    try:
        return last.read_text(encoding="utf-8")
    except OSError:
        return "(결과 텍스트가 없어요. 만든 파일을 확인하세요.)"


# ───────── 카드용 한국어 짧은 이름 ─────────
def label_prompt(items: list[dict]) -> str:
    lines = "\n".join(f"- {x['key']}: {x['desc'][:200]}" for x in items)
    return ("아래 스킬마다 카드에 보일 한국어 짧은 이름(4~12자, 명사형, 예: '견적서 작성', '영상 대본 번역')을 지으세요.\n"
            '결과는 JSON 객체만 출력하세요(설명 없이): {"키":"짧은 이름", ...}\n\n' + lines)


def parse_labels(text: str, keys: set[str]) -> dict:
    m = re.search(r"\{.*\}", str(text), re.S)
    try:
        d = json.loads(m.group(0)) if m else {}
    except ValueError:
        return {}
    return {k: " ".join(str(v).split())[:30] for k, v in d.items() if k in keys and str(v).strip()}
