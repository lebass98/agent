"""외부 도구(MCP 서버) 목록: 팀원(claude-cli)이 메일·슬랙·깃허브 같은 바깥 서비스를 쓸 수 있게 연결한다.

- 목록은 mcp-servers.json(Git 제외)에 Claude Code 의 mcpServers 형식으로 둔다.
  stdio: {"command": "npx", "args": [...], "env": {...}}  /  원격: {"type": "http"|"sse", "url": "https://…", "headers": {...}}
  (Composio 같은 서비스가 주는 MCP 주소를 원격으로 넣으면 된다)
- 등록만으로는 쓰이지 않는다. 업무를 시작할 때 사용자가 '이번 업무에 허락'한 서버만 그 업무에 붙는다(POST /api/run tools).
- 목록 화면(public)에는 명령·주소의 요약만 보이고 env·headers(키가 들어 있을 수 있다)는 내보내지 않는다.
"""
import json
import os
import re
import threading
from pathlib import Path
from urllib.parse import urlsplit

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
SERVER_LIMIT = 20
ARG_LIMIT = 50
TEXT_LIMIT = 2000
DESC_LIMIT = 200


class ToolError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def _str_map(v, what: str) -> dict:
    if v is None:
        return {}
    if not isinstance(v, dict) or len(v) > ARG_LIMIT:
        raise ToolError(f"{what} 형식이 올바르지 않습니다({{\"이름\": \"값\"}}).")
    out = {}
    for k, x in v.items():
        if not isinstance(k, str) or not isinstance(x, (str, int, float)) or len(str(x)) > TEXT_LIMIT or not k.strip():
            raise ToolError(f"{what} 의 값은 글자여야 합니다.")
        out[k] = str(x)
    return out


def validate(cfg: dict) -> dict:
    """mcpServers 의 서버 하나. 알려진 키만 남긴다."""
    if not isinstance(cfg, dict):
        raise ToolError("설정은 JSON 객체여야 합니다.")
    if cfg.get("url"):
        url = str(cfg["url"]).strip()
        p = urlsplit(url)
        if p.scheme not in ("http", "https") or not p.netloc or len(url) > TEXT_LIMIT:
            raise ToolError("원격 MCP 주소는 http:// 또는 https:// 로 시작해야 합니다.")
        kind = str(cfg.get("type") or "http").lower()
        if kind not in ("http", "sse"):
            raise ToolError("원격 MCP 의 type 은 http 또는 sse 입니다.")
        out = {"type": kind, "url": url}
        if cfg.get("headers"):
            out["headers"] = _str_map(cfg["headers"], "headers")
        return out
    command = str(cfg.get("command") or "").strip()
    if not command or len(command) > TEXT_LIMIT:
        raise ToolError("command(실행할 명령) 또는 url(원격 주소) 중 하나가 필요합니다.")
    args = cfg.get("args") or []
    if not isinstance(args, list) or len(args) > ARG_LIMIT or not all(isinstance(a, (str, int, float)) for a in args):
        raise ToolError("args 는 글자 목록이어야 합니다.")
    out = {"command": command, "args": [str(a) for a in args]}
    if cfg.get("env"):
        out["env"] = _str_map(cfg["env"], "env")
    return out


def summary(cfg: dict) -> dict:
    if cfg.get("url"):
        return {"kind": cfg.get("type", "http"), "target": urlsplit(cfg["url"]).netloc}
    return {"kind": "stdio", "target": " ".join([os.path.basename(cfg.get("command", ""))] + cfg.get("args", [])[:3])[:120]}


class Store:
    def __init__(self, file: Path):
        self.file = Path(file)
        self._lock = threading.Lock()

    def _load_all(self) -> dict:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"mcpServers": {}, "descriptions": {}}
        if not isinstance(data, dict):
            return {"mcpServers": {}, "descriptions": {}}
        servers = data.get("mcpServers") if isinstance(data.get("mcpServers"), dict) else {}
        desc = data.get("descriptions") if isinstance(data.get("descriptions"), dict) else {}
        return {"mcpServers": servers, "descriptions": desc}

    def load(self) -> dict:
        """{이름: 설정} — 형식이 맞는 서버만."""
        out = {}
        for name, cfg in self._load_all()["mcpServers"].items():
            try:
                if NAME_RE.fullmatch(name):
                    out[name] = validate(cfg)
            except ToolError:
                continue
        return out

    def public(self) -> list[dict]:
        desc = self._load_all()["descriptions"]
        return [{"name": n, "description": str(desc.get(n, ""))[:DESC_LIMIT], **summary(c)} for n, c in sorted(self.load().items())]

    def _save(self, data: dict) -> None:
        tmp = self.file.with_name(self.file.name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.file)

    def put(self, name: str, cfg: dict, description: str = "") -> dict:
        name = (name or "").strip().lower()
        if not NAME_RE.fullmatch(name):
            raise ToolError("이름은 영문 소문자·숫자·-·_ 로 32자 이내여야 합니다.")
        clean = validate(cfg)
        with self._lock:
            data = self._load_all()
            if name not in data["mcpServers"] and len(data["mcpServers"]) >= SERVER_LIMIT:
                raise ToolError(f"외부 도구는 {SERVER_LIMIT}개까지 등록할 수 있습니다.")
            data["mcpServers"][name] = clean
            data["descriptions"][name] = " ".join(str(description or "").split())[:DESC_LIMIT]
            self._save(data)
        return {"name": name, "description": data["descriptions"][name], **summary(clean)}

    def remove(self, name: str) -> bool:
        with self._lock:
            data = self._load_all()
            if name not in data["mcpServers"]:
                return False
            data["mcpServers"].pop(name)
            data["descriptions"].pop(name, None)
            self._save(data)
        return True

    def select(self, names: list[str] | None) -> dict:
        """사용자가 이번 업무에 허락한 서버 설정만. 없는 이름이면 ToolError."""
        if not names:
            return {}
        have = self.load()
        missing = [n for n in names if n not in have]
        if missing:
            raise ToolError(f"등록되지 않은 외부 도구: {', '.join(missing)}")
        return {n: have[n] for n in dict.fromkeys(names)}
