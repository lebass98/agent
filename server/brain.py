"""브레인 모드: 바로가기·루틴·중요 일정·캘린더 구독 설정 저장, 스킬 목록, 통합 캘린더.

- 설정은 cache/brain.json(Git 제외)에 둔다. 캘린더 구독 주소(iCal 비공개 주소)는 비밀번호와 같으므로
  화면에는 다시 보내지 않는다(호스트만 보여 준다). 바꿀 때는 새 주소를 넣거나 그 캘린더를 지운다.
- 캘린더: Google 캘린더 '비공개 주소(iCal 형식)', 아이폰(iCloud) '공개 캘린더' 링크, 그 밖의 .ics 주소를 구독한다.
  반복 일정은 recurring-ical-events 로 펼친다. 주소마다 10분 동안 받아 둔 것을 쓴다.
- 스킬: Claude(~/.claude/skills·플러그인·프로젝트 .claude/skills), GPT(~/.codex/skills), Gemini(~/.gemini/skills)의 SKILL.md 를 읽는다.
  직접 만든 것(mine)과 설치한 것(플러그인·동기화)을 나눈다.
"""
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

NAME_LIMIT = 80
NOTE_LIMIT = 300
GOAL_LIMIT = 2000
URL_LIMIT = 2000
MAX_ITEMS = 60
MAX_SKILLNOTES = 300  # 스킬 카드 이름은 스킬 수만큼
ICS_LIMIT = 5_000_000      # 받는 .ics 최대 크기
ICS_TTL = 600              # 캘린더 받아 둔 것을 쓰는 시간(초)
TIMEOUT = 15
CAL_KINDS = ("google", "phone", "notion", "other")
ROUTINE_KINDS = ("check", "auto")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


class BrainError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def _id() -> str:
    return secrets.token_hex(4)


def _text(v, limit: int, what: str, required: bool = True) -> str:
    s = " ".join(str(v or "").split())[:limit]
    if required and not s:
        raise BrainError(f"{what}을(를) 입력하세요.")
    return s


def _url(v, what: str = "주소") -> str:
    s = str(v or "").strip()
    if s.startswith("webcal://"):
        s = "https://" + s[len("webcal://"):]
    p = urlsplit(s)
    if p.scheme not in ("http", "https") or not p.netloc or len(s) > URL_LIMIT:
        raise BrainError(f"{what}는 http(s):// 로 시작해야 해요.")
    return s


EMPTY = {"shortcuts": [], "routines": [], "pins": [], "calendars": [], "events": [], "meetings": [], "skillnotes": []}


class Store:
    """cache/brain.json 읽기·쓰기. 목록마다 검사한 뒤 저장한다."""

    def __init__(self, file: Path):
        self.file = Path(file)
        self.lock = threading.Lock()

    def load(self) -> dict:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        return {k: list(data.get(k) or []) if isinstance(data.get(k), list) else [] for k in EMPTY}

    def _write(self, data: dict) -> None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.file)

    def public(self) -> dict:
        d = self.load()
        d["calendars"] = [{k: v for k, v in c.items() if k != "url"} | {"host": urlsplit(c.get("url", "")).netloc} for c in d["calendars"]]
        return d

    def put(self, kind: str, items: list) -> dict:
        if kind not in EMPTY:
            raise BrainError("알 수 없는 목록이에요.")
        limit = MAX_SKILLNOTES if kind == "skillnotes" else MAX_ITEMS
        if not isinstance(items, list) or len(items) > limit:
            raise BrainError(f"한 목록에 {limit}개까지 넣을 수 있어요.")
        with self.lock:
            data = self.load()
            old = {x.get("id"): x for x in data[kind]}
            data[kind] = [getattr(self, f"_{kind}")(x if isinstance(x, dict) else {}, old) for x in items]
            self._write(data)
        return self.public()

    # ── 항목 검사 ──
    @staticmethod
    def _shortcuts(x: dict, old: dict) -> dict:
        name = _text(x.get("name"), 40, "이름")
        abbr = _text(x.get("abbr"), 3, "약자", required=False) or name[:2]
        color = x.get("color") if COLOR.fullmatch(str(x.get("color") or "")) else "#5558e6"
        return {"id": x.get("id") if x.get("id") in old else _id(), "name": name, "abbr": abbr, "url": _url(x.get("url")), "color": color}

    @staticmethod
    def _routines(x: dict, old: dict) -> dict:
        kind = x.get("kind") if x.get("kind") in ROUTINE_KINDS else "check"
        at = str(x.get("at") or "09:00")
        if not HHMM.fullmatch(at):
            raise BrainError("시간은 09:30 처럼 적어 주세요.")
        days = [d for d in DAYS if d in (x.get("days") or DAYS)] or list(DAYS)
        prev = old.get(x.get("id")) or {}
        r = {"id": prev.get("id") or _id(), "name": _text(x.get("name"), NAME_LIMIT, "루틴 이름"), "kind": kind, "at": at, "days": days,
             "on": bool(x.get("on", True)), "goal": _text(x.get("goal"), GOAL_LIMIT, "맡길 업무", required=kind == "auto"),
             "checks": {k: True for k, v in (x.get("checks") or prev.get("checks") or {}).items() if v and re.fullmatch(r"\d{4}-\d{2}-\d{2}", k)},
             "last": prev.get("last")}
        # 오래된 확인 기록은 100일만 남긴다(연속 기록 표시용)
        r["checks"] = dict(sorted(r["checks"].items())[-100:])
        return r

    @staticmethod
    def _pins(x: dict, old: dict) -> dict:
        when = str(x.get("when") or "")
        try:
            datetime.fromisoformat(when)
        except ValueError:
            raise BrainError("중요 일정의 날짜·시간이 올바르지 않아요.")
        return {"id": x.get("id") if x.get("id") in old else _id(), "title": _text(x.get("title"), NAME_LIMIT, "제목"), "when": when,
                "note": _text(x.get("note"), NOTE_LIMIT, "메모", required=False)}

    @staticmethod
    def _calendars(x: dict, old: dict) -> dict:
        prev = old.get(x.get("id"))
        url = prev["url"] if prev and not x.get("url") else _url(x.get("url"), "캘린더 주소")
        kind = x.get("kind") if x.get("kind") in CAL_KINDS else "other"
        return {"id": prev["id"] if prev else _id(), "name": _text(x.get("name"), 40, "캘린더 이름"), "kind": kind, "url": url, "on": bool(x.get("on", True))}

    @staticmethod
    def _events(x: dict, old: dict) -> dict:
        try:
            s, e = datetime.fromisoformat(str(x.get("start"))), datetime.fromisoformat(str(x.get("end") or x.get("start")))
        except ValueError:
            raise BrainError("일정의 시작·끝 시간이 올바르지 않아요.")
        if e < s:
            raise BrainError("끝 시간이 시작보다 빨라요.")
        return {"id": x.get("id") if x.get("id") in old else _id(), "title": _text(x.get("title"), NAME_LIMIT, "일정 제목"),
                "start": s.isoformat(timespec="minutes"), "end": e.isoformat(timespec="minutes"), "star": bool(x.get("star")),
                "where": _text(x.get("where"), NAME_LIMIT, "장소", required=False)}

    @staticmethod
    def _meetings(x: dict, old: dict) -> dict:
        """회의록 출처: 노션 페이지·데이터베이스 주소 또는 검색어(예: 주간회의)"""
        ref = _text(x.get("ref"), 300, "노션 주소 또는 검색어")
        if ref.startswith(("http://", "https://")) and not re.match(r"https://([a-z0-9-]+\.)?notion\.(so|site)/", ref):
            raise BrainError("노션 주소(notion.so)나 검색어를 넣어 주세요.")
        try:
            count = max(1, min(5, int(x.get("count") or 2)))
        except (TypeError, ValueError):
            raise BrainError("보여 줄 개수는 1~5 사이 숫자로 넣어 주세요.")
        return {"id": x.get("id") if x.get("id") in old else _id(), "name": _text(x.get("name"), 40, "이름"), "ref": ref, "count": count}

    @staticmethod
    def _skillnotes(x: dict, old: dict) -> dict:
        """스킬 카드에 보일 짧은 한국어 이름·입력 받기 여부(스킬 파일은 그대로)"""
        key = str(x.get("key") or "")
        if not re.fullmatch(r"(claude|gpt|gemini):[^\s]{1,80}", key):
            raise BrainError("스킬을 알 수 없어요.")
        inp = x.get("input")
        return {"id": x.get("id") if x.get("id") in old else _id(), "key": key, "label": _text(x.get("label"), 30, "이름", required=False),
                "input": None if inp is None else bool(inp)}

    def check(self, rid: str, day: str, done: bool) -> dict:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
            raise BrainError("날짜가 올바르지 않아요.")
        with self.lock:
            data = self.load()
            r = next((r for r in data["routines"] if r.get("id") == rid), None)
            if not r:
                raise BrainError("루틴을 찾을 수 없어요.")
            checks = dict(r.get("checks") or {})
            if done:
                checks[day] = True
            else:
                checks.pop(day, None)
            r["checks"] = dict(sorted(checks.items())[-100:])
            self._write(data)
        return self.public()


# ───────── 통합 캘린더 ─────────
_ics_cache: dict[str, tuple[float, bytes]] = {}
_ics_lock = threading.Lock()


def _fetch(url: str) -> bytes:
    now = time.time()
    with _ics_lock:
        hit = _ics_cache.get(url)
        if hit and now - hit[0] < ICS_TTL:
            return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": "AgentOffice-Brain/1.0", "Accept": "text/calendar,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read(ICS_LIMIT + 1)
    except urllib.error.HTTPError as e:
        raise BrainError(f"캘린더를 받지 못했어요 (HTTP {e.code}). 주소가 맞는지 확인하세요.")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise BrainError("캘린더 서버에 연결하지 못했어요.")
    if len(body) > ICS_LIMIT:
        raise BrainError("캘린더 파일이 너무 커요.")
    if b"BEGIN:VCALENDAR" not in body[:2000]:
        raise BrainError("iCal(.ics) 주소가 아니에요. 캘린더의 '비공개 주소(iCal 형식)'를 넣어 주세요.")
    with _ics_lock:
        _ics_cache[url] = (now, body)
    return body


def _as_local(v) -> tuple[datetime, bool]:
    """date/datetime → (로컬 naive datetime, 종일 여부)"""
    if isinstance(v, datetime):
        return (v.astimezone().replace(tzinfo=None) if v.tzinfo else v), False
    return datetime(v.year, v.month, v.day), True


def parse_ics(body: bytes, start: date, end: date) -> list[dict]:
    import icalendar
    import recurring_ical_events
    cal = icalendar.Calendar.from_ical(body)
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        s = ev.get("DTSTART")
        if s is None:
            continue
        s, all_day = _as_local(s.dt)
        e = ev.get("DTEND")
        e = _as_local(e.dt)[0] if e is not None else s + (timedelta(days=1) if all_day else timedelta(hours=1))
        out.append({"title": str(ev.get("SUMMARY", "") or "(제목 없음)")[:NAME_LIMIT], "start": s.isoformat(timespec="minutes"),
                    "end": e.isoformat(timespec="minutes"), "allDay": all_day, "where": str(ev.get("LOCATION", "") or "")[:NAME_LIMIT]})
    return out


def calendar(store: Store, days_before: int = 1, days_after: int = 14, extra: list[dict] | None = None) -> dict:
    """구독 캘린더 + 직접 넣은 일정 + extra(Claude 의 Notion 캘린더 연결로 받은 일정)를 합친다.
    같은 제목·같은 시작은 하나로(여러 캘린더에 겹친 일정)."""
    today = date.today()
    start, end = today - timedelta(days=days_before), today + timedelta(days=days_after + 1)
    data = store.load()
    events, status = [], []
    for c in data["calendars"]:
        if not c.get("on", True):
            continue
        try:
            got = parse_ics(_fetch(c["url"]), start, end)
            status.append({"id": c["id"], "ok": True, "count": len(got)})
            events += [e | {"src": c.get("kind", "other"), "cal": c.get("name", "")} for e in got]
        except BrainError as e:
            status.append({"id": c["id"], "ok": False, "error": str(e)})
        except Exception:  # 깨진 .ics 등
            status.append({"id": c["id"], "ok": False, "error": "캘린더 내용을 읽지 못했어요."})
    for e in extra or []:
        if start.isoformat() <= e["start"][:10] <= end.isoformat():
            events.append(e)
    for e in data["events"]:
        if start.isoformat() <= e["start"][:10] <= end.isoformat():
            events.append({**e, "allDay": False, "src": "manual", "cal": "직접 입력"})
    seen, merged = set(), []
    for e in sorted(events, key=lambda e: e["start"]):
        k = (e["title"].strip().lower(), e["start"])
        if k in seen:
            continue
        seen.add(k)
        merged.append(e)
    return {"events": merged, "status": status, "from": start.isoformat(), "to": end.isoformat()}


# ───────── 스킬 목록 ─────────
FRONT = re.compile(r"^---\s*\n(.*?)\n---", re.S)


def _front(text: str) -> dict:
    m = FRONT.match(text)
    out = {}
    if not m:
        return out
    key = None
    for line in m.group(1).splitlines():
        if re.match(r"^[A-Za-z_-]+:", line):
            key, _, val = line.partition(":")
            key, val = key.strip(), val.strip()
            out[key] = val.strip("'\"") if val not in ("|", ">", "|-", ">-") else ""
        elif key and line.startswith((" ", "\t")):
            out[key] = (out[key] + " " + line.strip()).strip()
    return out


def _short(p: Path) -> str:
    home = str(Path.home())
    s = str(p)
    return "~" + s[len(home):] if s.startswith(home) else s


def skills(project_root: Path | None = None, home: Path | None = None, internal: bool = False) -> list[dict]:
    home = Path(home or Path.home())
    places = [  # (ai, 직접 만든 것인지, 찾을 곳)
        ("claude", True, home / ".claude" / "skills"),
        ("claude", False, home / ".claude" / "plugins"),
        ("gpt", True, home / ".codex" / "skills"),
        ("gemini", True, home / ".gemini" / "skills"),
    ]
    if project_root:
        places.insert(1, ("claude", True, Path(project_root) / ".claude" / "skills"))
    out, seen = [], set()
    for ai, mine, root in places:
        if not root.is_dir():
            continue
        for f in sorted(root.rglob("SKILL.md")):
            if len(out) >= 300:
                break
            rel = f.relative_to(root).parts
            # ~/.claude/skills/synced 는 동기화(설치)된 것, ~/.codex/skills/.system 처럼 점(.) 폴더는 기본 내장
            installed = not mine or "synced" in rel or any(x.startswith(".") for x in rel[:-1])
            try:
                meta = _front(f.read_text(encoding="utf-8", errors="replace")[:6000])
            except OSError:
                continue
            name = (meta.get("name") or f.parent.name)[:NAME_LIMIT]
            key = (ai, name)
            if key in seen:
                continue
            seen.add(key)
            item = {"ai": ai, "name": name, "desc": " ".join(str(meta.get("description", "")).split())[:240],
                    "mine": not installed, "path": _short(f.parent), "hint": " ".join(str(meta.get("argument-hint", "")).split())[:120]}
            if internal:
                item["dir"] = str(f.parent)   # 서버 안에서만(실행·편집). 화면에는 보내지 않는다
            out.append(item)
    out.sort(key=lambda s: (not s["mine"], s["ai"], s["name"].lower()))
    return out
