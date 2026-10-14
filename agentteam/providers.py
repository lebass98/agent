"""각 AI 사(社)별 호출 래퍼. 모든 팀원은 같은 인터페이스(ask)를 가진다."""
import asyncio
import json
import logging
import os
import random
import re
from dataclasses import dataclass


# .env 의 키가 SDK 프로필 자동탐색보다 우선한다는 안내 경고는 의도된 동작이라 숨긴다
logging.getLogger("anthropic.lib.credentials._auth").setLevel(logging.ERROR)


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

    async def ask(self, prompt: str, system: str | None = None) -> str:
        call = _PROVIDERS.get(self.provider)
        if call is None:
            raise ValueError(f"알 수 없는 provider: {self.provider}")
        _require_key(self)
        return await call(self, prompt, system or self.system)


# provider 별로 하나라도 있으면 되는 환경변수
_KEYS = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "openai": ("OPENAI_API_KEY",),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
}


def has_key(m: Member) -> bool:
    names = _KEYS.get(m.provider)
    return not names or any(os.getenv(n, "").strip() for n in names)


def _require_key(m: Member) -> None:
    """키가 없으면 SDK 의 난해한 오류 대신 바로 원인을 알려준다."""
    if not has_key(m):
        names = _KEYS[m.provider]
        raise RuntimeError(f"{m.name} 팀원의 API 키가 없습니다. .env 의 {names[0]} 를 채워 주세요.")


async def _anthropic(m: Member, prompt: str, system: str) -> str:
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


async def _openai(m: Member, prompt: str, system: str) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI()  # OPENAI_API_KEY
    resp = await client.responses.create(
        model=m.model,
        instructions=system,
        input=prompt,
        max_output_tokens=m.max_tokens,
    )
    return resp.output_text


async def _google(m: Member, prompt: str, system: str) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
    resp = await client.aio.models.generate_content(
        model=m.model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system, max_output_tokens=m.max_tokens
        ),
    )
    return resp.text or ""


async def _mock(m: Member, prompt: str, system: str) -> str:
    """API 키 없이 흐름을 점검하기 위한 가짜 응답. MOCK_DELAY(초) 만큼 생각하는 척한다."""
    delay = float(os.getenv("MOCK_DELAY", "0"))
    if delay:
        await asyncio.sleep(delay * random.uniform(0.6, 1.6))
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
                "- 실제 API 키를 넣고 `--mock` 없이 실행하면 진짜 결과물이 나옵니다.")
    return ("## 1. 최종 결과물 (모의)\n팀원 결과를 통합한 모의 보고서입니다.\n\n"
            "## 2. 팀원별 검수 의견\n- 모든 업무가 기한 내 완료되었습니다.\n\n"
            "## 3. 남은 과제\n- 실제 API 연결 후 결과 품질 확인")


_PROVIDERS = {
    "anthropic": _anthropic,
    "openai": _openai,
    "google": _google,
    "mock": _mock,
}
