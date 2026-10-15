"""팀장(leader)이 업무를 분해·배정하고, 팀원들이 의존 순서대로 병렬 수행한 뒤, 팀장이 검수·통합한다.

진행 단계마다 emit(event) 으로 이벤트를 내보낸다. 형식은 docs/events.md 참고.
"""
import asyncio
import inspect
import json
import re
import tomllib
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

from .providers import Member

Emit = Callable[[dict], Awaitable[None] | None]
RESULT_LIMIT = 20_000

PLAN_PROMPT = """##PLAN##
당신은 팀장입니다. 아래 목표를 팀원에게 나눠 줄 업무로 분해하세요.

[목표]
{goal}

[팀원과 역할]
{roster}
{guide}
규칙:
- 각 업무는 역할에 가장 잘 맞는 팀원 1명에게 배정합니다 (팀장 본인도 가능). [배정 원칙]이 있으면 그것을 가장 먼저 따릅니다.
- 다른 업무 결과가 필요하면 depends_on에 해당 id를 넣습니다. 서로 독립적이면 비워 두어 병렬로 진행합니다.
- instruction은 다른 맥락 없이도 수행 가능할 만큼 구체적으로 씁니다.

아래 JSON만 출력하세요 (설명·코드블록 금지):
{{"summary": "계획 요약", "tasks": [{{"id": 1, "assignee": "팀원이름", "title": "업무명", "instruction": "구체적 지시", "depends_on": []}}]}}
"""

PROJECT_NOTE = """

[프로젝트 폴더]
{path}
이 업무는 위 폴더(사용자가 전체 접근을 허락한 프로젝트) 안에서 진행합니다. 작업 폴더가 곧 이 폴더입니다.
- 폴더 안의 파일은 필요하면 읽고, 만들고, 고칠 수 있습니다. 지우기는 업무에 꼭 필요할 때만 하세요.
- 폴더 밖의 파일·설정은 절대 읽거나 바꾸지 마세요.
- 만들거나 바꾼 파일은 결과 끝에 폴더 기준 상대 경로 목록으로 적으세요.
"""

REVIEW_PROMPT = """당신은 팀장입니다. 팀원들의 결과물을 검수하고 최종 보고서를 작성하세요.

[목표]
{goal}

[팀원 결과물]
{results}

보고서 형식:
1. 최종 결과물 (팀원 결과를 통합·보완한 완성본)
2. 팀원별 검수 의견 (잘된 점 / 보완 필요 사항)
3. 남은 과제
"""


class Team:
    def __init__(self, config_path: str | Path = "team.toml", mock: bool = False):
        cfg = tomllib.loads(Path(config_path).read_text(encoding="utf-8"))
        self.members = {
            name: Member(name=name, **({**m, "provider": "mock"} if mock else m))
            for name, m in cfg["members"].items()
        }
        self.leader = self.members[cfg["leader"]["member"]]
        self.guide = str(cfg["leader"].get("guide", "")).strip()  # team.toml [leader] guide: 업무 배정 원칙
        self.mock = mock

    def guide_text(self) -> str:
        return f"\n[배정 원칙]\n{self.guide}\n" if self.guide else ""

    def roster(self) -> str:
        return "\n".join(f"- {m.name}: {m.role}" for m in self.members.values())

    def info(self) -> dict:
        return {
            "leader": self.leader.name,
            "members": [
                {"name": m.name, "provider": m.provider, "model": m.model, "role": m.role}
                for m in self.members.values()
            ],
        }

    # ── 단일 지시 ─────────────────────────────────────
    async def ask(self, name: str, prompt: str) -> str:
        if name not in self.members:
            raise SystemExit(f"팀원 '{name}' 없음. 사용 가능: {', '.join(self.members)}")
        return await self.members[name].ask(prompt)

    # ── 팀 업무 ───────────────────────────────────────
    async def run(self, goal: str, out_root: Path = Path("runs"),
                  emit: Emit | None = None, run_id: str | None = None,
                  project: dict | None = None) -> Path:
        """project: {id, name, path} — 있으면 팀원들이 그 폴더를 작업 폴더로 삼아 파일을 읽고 고친다."""
        run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
        out = out_root / run_id
        out.mkdir(parents=True, exist_ok=True)
        (out / "goal.txt").write_text(goal, encoding="utf-8")
        project = {k: project[k] for k in ("id", "name", "path")} if project else None
        if project:
            (out / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
        workdir = project["path"] if project else None
        note = PROJECT_NOTE.format(path=workdir) if workdir else ""

        async def send(event: dict) -> None:
            if emit is None:
                return
            r = emit(event)
            if inspect.isawaitable(r):
                await r

        ok = False
        try:
            await send({"type": "run_start", "run_id": run_id, "goal": goal, "project": project})

            print(f"📋 [{self.leader.name}] 업무 계획 수립 중…")
            await send({"type": "plan_start", "leader": self.leader.name})
            plan = _parse_json(await self.leader.ask(
                PLAN_PROMPT.format(goal=goal, roster=self.roster(), guide=self.guide_text()) + note,
                workdir=workdir))
            tasks = self._normalize(plan.get("tasks", []))
            if not tasks:
                raise ValueError("팀장 계획에 업무가 없습니다.")
            plan = {"summary": str(plan.get("summary", "")), "tasks": tasks}
            (out / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
            for t in tasks:
                print(f"   #{t['id']} @{t['assignee']:<7} {t['title']}")
            await send({"type": "plan", **plan})

            results = await self._execute(tasks, out, send, workdir, note)

            print(f"🔍 [{self.leader.name}] 검수 및 최종 보고 작성 중…")
            await send({"type": "review_start", "leader": self.leader.name})
            joined = "\n\n".join(
                f"### #{t['id']} {t['title']} (@{t['assignee']})\n{results[t['id']]}"
                for t in tasks
            )
            report = await self.leader.ask(REVIEW_PROMPT.format(goal=goal, results=joined) + note, workdir=workdir)
            (out / "report.md").write_text(f"# 목표\n{goal}\n\n{report}\n", encoding="utf-8")
            await send({"type": "report", "report": report, "dir": str(out)})
            ok = True
            return out
        except Exception as e:
            (out / "error.txt").write_text(str(e), encoding="utf-8")
            await send({"type": "run_error", "message": str(e)})
            raise
        finally:
            await send({"type": "run_end", "run_id": run_id, "ok": ok})

    def _normalize(self, raw: list[Any]) -> list[dict]:
        """LLM 이 만든 계획을 실행 가능한 형태로 정리한다.
        - id 정수화·중복 제거, 모르는 팀원은 팀장에게 배정
        - 없는 id·자기 자신 의존 제거, 순환 의존은 끊는다
        """
        tasks, seen = [], set()
        for i, t in enumerate(raw, 1):
            if not isinstance(t, dict):
                continue
            try:
                tid = int(t.get("id", i))
            except (TypeError, ValueError):
                tid = i
            while tid in seen:
                tid += 1000
            seen.add(tid)
            assignee = str(t.get("assignee", "")).strip().lstrip("@").lower()
            tasks.append({
                "id": tid,
                "assignee": assignee if assignee in self.members else self.leader.name,
                "title": str(t.get("title") or f"업무 {tid}"),
                "instruction": str(t.get("instruction") or t.get("title") or ""),
                "depends_on": t.get("depends_on") or [],
            })
        for t in tasks:
            deps = []
            for d in t["depends_on"] if isinstance(t["depends_on"], list) else []:
                try:
                    d = int(d)
                except (TypeError, ValueError):
                    continue
                if d in seen and d != t["id"] and d not in deps:
                    deps.append(d)
            t["depends_on"] = deps
        # 순환 제거 (Kahn): 정렬되지 못하고 남은 업무끼리의 의존은 끊는다
        by_id = {t["id"]: t for t in tasks}
        done: set[int] = set()
        changed = True
        while changed:
            changed = False
            for t in tasks:
                if t["id"] not in done and all(d in done for d in t["depends_on"]):
                    done.add(t["id"])
                    changed = True
        for tid in set(by_id) - done:
            by_id[tid]["depends_on"] = [d for d in by_id[tid]["depends_on"] if d in done]
        return tasks

    async def _execute(self, tasks: list[dict], out: Path, send: Callable[[dict], Awaitable[None]],
                       workdir: str | None = None, note: str = "") -> dict[int, str]:
        """선행 업무가 끝나는 즉시 착수한다. 팀원 1명은 한 번에 업무 1개만 처리한다."""
        results: dict[int, str] = {}
        finished = {t["id"]: asyncio.Event() for t in tasks}
        locks = {name: asyncio.Lock() for name in self.members}

        async def work(t: dict) -> None:
            for d in t["depends_on"]:
                await finished[d].wait()
            member = self.members[t["assignee"]]
            async with locks[member.name]:
                context = "".join(
                    f"\n\n[참고: #{d} 결과]\n{results[d]}" for d in t["depends_on"]
                )
                print(f"▶  #{t['id']} @{member.name} 시작")
                await send({"type": "task_start", "id": t["id"], "assignee": member.name})
                ok = True
                try:
                    results[t["id"]] = await member.ask(
                        f"[업무] {t['title']}\n{t['instruction']}{context}{note}", workdir=workdir
                    )
                    print(f"✅ #{t['id']} @{member.name} 완료")
                except Exception as e:  # 한 팀원 실패가 팀 전체를 멈추지 않도록
                    ok = False
                    results[t["id"]] = f"(실패: {e})"
                    print(f"❌ #{t['id']} @{member.name} 실패: {e}")
                (out / f"task-{t['id']:02d}-{member.name}.md").write_text(
                    f"# #{t['id']} {t['title']}\n\n{results[t['id']]}\n", encoding="utf-8"
                )
                await send({"type": "task_done", "id": t["id"], "assignee": member.name,
                            "ok": ok, "result": results[t["id"]][:RESULT_LIMIT]})
            finished[t["id"]].set()

        await asyncio.gather(*(work(t) for t in tasks))
        return results


def _parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"팀장 계획을 JSON으로 해석할 수 없습니다:\n{text[:500]}")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as e:
        raise ValueError(f"팀장 계획 JSON 오류: {e}\n{text[:500]}") from e
