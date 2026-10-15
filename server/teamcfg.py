"""에이전트 설정: 웹 화면에서 team.toml 의 팀장·배정 원칙·팀원(AI 선택·모델·하는 일)을 읽고 고친다.

- read_config: team.toml 을 화면용 dict 로 읽는다(모의 실행이어도 파일에 적힌 실제 provider 를 돌려준다).
- validate: 화면에서 보낸 값을 검사·정리한다. 틀리면 ConfigError(사용자에게 보여 줄 한국어 사유).
- write_config: 파일 맨 위 설명 주석은 그대로 두고 나머지를 다시 쓴다. 바로 전 파일은 team.toml.bak 으로 남긴다.
- provider_options: 'AI 선택' 목록(설치·키 준비 여부, 추천 모델).
"""
import json
import os
import re
import tomllib
from pathlib import Path

from agentteam import providers
from agentteam.providers import Member

NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,19}$")
MODEL_RE = re.compile(r"^[A-Za-z0-9._:/@+-]{1,80}$")
MEMBER_LIMIT = 12
ROLE_LIMIT = 300
GUIDE_LIMIT = 2000
CLAUDE_ALIASES = ("opus", "sonnet", "haiku")

# 화면의 'AI 선택' 목록 순서·설명. models 는 추천값(직접 입력도 가능)
PROVIDER_INFO = [
    {"id": "claude-cli", "brand": "Claude", "label": "Claude Code 구독 로그인 (Max·Pro)", "kind": "cli", "models": list(CLAUDE_ALIASES)},
    {"id": "codex-cli", "brand": "GPT", "label": "Codex 구독 로그인 (ChatGPT)", "kind": "cli", "models": ["default"]},
    {"id": "antigravity-cli", "brand": "Gemini", "label": "Antigravity 구독 로그인 (Google AI Pro·Ultra)", "kind": "cli",
     "models": ["gemini-3.8-flash-medium", "gemini-3.8-flash-high", "gemini-3.8-flash-low"]},
    {"id": "gemini-cli", "brand": "Gemini", "label": "Gemini CLI (API 키 로그인)", "kind": "cli", "models": ["default"]},
    {"id": "anthropic", "brand": "Claude", "label": "Anthropic API 키 (.env)", "kind": "api", "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]},
    {"id": "openai", "brand": "GPT", "label": "OpenAI API 키 (.env)", "kind": "api", "models": []},
    {"id": "google", "brand": "Gemini", "label": "Google AI Studio API 키 (.env)", "kind": "api", "models": ["gemini-3.6-flash", "gemini-flash-latest"]},
    {"id": "mock", "brand": "모의", "label": "모의 실행 (AI 호출 없음, 테스트용)", "kind": "mock", "models": ["mock"]},
]


class ConfigError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def provider_options() -> list[dict]:
    out = []
    for p in PROVIDER_INFO:
        if p["id"] not in providers._PROVIDERS:
            continue
        ready = providers.has_key(Member(name="x", provider=p["id"], model="x", role=""))
        hint = "" if ready else ("CLI 가 설치되어 있지 않아요" if p["kind"] == "cli" else "API 키가 .env 에 없어요" if p["kind"] == "api" else "")
        out.append({**p, "ready": ready, "hint": hint})
    return out


def read_config(path: Path) -> dict:
    cfg = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    members = [{"name": n, "provider": str(m.get("provider", "")), "model": str(m.get("model", "")), "role": str(m.get("role", ""))}
               for n, m in cfg.get("members", {}).items()]
    lead = cfg.get("leader", {})
    try:
        rework = int(lead.get("rework", 1))
    except (TypeError, ValueError):
        rework = 1
    return {"leader": str(lead.get("member", "")), "guide": str(lead.get("guide", "")).strip(), "rework": rework, "members": members}


def validate(data: dict) -> dict:
    if not isinstance(data, dict):
        raise ConfigError("설정 형식이 올바르지 않습니다.")
    raw = data.get("members")
    if not isinstance(raw, list) or not raw:
        raise ConfigError("팀원이 한 명 이상 있어야 합니다.")
    if len(raw) > MEMBER_LIMIT:
        raise ConfigError(f"팀원은 최대 {MEMBER_LIMIT}명까지 둘 수 있습니다.")
    members, seen = [], set()
    for i, m in enumerate(raw, 1):
        if not isinstance(m, dict):
            raise ConfigError("팀원 정보 형식이 올바르지 않습니다.")
        name = str(m.get("name", "")).strip().lower()
        label = name or f"{i}번째 팀원"
        if not NAME_RE.fullmatch(name):
            raise ConfigError(f"{label}: 이름은 영문 소문자로 시작하고 영문 소문자·숫자·-·_ 만 20자 이내로 쓸 수 있습니다.")
        if name in seen:
            raise ConfigError(f"이름 '{name}' 이(가) 겹칩니다. 팀원 이름은 서로 달라야 합니다.")
        seen.add(name)
        provider = str(m.get("provider", "")).strip()
        if provider not in providers._PROVIDERS:
            raise ConfigError(f"{name}: AI 를 골라 주세요.")
        model = str(m.get("model", "")).strip()
        if not MODEL_RE.fullmatch(model):
            raise ConfigError(f"{name}: 모델 이름을 확인해 주세요(영문·숫자·.-_:/ 만, 80자 이내).")
        if provider == "claude-cli" and model not in CLAUDE_ALIASES:
            raise ConfigError(f"{name}: Claude Code 구독 로그인은 모델에 opus·sonnet·haiku 중 하나만 쓸 수 있습니다.")
        role = " ".join(str(m.get("role", "")).split())
        if not role:
            raise ConfigError(f"{name}: 하는 일을 적어 주세요. 팀장이 이 문장을 보고 업무를 나눕니다.")
        if len(role) > ROLE_LIMIT:
            raise ConfigError(f"{name}: 하는 일은 {ROLE_LIMIT}자 이내로 적어 주세요.")
        members.append({"name": name, "provider": provider, "model": model, "role": role})
    leader = str(data.get("leader", "")).strip().lower()
    if leader not in seen:
        raise ConfigError("팀장을 팀원 중에서 골라 주세요.")
    guide = str(data.get("guide", "") or "").replace("\r\n", "\n").strip()
    if len(guide) > GUIDE_LIMIT:
        raise ConfigError(f"업무 배정 원칙은 {GUIDE_LIMIT:,}자 이내로 적어 주세요.")
    try:
        rework = int(data.get("rework", 1))
    except (TypeError, ValueError):
        raise ConfigError("보완 요청 횟수는 0~3 사이 숫자여야 합니다.")
    if not 0 <= rework <= 3:
        raise ConfigError("보완 요청 횟수는 0~3 사이 숫자여야 합니다.")
    return {"leader": leader, "guide": guide, "rework": rework, "members": members}


def _s(v: str) -> str:
    """TOML 기본 문자열(JSON 문자열 표기와 호환)."""
    return json.dumps(v, ensure_ascii=False)


def _multiline(v: str) -> str:
    if '"""' not in v and "\\" not in v:
        return f'"""\n{v}\n"""'
    return _s(v)


def render(cfg: dict, header: str = "") -> str:
    lines = [header.rstrip("\n"), ""] if header.strip() else []
    lines += ["[leader]", f"member = {_s(cfg['leader'])}   # 업무 분배·검수·최종 보고 담당"]
    if cfg["guide"]:
        lines += ["# 업무 배정 원칙 — 팀장이 계획을 세울 때 가장 먼저 따른다", f"guide = {_multiline(cfg['guide'])}"]
    lines += [f"rework = {int(cfg.get('rework', 1))}   # 팀장 중간 검수 후 보완 요청 최대 횟수(0~3, 0이면 끔)"]
    for m in cfg["members"]:
        lines += ["", f"[members.{m['name']}]", f"provider = {_s(m['provider'])}", f"model = {_s(m['model'])}", f"role = {_s(m['role'])}"]
    return "\n".join(lines) + "\n"


def header_of(text: str) -> str:
    """파일 맨 위 설명 주석(첫 [표] 이전의 주석·빈 줄)."""
    out = []
    for line in text.splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            break
        out.append(line)
    return "\n".join(out).strip("\n")


def write_config(path: Path, cfg: dict) -> None:
    path = Path(path)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    text = render(cfg, header_of(old))
    tomllib.loads(text)  # 만든 내용이 읽히는지 먼저 확인
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    if old:
        path.with_name(path.name + ".bak").write_text(old, encoding="utf-8")
    os.replace(tmp, path)
