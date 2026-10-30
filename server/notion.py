"""노션 업무 기록: 업무가 끝날 때마다 노션 데이터베이스에 한 쪽씩 쌓는다(지시·계획·팀원별 결과·최종 보고서).

- .env 의 NOTION_TOKEN(노션 '내부 통합' 토큰, ntn_…)과 NOTION_DATABASE_ID(기록용 데이터베이스)가 둘 다 있을 때만 켜진다.
  데이터베이스는 그 통합에 '연결'(공유)되어 있어야 한다. 속성: 이름(제목)·날짜·상태·담당·프로젝트·실행 ID.
- 보내기 실패는 업무 결과에 영향을 주지 않는다(서버 로그·마지막 기록 결과만 남긴다).
"""
import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

API = "https://api.notion.com/v1"
VERSION = "2022-06-28"
TEXT_LIMIT = 2000      # rich_text 한 조각 최대 길이
BATCH = 100            # 한 번에 붙일 수 있는 블록 수
TASK_LIMIT = 12_000    # 팀원 결과 1건당 최대 글자 수(너무 긴 결과는 자른다)
TIMEOUT = 20
log = logging.getLogger(__name__)


class Notion:
    def __init__(self):
        self.last: dict | None = None  # {at, ok, run_id, url, error}

    @staticmethod
    def config() -> tuple[str, str] | None:
        token, db = os.getenv("NOTION_TOKEN", "").strip(), os.getenv("NOTION_DATABASE_ID", "").strip()
        return (token, db.replace("-", "")) if token and db else None

    def enabled(self) -> bool:
        return self.config() is not None

    def public(self) -> dict:
        return {"enabled": self.enabled(), "last": self.last}

    def record(self, run_dir: Path, run_id: str, ok: bool, usage: dict | None = None) -> dict:
        """동기 기록(스레드에서 부른다). 결과 {ok, url, error}."""
        cfg = self.config()
        if not cfg:
            return {"ok": False, "url": None, "error": "NOTION_TOKEN·NOTION_DATABASE_ID 가 없습니다."}
        token, db = cfg
        props, blocks = page_content(run_dir, run_id, ok, usage)
        try:
            page = _call(token, "POST", "/pages", {"parent": {"database_id": db}, "properties": props, "children": blocks[:BATCH]})
            for i in range(BATCH, len(blocks), BATCH):
                _call(token, "PATCH", f"/blocks/{page['id']}/children", {"children": blocks[i:i + BATCH]})
            res = {"ok": True, "url": page.get("url"), "error": None}
        except NotionError as e:
            log.warning("노션 기록 실패(%s): %s", run_id, e)
            res = {"ok": False, "url": None, "error": str(e)}
        self.last = {"at": datetime.now().isoformat(timespec="seconds"), "run_id": run_id, **res}
        return res


class NotionError(RuntimeError):
    pass


def _call(token: str, method: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(os.getenv("NOTION_API", API) + path, data=json.dumps(body).encode("utf-8"), method=method,
                                 headers={"Authorization": f"Bearer {token}", "Notion-Version": VERSION,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("message", "")
        except (ValueError, OSError):
            msg = ""
        raise NotionError(f"HTTP {e.code} {msg}".strip()) from None
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise NotionError(str(getattr(e, "reason", e))[:200]) from None


# ── 쪽 내용 만들기 ────────────────────────────────────────
def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def page_content(run_dir: Path, run_id: str, ok: bool, usage: dict | None) -> tuple[dict, list[dict]]:
    goal = _read(run_dir / "goal.txt").strip() or "(지시 없음)"
    try:
        plan = json.loads(_read(run_dir / "plan.json") or "{}")
    except ValueError:
        plan = {}
    try:
        project = json.loads(_read(run_dir / "project.json") or "null") or {}
    except ValueError:
        project = {}
    tasks = plan.get("tasks") or []
    members = sorted({str(t.get("assignee")) for t in tasks if t.get("assignee")})
    started = datetime.strptime(run_id[:15], "%Y%m%d-%H%M%S") if re.fullmatch(r"\d{8}-\d{6}.*", run_id) else datetime.now()

    props = {
        "이름": {"title": _rich(goal.splitlines()[0][:100])},
        "날짜": {"date": {"start": started.isoformat(timespec="seconds"), "end": datetime.now().isoformat(timespec="seconds")}},
        "상태": {"select": {"name": "완료" if ok else "실패"}},
        "담당": {"multi_select": [{"name": m} for m in members]},
        "프로젝트": {"rich_text": _rich(str(project.get("name") or ""))},
        "실행 ID": {"rich_text": _rich(run_id)},
    }

    md = [f"## 지시\n{goal}"]
    if plan.get("summary"):
        md.append(f"## 계획\n{plan['summary']}")
    if tasks:
        md.append("## 업무 분담\n" + "\n".join(f"- #{t.get('id')} @{t.get('assignee')} — {t.get('title', '')}" for t in tasks))
    for f in sorted(run_dir.glob("task-*.md")):
        body = _read(f).strip()
        if len(body) > TASK_LIMIT:
            body = body[:TASK_LIMIT] + "\n\n…(길어서 줄임 — 전체는 runs 폴더)"
        m = re.match(r"task-(\d+)-(.+)\.md", f.name)
        title = next((t.get("title") for t in tasks if m and str(t.get("id")) == str(int(m.group(1)))), "")
        md.append(f"## 결과 #{int(m.group(1)) if m else '?'} @{m.group(2) if m else ''} {title}\n{body}")
    report = _read(run_dir / "report.md").strip()
    if report:
        md.append(f"## 최종 보고서\n{report}")
    err = _read(run_dir / "error.txt").strip()
    if err:
        md.append(f"## 오류\n{err}")
    if usage:
        md.append("## 사용량\n" + "\n".join(f"- {k}: {v}" for k, v in usage.items() if not isinstance(v, (dict, list))))
    return props, markdown_blocks("\n\n".join(md))


def _rich(text: str) -> list[dict]:
    return [{"type": "text", "text": {"content": text[i:i + TEXT_LIMIT]}} for i in range(0, len(text), TEXT_LIMIT)] or []


def _inline(text: str) -> list[dict]:
    """**굵게**·`코드` 만 살린 rich_text."""
    out = []
    for part in re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text):
        if not part:
            continue
        ann = {}
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            part, ann = part[2:-2], {"bold": True}
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            part, ann = part[1:-1], {"code": True}
        for i in range(0, len(part), TEXT_LIMIT):
            out.append({"type": "text", "text": {"content": part[i:i + TEXT_LIMIT]}, **({"annotations": ann} if ann else {})})
    return out


def _block(kind: str, text: str, **extra) -> dict:
    return {"object": "block", "type": kind, kind: {"rich_text": _inline(text), **extra}}


def markdown_blocks(md: str) -> list[dict]:
    """보고서 마크다운을 노션 블록으로(제목·목록·번호 목록·인용·코드·구분선·문단)."""
    blocks, para, code, lang = [], [], None, ""

    def flush():
        if para:
            blocks.append(_block("paragraph", " ".join(para)))
            para.clear()

    for line in md.splitlines():
        if code is not None:
            if line.strip().startswith("```"):
                blocks.append({"object": "block", "type": "code",
                               "code": {"rich_text": _rich("\n".join(code)), "language": lang or "plain text"}})
                code = None
            else:
                code.append(line)
            continue
        s = line.strip()
        if s.startswith("```"):
            flush()
            code, lang = [], _lang(s[3:].strip())
        elif not s:
            flush()
        elif m := re.match(r"(#{1,6})\s+(.*)", s):
            flush()
            blocks.append(_block(f"heading_{min(len(m.group(1)), 3)}", m.group(2)))
        elif re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
            flush()
            blocks.append({"object": "block", "type": "divider", "divider": {}})
        elif m := re.match(r"[-*+]\s+(\[[ xX]\]\s+)?(.*)", s):
            flush()
            if m.group(1):
                blocks.append(_block("to_do", m.group(2), checked=m.group(1)[1] in "xX"))
            else:
                blocks.append(_block("bulleted_list_item", m.group(2)))
        elif m := re.match(r"\d+[.)]\s+(.*)", s):
            flush()
            blocks.append(_block("numbered_list_item", m.group(1)))
        elif s.startswith(">"):
            flush()
            blocks.append(_block("quote", s.lstrip("> ")))
        else:
            para.append(s)
    flush()
    if code is not None:
        blocks.append({"object": "block", "type": "code", "code": {"rich_text": _rich("\n".join(code)), "language": "plain text"}})
    return blocks


_LANGS = {"py": "python", "python": "python", "js": "javascript", "javascript": "javascript", "ts": "typescript",
          "typescript": "typescript", "json": "json", "html": "html", "css": "css", "sh": "shell", "bash": "bash",
          "shell": "shell", "sql": "sql", "java": "java", "kotlin": "kotlin", "swift": "swift", "yaml": "yaml",
          "yml": "yaml", "toml": "plain text", "md": "markdown", "markdown": "markdown", "php": "php"}


def _lang(s: str) -> str:
    return _LANGS.get(s.lower(), "plain text")
