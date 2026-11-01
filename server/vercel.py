"""브레인 모드 바로가기: Vercel 프로젝트 목록을 읽어 바로가기로 가져온다(읽기만).

- 토큰: .env 의 VERCEL_TOKEN(vercel.com → Settings → Tokens) 이 먼저, 없으면 이 컴퓨터에서 `vercel login` 한 Vercel CLI 의 저장된 로그인.
  토큰은 화면·로그로 보내지 않는다. 프로젝트·팀 목록 조회(GET)만 한다.
- Vercel CLI 로그인은 만료되면(401) `vercel whoami` 를 한 번 실행해 저장된 갱신 토큰으로 새로 받은 뒤 다시 시도한다.
- 주소: 프로젝트의 프로덕션 도메인(targets.production.alias 첫 번째) → 없으면 <이름>.vercel.app
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.vercel.com"
TIMEOUT = 15
PALETTE = ("#5558e6", "#e0458b", "#0f8a6a", "#ff7a1a", "#2f6bff", "#8b5cf6", "#14b8a6", "#c2410c", "#4a5578", "#d97757")


class VercelError(RuntimeError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def _cli_auth_files() -> list[Path]:
    home = Path.home()
    if sys.platform == "darwin":
        base = [home / "Library/Application Support/com.vercel.cli"]
    elif os.name == "nt":
        base = [Path(os.getenv("APPDATA", home)) / "com.vercel.cli"]
    else:
        base = [Path(os.getenv("XDG_DATA_HOME", home / ".local/share")) / "com.vercel.cli"]
    return [b / "auth.json" for b in base] + [home / ".vercel/auth.json"]


def token() -> tuple[str, str] | None:
    """(토큰, 어디서: env | cli) — 없으면 None. .env 는 매번 다시 읽는다(서버를 다시 켤 필요 없음)"""
    from .gmail import ENV_FILE
    env_tok = os.getenv("VERCEL_TOKEN", "")
    try:
        from dotenv import dotenv_values
        if ENV_FILE.exists():
            env_tok = dotenv_values(ENV_FILE).get("VERCEL_TOKEN") or env_tok
    except Exception:
        pass
    if env_tok.strip():
        return env_tok.strip(), "env"
    for f in _cli_auth_files():
        try:
            tok = json.loads(f.read_text(encoding="utf-8")).get("token")
        except (OSError, ValueError):
            continue
        if tok:
            return str(tok), "cli"
    return None


def _get(path: str, tok: str) -> dict:
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}", "User-Agent": "AgentOffice-Brain/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read(5_000_000))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise VercelError("Vercel 로그인이 만료됐거나 권한이 없어요. 터미널에서 `npx vercel login` 하거나 .env 에 VERCEL_TOKEN 을 넣어 주세요.")
        raise VercelError(f"Vercel 에서 목록을 받지 못했어요 (HTTP {e.code}).")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise VercelError("Vercel 서버에 연결하지 못했어요.")


def _abbr(name: str) -> str:
    parts = [p for p in re.split(r"[-_\s.]+", name) if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    return name[:2].capitalize() or "V"


def refresh_cli_login() -> bool:
    """Vercel CLI 를 한 번 실행해 저장된 로그인을 갱신한다(설치돼 있지 않으면 npx). 성공하면 True"""
    from agentteam import cli
    exe = cli.which("vercel")
    cmd = [exe, "whoami"] if exe else ([shutil.which("npx"), "--yes", "vercel@latest", "whoami"] if shutil.which("npx") else None)
    if not cmd:
        return False
    try:
        return subprocess.run(cmd, capture_output=True, timeout=120, env=cli._env(), stdin=subprocess.DEVNULL).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def projects() -> list[dict]:
    """개인 + 속한 팀의 프로젝트를 바로가기 모양으로 [{name, url, abbr, color, team}]"""
    got = token()
    if not got:
        raise VercelError("Vercel 로그인 정보가 없어요. 터미널에서 `npx vercel login` 을 한 번 하거나 .env 에 VERCEL_TOKEN 을 넣어 주세요.")
    try:
        return _projects(got[0])
    except VercelError as e:
        if got[1] != "cli" or "만료" not in str(e) or not refresh_cli_login():
            raise
        got = token()
        return _projects(got[0])


def _projects(tok: str) -> list[dict]:
    scopes = [("", "")]
    try:
        scopes += [(t["id"], t.get("name") or t.get("slug") or "") for t in _get("/v2/teams?limit=50", tok).get("teams", [])]
    except VercelError:
        pass  # 팀 권한이 없는 토큰이면 개인 프로젝트만
    out, seen = [], set()
    for team_id, team in scopes:
        q = urllib.parse.urlencode({"limit": 100, **({"teamId": team_id} if team_id else {})})
        for p in _get(f"/v9/projects?{q}", tok).get("projects", []):
            name = str(p.get("name") or "")
            if not name:
                continue
            alias = ((p.get("targets") or {}).get("production") or {}).get("alias") or []
            host = next((a for a in alias if not a.endswith(".vercel.app")), None) or (alias[0] if alias else f"{name}.vercel.app")
            url = f"https://{host}"
            if url in seen:
                continue
            seen.add(url)
            out.append({"name": name[:40], "url": url, "abbr": _abbr(name), "color": PALETTE[sum(map(ord, name)) % len(PALETTE)], "team": team})
    return sorted(out, key=lambda x: (x["team"], x["name"].lower()))
