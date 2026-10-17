"""팀장(leader)이 업무를 분해·배정하고, 팀원들이 의존 순서대로 병렬 수행한 뒤, 팀장이 검수·통합한다.

진행 단계마다 emit(event) 으로 이벤트를 내보낸다. 형식은 docs/events.md 참고.
"""
import asyncio
import inspect
import json
import os
import re
import tomllib
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

from .providers import Member, setup_hint

Emit = Callable[[dict], Awaitable[None] | None]
RESULT_LIMIT = 20_000
RETRIES = int(os.getenv("AGENT_RETRIES", "1"))          # 일시 오류(시간 초과·빈 응답 등) 때 다시 시도하는 횟수
RETRY_DELAY = float(os.getenv("AGENT_RETRY_DELAY", "3"))  # 다시 시도하기 전 기다리는 시간(초)
REWORK_LIMIT = 3  # team.toml [leader] rework 최대값
# 다시 해도 소용없는 오류(설치·키·설정 문제)
NO_RETRY = ("CLI 가 없습니다", "API 키가 없습니다", "알 수 없는 provider", "로그인", "authentication", "not logged in")

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

CHECK_PROMPT = """##CHECK##
당신은 팀장입니다. 최종 보고서를 쓰기 전에 팀원 결과물이 목표에 맞게 충분한지 점검합니다.

[목표]
{goal}

[팀원 결과물]
{results}

규칙:
- 목표 달성에 꼭 필요한데 빠졌거나, 틀렸거나, 실패한 업무만 보완을 요청합니다. 사소한 문체 차이는 요청하지 않습니다.
- 보완이 필요 없으면 빈 목록을 냅니다.
- feedback 은 담당자가 바로 고칠 수 있게 구체적으로 씁니다.

아래 JSON만 출력하세요 (설명·코드블록 금지):
{{"rework": [{{"id": 1, "feedback": "무엇을 어떻게 보완할지"}}]}}
"""

REWORK_NOTE = """

[이전 결과]
{prev}

[팀장 보완 요청]
{feedback}
이전 결과를 바탕으로 요청을 반영한 완성본을 처음부터 끝까지 다시 작성하세요."""

TOOLS_NOTE = """

[외부 도구]
사용자가 이번 업무에 외부 도구(MCP) {names} 사용을 허락했습니다. 업무에 필요할 때만 쓰세요.
메일 발송·게시·삭제·결제처럼 바깥에 영향을 주는 행동은 업무 지시에 분명히 적힌 경우에만 하고, 한 일은 결과에 모두 적으세요."""

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


def rework_rounds(v) -> int:
    try:
        return max(0, min(REWORK_LIMIT, int(os.getenv("AGENT_REWORK", v))))
    except (TypeError, ValueError):
        return 1


class Team:
    def __init__(self, config_path: str | Path = "team.toml", mock: bool = False):
        self.config_path = Path(config_path)  # 웹 화면 '에이전트 설정'이 다시 쓰는 파일
        cfg = tomllib.loads(self.config_path.read_text(encoding="utf-8"))
        self.members = {
            name: Member(name=name, **({**m, "provider": "mock"} if mock else m))
            for name, m in cfg["members"].items()
        }
        self.leader = self.members[cfg["leader"]["member"]]
        self.guide = str(cfg["leader"].get("guide", "")).strip()  # team.toml [leader] guide: 업무 배정 원칙
        self.rework = rework_rounds(cfg["leader"].get("rework", 1))  # 팀장 중간 검수 → 보완 요청 최대 횟수(0이면 끔)
        self.mock = mock

    def reload(self) -> None:
        """team.toml 을 다시 읽어 팀원·팀장·배정 원칙을 바꾼다(진행 중인 업무가 없을 때만 부른다)."""
        fresh = Team(self.config_path, mock=self.mock)
        self.members, self.leader, self.guide, self.rework = fresh.members, fresh.leader, fresh.guide, fresh.rework

    def guide_text(self) -> str:
        return f"\n[배정 원칙]\n{self.guide}\n" if self.guide else ""

    def roster(self, tools: bool = False) -> str:
        """tools: 이번 업무에 외부 도구가 허락되었으면 쓸 수 있는 팀원에 표시한다(팀장이 배정할 때 참고)."""
        return "\n".join(f"- {m.name}: {m.role}{' (외부 도구 사용 가능)' if tools and m.can_use_tools else ''}"
                         for m in self.members.values())

    def info(self) -> dict:
        """화면용 팀 정보. ready/hint: CLI 설치·API 키 준비 여부와 준비 방법(모의 실행이면 provider 가 mock 이라 항상 준비됨)."""
        members = []
        for m in self.members.values():
            hint = setup_hint(m)
            members.append({"name": m.name, "provider": m.provider, "model": m.model, "role": m.role, "ready": not hint, "hint": hint})
        return {"leader": self.leader.name, "members": members}

    # ── 단일 지시 ─────────────────────────────────────
    async def ask(self, name: str, prompt: str) -> str:
        if name not in self.members:
            raise SystemExit(f"팀원 '{name}' 없음. 사용 가능: {', '.join(self.members)}")
        return await self.members[name].ask(prompt)

    # ── 팀 업무 ───────────────────────────────────────
    async def run(self, goal: str, out_root: Path = Path("runs"),
                  emit: Emit | None = None, run_id: str | None = None,
                  project: dict | None = None, tools: dict | None = None, resume: bool = False) -> Path:
        """project: {id, name, path} — 있으면 팀원들이 그 폴더를 작업 폴더로 삼아 파일을 읽고 고친다.
        tools: 사용자가 이번 업무에 허락한 외부 도구 {MCP 서버 이름: 설정} — 쓸 수 있는 팀원(claude-cli)에게만 붙는다.
        resume: 중단된 실행(runs/<run_id>)을 이어 한다. 저장된 계획을 다시 쓰고, 이미 끝난 업무는 건너뛴다."""
        run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
        out = out_root / run_id
        out.mkdir(parents=True, exist_ok=True)
        if not resume:
            (out / "goal.txt").write_text(goal, encoding="utf-8")
        project = {k: project[k] for k in ("id", "name", "path")} if project else None
        if project and not resume:
            (out / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
        tools = dict(tools or {})
        r = _Run(out, emit, project["path"] if project else None, tools)
        names = ", ".join(sorted(tools))
        r.note = PROJECT_NOTE.format(path=r.workdir) if r.workdir else ""
        r.tools_note = TOOLS_NOTE.format(names=names) if tools else ""

        ok = False
        r.save(status="running", run_id=run_id, tools=sorted(tools), resumed=resume or r.state.get("resumed", False))
        try:
            await r.send({"type": "run_start", "run_id": run_id, "goal": goal, "project": project,
                          "tools": sorted(tools), "resumed": resume})

            saved = _read_json(out / "plan.json") if resume else None
            if saved and saved.get("tasks"):
                plan, usage = saved, None
                print(f"↩️  [{self.leader.name}] 저장된 계획으로 이어 합니다.")
            else:
                print(f"📋 [{self.leader.name}] 업무 계획 수립 중…")
                await r.send({"type": "plan_start", "leader": self.leader.name})
                raw, usage = await self._plan(r, goal)
                tasks = self._normalize(raw.get("tasks", []))
                if not tasks:
                    raise ValueError("팀장 계획에 업무가 없습니다.")
                plan = {"summary": str(raw.get("summary", "")), "tasks": tasks}
                (out / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
            tasks = plan["tasks"]
            for t in tasks:
                print(f"   #{t['id']} @{t['assignee']:<7} {t['title']}")
            await r.send({"type": "plan", "summary": plan.get("summary", ""), "tasks": tasks, "usage": usage, "resumed": bool(resume and saved)})
            r.save(stage="work")

            extra = [t for t in r.state.get("extra_tasks", []) if isinstance(t, dict)] if resume else []
            if extra:  # 이어 하기: 앞서 받은 보완 요청 업무도 화면에 다시 알린다
                await r.send({"type": "rework", "round": r.state.get("rework_round", 1), "tasks": extra, "resumed": True})
            results = await self._execute(tasks + extra, r)

            # 팀장 중간 검수 → 부족한 업무는 담당자에게 보완 요청(최대 self.rework 번)
            rnd = int(r.state.get("rework_round", 0)) if resume else 0
            while rnd < self.rework:
                rnd += 1
                items = await self._check(r, goal, tasks, tasks + extra, results)
                r.save(rework_round=rnd)
                if not items:
                    break
                next_id = max(t["id"] for t in tasks + extra) + 1
                new = []
                for i, (orig, feedback, prev) in enumerate(items):
                    new.append({"id": next_id + i, "of": orig["id"], "assignee": orig["assignee"],
                                "title": f"보완: {orig['title']}", "feedback": feedback, "depends_on": [],
                                "instruction": orig["instruction"] + REWORK_NOTE.format(prev=prev[:8000], feedback=feedback)})
                extra += new
                r.save(extra_tasks=extra)
                print(f"🔁 [{self.leader.name}] 보완 요청 {len(new)}건 (#{', #'.join(str(t['of']) for t in new)})")
                await r.send({"type": "rework", "round": rnd, "tasks": [{k: v for k, v in t.items() if k != "instruction"} for t in new]})
                results.update(await self._execute(new, r))

            print(f"🔍 [{self.leader.name}] 검수 및 최종 보고 작성 중…")
            r.save(stage="review")
            await r.send({"type": "review_start", "leader": self.leader.name})
            joined = _joined(tasks, tasks + extra, results)
            report, usage = await self._call(r, self.leader, REVIEW_PROMPT.format(goal=goal, results=joined) + r.note_for(self.leader), "review")
            (out / "report.md").write_text(f"# 목표\n{goal}\n\n{report}\n", encoding="utf-8")
            await r.send({"type": "report", "report": report, "dir": str(out), "usage": usage})
            ok = True
            r.save(status="done", stage="done")
            return out
        except asyncio.CancelledError:  # 서버 종료·재시작: 다음에 이어 할 수 있게 표시만 한다
            r.save(status="interrupted")
            raise
        except Exception as e:
            (out / "error.txt").write_text(str(e), encoding="utf-8")
            r.save(status="error", error=str(e)[:500])
            await r.send({"type": "run_error", "message": str(e)})
            raise
        finally:
            await r.send({"type": "run_end", "run_id": run_id, "ok": ok, "usage": r.total()})

    async def _call(self, r: "_Run", member: Member, prompt: str, stage: str, task_id: int | None = None) -> tuple[str, dict]:
        """팀원 호출 + 일시 오류면 RETRIES 번까지 다시 시도(retry 이벤트). 사용량은 usage.json 에 남긴다."""
        attempt = 0
        while True:
            attempt += 1
            try:
                text, usage = await member.call(prompt, workdir=r.workdir, mcp=r.tools if member.can_use_tools else None)
                if not str(text).strip():
                    raise RuntimeError("빈 응답")
                r.add_usage(stage, member.name, usage, task_id, attempt)
                return text, usage
            except Exception as e:
                if attempt > RETRIES or not _retryable(e):
                    raise
                print(f"↻  {stage}{f' #{task_id}' if task_id else ''} @{member.name} 다시 시도 ({e})")
                await r.send({"type": "retry", "stage": stage, "id": task_id, "assignee": member.name,
                              "attempt": attempt + 1, "error": str(e)[:300]})
                await asyncio.sleep(RETRY_DELAY)

    async def _plan(self, r: "_Run", goal: str) -> tuple[dict, dict]:
        """계획 JSON 이 깨지면 형식을 다시 일러 한 번 더 받는다."""
        prompt = PLAN_PROMPT.format(goal=goal, roster=self.roster(bool(r.tools)), guide=self.guide_text()) + r.note_for(self.leader)
        for attempt in (1, 2):
            text, usage = await self._call(r, self.leader, prompt, "plan")
            try:
                return _parse_json(text), usage
            except ValueError:
                if attempt == 2:
                    raise
                await r.send({"type": "retry", "stage": "plan", "id": None, "assignee": self.leader.name,
                              "attempt": 2, "error": "계획 형식(JSON) 오류"})
                prompt += "\n\n주의: 설명 없이 위 형식의 JSON 하나만 출력하세요."
        raise AssertionError("unreachable")

    async def _check(self, r: "_Run", goal: str, originals: list[dict], every: list[dict],
                     results: dict[int, tuple[str, bool]]) -> list[tuple[dict, str, str]]:
        """팀장 중간 검수. 보완할 (원래 업무, 요청, 지금 결과) 목록. 검수가 실패하면 보완 없이 넘어간다."""
        latest = _latest(originals, every, results)
        try:
            text, _ = await self._call(r, self.leader, CHECK_PROMPT.format(goal=goal, results=_joined(originals, every, results)) + r.note_for(self.leader), "check")
            items = _parse_json(text).get("rework", [])
        except Exception as e:  # noqa: BLE001 — 검수 실패가 업무 전체를 멈추지 않게
            print(f"⚠️  중간 검수 생략: {e}")
            return []
        by_id = {t["id"]: t for t in originals}
        out, seen = [], set()
        for it in items if isinstance(items, list) else []:
            try:
                tid = int(it.get("id"))
            except (TypeError, ValueError, AttributeError):
                continue
            feedback = " ".join(str(it.get("feedback", "")).split())[:1000]
            if tid in by_id and tid not in seen and feedback:
                seen.add(tid)
                out.append((by_id[tid], feedback, latest[tid][0]))
        return out

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

    async def _execute(self, tasks: list[dict], r: "_Run") -> dict[int, tuple[str, bool]]:
        """선행 업무가 끝나는 즉시 착수한다. 팀원 1명은 한 번에 업무 1개만 처리한다.
        이어 하기: state.json 에 성공으로 남은 업무는 다시 하지 않고 저장된 결과를 쓴다(화면에는 바로 완료로 알린다)."""
        results: dict[int, tuple[str, bool]] = {}
        finished = {t["id"]: asyncio.Event() for t in tasks}
        locks = {name: asyncio.Lock() for name in self.members}
        state = r.state.setdefault("tasks", {})

        async def work(t: dict) -> None:
            for d in t["depends_on"]:
                if d in finished:
                    await finished[d].wait()
            member = self.members.get(t["assignee"]) or self.leader
            prev = state.get(str(t["id"]))
            if prev and prev.get("ok") and (r.out / str(prev.get("file", ""))).is_file():
                text = _task_body(r.out / prev["file"])
                await r.send({"type": "task_start", "id": t["id"], "assignee": member.name, "resumed": True})
                await r.send({"type": "task_done", "id": t["id"], "assignee": member.name, "ok": True,
                              "result": text[:RESULT_LIMIT], "resumed": True})
                results[t["id"]] = (text, True)
                finished[t["id"]].set()
                return
            async with locks[member.name]:
                context = "".join(f"\n\n[참고: #{d} 결과]\n{results[d][0]}" for d in t["depends_on"] if d in results)
                print(f"▶  #{t['id']} @{member.name} 시작")
                await r.send({"type": "task_start", "id": t["id"], "assignee": member.name})
                ok, usage = True, None
                try:
                    text, usage = await self._call(r, member, f"[업무] {t['title']}\n{t['instruction']}{context}{r.note_for(member)}", "task", t["id"])
                    print(f"✅ #{t['id']} @{member.name} 완료")
                except Exception as e:  # 한 팀원 실패가 팀 전체를 멈추지 않도록
                    ok, text = False, f"(실패: {e})"
                    print(f"❌ #{t['id']} @{member.name} 실패: {e}")
                file = f"task-{t['id']:02d}-{member.name}.md"
                (r.out / file).write_text(f"# #{t['id']} {t['title']}\n\n{text}\n", encoding="utf-8")
                state[str(t["id"])] = {"ok": ok, "file": file}
                r.save()
                await r.send({"type": "task_done", "id": t["id"], "assignee": member.name,
                              "ok": ok, "result": text[:RESULT_LIMIT], "usage": usage})
            results[t["id"]] = (text, ok)
            finished[t["id"]].set()

        await asyncio.gather(*(work(t) for t in tasks))
        return results


class _Run:
    """업무 1건의 실행 상태: 이벤트 전송, 체크포인트(state.json — 이어 하기용), 사용량 기록(usage.json)."""

    def __init__(self, out: Path, emit: Emit | None, workdir: str | None, tools: dict):
        self.out, self.emit, self.workdir, self.tools = out, emit, workdir, tools
        self.note = self.tools_note = ""
        self.state: dict = _read_json(out / "state.json") or {}
        self.usage: list[dict] = (_read_json(out / "usage.json") or {}).get("calls", [])

    async def send(self, event: dict) -> None:
        if self.emit is None:
            return
        res = self.emit(event)
        if inspect.isawaitable(res):
            await res

    def note_for(self, member: Member) -> str:
        """프롬프트 끝에 붙는 안내: 프로젝트 폴더 + (도구를 쓸 수 있는 팀원에게만) 외부 도구."""
        return self.note + (self.tools_note if member.can_use_tools else "")

    def save(self, **kw) -> None:
        self.state.update(kw, updated=datetime.now().isoformat(timespec="seconds"))
        _write_json(self.out / "state.json", self.state)

    def add_usage(self, stage: str, name: str, usage: dict, task_id: int | None, attempt: int) -> None:
        self.usage.append({"stage": stage, "id": task_id, "name": name, "attempt": attempt,
                           "at": datetime.now().isoformat(timespec="seconds"), **usage})
        _write_json(self.out / "usage.json", {"calls": self.usage, "total": self.total()})

    def total(self) -> dict:
        return summarize(self.usage)


def summarize(calls: list[dict]) -> dict:
    """사용량 합계: 호출 수·걸린 시간(ms)·입력/출력 토큰·(API 환산) 비용."""
    tot = {"calls": 0, "ms": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    for c in calls:
        tot["calls"] += 1
        for k in ("ms", "input_tokens", "output_tokens"):
            tot[k] += int(c.get(k) or 0)
        tot["cost_usd"] += float(c.get("cost_usd") or 0)
    tot["cost_usd"] = round(tot["cost_usd"], 4)
    return tot


def _retryable(e: Exception) -> bool:
    if isinstance(e, ValueError):  # 설정 오류(알 수 없는 provider 등)
        return False
    msg = str(e)
    return not any(k in msg for k in NO_RETRY)


def _latest(originals: list[dict], every: list[dict], results: dict[int, tuple[str, bool]]) -> dict[int, tuple[str, bool]]:
    """원래 업무 id → 가장 최근의 결과(성공한 보완본이 있으면 그것)."""
    latest = {t["id"]: results.get(t["id"], ("(결과 없음)", False)) for t in originals}
    for t in every:
        of = t.get("of")
        if of in latest and t["id"] in results and results[t["id"]][1]:
            latest[of] = results[t["id"]]
    return latest


def _joined(originals: list[dict], every: list[dict], results: dict[int, tuple[str, bool]]) -> str:
    latest = _latest(originals, every, results)
    return "\n\n".join(f"### #{t['id']} {t['title']} (@{t['assignee']})\n{latest[t['id']][0]}" for t in originals)


def _task_body(path: Path) -> str:
    """task-*.md 에서 머리줄(# #id 제목)을 뺀 본문."""
    text = path.read_text(encoding="utf-8")
    head, _, body = text.partition("\n\n")
    return (body if head.startswith("# #") else text).rstrip("\n")


def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"팀장 계획을 JSON으로 해석할 수 없습니다:\n{text[:500]}")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as e:
        raise ValueError(f"팀장 계획 JSON 오류: {e}\n{text[:500]}") from e
