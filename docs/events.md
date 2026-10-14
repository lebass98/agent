# 실시간 이벤트 프로토콜 (서버 ↔ 웹 UI)

`agentteam.Team.run(goal, emit=...)` 이 진행 단계마다 이벤트를 내보내고,
서버(`server/app.py`)가 WebSocket `/ws` 로 모든 접속자에게 그대로 브로드캐스트한다.
모든 메시지는 JSON 객체이며 `type` 필드로 구분한다.

## 서버 → 클라이언트

| type | 필드 | 의미 / UI 연출 |
|---|---|---|
| `hello` | `team`, `mock`, `snapshot` | 접속 직후 1회. 팀 구성, 모의 실행 여부, 현재(또는 마지막) 실행 상태 |
| `run_start` | `run_id`, `goal` | 새 업무 시작 |
| `plan_start` | `leader` | 팀장이 계획 수립 시작 → 화이트보드로 이동, 필기 |
| `plan` | `summary`, `tasks[]` | 계획 확정 → 회의 소집, 업무 배정 |
| `task_start` | `id`, `assignee` | 팀원이 업무 착수 → 자리로 가서 타이핑 |
| `task_done` | `id`, `assignee`, `ok`, `result` | 업무 완료(또는 실패) |
| `review_start` | `leader` | 팀장 검수 시작 → 팀원들이 보고하러 이동 |
| `report` | `report`(마크다운), `dir` | 최종 보고서 |
| `run_error` | `message` | 실행 중 오류(계획 JSON 해석 실패, API 오류 등) |
| `run_end` | `run_id`, `ok` | 실행 종료(성공/실패 무관 항상 마지막) |
| `pong` | — | 클라이언트 `ping` 에 대한 응답 |

### 공통 구조

```jsonc
// team (hello, GET /api/team)
{ "leader": "claude",
  "members": [{ "name": "claude", "provider": "anthropic", "model": "claude-opus-5-5", "role": "팀장 겸 퍼블리셔..." }] }

// task (plan.tasks[])
{ "id": 1, "assignee": "gemini", "title": "요구사항 분석", "instruction": "...", "depends_on": [] }

// snapshot (hello)
{ "run_id": "20261014-160000", "goal": "...", "phase": "plan|work|review|done",
  "summary": "...", "tasks": [{ ...task, "state": "todo|doing|done|failed", "result": "..." | null }],
  "report": "..." | null, "ok": true | false | null, "error": "..." | null }
```

- `snapshot` 은 서버가 켜진 뒤 **실행이 한 번도 없었을 때만 `null`** 이다. 그 밖에는 진행 중인 실행,
  없으면 **마지막으로 끝난 실행**의 상태다. `phase: "done"` 이면 서버는 쉬는 중(새 업무를 받을 수 있음)이다.
- `ok` 는 실행 중 `null`, `run_end` 뒤에 `true`/`false`. `error` 는 `run_error` 가 있었으면 그 메시지, 없으면 `null`.
- `tasks[].result` 는 끝나기 전에는 `null`, 끝나면 `task_done.result` 와 같다.
- `task_start` / `task_done` 은 의존성 순서를 지키되 서로 다른 팀원 것은 **동시에** 올 수 있다.
  한 팀원은 한 번에 업무 1개만 한다. 실패한 업무에 의존하는 업무도 시작된다.
- `task_done.result` 는 최대 20,000자로 잘린다. 전문은 `runs/<run_id>/task-*.md`.
- `assignee` 가 팀에 없는 이름이면 서버가 팀장 이름으로 바꿔서 보낸다.

## 클라이언트 → 서버

### WebSocket `/ws`

- `{"type": "ping"}` → 서버가 `{"type": "pong"}` 으로 응답. 그 밖의 메시지(바이너리·JSON 아님·배열 등)는 무시한다.
- 웹 UI 는 20초마다 ping 을 보내고, 90초 동안 아무 메시지가 없으면 끊고 다시 접속한다.

### HTTP

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/team` | 팀 구성 (`team` 과 같은 형식) |
| `POST` | `/api/run` | `{ "goal": "..." }` 업무 시작 → `{ "run_id": "..." }`. 빈 목표·4,000자 초과 `400`, 진행 중 `409`, 형식 오류 `422` |
| `GET` | `/api/runs` | 지난 실행 목록(최신순, 최대 50건) `[{run_id, goal, created, has_report, has_error}]` |
| `GET` | `/api/runs/{run_id}` | `{run_id, goal, plan, tasks: [{file, content}], report, error}` — `plan` 은 plan.json(없으면 `null`), `tasks` 는 task-*.md 번호순, `report`·`error` 는 없으면 `null`. 없는 id 는 `404` |

- `created` 는 ISO 시각 문자열, `has_report`·`has_error` 는 report.md·error.txt 존재 여부.

## WebSocket 종료 코드

| 코드 | 의미 | 클라이언트 동작 |
|---|---|---|
| `4401` | 접속 키 없음·틀림 | 재시도하지 않고 '접속 키 필요' 상태 + 키 입력 창 (데모 모드로 가지 않음) |
| `1013` | 느린 접속 정리(미전송 1,000건 초과 또는 1건 전송 15초 초과) | 재연결 → 새 `hello.snapshot` 으로 상태 복구 |
| `1012` | 서버 종료(재시작) | 점점 늦추며(최대 15초) 재연결 |

## 인증 (`--lan` 모드)

LAN 공개 시 서버가 접속 키를 쓴다(`.env` 의 `ACCESS_KEY`, 없으면 실행할 때마다 새로 생성).
클라이언트는 URL `?key=...` 로 받은 키(또는 키 입력 창에 넣은 키)를 `localStorage` 에 저장하고 주소창에서 지운다.

- HTTP `/api/*` 는 `X-Access-Key` 헤더로만 인증한다(`?key=` 는 받지 않음). 없거나 틀리면 `401`.
- WebSocket 은 `/ws?key=...` 로만 인증한다(헤더는 받지 않음). 없거나 틀리면 접속 후 바로 `4401` 로 닫는다.
- 정적 파일(`web/`)은 키 없이 열린다. 로컬(127.0.0.1) 전용 실행 시에는 키가 없다.

## 개발 모드 채널 (`serve.py` 기본 켜짐, `--no-dev` 로 끔)

작업 중 바뀐 파일이 항상 바로 보이게 하는 장치. 웹 UI 코드(app.js)는 관여하지 않는다.

- 서버가 `/`·`/index.html` 을 줄 때 `</body>` 앞에 `<script src="/__dev/livereload.js"></script>` 를 끼워 넣는다.
- WebSocket `/__dev/ws` (접속 키 불필요, 수신 전용):
  - 접속 즉시 `{"type": "hello", "boot": "<서버 프로세스 식별자>"}`
  - `web/` 안의 파일이 바뀌면 `{"type": "reload", "files": ["app.js", …]}` → 페이지가 `location.reload()`
  - 끊기면 0.8초 간격으로 재접속하고, 다시 받은 `boot` 가 이전과 다르면(서버 재시작) 새로고침한다.
- 모든 HTTP 응답에 `Cache-Control: no-store` 를 붙여 브라우저가 옛 파일을 쓰지 않게 한다.
- `*.py`·`team.toml` 이 바뀌면 uvicorn 이 서버를 재시작한다(진행 중이던 업무는 중단, `/ws` 는 1012 로 닫힘 → 클라이언트가 재접속).
