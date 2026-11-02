"""브레인 자료 Firebase(Firestore) 백업·복원.

- 켜기: .env 의 `FIREBASE_PROJECT`(프로젝트 ID). 매번 다시 읽으므로 서버를 다시 켤 필요 없다.
- 로그인: 이 컴퓨터에서 `firebase login` 한 Firebase CLI 의 저장된 로그인(갱신 토큰)으로 접근 토큰을 받는다.
  토큰은 화면·로그로 보내지 않는다. (서비스 계정 키 파일을 쓰려면 다음 단계에서)
- 자료: `cache/brain*.json` 파일마다 Firestore 문서 하나(`agent-brain/<파일 이름>`)에 gzip 으로 올린다.
- 양방향(집·회사 컴퓨터): 1분마다 마지막 동기화(`cache/.firebase-sync.json`) 이후 이쪽에서 바뀐 파일은 올리고, 저쪽에서 바뀐 파일은 받는다.
  양쪽 다 바뀌었을 때: 쌓이는 파일(메일 목록·메일 요약·회의 할 일 체크)은 둘을 합치고, 나머지는 더 최근에 고친 쪽이 이긴다.
  덮어써지는 쪽(이 컴퓨터 파일이든 Firestore 쪽이든)은 `cache/firebase-conflicts/` 에 남긴다(최근 KEEP_CONFLICTS 개).
  컴퓨터마다 `agent-brain-hosts/<이름>` 에 1분마다 신호를 남겨, 다른 컴퓨터 서버가 같이 켜져 있으면 상태에 알린다.
- 스킬 실행 기록(brain-skill-runs.json)은 결과 파일이 그 컴퓨터에만 있어 동기화하지 않는다.
- 비밀: 캘린더 iCal 비공개 주소(`brain.json` 의 calendars[].url)는 올리지 않는다. notify.json·.env 도 올리지 않는다.
- Firestore 규칙은 닫혀 있어(브라우저 접근 불가) 이 서버의 로그인으로만 읽고 쓴다.
"""
import base64
import socket
import gzip
import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

COLLECTION = "agent-brain"
PATTERN = "brain*.json"
SKIP = {"brain-skill-runs.json"}
HOSTS = "agent-brain-hosts"
ALIVE = 180  # 이 시간 안에 신호가 있으면 켜져 있는 서버
KEEP_CONFLICTS = 30


def _merge_mail(a: dict, b: dict) -> dict:
    """메일 목록: 두 쪽 메일을 id 로 합친다(이쪽 요약이 먼저)"""
    items, seen = [], set()
    for m in (a.get("items") or []) + (b.get("items") or []):
        if isinstance(m, dict) and m.get("id") not in seen:
            seen.add(m.get("id"))
            items.append(m)
    items.sort(key=lambda m: m.get("date", ""), reverse=True)
    return {"items": items[:300], "at": max(float(a.get("at") or 0), float(b.get("at") or 0)),
            "span": max(int(a.get("span") or 0), int(b.get("span") or 0))}


def _merge_dict(a: dict, b: dict) -> dict:
    """메일 요약·할 일 체크처럼 키마다 쌓이는 파일: 둘을 합친다(이쪽이 먼저)"""
    return (b if isinstance(b, dict) else {}) | (a if isinstance(a, dict) else {})


MERGE = {"brain-mail-store.json": _merge_mail, "brain-mail-detail.json": _merge_dict, "brain-meet-done.json": _merge_dict}
TIMEOUT = 20
CLI_CONFIG = Path.home() / ".config/configstore/firebase-tools.json"


class FirebaseError(RuntimeError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def project() -> str:
    from .gmail import ENV_FILE
    p = os.getenv("FIREBASE_PROJECT", "")
    try:
        from dotenv import dotenv_values
        if ENV_FILE.exists():
            p = dotenv_values(ENV_FILE).get("FIREBASE_PROJECT") or p
    except Exception:
        pass
    p = p.strip()
    return p if re.fullmatch(r"[a-z][a-z0-9-]{4,40}", p) else ""


def _cli_client() -> tuple[str, str]:
    """Firebase CLI 의 OAuth 클라이언트(설치된 firebase-tools 에서 읽는다)"""
    bases = [Path.home() / ".npm-global/lib/node_modules", Path("/usr/local/lib/node_modules"), Path("/opt/homebrew/lib/node_modules")]
    exe = shutil.which("firebase") or next((str(p) for p in Path.home().glob(".local/share/node/*/bin/firebase")), None)
    if exe:  # nvm·직접 받은 node 처럼 다른 곳에 깔린 경우: 실행 파일의 실제 위치에서 node_modules 를 찾는다
        real = Path(os.path.realpath(exe))
        bases += [p for p in real.parents if p.name == "node_modules"][:1]
    for base in bases:
        f = base / "firebase-tools/lib/api.js"
        try:
            src = f.read_text(encoding="utf-8")
        except OSError:
            continue
        cid = re.search(r'"FIREBASE_CLIENT_ID",\s*"([^"]+)"', src)
        sec = re.search(r'"FIREBASE_CLIENT_SECRET",\s*"([^"]+)"', src)
        if cid and sec:
            return cid.group(1), sec.group(1)
    raise FirebaseError("Firebase CLI 를 찾지 못했어요. `npm i -g firebase-tools` 후 `firebase login` 하세요.")


class Auth:
    def __init__(self, config: Path = CLI_CONFIG):
        self.config, self.token, self.until = config, "", 0.0

    def get(self) -> str:
        if self.token and time.time() < self.until - 60:
            return self.token
        try:
            refresh = json.loads(self.config.read_text(encoding="utf-8"))["tokens"]["refresh_token"]
        except (OSError, ValueError, KeyError, TypeError):
            raise FirebaseError("Firebase CLI 로그인이 없어요. 이 컴퓨터에서 `firebase login` 하세요.")
        cid, sec = _cli_client()
        body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh, "client_id": cid, "client_secret": sec}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body), timeout=TIMEOUT) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise FirebaseError(f"Firebase 로그인을 갱신하지 못했어요({e.code}). `firebase login --reauth` 하세요.")
        self.token, self.until = d["access_token"], time.time() + int(d.get("expires_in", 3600))
        return self.token


def _strip(name: str, raw: bytes) -> bytes:
    """올리면 안 되는 값 빼기: 캘린더 비공개 주소"""
    if name != "brain.json":
        return raw
    try:
        d = json.loads(raw)
    except ValueError:
        return raw
    for c in d.get("calendars") or []:
        if isinstance(c, dict):
            c.pop("url", None)
    return json.dumps(d, ensure_ascii=False, indent=2).encode()


def host_name() -> str:
    return re.sub(r"[^A-Za-z0-9-]", "-", socket.gethostname().split(".")[0])[:40] or "server"


def _keep_calendar_urls(raw: bytes, local: Path) -> bytes:
    """받은 brain.json 에 이 컴퓨터의 캘린더 비공개 주소를 다시 붙인다(Firestore 에는 없다)"""
    try:
        d, mine = json.loads(raw), json.loads(local.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return raw
    urls = {c.get("id"): c.get("url") for c in mine.get("calendars") or [] if isinstance(c, dict) and c.get("url")}
    if not urls:
        return raw
    for c in d.get("calendars") or []:
        if isinstance(c, dict) and urls.get(c.get("id")):
            c["url"] = urls[c["id"]]
    return json.dumps(d, ensure_ascii=False, indent=2).encode()


class Sync:
    def __init__(self, cache_dir: Path, auth: Auth | None = None, host: str | None = None, on_pull=None):
        self.dir, self.auth, self.host = cache_dir, auth or Auth(), host or host_name()
        self.on_pull = on_pull                      # 받은 파일 이름으로 불러 메모리 속 자료를 다시 읽게
        self.locks: dict = {}                       # 파일 이름 → 그 파일을 쓰는 저장소의 잠금(받아 쓰는 동안 같이 잡는다)
        self.state_file = cache_dir / ".firebase-sync.json"
        try:
            self.base: dict = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.base = {}
        self.last, self.error, self.others = "", "", []
        self.pulled: list[str] = []
        self.pushed: list[str] = []

    def _url(self, proj: str, name: str = "", coll: str = COLLECTION) -> str:
        base = f"https://firestore.googleapis.com/v1/projects/{proj}/databases/(default)/documents/{coll}"
        return f"{base}/{urllib.parse.quote(name)}" if name else base

    def _call(self, url: str, method: str = "GET", body: dict | None = None) -> dict:
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {self.auth.get()}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            raise FirebaseError(f"Firestore 요청이 거부됐어요({e.code}).")
        except OSError:
            raise FirebaseError("Firestore 에 연결하지 못했어요(인터넷 확인).")

    def files(self) -> list[Path]:
        return sorted(p for p in self.dir.glob(PATTERN) if not p.name.startswith("._") and p.name not in SKIP)

    def _remote(self, proj: str) -> dict[str, dict]:
        out = {}
        for doc in self._call(self._url(proj) + "?pageSize=100").get("documents", []):
            name, f = doc["name"].rsplit("/", 1)[-1], doc.get("fields", {})
            if not re.fullmatch(r"brain[\w.-]*\.json", name) or name in SKIP or "data" not in f:
                continue
            out[name] = {"data": f["data"].get("bytesValue", ""), "mtime": float(f.get("mtime", {}).get("doubleValue", 0)),
                         "at": f.get("at", {}).get("stringValue", "") or str(f.get("mtime", {}).get("doubleValue", ""))}
        return out

    def _save_state(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(self.base), encoding="utf-8")

    def _push(self, proj: str, f: Path) -> None:
        mt = f.stat().st_mtime
        at = f"{self.host}:{time.time():.3f}"
        data = base64.b64encode(gzip.compress(_strip(f.name, f.read_bytes()))).decode()
        self._call(self._url(proj, f.name), "PATCH", {"fields": {"data": {"bytesValue": data}, "mtime": {"doubleValue": mt},
                                                                   "at": {"stringValue": at}, "host": {"stringValue": self.host}}})
        self.base[f.name] = {"local": mt, "remote": at}
        self.pushed.append(f.name)

    def _keep(self, name: str, raw: bytes, side: str) -> None:
        """덮어써지기 전 내용을 cache/firebase-conflicts/ 에 남긴다(오래된 것부터 정리)"""
        keep = self.dir / "firebase-conflicts"
        keep.mkdir(parents=True, exist_ok=True)
        (keep / f"{Path(name).stem}.{side}.{time.strftime('%Y%m%d-%H%M%S')}.json").write_bytes(raw)
        for old in sorted(keep.glob("*.json"), key=lambda p: p.stat().st_mtime)[:-KEEP_CONFLICTS]:
            old.unlink(missing_ok=True)

    @staticmethod
    def _raw(r: dict) -> bytes | None:
        try:
            raw = gzip.decompress(base64.b64decode(r["data"]))
            json.loads(raw)
            return raw
        except (ValueError, OSError, KeyError):
            return None

    def _write_local(self, f: Path, raw: bytes) -> None:
        lock = self.locks.get(f.name)
        if lock:
            lock.acquire()
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".fbtmp")
            tmp.write_bytes(raw)
            os.replace(tmp, f)
        finally:
            if lock:
                lock.release()

    def _merge(self, proj: str, f: Path, r: dict) -> bool:
        """쌓이는 파일: 이쪽과 Firestore 쪽을 합쳐 양쪽에 쓴다"""
        raw = self._raw(r)
        try:
            mine = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        if raw is None:
            return False
        merged = json.dumps(MERGE[f.name](mine, json.loads(raw)), ensure_ascii=False).encode()
        self._write_local(f, merged)
        self.pulled.append(f.name)
        if self.on_pull:
            self.on_pull(f.name)
        self._push(proj, f)
        return True

    def _pull(self, name: str, r: dict, backup: bool = False) -> bool:
        raw = self._raw(r)
        if raw is None:
            return False
        f = self.dir / name
        if backup and f.exists():
            self._keep(name, f.read_bytes(), "local")
        if name == "brain.json" and f.exists():
            raw = _keep_calendar_urls(raw, f)
        self._write_local(f, raw)
        self.base[name] = {"local": f.stat().st_mtime, "remote": r["at"]}
        self.pulled.append(name)
        if self.on_pull:
            self.on_pull(name)
        return True

    def sync(self) -> dict:
        """양방향 한 번(동기, 스레드에서). {pulled, pushed}"""
        proj = project()
        self.pulled, self.pushed = [], []
        if not proj:
            return {"pulled": [], "pushed": []}
        try:   # 같은 컴퓨터의 다른 서버(예: 8000·8001)와 기록을 함께 쓴다 — 서로 주고받기를 되풀이하지 않게
            self.base = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        remote = self._remote(proj)
        local = {f.name: f for f in self.files()}
        for name in sorted(set(remote) | set(local)):
            f, r, b = local.get(name), remote.get(name), self.base.get(name)
            lm = f.stat().st_mtime if f else None
            if f and not r:
                self._push(proj, f)
            elif r and not f:
                self._pull(name, r)
            elif b is None or (lm != b.get("local") and r["at"] != b.get("remote")):
                # 처음 맞춰 보거나 양쪽 다 바뀜: 쌓이는 파일은 합치고, 나머지는 최근 것이 이기며 진 쪽은 남긴다
                if b is None and abs(r["mtime"] - lm) <= 1:
                    self.base[name] = {"local": lm, "remote": r["at"]}
                elif name in MERGE:
                    self._merge(proj, f, r)
                elif r["mtime"] > lm:
                    self._pull(name, r, backup=True)
                else:
                    if (raw := self._raw(r)) is not None:
                        self._keep(name, raw, "remote")
                    self._push(proj, f)
            else:
                mine, theirs = lm != b.get("local"), r["at"] != b.get("remote")
                if theirs:
                    self._pull(name, r)
                elif mine:
                    self._push(proj, f)
        self._beat(proj)
        self._save_state()
        self.last, self.error = time.strftime("%Y-%m-%dT%H:%M"), ""
        return {"pulled": self.pulled, "pushed": self.pushed}

    def _beat(self, proj: str) -> None:
        """이 서버가 켜져 있다는 신호 + 다른 컴퓨터 서버 확인"""
        now = time.time()
        self._call(self._url(proj, self.host, HOSTS), "PATCH", {"fields": {"at": {"doubleValue": now}}})
        others = []
        for doc in self._call(self._url(proj, coll=HOSTS) + "?pageSize=50").get("documents", []):
            name = doc["name"].rsplit("/", 1)[-1]
            at = float(doc.get("fields", {}).get("at", {}).get("doubleValue", 0))
            if name != self.host and now - at < ALIVE:
                others.append(name)
        self.others = others

    def status(self) -> dict:
        proj = project()
        return {"enabled": bool(proj), "project": proj, "host": self.host, "last": self.last, "error": self.error,
                "others": self.others, "files": [f.name for f in self.files()] if proj else []}
