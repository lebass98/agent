"""CLI provider: 가짜 CLI 실행 파일로 호출 형식·결과 파싱·오류 처리를 검증한다 (실제 로그인·네트워크 불필요)."""
import asyncio
import json
import os
import stat
import sys
from pathlib import Path

import pytest

from agentteam import cli
from agentteam.providers import Member

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="가짜 CLI 가 셸 스크립트")


def fake(bin_dir: Path, name: str, script: str) -> None:
    p = bin_dir / name
    p.write_text("#!/bin/sh\n" + script, encoding="utf-8")
    p.chmod(p.stat().st_mode | stat.S_IXUSR)


@pytest.fixture
def bin_dir(tmp_path, monkeypatch):
    d = tmp_path / "bin"
    d.mkdir()
    monkeypatch.setenv("PATH", f"{d}:/usr/bin:/bin")  # 진짜 CLI 는 보이지 않게, 기본 명령(cat·sleep)만 남긴다
    monkeypatch.setattr(cli, "EXTRA_BIN", [])
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("CLAUDECODE", "1")
    return d


def member(provider, model="default"):
    return Member(name="x", provider=provider, model=model, role="테스트")


def test_missing_cli_gives_install_hint(bin_dir):
    with pytest.raises(RuntimeError, match="npm i -g @google/gemini-cli"):
        asyncio.run(member("gemini-cli").ask("hi"))
    assert not cli.installed("gemini-cli")


def test_claude_cli_parses_json_and_hides_api_key(bin_dir, tmp_path):
    log = tmp_path / "args.txt"
    fake(bin_dir, "claude", f'''printf '%s\\n' "$@" > "{log}"; echo "key=$ANTHROPIC_API_KEY cc=$CLAUDECODE" >> "{log}"
cat >> "{log}"
echo '{{"type":"result","is_error":false,"result":"연결 성공"}}' ''')
    assert asyncio.run(member("claude-cli", "opus").ask("테스트 질문")) == "연결 성공"
    args = log.read_text(encoding="utf-8")
    assert "-p" in args and "--output-format\njson" in args and "--model\nopus" in args
    assert "--tools\n\n" in args and "--max-turns\n1" in args          # 도구 끔, 한 턴만
    assert "key= cc=" in args                                           # API 키·Claude Code 세션 변수 제거
    assert args.rstrip().endswith("테스트 질문")                        # 프롬프트는 stdin


def test_claude_cli_error_result(bin_dir):
    fake(bin_dir, "claude", '''echo '{"type":"result","is_error":true,"result":"Not logged in"}' ''')
    with pytest.raises(RuntimeError, match="Not logged in"):
        asyncio.run(member("claude-cli").ask("hi"))


def test_codex_cli_reads_last_message_file(bin_dir):
    fake(bin_dir, "codex", '''out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
cat > /dev/null; echo "progress log" ; printf '답변 본문' > "$out" ''')
    assert asyncio.run(member("codex-cli").ask("hi")) == "답변 본문"


def test_cli_nonzero_exit_surfaces_stderr(bin_dir):
    fake(bin_dir, "codex", '''cat > /dev/null; echo "quota exceeded" >&2; exit 3''')
    with pytest.raises(RuntimeError, match=r"codex 실패\(code 3\): quota exceeded"):
        asyncio.run(member("codex-cli").ask("hi"))


def test_gemini_cli_passes_prompt_and_model(bin_dir, tmp_path):
    log = tmp_path / "args.txt"
    fake(bin_dir, "gemini", f'''printf '%s\\n' "$@" > "{log}"; echo "  답변  " ''')
    assert asyncio.run(member("gemini-cli", "gemini-2.5-pro").ask("질문")) == "답변"
    args = log.read_text(encoding="utf-8")
    assert args.startswith("-p\n") and "질문" in args and "-m\ngemini-2.5-pro" in args


def test_timeout(bin_dir, monkeypatch):
    monkeypatch.setattr(cli, "TIMEOUT", 0.3)
    fake(bin_dir, "claude", "sleep 5")
    with pytest.raises(RuntimeError, match="시간 초과"):
        asyncio.run(member("claude-cli").ask("hi"))


def test_extra_bin_lookup(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", "")
    d = tmp_path / "npm-global" / "bin"
    d.mkdir(parents=True)
    fake(d, "gemini", "echo ok")
    monkeypatch.setattr(cli, "EXTRA_BIN", [str(d)])
    assert cli.which("gemini") == str(d / "gemini") and cli.installed("gemini-cli")
    assert os.access(cli.which("gemini"), os.X_OK)
