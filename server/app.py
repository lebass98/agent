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
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, WebSocket
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import outside, projects

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


_CHANGES = {
    "plan": _plan,
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
def create_app(team, access_key: str | None, runs_dir: Path, web_dir: Path, dev: bool = False,
               cache_dir: Path | None = None, projects_file: Path | None = None) -> FastAPI:
    """dev=True: web/ 변경 시 브라우저 자동 새로고침 + 정적 파일 캐시 금지(새로고침하면 항상 최신 파일).
    cache_dir: 바깥 풍경 지도 원본·사무실 위치를 두는 곳(기본: runs 옆 cache/outside, Git 제외).
    projects_file: 등록한 프로젝트(폴더 접근) 목록(기본: runs 옆 projects.json, Git 제외)."""
    runs_dir, web_dir = Path(runs_dir), Path(web_dir)
    store = projects.Store(Path(projects_file) if projects_file else runs_dir.parent / "projects.json")
    out_dir = Path(cache_dir) if cache_dir else runs_dir.parent / "cache" / "outside"
    map_lock = asyncio.Lock()
    hub = Hub()
    dev_hub = DevReload() if dev else None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        watcher = asyncio.create_task(dev_hub.watch(web_dir)) if dev_hub else None
        yield
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
        if app.state.chatting or (app.state.task and not app.state.task.done()):
            raise HTTPException(409, "이미 진행 중인 업무가 있습니다.")
        run_id = _new_run_id(runs_dir)
        task = asyncio.create_task(team.run(goal, runs_dir, emit=hub.publish, run_id=run_id, project=project))
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
        return {"run_id": run_id, "goal": _read(d / "goal.txt") or "", "project": project, "plan": plan,
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
    app.mount("/", StaticFiles(directory=web_dir, html=True, check_dir=False), name="web")
    return app
