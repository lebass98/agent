"""구독 로그인된 CLI(claude · codex · gemini)를 비대화형 서브프로세스로 호출하는 provider.

API 키·크레딧 없이 각 CLI 의 로그인 세션(Claude Max/Pro, ChatGPT, Google 계정)을 그대로 쓴다.
- 기본: 빈 임시 폴더에서 도구 없이 실행해 프로젝트 훅·MCP·파일 접근의 영향을 받지 않게 한다(순수 텍스트 생성).
- 프로젝트 모드(workdir 지정): 그 폴더를 작업 폴더로 삼고 파일 도구(읽기·만들기·고치기)를 켠다. 폴더 밖은 막는다.
- 환경변수의 API 키는 넘기지 않는다(키가 있으면 CLI 가 키를 우선 써서 종량제로 과금된다).
- 결과는 최종 답변 텍스트만 돌려준다.
"""
import asyncio
import json
import os
import shutil
import tempfile
from asyncio.subprocess import PIPE
from contextlib import contextmanager

TIMEOUT = float(os.getenv("CLI_TIMEOUT", "900"))  # 초. 긴 작업은 수 분 걸릴 수 있다
TAIL = 800
PROJECT_TURNS = 30  # 프로젝트 모드에서 claude 가 파일을 읽고 고치며 쓸 수 있는 최대 턴
CLAUDE_FILE_TOOLS = "Read,Edit,Write,Glob,Grep"  # 프로젝트 모드에서 claude 에게 주는 도구(셸 Bash 는 주지 않는다)

BINS = {"claude-cli": "claude", "codex-cli": "codex", "gemini-cli": "gemini", "antigravity-cli": "agy"}
INSTALL = {
    "claude": "`curl -fsSL https://claude.ai/install.sh | bash` 로 설치한 뒤 `claude` 를 실행해 로그인하세요.",
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


@contextmanager
def _workdir(workdir: str | None, prefix: str):
    """프로젝트 폴더가 있으면 그 폴더, 없으면 끝나면 지워지는 빈 임시 폴더."""
    if workdir:
        yield workdir
        return
    with tempfile.TemporaryDirectory(prefix=prefix) as d:
        yield d


def claude_args(m, system: str, workdir: str | None = None, mcp_file: str | None = None,
                mcp_names: list[str] | None = None) -> list[str]:
    """claude -p 인자. 프로젝트 모드에서는 파일 도구를 켜되 허용 규칙을 그 폴더 안으로 좁힌다.
    mcp_file·mcp_names: 사용자가 이번 업무에 허락한 외부 도구(MCP 서버). 그 서버들만 읽고(--strict-mcp-config) 미리 허용한다.
    허락하지 않았으면 MCP 도구는 모두 막는다."""
    cmd = ["-p", "--output-format", "json", "--system-prompt", system]
    tools = bool(mcp_file and mcp_names)
    if tools:
        cmd += ["--mcp-config", mcp_file, "--strict-mcp-config"]
        for name in mcp_names:
            cmd += ["--allowedTools", f"mcp__{name}"]  # 서버 이름 규칙 = 그 서버의 모든 도구
    if workdir:
        rule = "/" + workdir.rstrip("/") + "/**"  # 절대 경로 규칙은 '//' 로 시작한다 (예: Read(//Users/me/site/**))
        cmd += ["--tools", CLAUDE_FILE_TOOLS, "--add-dir", workdir,
                "--allowedTools", f"Read({rule})", "--allowedTools", f"Edit({rule})"]  # Edit 규칙은 Write 에도 적용된다
        if not tools:
            cmd += ["--disallowedTools", "mcp__*"]
        cmd += ["--disallowedTools", "Bash", "--disallowedTools", "WebFetch",
                "--max-turns", str(PROJECT_TURNS), "--permission-mode", "acceptEdits"]
    elif tools:  # 파일 도구 없이 외부 도구만: 여러 턴(도구 호출)이 필요하다
        cmd += ["--tools", "", "--max-turns", str(PROJECT_TURNS), "--permission-mode", "dontAsk"]
    else:
        cmd += ["--tools", "", "--disallowedTools", "mcp__*", "--max-turns", "1", "--permission-mode", "dontAsk"]
    cmd += ["--no-session-persistence", "--disable-slash-commands"]
    if m.model and m.model != "default":
        cmd += ["--model", m.model]
    return cmd


async def claude_cli(m, prompt: str, system: str, workdir: str | None = None, mcp: dict | None = None) -> str:
    """claude -p: Claude Code 의 claude.ai 로그인(Max/Pro)으로 호출. 사용량은 구독 한도에서 차감된다.
    mcp: {서버 이름: 설정} — 이번 업무에 허락된 외부 도구. 설정 파일은 임시 폴더에 쓰고 끝나면 지운다."""
    claude = _need("claude")
    with tempfile.TemporaryDirectory(prefix="agent-mcp-") as tmp, _workdir(workdir, "agent-claude-") as cwd:
        mcp_file = None
        if mcp:
            mcp_file = os.path.join(tmp, "mcp.json")
            with open(mcp_file, "w", encoding="utf-8") as f:
                json.dump({"mcpServers": mcp}, f, ensure_ascii=False)
        cmd = [claude, *claude_args(m, system, workdir, mcp_file, sorted(mcp) if mcp else None)]
        out = await _run(cmd, prompt, cwd, _env("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"))
    try:
        data = json.loads(out)
    except ValueError:
        return out.strip()
    u = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    _usage(input_tokens=_num(u.get("input_tokens")) + _num(u.get("cache_read_input_tokens")) + _num(u.get("cache_creation_input_tokens")) or None,
           output_tokens=_num(u.get("output_tokens")) or None, cost_usd=data.get("total_cost_usd"), turns=data.get("num_turns"))
    if data.get("is_error"):
        raise RuntimeError(f"claude: {data.get('result') or data}")
    return str(data.get("result", "")).strip()


def _num(v) -> int:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _usage(**kw) -> None:
    from .providers import report_usage  # providers 가 cli 를 불러오므로 함수 안에서 가져온다
    report_usage(**kw)


async def codex_cli(m, prompt: str, system: str, workdir: str | None = None) -> str:
    """codex exec: Codex CLI 의 ChatGPT 로그인으로 호출. 시스템 프롬프트는 본문 앞에 붙인다.
    프로젝트 모드: 그 폴더에서 --sandbox workspace-write (폴더 안 쓰기만 허용, 네트워크 차단)."""
    codex = _need("codex")
    with tempfile.TemporaryDirectory(prefix="agent-codex-") as tmp, _workdir(workdir, "agent-codex-") as cwd:
        last = os.path.join(tmp, "last-message.md")  # 답변 파일은 프로젝트 폴더를 어지르지 않게 임시 폴더에
        cmd = [codex, "exec", "--skip-git-repo-check", "-C", cwd, "-o", last]
        if workdir:
            cmd += ["--sandbox", "workspace-write"]
        if m.model and m.model != "default":
            cmd += ["-m", m.model]
        cmd.append("-")  # 지시문은 stdin 으로
        out = await _run(cmd, f"{system}\n\n---\n\n{prompt}", cwd, _env("OPENAI_API_KEY"))
        try:
            with open(last, encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            return out.strip()


async def gemini_cli(m, prompt: str, system: str, workdir: str | None = None) -> str:
    """gemini -p: Gemini CLI 의 Google 로그인(무료 사용량)으로 호출. 프로젝트 모드는 편집 도구만 자동 승인."""
    cmd = [_need("gemini"), "-p", f"{system}\n\n---\n\n{prompt}"]
    if workdir:
        cmd += ["--approval-mode", "auto_edit"]
    if m.model and m.model != "default":
        cmd += ["-m", m.model]
    with _workdir(workdir, "agent-gemini-") as cwd:
        out = await _run(cmd, "", cwd, _env("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    return out.strip()


async def antigravity_cli(m, prompt: str, system: str, workdir: str | None = None) -> str:
    """agy -p: Antigravity CLI 의 Google 로그인(AI Pro/Ultra 구독)으로 호출. 결과는 --output-format json 의 response 필드.
    기본(임시 폴더)은 헤드리스에서 도구가 자동 거부되어 사실상 텍스트 전용.
    프로젝트 모드: 그 폴더를 작업 폴더(+ --add-dir)로 두고 --mode accept-edits 로 폴더 안 편집을 자동 승인한다.
    (--dangerously-skip-permissions 는 명령 실행까지 모두 승인하므로 쓰지 않는다)"""
    cmd = [_need("agy"), "-p", f"{system}\n\n---\n\n{prompt}", "--output-format", "json",
           "--print-timeout", f"{max(1, int(TIMEOUT // 60))}m"]
    if workdir:
        cmd += ["--mode", "accept-edits", "--add-dir", workdir]
    if m.model and m.model != "default":
        cmd += ["--model", m.model]
    with _workdir(workdir, "agent-agy-") as cwd:
        out = await _run(cmd, "", cwd, _env("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    try:
        data = json.loads(out)
    except ValueError:
        return out.strip()
    if isinstance(data.get("usage"), dict):
        u = data["usage"]
        _usage(input_tokens=_num(u.get("input_tokens") or u.get("prompt_tokens")) or None,
               output_tokens=_num(u.get("output_tokens") or u.get("completion_tokens")) or None)
    if data.get("status", "SUCCESS") != "SUCCESS" or data.get("error"):
        raise RuntimeError(f"agy: {data.get('error') or data.get('status')}")
    text = str(data.get("response", "")).strip()
    if not text:  # 도구 사용이 막히면(denied_actions) 빈 답이 온다 → 실패로 알린다
        denied = data.get("denied_actions") or []
        names = ", ".join(str(d.get("action", d) if isinstance(d, dict) else d) for d in denied)
        raise RuntimeError("agy: 빈 응답" + (f" (거부된 동작: {names})" if names else ""))
    return text


PROVIDERS = {"claude-cli": claude_cli, "codex-cli": codex_cli, "gemini-cli": gemini_cli, "antigravity-cli": antigravity_cli}
