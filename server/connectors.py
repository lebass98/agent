"""claude.ai 커넥터(Gmail·Notion 등)를 이 컴퓨터의 `claude` CLI 로 읽기 전용 호출한다(브레인 모드 메일·회의록).

- 구독 로그인 세션을 그대로 쓴다(API 키는 넘기지 않는다). 빈 임시 폴더에서 실행해 프로젝트 파일·훅의 영향을 받지 않는다.
- 허용 도구는 호출하는 쪽이 정한 '읽기' 도구만(--allowedTools). 그 밖의 도구는 -p 모드에서 묻지 못하므로 거부되고,
  셸·파일 쓰기·웹 도구는 --disallowedTools 로 한 번 더 막는다.
"""
import asyncio
import json
import tempfile

BLOCK_TOOLS = "Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Task"
TIMEOUT = 300


class ConnectorError(RuntimeError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def claude_exe() -> str | None:
    from agentteam import cli
    return cli.which("claude")


async def ask(prompt: str, tools: str, model: str = "haiku", what: str = "커넥터") -> str:
    """claude -p 로 묻고 최종 답 텍스트를 돌려준다."""
    from agentteam import cli
    exe = claude_exe()
    if not exe:
        raise ConnectorError("claude CLI 가 없어요. Claude Code 를 설치하고 로그인하세요.")
    cmd = [exe, "-p", "--model", model, "--disallowedTools", BLOCK_TOOLS, "--output-format", "json"]
    cmd += ["--allowedTools", tools] if tools else ["--tools", "", "--max-turns", "1"]   # 도구 없이 글만
    with tempfile.TemporaryDirectory(prefix="agent-conn-") as tmp:
        proc = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.PIPE, cwd=tmp, env=cli._env("ANTHROPIC_API_KEY"))
        try:
            out, _ = await asyncio.wait_for(proc.communicate(prompt.encode()), TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            raise ConnectorError(f"Claude 의 {what} 연결이 응답하지 않아요. 잠시 뒤 다시 시도하세요.")
    try:
        d = json.loads(out.decode("utf-8", "replace"))
    except ValueError:
        raise ConnectorError(f"Claude 의 {what} 연결 결과를 읽지 못했어요. 터미널에서 `claude` 로그인 상태를 확인하세요.")
    if d.get("is_error"):
        raise ConnectorError(f"Claude 의 {what} 연결이 실패했어요. claude.ai 설정 → 커넥터에서 {what} 이(가) 연결돼 있는지 확인하세요.")
    return str(d.get("result", ""))
