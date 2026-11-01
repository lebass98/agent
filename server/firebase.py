"""브레인 자료 Firebase(Firestore) 백업·복원.

- 켜기: .env 의 `FIREBASE_PROJECT`(프로젝트 ID). 매번 다시 읽으므로 서버를 다시 켤 필요 없다.
- 로그인: 이 컴퓨터에서 `firebase login` 한 Firebase CLI 의 저장된 로그인(갱신 토큰)으로 접근 토큰을 받는다.
  토큰은 화면·로그로 보내지 않는다. (서비스 계정 키 파일을 쓰려면 다음 단계에서)
- 자료: `cache/brain*.json` 파일마다 Firestore 문서 하나(`agent-brain/<파일 이름>`)에 gzip 으로 올린다.
  1분마다 바뀐 파일만 올리고, 서버를 켤 때 이 컴퓨터에 없는 파일은 Firestore 에서 받아 되살린다.
- 비밀: 캘린더 iCal 비공개 주소(`brain.json` 의 calendars[].url)는 올리지 않는다. notify.json·.env 도 올리지 않는다.
- Firestore 규칙은 닫혀 있어(브라우저 접근 불가) 이 서버의 로그인으로만 읽고 쓴다.
"""
import base64
import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

COLLECTION = "agent-brain"
PATTERN = "brain*.json"
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
    for base in (Path.home() / ".npm-global/lib/node_modules", Path("/usr/local/lib/node_modules"), Path("/opt/homebrew/lib/node_modules")):
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


class Sync:
    def __init__(self, cache_dir: Path, auth: Auth | None = None):
        self.dir, self.auth = cache_dir, auth or Auth()
        self.sent: dict[str, float] = {}
        self.last, self.error, self.restored = "", "", []

    def _url(self, proj: str, name: str = "") -> str:
        base = f"https://firestore.googleapis.com/v1/projects/{proj}/databases/(default)/documents/{COLLECTION}"
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
        return sorted(p for p in self.dir.glob(PATTERN) if not p.name.startswith("._"))

    def push(self, force: bool = False) -> int:
        """바뀐 파일만 올린다(동기, 스레드에서). 올린 개수"""
        proj = project()
        if not proj:
            return 0
        n = 0
        for f in self.files():
            try:
                mt = f.stat().st_mtime
                if not force and self.sent.get(f.name) == mt:
                    continue
                data = base64.b64encode(gzip.compress(_strip(f.name, f.read_bytes()))).decode()
            except OSError:
                continue
            self._call(self._url(proj, f.name), "PATCH", {"fields": {"data": {"bytesValue": data}, "mtime": {"doubleValue": mt}}})
            self.sent[f.name] = mt
            n += 1
        self.last, self.error = time.strftime("%Y-%m-%dT%H:%M"), ""
        return n

    def restore(self) -> list[str]:
        """이 컴퓨터에 없는 브레인 파일을 Firestore 에서 되살린다"""
        proj = project()
        if not proj:
            return []
        got = []
        for doc in self._call(self._url(proj) + "?pageSize=100").get("documents", []):
            name = doc["name"].rsplit("/", 1)[-1]
            if not re.fullmatch(r"brain[\w.-]*\.json", name) or (self.dir / name).exists():
                continue
            try:
                raw = gzip.decompress(base64.b64decode(doc["fields"]["data"]["bytesValue"]))
                json.loads(raw)
            except (KeyError, ValueError, OSError):
                continue
            self.dir.mkdir(parents=True, exist_ok=True)
            (self.dir / name).write_bytes(raw)
            self.sent[name] = (self.dir / name).stat().st_mtime
            got.append(name)
        self.restored = got
        return got

    def status(self) -> dict:
        proj = project()
        return {"enabled": bool(proj), "project": proj, "last": self.last, "error": self.error, "restored": self.restored,
                "files": [f.name for f in self.files()] if proj else []}
