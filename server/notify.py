"""결과 알림(웹훅): 업무가 끝나면 설정한 주소로 결과(JSON)를 보낸다. n8n·Make·Zapier·슬랙 워크플로 등에서 받는다.

- 설정은 cache/notify.json(Git 제외)에 둔다: {url, secret, enabled}. secret 은 화면에 다시 보여 주지 않는다.
- secret 이 있으면 본문의 HMAC-SHA256 을 X-Agent-Signature: sha256=<hex> 헤더로 붙인다(받는 쪽에서 위조 확인).
- 보내기 실패는 업무 결과에 영향을 주지 않는다(서버 로그·마지막 전송 결과만 남긴다).
"""
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

URL_LIMIT = 2000
SECRET_LIMIT = 200
REPORT_LIMIT = 20_000
TIMEOUT = 10


class NotifyError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


class Notify:
    def __init__(self, file: Path):
        self.file = Path(file)
        self.last: dict | None = None  # 마지막 전송 결과 {at, ok, status, error, run_id}

    def load(self) -> dict:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        return {"url": str(data.get("url", "")), "secret": str(data.get("secret", "")), "enabled": bool(data.get("enabled"))}

    def public(self) -> dict:
        c = self.load()
        return {"url": c["url"], "enabled": c["enabled"] and bool(c["url"]), "has_secret": bool(c["secret"]), "last": self.last}

    def save(self, url: str, enabled: bool, secret: str | None = None) -> dict:
        """secret: None 이면 그대로, "" 이면 지운다."""
        url = (url or "").strip()
        if url:
            check_url(url)
        elif enabled:
            raise NotifyError("알림을 켜려면 받을 주소(URL)를 입력하세요.")
        c = self.load()
        if secret is not None:
            secret = secret.strip()
            if len(secret) > SECRET_LIMIT:
                raise NotifyError(f"비밀 키는 {SECRET_LIMIT}자 이내로 입력하세요.")
            c["secret"] = secret
        c.update(url=url, enabled=bool(enabled and url))
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_name(self.file.name + ".tmp")
        tmp.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.file)
        return self.public()

    def send(self, payload: dict, force: bool = False) -> dict:
        """동기 전송(스레드에서 부른다). 결과 {ok, status, error}."""
        c = self.load()
        if not c["url"] or not (c["enabled"] or force):
            return {"ok": False, "status": None, "error": "알림이 꺼져 있거나 주소가 없습니다."}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8", "User-Agent": "WordNCode-Agent-Office/1"}
        if c["secret"]:
            headers["X-Agent-Signature"] = "sha256=" + hmac.new(c["secret"].encode(), body, hashlib.sha256).hexdigest()
        req = urllib.request.Request(c["url"], data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                res = {"ok": 200 <= r.status < 300, "status": r.status, "error": None}
        except urllib.error.HTTPError as e:
            res = {"ok": False, "status": e.code, "error": f"HTTP {e.code}"}
        except (urllib.error.URLError, OSError, ValueError) as e:
            res = {"ok": False, "status": None, "error": str(getattr(e, "reason", e))[:200]}
        self.last = {"at": datetime.now().isoformat(timespec="seconds"), "run_id": payload.get("run_id"), **res}
        return res


def check_url(url: str) -> None:
    if len(url) > URL_LIMIT:
        raise NotifyError(f"주소는 {URL_LIMIT}자 이내로 입력하세요.")
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise NotifyError("주소는 http:// 또는 https:// 로 시작해야 합니다.")


def _read(p: Path) -> str | None:
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return None


def run_payload(run_dir: Path, run_id: str, ok: bool, usage: dict | None = None) -> dict:
    """업무 1건의 결과 알림 본문."""
    report = _read(run_dir / "report.md")
    try:
        project = json.loads(_read(run_dir / "project.json") or "null")
    except ValueError:
        project = None
    return {"event": "run_end", "run_id": run_id, "ok": ok, "goal": _read(run_dir / "goal.txt") or "",
            "project": {"name": project.get("name"), "path": project.get("path")} if isinstance(project, dict) else None,
            "report": report[:REPORT_LIMIT] if report else None, "error": _read(run_dir / "error.txt"),
            "usage": usage, "finished_at": datetime.now().isoformat(timespec="seconds"), "source": "WordNCode Agent Office"}


def sample_payload() -> dict:
    return {"event": "test", "run_id": "test", "ok": True, "goal": "알림 연결 시험", "project": None,
            "report": "# 시험 알림\nWordNCode Agent Office 에서 보낸 시험 메시지입니다.", "error": None,
            "usage": None, "finished_at": datetime.now().isoformat(timespec="seconds"), "source": "WordNCode Agent Office"}
