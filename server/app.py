"""웹 UI 서버: REST API + WebSocket 실시간 중계 + 정적 파일(web/).

Team.run 이 내보내는 이벤트를 /ws 접속자 모두에게 그대로 전달한다. 형식은 docs/events.md 참고.
"""
import asyncio
import contextlib
import copy
import json
import logging
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agentteam.team import summarize

from . import assistant, brain, calconn, connectors, firebase, gmail, mailcal, mcptools, meetings, skills, vercel, notify, notion, outside, projects, teamcfg

log = logging.getLogger("server")

RUN_ID = re.compile(r"\d{8}-\d{6}(-\d+)?", re.ASCII)  # fullmatch 로만 사용 (경로 조작 차단)
GOAL_LIMIT = 4000
RUNS_LIMIT = 50
QUEUE_LIMIT = 1000   # 접속자별 미전송 메시지 한도. 넘으면 그 접속을 끊는다
SEND_TIMEOUT = 15.0  # 메시지 1건 전송 제한 시간(초)


# ── 스냅샷 (중간 합류용 현재 상태) ─────────────────────
def apply_event(snap: dict | None, event: dict) -> dict | None:
    """이벤트 하나를 반영한 새 스냅샷을 돌려준다. 입력 스냅샷은 바꾸지 않는다."""
    kind = event.get("type")
    if kind == "run_start":
        return {"run_id": event.get("run_id"), "goal": event.get("goal", ""), "project": event.get("project"), "phase": "plan",
                "summary": "", "tasks": [], "report": None, "ok": None, "error": None}
    if snap is None or kind not in _CHANGES:
        return snap
    s = copy.deepcopy(snap)
    _CHANGES[kind](s, event)
    return s


def _plan(s: dict, e: dict) -> None:
    s.update(phase="work", summary=e.get("summary", ""),
             tasks=[{**t, "state": "todo", "result": None} for t in e.get("tasks", [])])


def _task(state: str | None):
    def change(s: dict, e: dict) -> None:
        for t in s["tasks"]:
            if t.get("id") == e.get("id"):
                t["assignee"] = e.get("assignee", t.get("assignee"))
                if state:
                    t["state"] = state
                else:  # task_done
                    t.update(state="done" if e.get("ok") else "failed", result=e.get("result", ""))
    return change


def _rework(s: dict, e: dict) -> None:
    have = {t.get("id") for t in s["tasks"]}
    s["phase"] = "work"
    s["tasks"] += [{**t, "state": "todo", "result": None} for t in e.get("tasks", []) if t.get("id") not in have]


_CHANGES = {
    "plan": _plan,
    "rework": _rework,
    "task_start": _task("doing"),
    "task_done": _task(None),
    "review_start": lambda s, e: s.update(phase="review"),
    "report": lambda s, e: s.update(report=e.get("report")),
    "run_error": lambda s, e: s.update(error=e.get("message")),
    "run_end": lambda s, e: s.update(phase="done", ok=bool(e.get("ok"))),
}


# ── 중계 허브 ─────────────────────────────────────────
class Hub:
    """접속자별 큐로 이벤트를 중계한다. 느리거나 끊긴 접속이 실행을 막지 않는다.
    snapshot 은 진행 중인(없으면 마지막으로 끝난) 실행의 상태다."""

    def __init__(self, limit: int = QUEUE_LIMIT):
        self.clients: set[asyncio.Queue] = set()
        self.snapshot: dict | None = None
        self.limit = limit

    def connect(self, hello: dict) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(self.limit)
        q.put_nowait(_dump(hello))
        self.clients.add(q)
        return q

    def disconnect(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def send(self, q: asyncio.Queue, event: dict) -> None:
        self._put(q, _dump(event))

    def broadcast(self, event: dict) -> None:
        """스냅샷은 그대로 두고 모든 접속자에게 보낸다(팀 구성 변경 후 hello 재전송)."""
        text = _dump(event)
        for q in list(self.clients):
            self._put(q, text)

    def publish(self, event: dict) -> None:
        """Team.run 의 emit. 기다리지 않고 바로 반환한다."""
        self.snapshot = apply_event(self.snapshot, event)
        text = _dump(event)
        for q in list(self.clients):
            self._put(q, text)

    def _put(self, q: asyncio.Queue, text: str) -> None:
        try:
            q.put_nowait(text)
        except asyncio.QueueFull:  # 너무 밀린 접속: 비우고 종료 신호(None)만 남긴다
            self.disconnect(q)
            while not q.empty():
                q.get_nowait()
            q.put_nowait(None)

    async def pump(self, ws: WebSocket, q: asyncio.Queue) -> None:
        """큐의 메시지를 순서대로 보낸다. 전송 실패·지연·적체 시 접속을 끊는다."""
        with contextlib.suppress(Exception):
            while (text := await q.get()) is not None:
                await asyncio.wait_for(ws.send_text(text), SEND_TIMEOUT)
        self.disconnect(q)
        with contextlib.suppress(Exception):
            await ws.close(code=1013)


def _dump(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False)


# ── 개발 모드: 자동 새로고침 ────────────────────────────
# web/ 안의 파일이 바뀌면 열려 있는 모든 페이지를 새로고침시킨다. 페이지에는 서버가 index.html 을 줄 때
# /__dev/livereload.js 를 끼워 넣고, 그 스크립트가 /__dev/ws 로 'reload' 신호를 받는다(접속 키 불필요).
# 서버 코드가 바뀌어 재시작되면 boot 값이 달라지므로 페이지가 알아서 다시 읽는다.
DEV_SCRIPT = """(() => {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/__dev/ws";
  let boot = "", timer = 0;
  const reload = () => { clearTimeout(timer); timer = setTimeout(() => location.reload(), 150); };
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "hello") { if (boot && boot !== m.boot) reload(); boot = m.boot; }
      else if (m.type === "reload") reload();
    };
    ws.onclose = () => setTimeout(connect, 800);
    ws.onerror = () => ws.close();
  };
  connect();
})();
"""


class DevReload:
    """개발 모드 새로고침 허브. notify() 가 접속한 모든 페이지에 reload 를 보낸다."""

    def __init__(self):
        self.clients: set[asyncio.Queue] = set()
        self.boot = secrets.token_hex(4)  # 서버 프로세스마다 다른 값

    def connect(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(50)
        q.put_nowait(_dump({"type": "hello", "boot": self.boot}))
        self.clients.add(q)
        return q

    def disconnect(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def notify(self, files=()) -> None:
        names = sorted({f for f in files if f not in (".", "")})  # 폴더 자체의 변경은 이름에서 뺀다
        text = _dump({"type": "reload", "files": names[:20]})
        for q in list(self.clients):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(text)

    async def watch(self, web_dir: Path) -> None:
        """web/ 를 감시한다. 폴더가 아직 없으면 생길 때까지 기다린다."""
        from watchfiles import awatch

        while True:
            while not web_dir.is_dir():
                await asyncio.sleep(1)
            try:
                async for changes in awatch(web_dir, debounce=300, step=100):
                    self.notify(_rel(web_dir, p) for _, p in changes)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # 폴더가 지워지는 등 감시 실패: 잠시 뒤 다시 시작
                log.warning("web/ 감시 중단, 다시 시작합니다: %s", e)
                await asyncio.sleep(1)


def _rel(root: Path, p: str) -> str:
    try:
        return str(Path(p).relative_to(root))
    except ValueError:
        return Path(p).name


# ── 실행 기록(runs/) ───────────────────────────────────
def _read(path: Path) -> str | None:
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else None


def _run_key(d: Path) -> tuple:
    date, time, *n = d.name.split("-")
    return date, time, int(n[0]) if n else 1


def _created(d: Path) -> str:
    try:
        return datetime.strptime(d.name[:15], "%Y%m%d-%H%M%S").isoformat()
    except ValueError:
        return datetime.fromtimestamp(d.stat().st_mtime).isoformat(timespec="seconds")


def _state(d: Path) -> dict:
    try:
        data = json.loads(_read(d / "state.json") or "null")
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _set_state(d: Path, **kw) -> None:
    st = _state(d)
    st.update(kw, updated=datetime.now().isoformat(timespec="seconds"))
    tmp = d / "state.json.tmp"
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(d / "state.json")


def _mark_interrupted(runs_dir: Path) -> None:
    """서버가 막 켜졌을 때: '진행 중'으로 남은 실행은 서버 종료·재시작으로 끊긴 것이다 → 이어 할 수 있게 표시."""
    if not runs_dir.is_dir():
        return
    for d in runs_dir.iterdir():
        if d.is_dir() and RUN_ID.fullmatch(d.name) and _state(d).get("status") == "running":
            with contextlib.suppress(OSError):
                _set_state(d, status="interrupted")


RESUME_DAYS = 7


def _resumable(runs_dir: Path) -> list[dict]:
    """이어 할 수 있는 실행(끊김·오류, 최근 7일, 최신 5건)."""
    if not runs_dir.is_dir():
        return []
    cut = datetime.now().timestamp() - RESUME_DAYS * 86400
    out = []
    for d in sorted((d for d in runs_dir.iterdir() if d.is_dir() and RUN_ID.fullmatch(d.name)), key=_run_key, reverse=True):
        st = _state(d)
        if st.get("status") not in ("interrupted", "error") or (d / "report.md").is_file():
            continue
        if d.stat().st_mtime < cut:
            continue
        try:
            plan = json.loads(_read(d / "plan.json") or "null") or {}
        except ValueError:
            plan = {}
        total = len(plan.get("tasks", [])) if isinstance(plan, dict) else 0
        done = sum(1 for v in (st.get("tasks") or {}).values() if isinstance(v, dict) and v.get("ok"))
        out.append({"run_id": d.name, "goal": _read(d / "goal.txt") or "", "created": _created(d), "status": st.get("status"),
                    "stage": st.get("stage", "plan"), "done": done, "total": total, "project": _project_name(d),
                    "error": (st.get("error") or _read(d / "error.txt") or "")[:300], "tools": st.get("tools") or []})
        if len(out) >= 5:
            break
    return out


def _usage_report(runs_dir: Path, days: int) -> dict:
    """최근 days 일 동안의 사용량: 전체·팀원별·하루별·단계별."""
    since = datetime.now().timestamp() - days * 86400
    calls = []
    if runs_dir.is_dir():
        for d in runs_dir.iterdir():
            if not (d.is_dir() and RUN_ID.fullmatch(d.name)):
                continue
            try:
                t = datetime.strptime(d.name[:15], "%Y%m%d-%H%M%S")
            except ValueError:
                continue
            if t.timestamp() < since:
                continue
            try:
                data = json.loads(_read(d / "usage.json") or "null") or {}
            except ValueError:
                continue
            for c in data.get("calls", []) if isinstance(data, dict) else []:
                if isinstance(c, dict):
                    calls.append({**c, "day": t.strftime("%Y-%m-%d"), "run_id": d.name})
    group = lambda key: {k: summarize([c for c in calls if c.get(key) == k]) for k in sorted({str(c.get(key)) for c in calls})}  # noqa: E731
    return {"days": days, "runs": len({c["run_id"] for c in calls}), "total": summarize(calls),
            "by_member": group("name"), "by_day": group("day"), "by_stage": group("stage"), "by_provider": group("provider")}


def _project_name(d: Path) -> str | None:
    try:
        return (json.loads(_read(d / "project.json") or "null") or {}).get("name")
    except (ValueError, AttributeError):
        return None


def _task_key(f: Path) -> int:
    m = re.match(r"task-(\d+)", f.name)
    return int(m.group(1)) if m else 0


def _new_run_id(root: Path) -> str:
    """시각 기반 run_id. 같은 초에 이미 있으면 -2, -3 … 을 붙이고 폴더를 먼저 만들어 선점한다."""
    base = datetime.now().strftime("%Y%m%d-%H%M%S")
    root.mkdir(parents=True, exist_ok=True)
    run_id, n = base, 1
    while True:
        try:
            (root / run_id).mkdir()
            return run_id
        except FileExistsError:
            n += 1
            run_id = f"{base}-{n}"


class RunIn(BaseModel):
    goal: str = ""
    project_id: str | None = Field(None, max_length=64)  # 있으면 그 프로젝트 폴더 안에서 실행
    tools: list[str] | None = Field(None, max_length=20)  # 사용자가 이번 업무에 허락한 외부 도구(MCP 서버 이름)


class ResumeIn(BaseModel):
    tools: list[str] | None = Field(None, max_length=20)


class BrainListIn(BaseModel):
    items: list[dict] = Field(default_factory=list, max_length=brain.MAX_SKILLNOTES)


class SkillIn(BaseModel):
    ai: Literal["claude", "gpt", "gemini"]
    name: str = Field(min_length=1, max_length=80)


class SkillRunIn(SkillIn):
    input: str = Field("", max_length=2000)


class SkillEditIn(SkillIn):
    content: str | None = Field(None, max_length=skills.FILE_LIMIT)
    label: str | None = Field(None, max_length=30)
    input: bool | None = None


class AssistantMsg(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AssistantIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[AssistantMsg] = Field(default_factory=list, max_length=20)


class MeetCheckIn(BaseModel):
    key: str = Field(max_length=80)
    done: bool = True


class BrainCheckIn(BaseModel):
    day: str
    done: bool = True


class NotifyIn(BaseModel):
    url: str = Field("", max_length=2000)
    enabled: bool = False
    secret: str | None = Field(None, max_length=200)  # None: 그대로 · "": 지우기


class ToolIn(BaseModel):
    config: dict
    description: str = Field("", max_length=200)


class ProjectIn(BaseModel):
    path: str = Field(max_length=4096)
    name: str | None = Field(None, max_length=200)
    confirm: bool = False  # 사용자가 '전체 접근 허락'에 동의했는지


class ProjectPatch(BaseModel):
    name: str = Field(max_length=200)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskIn(BaseModel):
    name: str
    message: str = ""
    history: list[ChatMessage] = []


class PlaceIn(BaseModel):
    """사무실 위치(설정의 '사무실 위치'): 일출·일몰 계산과 바깥 풍경에 함께 쓴다."""
    lat: float = Field(ge=-85, le=85)
    lng: float = Field(ge=-180, le=180)
    label: str = Field("", max_length=200)
    floor: int = Field(1, ge=1, le=200)       # 사무실 층(2층이면 1층 높이만큼 띄운다)
    show: bool = True                          # 바깥 풍경 보이기
    turn: int = Field(0, ge=0, le=3)           # 사무실 방향 90°씩 돌리기
    r: int = Field(350, ge=outside.R_MIN, le=outside.R_MAX)  # 지도 반경(m)


# ── 앱 ────────────────────────────────────────────────
class RevalidatedStaticFiles(StaticFiles):
    """web/ 정적 파일: 매번 ETag·Last-Modified 로 재검증(바뀌지 않았으면 304). 업데이트 뒤 옛 JS 가 섞이지 않게 한다."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


def create_app(team, access_key: str | None, runs_dir: Path, web_dir: Path, dev: bool = False,
               cache_dir: Path | None = None, projects_file: Path | None = None,
               notify_file: Path | None = None, tools_file: Path | None = None, brain_file: Path | None = None) -> FastAPI:
    """dev=True: web/ 변경 시 브라우저 자동 새로고침 + 정적 파일 캐시 금지(새로고침하면 항상 최신 파일).
    cache_dir: 바깥 풍경 지도 원본·사무실 위치를 두는 곳(기본: runs 옆 cache/outside, Git 제외).
    projects_file: 등록한 프로젝트(폴더 접근) 목록(기본: runs 옆 projects.json, Git 제외)."""
    runs_dir, web_dir = Path(runs_dir), Path(web_dir)
    store = projects.Store(Path(projects_file) if projects_file else runs_dir.parent / "projects.json")
    out_dir = Path(cache_dir) if cache_dir else runs_dir.parent / "cache" / "outside"
    map_lock = asyncio.Lock()
    hub = Hub()
    dev_hub = DevReload() if dev else None
    notifier = notify.Notify(Path(notify_file) if notify_file else runs_dir.parent / "cache" / "notify.json")
    tools_store = mcptools.Store(Path(tools_file) if tools_file else runs_dir.parent / "mcp-servers.json")
    recorder = notion.Notion()
    brain_store = brain.Store(Path(brain_file) if brain_file else runs_dir.parent / "cache" / "brain.json")
    fb_sync = firebase.Sync(brain_store.file.parent)  # 브레인 자료 Firestore 백업(.env FIREBASE_PROJECT 가 있을 때만)
    mail_sums = gmail.Summaries((Path(brain_file).parent if brain_file else runs_dir.parent / "cache") / "brain-mail.json")
    mail = {"items": [], "at": 0.0, "error": "", "task": None, "fail": 0.0}  # 받은 메일(10분 재사용)·요약 작업
    dist_dir = runs_dir.parent / "dist"  # 휴대폰 앱 릴리즈(scripts/release.py, Git 제외)
    _mark_interrupted(runs_dir)
    background: set[asyncio.Task] = set()

    def later(fn, *args) -> None:
        task = asyncio.get_running_loop().create_task(asyncio.to_thread(fn, *args))
        background.add(task)
        task.add_done_callback(background.discard)

    def publish(event: dict) -> None:
        """Team.run 의 emit: 화면에 중계하고, 업무가 끝나면(끊긴 경우 제외) 결과 알림을 보내고 노션에 기록한다."""
        hub.publish(event)
        if event.get("type") != "run_end":
            return
        rid = str(event.get("run_id", ""))
        d = runs_dir / rid
        if not RUN_ID.fullmatch(rid) or _state(d).get("status") == "interrupted":
            return
        if notifier.load()["enabled"]:
            later(notifier.send, notify.run_payload(d, rid, bool(event.get("ok")), event.get("usage")))
        if recorder.enabled():
            later(recorder.record, d, rid, bool(event.get("ok")), event.get("usage"))

    async def fb_loop() -> None:
        """1분마다 Firebase 와 양방향으로 맞춘다(이쪽에서 바뀐 것은 올리고, 다른 컴퓨터에서 바뀐 것은 받는다)"""
        warned = False
        while True:
            if firebase.project():
                try:
                    got = await asyncio.to_thread(fb_sync.sync)
                    if got["pulled"]:
                        log.info("Firebase 에서 받은 브레인 자료: %s", ", ".join(got["pulled"]))
                    if fb_sync.others and not warned:
                        log.warning("다른 컴퓨터(%s)의 서버도 켜져 있어요 — 한쪽만 켜 두는 것이 안전해요", ", ".join(fb_sync.others))
                    warned = bool(fb_sync.others)
                except firebase.FirebaseError as e:
                    fb_sync.error = str(e)
                except Exception as e:
                    log.warning("Firebase 동기화 실패: %s", e)
                    fb_sync.error = "Firebase 동기화에 실패했어요."
            await asyncio.sleep(60)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        watcher = asyncio.create_task(dev_hub.watch(web_dir)) if dev_hub else None
        fb_task = asyncio.create_task(fb_loop())
        yield
        fb_task.cancel()
        if watcher:
            watcher.cancel()
        if (task := app.state.task) and not task.done():  # 서버 종료 시 진행 중 업무 취소
            task.cancel()
            await asyncio.wait({task}, timeout=5)

    app = FastAPI(title="멀티 에이전트 팀", lifespan=lifespan)
    app.state.hub, app.state.task, app.state.dev = hub, None, dev_hub
    app.state.chatting = False

    def key_ok(key: str | None) -> bool:
        return not access_key or secrets.compare_digest((key or "").encode(), access_key.encode())

    def check_key(x_access_key: str | None = Header(None)) -> None:
        if not key_ok(x_access_key):
            raise HTTPException(401, "접속 키가 필요합니다.")

    def run_dir(run_id: str) -> Path:
        d = runs_dir / run_id
        if not RUN_ID.fullmatch(run_id) or not d.is_dir():
            raise HTTPException(404, "실행 기록을 찾을 수 없습니다.")
        return d

    def finished(task: asyncio.Task) -> None:
        # run_error 이벤트는 Team.run 이 이미 보냈다. 여기서는 서버 로그만 남긴다.
        if not task.cancelled() and (e := task.exception()):
            log.error("업무 실행 실패: %s", e, exc_info=e)

    api = APIRouter(prefix="/api", dependencies=[Depends(check_key)])

    @api.get("/team")
    def get_team():
        return team.info()

    # ── 에이전트 설정(team.toml) ──
    def config_file() -> Path:
        path = getattr(team, "config_path", None)
        if not path or not Path(path).is_file():
            raise HTTPException(404, "팀 설정 파일(team.toml)을 찾을 수 없습니다.")
        return Path(path)

    @api.get("/team/config")
    def get_team_config():
        try:
            cfg = teamcfg.read_config(config_file())
        except (OSError, ValueError) as e:
            raise HTTPException(500, f"team.toml 을 읽지 못했습니다: {e}")
        return {"config": cfg, "providers": teamcfg.provider_options(), "mock": team.mock,
                "limits": {"members": teamcfg.MEMBER_LIMIT, "role": teamcfg.ROLE_LIMIT, "guide": teamcfg.GUIDE_LIMIT}}

    @api.put("/team/config")
    def put_team_config(body: dict):
        if app.state.chatting or (app.state.task and not app.state.task.done()):
            raise HTTPException(409, "진행 중인 업무나 대화가 끝난 뒤 저장해 주세요.")
        try:
            cfg = teamcfg.validate(body.get("config") if isinstance(body, dict) else None)
        except teamcfg.ConfigError as e:
            raise HTTPException(400, str(e))
        path = config_file()
        try:
            teamcfg.write_config(path, cfg)
            team.reload()
        except (OSError, ValueError, KeyError, TypeError) as e:
            log.exception("팀 설정 저장 실패")
            raise HTTPException(500, f"설정을 저장하지 못했습니다: {e}")
        info = team.info()
        hub.broadcast({"type": "hello", "team": info, "mock": team.mock, "snapshot": hub.snapshot})
        return {"ok": True, "team": info, "config": cfg}

    @api.post("/run")
    async def start_run(body: RunIn):
        goal = body.goal.strip()
        if not goal:
            raise HTTPException(400, "업무 목표를 입력하세요.")
        if len(goal) > GOAL_LIMIT:
            raise HTTPException(400, f"업무 목표는 {GOAL_LIMIT:,}자 이내로 입력하세요.")
        # 확인과 시작 사이에 await 가 없으므로 동시 요청이 둘 다 시작될 수 없다
        project = None
        if body.project_id:
            try:
                project = store.usable(body.project_id)
            except LookupError as e:
                raise HTTPException(404, str(e))
            except projects.ProjectError as e:
                raise HTTPException(400, str(e))
        try:
            tools = tools_store.select(body.tools)
        except mcptools.ToolError as e:
            raise HTTPException(400, str(e))
        if app.state.chatting or (app.state.task and not app.state.task.done()):
            raise HTTPException(409, "이미 진행 중인 업무가 있습니다.")
        run_id = _new_run_id(runs_dir)
        task = asyncio.create_task(team.run(goal, runs_dir, emit=publish, run_id=run_id, project=project, tools=tools))
        task.add_done_callback(finished)
        app.state.task = task  # 강한 참조 유지 (GC 방지)
        return {"run_id": run_id}

    @api.post("/ask")
    async def ask_member(body: AskIn):
        if body.name not in team.members:
            raise HTTPException(404, "팀원을 찾을 수 없습니다.")
        message = body.message.strip()
        if not message or len(message) > GOAL_LIMIT:
            raise HTTPException(400, "질문은 1~4,000자로 입력하세요.")
        if len(body.history) > 12 or any(len(m.content) > 20_000 for m in body.history) or sum(len(m.content) for m in body.history) > 24_000:
            raise HTTPException(400, "대화가 너무 깁니다. 새 대화를 시작하세요.")
        if app.state.chatting or (app.state.task and not app.state.task.done()):
            raise HTTPException(409, "진행 중인 응답이나 팀 업무가 끝난 뒤 다시 말 걸어 주세요.")
        app.state.chatting = True
        try:
            history = "\n\n".join(f"{'사용자' if m.role == 'user' else '당신'}: {m.content}" for m in body.history)
            prompt = f"##CHAT##\n사무실에서 사용자가 당신에게 말을 걸었습니다. 자신의 역할에 맞춰 한국어로 자연스럽게 답하세요. 인사는 짧게, 질문은 구체적으로 답하세요.\n\n[이전 대화]\n{history}\n\n[사용자 질문]\n{message}"
            answer = await asyncio.wait_for(team.ask(body.name, prompt), timeout=180)
            return {"name": body.name, "answer": str(answer)[:20_000], "mock": team.mock}
        except TimeoutError:
            raise HTTPException(504, "답변 시간이 초과되었습니다. 잠시 후 다시 시도하세요.")
        except Exception:
            log.exception("팀원 대화 실패: %s", body.name)
            raise HTTPException(502, "답변을 받지 못했습니다. 서버의 모델 연결 상태를 확인하세요.")
        finally:
            app.state.chatting = False

    # ── 중단된 업무 이어 하기 ──
    @api.get("/runs/resumable")
    def resumable():
        busy = bool(app.state.task and not app.state.task.done())
        return {"runs": [] if busy else _resumable(runs_dir)}

    @api.post("/runs/{run_id}/resume")
    async def resume_run(run_id: str, body: ResumeIn | None = None):
        d = run_dir(run_id)
        st = _state(d)
        if st.get("status") not in ("interrupted", "error") or (d / "report.md").is_file():
            raise HTTPException(400, "이어 할 수 있는 업무가 아닙니다.")
        project = None
        try:
            saved = json.loads(_read(d / "project.json") or "null")
        except ValueError:
            saved = None
        if isinstance(saved, dict) and saved.get("id"):
            try:
                project = store.usable(saved["id"])
            except (LookupError, projects.ProjectError) as e:
                raise HTTPException(400, f"이 업무의 프로젝트 폴더를 쓸 수 없어 이어 할 수 없습니다: {e}")
        try:
            tools = tools_store.select(body.tools if body else None)
        except mcptools.ToolError as e:
            raise HTTPException(400, str(e))
        if app.state.chatting or (app.state.task and not app.state.task.done()):
            raise HTTPException(409, "이미 진행 중인 업무가 있습니다.")
        with contextlib.suppress(OSError):
            (d / "error.txt").unlink()
        goal = _read(d / "goal.txt") or ""
        task = asyncio.create_task(team.run(goal, runs_dir, emit=publish, run_id=run_id, project=project, tools=tools, resume=True))
        task.add_done_callback(finished)
        app.state.task = task
        return {"run_id": run_id, "resumed": True}

    @api.post("/runs/{run_id}/dismiss")
    def dismiss_run(run_id: str):
        d = run_dir(run_id)
        if _state(d).get("status") in ("interrupted", "error"):
            _set_state(d, status="dismissed")
        return {"ok": True}

    # ── 사용량 ──
    @api.get("/usage")
    def usage(days: int = 7):
        return _usage_report(runs_dir, max(1, min(90, days)))

    # ── 결과 알림(웹훅·n8n) ──
    @api.get("/notify")
    def get_notify():
        return notifier.public()

    @api.put("/notify")
    def put_notify(body: NotifyIn):
        try:
            return notifier.save(body.url, body.enabled, body.secret)
        except notify.NotifyError as e:
            raise HTTPException(400, str(e))

    @api.post("/notify/test")
    async def test_notify():
        if not notifier.load()["url"]:
            raise HTTPException(400, "받을 주소(URL)를 먼저 저장하세요.")
        return await asyncio.to_thread(notifier.send, notify.sample_payload(), True)

    # ── 브레인 모드(docs/events.md '브레인 모드') ──
    @api.get("/brain")
    def get_brain():
        return brain_store.public()

    @api.put("/brain/{kind}")
    def put_brain(kind: Literal["shortcuts", "routines", "pins", "calendars", "events", "meetings", "skillnotes"], body: BrainListIn):
        try:
            return brain_store.put(kind, body.items)
        except brain.BrainError as e:
            raise HTTPException(400, str(e))

    @api.post("/brain/routines/{rid}/check")
    def check_routine(rid: str, body: BrainCheckIn):
        try:
            return brain_store.check(rid, body.day, body.done)
        except brain.BrainError as e:
            raise HTTPException(400, str(e))

    vsync = {"at": 0.0, "added": 0}

    @api.get("/brain/vercel")
    async def vercel_status(sync: bool = False):
        """Vercel CLI 연결 상태. sync=1 이면 6시간마다 새 프로젝트를 바로가기로 자동으로 더한다."""
        st = await asyncio.to_thread(vercel.status)
        if st["connected"] and sync and time.time() - vsync["at"] > 6 * 3600:
            vsync["at"] = time.time()
            with contextlib.suppress(HTTPException):
                vsync["added"] = (await import_vercel())["added"]
        return st | {"synced": datetime.fromtimestamp(vsync["at"]).isoformat(timespec="minutes") if vsync["at"] else "", "added": vsync["added"]}

    @api.post("/brain/shortcuts/vercel")
    async def import_vercel():
        """Vercel 프로젝트를 바로가기로 더한다(이미 있는 주소는 건너뛴다)."""
        try:
            found = await asyncio.to_thread(vercel.projects)
        except vercel.VercelError as e:
            raise HTTPException(400, str(e))
        vsync["at"] = time.time()
        cur = brain_store.load()["shortcuts"]
        have = {x["url"].rstrip("/") for x in cur}
        new = [{k: v for k, v in p.items() if k != "team"} for p in found if p["url"].rstrip("/") not in have]
        room = brain.MAX_ITEMS - len(cur)
        try:
            out = brain_store.put("shortcuts", cur + new[:max(0, room)])
        except brain.BrainError as e:
            raise HTTPException(400, str(e))
        return out | {"added": min(len(new), max(0, room)), "found": len(found)}

    cal = {"items": [], "at": 0.0, "error": "", "task": None}  # Claude 의 Notion 캘린더 연결(Google 캘린더 포함)
    cal_file = mail_sums.file.with_name("brain-cal-last.json")
    with contextlib.suppress(OSError, ValueError):
        last = json.loads(cal_file.read_text(encoding="utf-8"))
        cal.update(items=list(last["items"]), at=float(last["at"]))

    async def cal_job() -> None:
        try:
            items = await calconn.fetch()
            cal.update(items=items, error="")
            with contextlib.suppress(OSError):
                cal_file.parent.mkdir(parents=True, exist_ok=True)
                cal_file.write_text(json.dumps({"items": items, "at": time.time()}, ensure_ascii=False), encoding="utf-8")
        except connectors.ConnectorError as e:
            cal["error"] = str(e)
        except Exception as e:
            log.warning("캘린더 연결 실패: %s", e)
            cal["error"] = "Claude 의 Notion 캘린더 연결로 일정을 가져오지 못했어요."
        cal["at"] = time.time()

    @api.get("/brain/calendar")
    async def brain_calendar(days: int = 14, refresh: bool = False):
        on = bool(connectors.claude_exe())
        busy = cal["task"] is not None and not cal["task"].done()
        if on and not busy and (refresh or time.time() - cal["at"] > calconn.TTL):
            cal["task"] = asyncio.create_task(cal_job())
            busy = True
        out = await asyncio.to_thread(brain.calendar, brain_store, 1, max(1, min(60, days)), cal["items"] if on else [])
        return out | {"conn": {"enabled": on, "loading": busy, "error": cal["error"], "count": len(cal["items"]),
                               "at": datetime.fromtimestamp(cal["at"]).isoformat(timespec="minutes") if cal["at"] else ""}}

    skill_runs = skills.Runs(mail_sums.file.with_name("brain-skill-runs.json"), runs_dir / "skills")

    def find_skill(ai: str, name: str) -> dict:
        try:
            return skills.find(ai, name, runs_dir.parent)
        except skills.SkillError as e:
            raise HTTPException(404, str(e))

    labeling = {"task": None, "at": 0.0}

    async def label_job(todo: list[dict]) -> None:
        """이름 없는 스킬에 한국어 짧은 이름을 붙인다(40개씩, 도구 없이 글만)."""
        for i in range(0, len(todo), 40):
            part = todo[i:i + 40]
            try:
                found = skills.parse_labels(await connectors.ask(skills.label_prompt(part), "", "haiku", "이름 짓기"), {x["key"] for x in part})
            except Exception as e:
                log.warning("스킬 이름 짓기 실패: %s", e)
                return
            notes = brain_store.load()["skillnotes"]
            have = {n["key"] for n in notes}
            notes = [n | ({"label": found[n["key"]]} if n["key"] in found and not n.get("label") else {}) for n in notes]
            notes += [{"key": k, "label": v, "input": None} for k, v in found.items() if k not in have]
            with contextlib.suppress(brain.BrainError):
                brain_store.put("skillnotes", notes[-brain.MAX_SKILLNOTES:])

    @api.get("/brain/skills")
    async def brain_skills():
        notes = {n["key"]: n for n in brain_store.load()["skillnotes"]}
        out = []
        for sk in await asyncio.to_thread(brain.skills, runs_dir.parent):
            n = notes.get(f"{sk['ai']}:{sk['name']}", {})
            out.append(sk | {"label": n.get("label", ""), "input": bool(sk["hint"]) if n.get("input") is None else n["input"]})
        todo = [{"key": f"{x['ai']}:{x['name']}", "desc": x["desc"] or x["name"]} for x in out if not x["label"]]
        busy = labeling["task"] is not None and not labeling["task"].done()
        if todo and not busy and connectors.claude_exe() and time.time() - labeling["at"] > 3600:
            labeling.update(task=asyncio.create_task(label_job(todo)), at=time.time())
            busy = True
        return {"skills": out, "labeling": busy}

    @api.get("/brain/skills/file")
    def skill_file(ai: Literal["claude", "gpt", "gemini"], name: str):
        sk = find_skill(ai, name)
        try:
            return {"content": skills.read(sk), "editable": sk["mine"], "path": sk["path"]}
        except skills.SkillError as e:
            raise HTTPException(400, str(e))

    @api.put("/brain/skills/file")
    def save_skill(body: SkillEditIn):
        sk = find_skill(body.ai, body.name)
        try:
            if body.content is not None:
                skills.write(sk, body.content)
            if body.label is not None or body.input is not None:
                key = f"{body.ai}:{body.name}"
                notes = [n for n in brain_store.load()["skillnotes"] if n["key"] != key]
                brain_store.put("skillnotes", notes + [{"key": key, "label": body.label or "", "input": body.input}])
        except (skills.SkillError, brain.BrainError) as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @api.post("/brain/skills/run")
    async def run_skill(body: SkillRunIn):
        sk = find_skill(body.ai, body.name)
        try:
            run = skill_runs.start(sk, body.input.strip())
        except skills.SkillError as e:
            raise HTTPException(400, str(e))
        return {k: v for k, v in run.items() if k != "folder"}

    @api.get("/brain/skills/runs")
    def skill_runs_list():
        return {"runs": skill_runs.public()}

    @api.get("/brain/skills/runs/{rid}/file")
    def skill_run_file(rid: str, path: str):
        try:
            return FileResponse(skill_runs.path_of(rid, path))
        except skills.SkillError as e:
            raise HTTPException(404, str(e))

    async def summarize_mail(todo: list[dict], cfg: dict) -> None:
        """요약이 없는 메일을 팀원 한 명에게 한 번에 맡긴다(실패하면 10분 뒤 다시)."""
        name = cfg["member"] if cfg["member"] in team.members else "gemini" if "gemini" in team.members else team.leader.name
        try:
            for i in range(0, len(todo), 20):
                part = todo[i:i + 20]
                answer = await asyncio.wait_for(team.ask(name, gmail.prompt(part)), timeout=240)
                found = gmail.parse_answer(answer, {m["id"] for m in part})
                if not found:
                    raise ValueError("요약 형식이 맞지 않음")
                await asyncio.to_thread(mail_sums.add, found)
        except Exception as e:
            log.warning("메일 요약 실패: %s", e)
            mail["fail"] = time.time()

    mail_store = gmail.Store(mail_sums.file.with_name("brain-mail-store.json"))  # 쌓아 둔 업무 메일(새 것만 더한다)
    old_last = mail_sums.file.with_name("brain-mail-last.json")                  # 예전 방식(마지막 목록) → 한 번 옮긴다
    if not mail_store.items and old_last.exists():
        with contextlib.suppress(OSError, ValueError, KeyError):
            mail_store.merge(list(json.loads(old_last.read_text(encoding="utf-8"))["items"]))
        with contextlib.suppress(OSError):
            old_last.unlink()
    mail["at"] = mail_store.at   # 기간만큼 아직 안 받았으면(span 부족) 처음 열 때 받는다 — brain_mail 이 판단

    async def claude_mail(cfg: dict) -> None:
        """새 메일만: 마지막으로 받은 뒤의 날짜만 보고, 이미 쌓인 스레드는 건너뛰게 한다.
        아직 기간(GMAIL_DAYS, 기본 30일)만큼 거슬러 받지 않았으면 그 기간 전체를 한 번 받는다."""
        try:
            back = mail_store.span < cfg["days"]
            since = cfg["days"] if back else (time.time() - mail_store.at) / 86400
            days = max(1, min(cfg["days"], int(since) + 1))
            items = await gmail.claude_fetch(cfg, mail_store.ids(), days)
            mail.update(added=await asyncio.to_thread(mail_store.merge, items, cfg["days"] if back else 0), error="", via="claude")
        except gmail.MailError as e:
            mail.update(error=str(e))
        except Exception as e:
            log.warning("Claude Gmail 연결 실패: %s", e)
            mail.update(error="Claude 의 Gmail 연결로 메일을 가져오지 못했어요.")
        mail["at"] = time.time()

    @api.get("/brain/mail")
    async def brain_mail(refresh: bool = False):
        """쌓아 둔 업무 메일(최근 GMAIL_DAYS 일, 기본 30일). refresh=1(다시 불러오기)이면 바로, 아니면 10분마다 새 메일만 더한다."""
        cfg = gmail.config()
        if not cfg:
            return {"enabled": False}
        now = time.time()
        busy = mail["task"] is not None and not mail["task"].done()
        stale = refresh or now - mail["at"] > 600 or (mail_store.span < cfg["days"] and not mail["error"])  # 기간을 늘렸으면 한 번 더 거슬러
        mode, note = cfg["mode"], ""
        # 앱 비밀번호 로그인이 실패하면(같은 값인 동안) Claude 의 Gmail 연결로 대신 가져온다
        failed = mail.get("imap_bad") == (cfg["user"], cfg["pw"])
        if mode == "imap" and failed and cfg["claude"]:
            mode, note = "claude", "앱 비밀번호 로그인에 실패해 Claude 의 Gmail 연결로 가져왔어요. .env 의 GMAIL_APP_PASSWORD 를 지우거나 고치세요."
        if mode == "imap" and stale and not busy:
            try:
                mail.update(items=await asyncio.to_thread(gmail.fetch, cfg), error="", via="imap")
                mail.pop("imap_bad", None)
            except gmail.MailError as e:
                if "로그인" in str(e) and cfg["claude"]:
                    mail["imap_bad"] = (cfg["user"], cfg["pw"])
                    mode, note = "claude", "앱 비밀번호 로그인에 실패해 Claude 의 Gmail 연결로 가져와요. .env 의 GMAIL_APP_PASSWORD 를 지우거나 고치세요."
                else:
                    mail.update(items=[], error=str(e), via="imap")
            mail["at"] = now
        pending = 0
        if mode == "claude":
            if stale and not busy:
                mail["task"] = asyncio.create_task(claude_mail(cfg))
                busy = True
        else:   # IMAP: 요약이 끝난 메일부터 쌓는다
            cached = mail_sums.load()
            done = [m for m in gmail.public(mail["items"], cached) if m["id"] in cached]
            if done:
                mail["added"] = await asyncio.to_thread(mail_store.merge, done, cfg["days"]) or mail.get("added", 0)
            todo = [m for m in mail["items"] if m["id"] not in cached]
            if todo and not busy and (refresh or now - mail["fail"] > 600):
                mail["task"] = asyncio.create_task(summarize_mail(todo, cfg))
                busy = True
            pending = len(todo) if busy else 0
        items = mail_store.recent(cfg["days"])
        return {"enabled": True, "source": mode, "user": gmail.masked(cfg["user"]) if mode == "imap" else "Claude 의 Gmail 연결",
                "items": items, "error": mail["error"], "note": note, "pending": pending, "loading": busy and mode == "claude",
                "added": mail.get("added", 0), "total": len(items), "days": cfg["days"],
                "at": datetime.fromtimestamp(mail["at"]).isoformat(timespec="minutes") if mail["at"] else ""}

    # 메일 → 일정 제안(server/mailcal.py). 사용자가 화면에서 [등록](고쳐서)·[취소] 해야 일정이 된다
    mcal = mailcal.Store(mail_sums.file.with_name("brain-mail-events.json"))
    mcal_job: dict = {"task": None, "error": "", "fail": 0.0}

    async def find_mail_events(todo: list[dict]) -> None:
        try:
            for i in range(0, len(todo), mailcal.BATCH):
                part = todo[i:i + mailcal.BATCH]
                answer = await connectors.ask(mailcal.prompt(part), "", "haiku", "일정 찾기")
                await asyncio.to_thread(mcal.add, mailcal.parse(answer, part), [m["id"] for m in part])
            mcal_job["error"] = ""
        except Exception as e:
            log.warning("메일 일정 찾기 실패: %s", e)
            mcal_job.update(error="메일에서 일정을 찾지 못했어요. 잠시 뒤 다시 시도해요.", fail=time.time())

    @api.get("/brain/mailcal")
    async def brain_mailcal(refresh: bool = False):
        """승인을 기다리는 일정 제안. 아직 살펴보지 않은 메일(요약이 있는 것)이 있으면 뒤에서 찾는다."""
        busy = mcal_job["task"] is not None and not mcal_job["task"].done()
        todo = mcal.unseen([m for m in mail_store.items if m.get("summary") or m.get("due")])
        if todo and not busy and (refresh or time.time() - mcal_job["fail"] > 600) and connectors.claude_exe():
            mcal_job["task"] = asyncio.create_task(find_mail_events(todo))
            busy = True
        return {"items": mcal.pending(), "loading": busy, "looking": len(todo) if busy else 0, "error": mcal_job["error"]}

    class MailCalIn(BaseModel):
        action: Literal["add", "dismiss"]
        title: str | None = None
        start: str | None = None
        end: str | None = None
        allDay: bool | None = None
        where: str | None = None
        star: bool | None = None

    @api.post("/brain/mailcal/{sid}")
    async def brain_mailcal_decide(sid: str, body: MailCalIn):
        """[등록]: 사용자가 고친 값으로 '직접 입력' 일정에 넣는다 · [취소]: 다시 제안하지 않는다"""
        x = next((x for x in mcal.load()["items"] if x["id"] == sid), None)
        if not x:
            raise HTTPException(404, "일정 제안을 찾을 수 없어요.")
        if x.get("status") != "pending":
            raise HTTPException(409, "이미 처리한 제안이에요.")
        if body.action == "dismiss":
            return {"ok": True, "item": await asyncio.to_thread(mcal.decide, sid, "dismissed")}
        edit = {k: v for k, v in body.model_dump().items() if k != "action" and v is not None}
        try:
            ev = mailcal.to_event({**x, **edit})
            before = {e["id"] for e in brain_store.load()["events"]}
            cfg = brain_store.put("events", [*brain_store.load()["events"], ev])
        except (brain.BrainError, ValueError) as e:
            raise HTTPException(400, str(e) or "일정 시간이 올바르지 않아요.")
        new_id = next((e["id"] for e in brain_store.load()["events"] if e["id"] not in before), "")
        item = await asyncio.to_thread(mcal.decide, sid, "added", new_id)
        return {"ok": True, "item": item, "brain": cfg}

    mail_detail = mail_sums.file.with_name("brain-mail-detail.json")   # 메일 하나 자세히(만든 것은 남겨 다시 쓰지 않는다)
    detail_busy: dict[str, asyncio.Task] = {}

    @api.get("/brain/mail/detail")
    async def brain_mail_detail(id: str):
        """모달용: 쌓아 둔 메일 하나의 요점·할 일. 처음엔 Claude 가 그 스레드만 읽어 정리하고(30초 안팎) 결과를 남긴다."""
        m = next((x for x in mail_store.items if x["id"] == id), None)
        if not m:
            raise HTTPException(404, "메일을 찾을 수 없어요.")
        try:
            saved = json.loads(mail_detail.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        if id in saved:
            return {"ready": True, **saved[id]}
        cfg = gmail.config()
        if not cfg or not cfg["claude"]:
            return {"ready": True, "points": [], "actions": [], "people": "", "messages": 0, "error": "자세한 요약은 Claude 의 Gmail 연결이 있을 때만 만들 수 있어요."}
        task = detail_busy.get(id)
        if task is None:
            async def job():
                try:
                    out = await gmail.claude_detail(m.get("thread") or id, cfg["model"])
                except gmail.MailError as e:
                    return {"error": str(e)}
                with contextlib.suppress(OSError, ValueError):
                    cur = json.loads(mail_detail.read_text(encoding="utf-8")) if mail_detail.exists() else {}
                    cur[id] = out
                    mail_detail.parent.mkdir(parents=True, exist_ok=True)
                    mail_detail.write_text(json.dumps(dict(list(cur.items())[-300:]), ensure_ascii=False), encoding="utf-8")
                return out
            task = detail_busy[id] = asyncio.create_task(job())
        if not task.done():
            return {"ready": False}
        detail_busy.pop(id, None)
        res = task.result()
        return {"ready": True, "points": [], "actions": [], "people": "", "messages": 0, **res}

    meet_file = mail_sums.file.with_name("brain-meet-last.json")    # 마지막 회의록 목록(서버를 다시 켜도 바로)
    meet_done = mail_sums.file.with_name("brain-meet-done.json")    # 이 앱에서 체크한 할 일
    meet = {"items": [], "at": 0.0, "key": "", "error": "", "task": None}
    with contextlib.suppress(OSError, ValueError):
        last = json.loads(meet_file.read_text(encoding="utf-8"))
        meet.update(items=list(last["items"]), at=float(last["at"]), key=str(last["key"]))

    def fb_reload(name: str) -> None:
        """Firebase 에서 받은 파일 → 메모리 속 자료도 다시 읽는다(brain.json·회의 체크·메일 상세는 매번 파일을 읽음)"""
        with contextlib.suppress(OSError, ValueError, KeyError):
            if name == mail_store.file.name:
                mail_store.reload()
                mail["at"] = max(mail["at"], mail_store.at)   # 다른 컴퓨터가 방금 받았으면 다시 받지 않는다
            elif name == meet_file.name:
                last = json.loads(meet_file.read_text(encoding="utf-8"))
                meet.update(items=list(last["items"]), at=float(last["at"]), key=str(last["key"]))
            elif name == cal_file.name:
                last = json.loads(cal_file.read_text(encoding="utf-8"))
                cal.update(items=list(last["items"]), at=float(last["at"]))
    fb_sync.on_pull = fb_reload
    fb_sync.locks = {brain_store.file.name: brain_store.lock, mail_store.file.name: mail_store.lock}   # 받아 쓰는 동안 저장과 겹치지 않게

    def read_done() -> dict:
        try:
            d = json.loads(meet_done.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    async def meet_job(sources: list[dict], key: str) -> None:
        try:
            items = await meetings.fetch(sources)
            meet.update(items=items, key=key, error="")
            with contextlib.suppress(OSError):
                meet_file.parent.mkdir(parents=True, exist_ok=True)
                meet_file.write_text(json.dumps({"items": items, "at": time.time(), "key": key}, ensure_ascii=False), encoding="utf-8")
        except connectors.ConnectorError as e:
            meet["error"] = str(e)
        except Exception as e:
            log.warning("회의록 가져오기 실패: %s", e)
            meet["error"] = "Claude 의 Notion 연결로 회의록을 가져오지 못했어요."
        meet["at"] = time.time()

    @api.get("/brain/firebase")
    def brain_firebase():
        return fb_sync.status()

    @api.post("/brain/firebase/sync")
    async def brain_firebase_sync():
        if not firebase.project():
            raise HTTPException(400, ".env 에 FIREBASE_PROJECT 를 넣어 주세요.")
        try:
            got = await asyncio.to_thread(fb_sync.sync)
        except firebase.FirebaseError as e:
            fb_sync.error = str(e)
            raise HTTPException(502, str(e))
        return fb_sync.status() | got

    @api.get("/brain/meetings")
    async def brain_meetings(refresh: bool = False):
        if not connectors.claude_exe():
            return {"enabled": False}
        chosen = brain_store.load()["meetings"]
        sources = chosen or meetings.DEFAULT
        key = meetings.sources_key(sources)
        busy = meet["task"] is not None and not meet["task"].done()
        if not busy and (refresh or key != meet["key"] or time.time() - meet["at"] > 1800):
            meet["task"] = asyncio.create_task(meet_job(sources, key))
            busy = True
        done = read_done()
        items = [m | {"actions": [a | {"done": a["done"] or bool(done.get(f"{m['id']}:{i}"))} for i, a in enumerate(m["actions"])]}
                 for m in (meet["items"] if meet["key"] == key else [])]
        return {"enabled": True, "items": items, "error": meet["error"], "loading": busy, "custom": bool(chosen), "sources": meetings.groups(sources, items),
                "at": datetime.fromtimestamp(meet["at"]).isoformat(timespec="minutes") if meet["at"] else ""}

    @api.post("/brain/meetings/check")
    def check_meeting(body: MeetCheckIn):
        if not re.fullmatch(r"[0-9a-f]{32}:\d{1,2}", body.key):
            raise HTTPException(400, "잘못된 할 일이에요.")
        d = read_done()
        if body.done:
            d[body.key] = True
        else:
            d.pop(body.key, None)
        meet_done.parent.mkdir(parents=True, exist_ok=True)
        meet_done.write_text(json.dumps(dict(list(d.items())[-500:])), encoding="utf-8")
        return {"ok": True}

    ai_lock = asyncio.Lock()

    @api.post("/brain/assistant")
    async def brain_assistant(body: AssistantIn):
        """WnC AI: 브레인 정보(일정·업무 메일·회의록·루틴·바로가기)를 맥락으로 답한다. 한 번에 하나씩."""
        if not connectors.claude_exe():
            raise HTTPException(503, "이 컴퓨터에 claude CLI 가 없어 AI 어시스턴트를 쓸 수 없어요.")
        if ai_lock.locked():
            raise HTTPException(409, "앞 질문에 답하는 중이에요. 잠시 뒤 다시 물어봐 주세요.")
        async with ai_lock:
            cfg = brain_store.load()
            today = await asyncio.to_thread(brain.calendar, brain_store, 0, 14, cal["items"])
            ctx = assistant.context(today["events"], mail_store.recent(), meet["items"], cfg["routines"], cfg["shortcuts"])
            try:
                text = await assistant.answer(body.message, [h.model_dump() for h in body.history], ctx)
            except connectors.ConnectorError as e:
                raise HTTPException(502, str(e))
            return {"answer": text[:20_000]}

    # ── 노션 업무 기록 ──
    @api.get("/notion")
    def get_notion():
        return recorder.public()

    # ── 휴대폰 앱 업데이트(scripts/release.py 가 dist/ 에 만든 최신 릴리즈) ──
    @api.get("/app/latest")
    def app_latest():
        try:
            return json.loads((dist_dir / "latest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise HTTPException(404, "릴리즈가 없습니다. 컴퓨터에서 scripts/release.py 를 실행하세요.")

    @api.get("/app/apk")
    def app_apk():
        f = dist_dir / "agent-office.apk"
        if not f.is_file():
            raise HTTPException(404, "릴리즈가 없습니다.")
        return FileResponse(f, media_type="application/vnd.android.package-archive", filename="agent-office.apk")

    # ── 외부 도구(MCP) ──
    def local_only(request: Request) -> None:
        client = request.client.host if request.client else None
        server = (request.scope.get("server") or (None,))[0]
        if not projects.is_local_client(client, server):
            raise HTTPException(403, "외부 도구 등록·삭제는 서버가 켜진 컴퓨터에서만 할 수 있습니다.")

    @api.get("/tools")
    def list_tools():
        return {"servers": tools_store.public(),
                "members": [m.name for m in team.members.values() if m.can_use_tools]}

    @api.put("/tools/{name}")
    def put_tool(name: str, body: ToolIn, request: Request):
        local_only(request)
        try:
            return {"server": tools_store.put(name, body.config, body.description)}
        except mcptools.ToolError as e:
            raise HTTPException(400, str(e))

    @api.delete("/tools/{name}")
    def delete_tool(name: str, request: Request):
        local_only(request)
        if not tools_store.remove(name):
            raise HTTPException(404, "등록되지 않은 외부 도구입니다.")
        return {"ok": True}

    @api.get("/runs")
    def list_runs():
        dirs = sorted((d for d in runs_dir.iterdir() if d.is_dir() and RUN_ID.fullmatch(d.name)),
                      key=_run_key, reverse=True) if runs_dir.is_dir() else []
        return [{"run_id": d.name, "goal": _read(d / "goal.txt") or "", "created": _created(d),
                 "project": _project_name(d),
                 "has_report": (d / "report.md").is_file(), "has_error": (d / "error.txt").is_file()}
                for d in dirs[:RUNS_LIMIT]]

    @api.get("/runs/{run_id}")
    def get_run(run_id: str):
        d = run_dir(run_id)
        try:
            plan = json.loads(_read(d / "plan.json") or "null")
        except ValueError:
            plan = None
        try:
            project = json.loads(_read(d / "project.json") or "null")
        except ValueError:
            project = None
        try:
            used = json.loads(_read(d / "usage.json") or "null")
        except ValueError:
            used = None
        return {"run_id": run_id, "goal": _read(d / "goal.txt") or "", "project": project, "plan": plan,
                "usage": used.get("total") if isinstance(used, dict) else None, "status": _state(d).get("status"),
                "tasks": [{"file": f.name, "content": _read(f)}
                          for f in sorted(d.glob("task-*.md"), key=_task_key)],
                "report": _read(d / "report.md"), "error": _read(d / "error.txt")}

    # ── 프로젝트(폴더 접근) ──
    @api.get("/fs/list")
    def fs_list(path: str = "", hidden: int = 0):
        try:
            return projects.list_dirs(path, bool(hidden))
        except projects.ProjectError as e:
            raise HTTPException(400, str(e))

    @api.post("/fs/pick")
    async def fs_pick(request: Request):
        """이 컴퓨터의 폴더 선택 창(Finder·탐색기)을 띄운다. 다른 기기(휴대폰)에서 부르면 native:false 로
        알려 주고, 웹 화면은 기존 폴더 고르기 창을 쓴다."""
        client = request.client.host if request.client else None
        server = (request.scope.get("server") or (None,))[0]
        if not projects.is_local_client(client, server) or not projects.pick_command():
            return {"native": False}
        try:
            path = await asyncio.to_thread(projects.native_pick)
        except projects.ProjectError as e:
            raise HTTPException(409, str(e))
        if not path:
            return {"native": True, "cancelled": True}
        try:
            path = str(projects.check_path(path))
        except projects.ProjectError as e:
            return {"native": True, "path": path, "error": str(e)}
        return {"native": True, "path": path}

    @api.get("/projects")
    def list_projects():
        return {"projects": store.load()}

    @api.post("/projects")
    def add_project(body: ProjectIn):
        if not body.confirm:
            raise HTTPException(400, "폴더 전체 접근에 동의해야 프로젝트를 추가할 수 있습니다.")
        try:
            return {"project": store.add(body.path, body.name)}
        except projects.ProjectError as e:
            raise HTTPException(400, str(e))

    @api.patch("/projects/{pid}")
    def rename_project(pid: str, body: ProjectPatch):
        try:
            item = store.rename(pid, body.name)
        except projects.ProjectError as e:
            raise HTTPException(400, str(e))
        if not item:
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        return {"project": item}

    @api.delete("/projects/{pid}")
    def remove_project(pid: str):
        if not store.remove(pid):
            raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
        return {"ok": True}

    # ── 바깥 풍경: 주소 검색 · 주변 지도(OpenStreetMap) · 사무실 위치 ──
    @api.get("/outside/geocode")
    async def outside_geocode(q: str = ""):
        q = q.strip()
        if not 1 <= len(q) <= 200:
            raise HTTPException(400, "주소를 1~200자로 입력하세요.")
        try:
            return {"results": await asyncio.to_thread(outside.geocode, q)}
        except outside.OutsideError as e:
            raise HTTPException(502, str(e))

    @api.get("/outside/map")
    async def outside_map(lat: float, lng: float, r: int = 350, w: float = 32, d: float = 22, turn: int = 0):
        if not (-85 <= lat <= 85 and -180 <= lng <= 180 and outside.R_MIN <= r <= outside.R_MAX
                and 4 <= w <= 200 and 4 <= d <= 200):
            raise HTTPException(400, "위치·범위 값이 올바르지 않습니다.")
        async with map_lock:  # 같은 지역을 동시에 두 번 받지 않게(처음 한 번만 인터넷에서 받고 이후는 캐시)
            try:
                osm = await asyncio.to_thread(outside.fetch_osm, lat, lng, r, out_dir)
            except outside.OutsideError as e:
                raise HTTPException(502, str(e))
        return await asyncio.to_thread(outside.build_scene, osm, lat, lng, r, (w, d), turn % 4)

    @api.get("/outside/place")
    def get_place():
        return {"place": outside.load_place(out_dir)}

    @api.put("/outside/place")
    def put_place(body: PlaceIn):
        return {"place": outside.save_place(out_dir, body.model_dump())}

    @api.delete("/outside/place")
    def delete_place():
        return {"place": outside.save_place(out_dir, None)}

    app.include_router(api)

    @app.websocket("/ws")
    async def ws_events(ws: WebSocket, key: str | None = None):
        await ws.accept()
        if not key_ok(key):
            await ws.close(code=4401)
            return
        q = hub.connect({"type": "hello", "team": team.info(), "mock": team.mock,
                         "snapshot": hub.snapshot})
        pump = asyncio.create_task(hub.pump(ws, q))
        try:
            while (msg := await ws.receive())["type"] != "websocket.disconnect":
                with contextlib.suppress(ValueError, TypeError):
                    data = json.loads(msg.get("text") or "")
                    if isinstance(data, dict) and data.get("type") == "ping":
                        hub.send(q, {"type": "pong"})
        except RuntimeError:  # 서버 쪽에서 먼저 닫은 경우
            pass
        finally:
            hub.disconnect(q)
            pump.cancel()

    if dev_hub:
        @app.middleware("http")
        async def no_store(request, call_next):
            resp = await call_next(request)
            resp.headers["Cache-Control"] = "no-store"
            return resp

        @app.get("/__dev/livereload.js", include_in_schema=False)
        def livereload_js():
            return Response(DEV_SCRIPT, media_type="application/javascript")

        @app.get("/", include_in_schema=False)
        @app.get("/index.html", include_in_schema=False)
        def dev_index():
            html = _read(web_dir / "index.html")
            if html is None:
                raise HTTPException(404, "web/index.html 이 없습니다.")
            tag = '<script src="/__dev/livereload.js"></script>'
            html = html.replace("</body>", f"{tag}\n</body>", 1) if "</body>" in html else html + tag
            return HTMLResponse(html)

        @app.websocket("/__dev/ws")
        async def ws_dev(ws: WebSocket):
            await ws.accept()
            q = dev_hub.connect()

            async def pump():
                with contextlib.suppress(Exception):
                    while True:
                        await ws.send_text(await q.get())

            sender = asyncio.create_task(pump())
            try:
                while (await ws.receive())["type"] != "websocket.disconnect":
                    pass
            except RuntimeError:
                pass
            finally:
                dev_hub.disconnect(q)
                sender.cancel()

    # API 라우트 뒤에 마운트해야 가려지지 않는다. check_dir=False: 서버 실행 뒤 web/ 이 생겨도 재시작 없이 제공
    app.mount("/", RevalidatedStaticFiles(directory=web_dir, html=True, check_dir=False), name="web")
    return app
