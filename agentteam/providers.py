"""각 AI 사(社)별 호출 래퍼. 모든 팀원은 같은 인터페이스(ask)를 가진다."""
import asyncio
import json
import logging
import os
import random
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass

from . import cli


# .env 의 키가 SDK 프로필 자동탐색보다 우선한다는 안내 경고는 의도된 동작이라 숨긴다
logging.getLogger("anthropic.lib.credentials._auth").setLevel(logging.ERROR)


# 호출 1회의 사용량(토큰·비용·턴). provider 가 알 수 있는 만큼 report_usage 로 채운다(Member.call 이 모은다)
_USAGE: ContextVar[dict | None] = ContextVar("agent_usage", default=None)
MCP_PROVIDERS = {"claude-cli"}  # 외부 도구(MCP)를 붙일 수 있는 provider


def report_usage(**kw) -> None:
    """provider 안에서 부른다. None 값은 버리고, 숫자는 같은 키끼리 더한다."""
    sink = _USAGE.get()
    if sink is None:
        return
    for k, v in kw.items():
        if v is None:
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool) and isinstance(sink.get(k), (int, float)):
            sink[k] += v
        else:
            sink[k] = v


@dataclass
class Member:
    name: str
    provider: str
    model: str
    role: str
    max_tokens: int = 8000

    @property
    def system(self) -> str:
        return (
            f"당신은 멀티 에이전트 팀의 팀원 '{self.name}'입니다.\n"
            f"담당 역할: {self.role}\n"
            "지시받은 업무만 정확히 수행하고, 결과물은 한국어로 간결하게 작성하세요."
        )

    @property
    def can_use_tools(self) -> bool:
        """외부 도구(MCP)를 쓸 수 있는 팀원인지(지금은 claude-cli 만)."""
        return self.provider in MCP_PROVIDERS

    async def ask(self, prompt: str, system: str | None = None, workdir: str | None = None, mcp: dict | None = None) -> str:
        """workdir: 프로젝트 폴더(절대 경로). CLI provider 는 그 폴더에서 파일 도구를 켜고 실행한다.
        API provider 는 파일 도구가 없어 무시한다(프롬프트의 폴더 안내만 받는다)."""
        return (await self.call(prompt, system, workdir, mcp))[0]

    async def call(self, prompt: str, system: str | None = None, workdir: str | None = None,
                   mcp: dict | None = None) -> tuple[str, dict]:
        """ask 와 같지만 (답변, 사용량)을 돌려준다. 사용량: {ms, provider, model, input_tokens?, output_tokens?, cost_usd?, turns?}
        mcp: 사용자가 이번 업무에 허락한 외부 도구 {서버 이름: 설정}. 쓸 수 있는 팀원(can_use_tools)에게만 넘긴다."""
        fn = _PROVIDERS.get(self.provider)
        if fn is None:
            raise ValueError(f"알 수 없는 provider: {self.provider}")
        _require_key(self)
        kw: dict = {}
        if workdir:
            kw["workdir"] = workdir
        if mcp and self.can_use_tools:
            kw["mcp"] = mcp
        sink: dict = {}
        token = _USAGE.set(sink)
        t0 = time.perf_counter()
        try:
            text = await fn(self, prompt, system or self.system, **kw)
        finally:
            _USAGE.reset(token)
        return text, {"ms": round((time.perf_counter() - t0) * 1000), "provider": self.provider, "model": self.model, **sink}


API_TIMEOUT = float(os.getenv("API_TIMEOUT", "600"))  # 초

# provider 별로 하나라도 있으면 되는 환경변수
_KEYS = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "openai": ("OPENAI_API_KEY",),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
}


def has_key(m: Member) -> bool:
    """API provider 는 키가 있는지, CLI provider 는 해당 CLI 가 설치되어 있는지."""
    if m.provider in cli.BINS:
        return cli.installed(m.provider)
    names = _KEYS.get(m.provider)
    return not names or any(os.getenv(n, "").strip() for n in names)


def setup_hint(m: Member) -> str:
    """이 팀원을 쓰려면 무엇을 해야 하는지(화면에 보일 한국어). 준비됐으면 빈 문자열. 로그인 여부는 보지 않는다."""
    if has_key(m):
        return ""
    if m.provider in cli.BINS:
        b = cli.BINS[m.provider]
        return f"`{b}` 명령을 찾을 수 없어요. {cli.INSTALL.get(b, '')}".strip()
    names = _KEYS.get(m.provider, ())
    return f".env 에 {' 또는 '.join(names)} 가 없어요." if names else "준비되지 않았어요."


def _require_key(m: Member) -> None:
    """키가 없으면 SDK 의 난해한 오류 대신 바로 원인을 알려준다. (CLI provider 는 cli 모듈이 직접 안내한다)"""
    if m.provider not in cli.BINS and not has_key(m):
        names = _KEYS[m.provider]
        raise RuntimeError(f"{m.name} 팀원의 API 키가 없습니다. .env 의 {names[0]} 를 채워 주세요.")


async def _anthropic(m: Member, prompt: str, system: str, workdir: str | None = None) -> str:
    from anthropic import AsyncAnthropic

    # 워크스페이스에 속하지 않은 조직 키는 ANTHROPIC_WORKSPACE_ID 헤더가 필요하다
    ws = os.getenv("ANTHROPIC_WORKSPACE_ID", "").strip()
    client = AsyncAnthropic(default_headers={"anthropic-workspace-id": ws} if ws else None)
    resp = await client.messages.create(
        model=m.model,
        max_tokens=m.max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if b.type == "text")


async def _openai(m: Member, prompt: str, system: str, workdir: str | None = None) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI()  # OPENAI_API_KEY
    resp = await client.responses.create(
        model=m.model,
        instructions=system,
        input=prompt,
        max_output_tokens=m.max_tokens,
    )
    return resp.output_text


async def _google(m: Member, prompt: str, system: str, workdir: str | None = None) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
    try:  # 무료 사용량에서는 응답이 아주 늦어질 수 있어 제한 시간을 둔다(Anthropic·OpenAI SDK 는 자체 제한 시간이 있다)
        resp = await asyncio.wait_for(client.aio.models.generate_content(
            model=m.model,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system, max_output_tokens=m.max_tokens),
        ), API_TIMEOUT)
    except asyncio.TimeoutError:
        raise RuntimeError(f"Gemini 응답 시간 초과({API_TIMEOUT:.0f}초). 모델을 바꾸거나 잠시 뒤 다시 시도하세요.")
    return resp.text or ""


_MOCK_FAILED: set[str] = set()


async def _mock(m: Member, prompt: str, system: str, workdir: str | None = None) -> str:
    """API 키 없이 흐름을 점검하기 위한 가짜 응답. MOCK_DELAY(초) 만큼 생각하는 척한다.
    workdir(프로젝트 폴더)가 있으면 결과에 폴더 이름을 적는다(파일은 건드리지 않는다)."""
    where = f"\n- 프로젝트 폴더 ‘{os.path.basename(workdir.rstrip('/'))}’ 안에서 작업했습니다(모의: 파일은 바꾸지 않음)." if workdir else ""
    delay = float(os.getenv("MOCK_DELAY", "0"))
    if delay:
        await asyncio.sleep(delay * random.uniform(0.6, 1.6))
    report_usage(input_tokens=len(prompt) // 3 + 200, output_tokens=120, turns=1)  # 모의 사용량(화면 점검용)
    fail = os.getenv("MOCK_FAIL_ONCE", "")  # 테스트: 이 문자열이 든 업무는 처음 한 번 실패(재시도 확인)
    if fail and fail in prompt and fail not in _MOCK_FAILED:
        _MOCK_FAILED.add(fail)
        raise RuntimeError("모의 일시 오류")
    if "##CHECK##" in prompt:  # 팀장 중간 검수: MOCK_REWORK=1 이면 첫 번째 업무를 한 번 보완 요청
        ids = [int(x) for x in re.findall(r"^### #(\d+) ", prompt, re.M)]
        want = os.getenv("MOCK_REWORK") == "1" and ids and "보완:" not in prompt
        return json.dumps({"rework": [{"id": ids[0], "feedback": "근거 자료와 예시를 더 보강해 주세요."}] if want else []},
                          ensure_ascii=False)
    if prompt.startswith("##CHAT##"):
        question = prompt.rsplit("[사용자 질문]\n", 1)[-1]
        return f"{m.name}입니다. 말씀하신 ‘{question[:120]}’ 잘 들었어요. 제 역할은 {m.role.split('.')[0]}입니다. 함께 정리해 볼까요?\n\n(모의 답변입니다. 실제 실행에서는 연결된 모델이 질문에 답합니다.)"
    if "##PLAN##" in prompt:
        names = re.findall(r"^- (\w+):", prompt, re.M)
        n = lambda i: names[i % len(names)]  # noqa: E731
        tasks = [
            {"id": 1, "assignee": n(2), "title": "요구사항·자료 분석", "depends_on": []},
            {"id": 2, "assignee": n(1), "title": "핵심 기능 구현", "depends_on": [1]},
            {"id": 3, "assignee": n(0), "title": "화면 설계·마크업", "depends_on": [1]},
            {"id": 4, "assignee": n(2), "title": "테스트 시나리오 작성", "depends_on": [2]},
        ]
        for t in tasks:
            t["instruction"] = f"(모의) {t['title']}을 수행하세요."
        return json.dumps({"summary": "분석 → 구현·설계 병렬 → 테스트 순으로 진행", "tasks": tasks},
                          ensure_ascii=False)
    title = re.search(r"\[업무\] (.+)", prompt)
    if title:
        return (f"## {title.group(1)} 결과 (모의)\n\n"
                f"- {m.name}({m.role.split('.')[0]})가 작성한 모의 결과입니다.\n"
                "- 실제 API 키를 넣고 `--mock` 없이 실행하면 진짜 결과물이 나옵니다."
                f"{where}")
    return ("## 1. 최종 결과물 (모의)\n팀원 결과를 통합한 모의 보고서입니다.\n"
            f"{where}\n\n"
            "## 2. 팀원별 검수 의견\n- 모든 업무가 기한 내 완료되었습니다.\n\n"
            "## 3. 남은 과제\n- 실제 API 연결 후 결과 품질 확인")


_PROVIDERS = {
    "anthropic": _anthropic,
    "openai": _openai,
    "google": _google,
    "mock": _mock,
    **cli.PROVIDERS,  # claude-cli · codex-cli · gemini-cli: 구독 로그인된 CLI 호출 (API 키 불필요)
}
