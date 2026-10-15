"""구독 로그인된 CLI(claude · codex · gemini)를 비대화형 서브프로세스로 호출하는 provider.

API 키·크레딧 없이 각 CLI 의 로그인 세션(Claude Max/Pro, ChatGPT, Google 계정)을 그대로 쓴다.
- 빈 임시 폴더에서 실행해 프로젝트 훅·MCP·파일 접근의 영향을 받지 않게 한다.
- 환경변수의 API 키는 넘기지 않는다(키가 있으면 CLI 가 키를 우선 써서 종량제로 과금된다).
- 결과는 최종 답변 텍스트만 돌려준다. 도구 사용은 끈다(순수 텍스트 생성).
"""
import asyncio
import json
import os
import shutil
import tempfile
from asyncio.subprocess import PIPE

TIMEOUT = float(os.getenv("CLI_TIMEOUT", "900"))  # 초. 긴 작업은 수 분 걸릴 수 있다
TAIL = 800

BINS = {"claude-cli": "claude", "codex-cli": "codex", "gemini-cli": "gemini", "antigravity-cli": "agy"}
INSTALL = {
    "claude": "npm i -g @anthropic-ai/claude-code 설치 후 `claude` 를 실행해 로그인하세요.",
    "codex": "npm i -g @openai/codex 설치 후 `codex login` 으로 ChatGPT 계정에 로그인하세요.",
    "gemini": "npm i -g @google/gemini-cli 설치 후 `gemini` 를 실행해 Google 계정으로 로그인하세요. (개인 Google 로그인은 2026-06 종료 → antigravity-cli 사용)",
    "agy": "`curl -fsSL https://antigravity.google/cli/install.sh | bash` 로 설치한 뒤 `agy` 를 실행해 Google 계정(AI Pro/Ultra 구독)으로 로그인하세요.",
}


# PATH 에 없어도 찾아보는 곳 (관리자 권한 없이 `npm i -g --prefix ~/.npm-global` 로 설치한 경우 등)
EXTRA_BIN = [os.path.expanduser(d) for d in ("~/.npm-global/bin", "~/.local/bin", "~/.npm/bin")]


def which(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for d in EXTRA_BIN:
        p = os.path.join(d, name)
        if os.access(p, os.X_OK):
            return p
    return None


def installed(provider: str) -> bool:
    return which(BINS.get(provider, "")) is not None


def _env(*drop: str) -> dict:
    """현재 환경에서 API 키와 Claude Code 세션 변수를 뺀 환경."""
    return {k: v for k, v in os.environ.items() if k not in drop and not k.startswith("CLAUDE")}


def _need(name: str) -> str:
    path = which(name)
    if not path:
        raise RuntimeError(f"'{name}' CLI 가 없습니다. {INSTALL[name]}")
    return path


async def _run(cmd: list[str], stdin: str, cwd: str, env: dict) -> str:
    proc = await asyncio.create_subprocess_exec(*cmd, stdin=PIPE, stdout=PIPE, stderr=PIPE, cwd=cwd, env=env)
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin.encode("utf-8")), TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"{os.path.basename(cmd[0])} 응답 시간 초과({TIMEOUT:.0f}초)")
    text, errs = out.decode("utf-8", "replace"), err.decode("utf-8", "replace").strip()
    if proc.returncode:
        raise RuntimeError(f"{os.path.basename(cmd[0])} 실패(code {proc.returncode}): {(errs or text.strip())[-TAIL:]}")
    return text


async def claude_cli(m, prompt: str, system: str) -> str:
    """claude -p: Claude Code 의 claude.ai 로그인(Max/Pro)으로 호출. 사용량은 구독 한도에서 차감된다."""
    cmd = [_need("claude"), "-p", "--output-format", "json", "--system-prompt", system,
           "--tools", "", "--disallowedTools", "mcp__*", "--max-turns", "1", "--permission-mode", "dontAsk",
           "--no-session-persistence", "--disable-slash-commands"]
    if m.model and m.model != "default":
        cmd += ["--model", m.model]
    with tempfile.TemporaryDirectory(prefix="agent-claude-") as cwd:
        out = await _run(cmd, prompt, cwd, _env("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"))
    try:
        data = json.loads(out)
    except ValueError:
        return out.strip()
    if data.get("is_error"):
        raise RuntimeError(f"claude: {data.get('result') or data}")
    return str(data.get("result", "")).strip()


async def codex_cli(m, prompt: str, system: str) -> str:
    """codex exec: Codex CLI 의 ChatGPT 로그인으로 호출. 시스템 프롬프트는 본문 앞에 붙인다."""
    codex = _need("codex")
    with tempfile.TemporaryDirectory(prefix="agent-codex-") as cwd:
        last = os.path.join(cwd, "last-message.md")
        cmd = [codex, "exec", "--skip-git-repo-check", "-C", cwd, "-o", last]
        if m.model and m.model != "default":
            cmd += ["-m", m.model]
        cmd.append("-")  # 지시문은 stdin 으로
        out = await _run(cmd, f"{system}\n\n---\n\n{prompt}", cwd, _env("OPENAI_API_KEY"))
        try:
            with open(last, encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            return out.strip()


async def gemini_cli(m, prompt: str, system: str) -> str:
    """gemini -p: Gemini CLI 의 Google 로그인(무료 사용량)으로 호출."""
    cmd = [_need("gemini"), "-p", f"{system}\n\n---\n\n{prompt}"]
    if m.model and m.model != "default":
        cmd += ["-m", m.model]
    with tempfile.TemporaryDirectory(prefix="agent-gemini-") as cwd:
        out = await _run(cmd, "", cwd, _env("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    return out.strip()


async def antigravity_cli(m, prompt: str, system: str) -> str:
    """agy -p: Antigravity CLI 의 Google 로그인(AI Pro/Ultra 구독)으로 호출. 헤드리스에서는 도구가 자동 거부되어 사실상 텍스트 전용.
    결과는 --output-format json 의 response 필드. (Gemini CLI 의 개인 로그인이 2026-06 에 끝나 이것이 후속이다)"""
    cmd = [_need("agy"), "-p", f"{system}\n\n---\n\n{prompt}", "--output-format", "json",
           "--print-timeout", f"{max(1, int(TIMEOUT // 60))}m"]
    if m.model and m.model != "default":
        cmd += ["--model", m.model]
    with tempfile.TemporaryDirectory(prefix="agent-agy-") as cwd:
        out = await _run(cmd, "", cwd, _env("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    try:
        data = json.loads(out)
    except ValueError:
        return out.strip()
    if data.get("status", "SUCCESS") != "SUCCESS" or data.get("error"):
        raise RuntimeError(f"agy: {data.get('error') or data.get('status')}")
    return str(data.get("response", "")).strip()


PROVIDERS = {"claude-cli": claude_cli, "codex-cli": codex_cli, "gemini-cli": gemini_cli, "antigravity-cli": antigravity_cli}
