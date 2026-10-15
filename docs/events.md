# 실시간 이벤트 프로토콜 (서버 ↔ 웹 UI)

`agentteam.Team.run(goal, emit=...)` 이 진행 단계마다 이벤트를 내보내고,
서버(`server/app.py`)가 WebSocket `/ws` 로 모든 접속자에게 그대로 브로드캐스트한다.
모든 메시지는 JSON 객체이며 `type` 필드로 구분한다.

## 서버 → 클라이언트

| type | 필드 | 의미 / UI 연출 |
|---|---|---|
| `hello` | `team`, `mock`, `snapshot` | 접속 직후 1회. 팀 구성, 모의 실행 여부, 현재(또는 마지막) 실행 상태 |
| `run_start` | `run_id`, `goal`, `project` | 새 업무 시작. `project` 는 프로젝트 폴더에서 실행하면 `{id, name, path}`, 아니면 `null` |
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
{ "run_id": "20261014-160000", "goal": "...", "project": { "id": "…", "name": "…", "path": "/절대/경로" } | null,
  "phase": "plan|work|review|done",
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
| `POST` | `/api/run` | `{ "goal": "...", "project_id"?: "..." }` 업무 시작 → `{ "run_id": "..." }`. `project_id` 가 있으면 그 프로젝트 폴더 안에서 실행(아래 '프로젝트'). 빈 목표·4,000자 초과·프로젝트 폴더가 사라졌거나 위험 경로로 바뀜 `400`, 없는 프로젝트 `404`, 진행 중 `409`, 형식 오류 `422` |
| `POST` | `/api/ask` | `{name, message, history?: [{role: "user" 또는 "assistant", content}]}` → `{name, answer, mock}`. 선택한 팀원에게 개인 질문. 빈 질문·4,000자 초과·이력 12건/24,000자 초과 `400`, 없는 팀원 `404`, 팀 업무/응답 진행 중 `409`, 연결 실패 `502`, 180초 초과 `504`. 동일 접속 키 인증 사용. |
| `GET` | `/api/runs` | 지난 실행 목록(최신순, 최대 50건) `[{run_id, goal, created, project, has_report, has_error}]` — `project` 는 프로젝트 이름 또는 `null` |
| `GET` | `/api/runs/{run_id}` | `{run_id, goal, project, plan, tasks: [{file, content}], report, error}` — `project` 는 `runs/<id>/project.json`(`{id, name, path}`, 없으면 `null`) — `plan` 은 plan.json(없으면 `null`), `tasks` 는 task-*.md 번호순, `report`·`error` 는 없으면 `null`. 없는 id 는 `404` |
| `GET` | `/api/outside/geocode?q=` | 바깥 풍경: 주소·장소 검색(OpenStreetMap Nominatim) → `{results: [{lat, lng, label, kind, exact}]}`(최대 5개, `exact: false` 는 도로·지역처럼 넓은 결과). 좌표("37.5665, 126.978")는 검색 없이 그대로 1개. 빈 값·200자 초과 `400`, 검색 서버 연결 실패 `502` |
| `GET` | `/api/outside/map?lat=&lng=&r=350&w=32&d=22&turn=0` | 반경 `r`(100~600m) 지도를 사무실 좌표로 다듬은 장면(형식은 `web/outside.js` 머리말). 처음 한 번 Overpass 에서 받아 `cache/outside/` 에 두고 이후는 캐시(인터넷 없이). 값 오류 `400`, 지도 서버 실패 `502` |
| `GET`·`PUT`·`DELETE` | `/api/outside/place` | 사무실 위치 `{place: {lat, lng, label, floor, show, turn, r}}`(없으면 `null`). 휴대폰 등 다른 기기도 같은 위치를 쓴다. 형식 오류 `422` |

- `created` 는 ISO 시각 문자열, `has_report`·`has_error` 는 report.md·error.txt 존재 여부.

### 프로젝트(폴더 접근)

사용자가 고른 로컬 폴더에 AI 팀의 전체 접근(읽기·만들기·고치기·지우기)을 허락하고, 업무를 그 폴더 안에서 실행한다.
등록 목록은 저장소 루트 `projects.json`(Git 제외) `[{id, name, path, granted_at, access: "full"}]`. 모두 `/api` 접속 키 검사를 받는다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/fs/list?path=&hidden=0` | 폴더 고르기: `{path, parent, dirs: [{name, path, has_children}], truncated, roots: [{name, path}], selectable, reason}`. 하위 **폴더 이름만**(파일 이름·내용은 내보내지 않음), 최대 500개. `path` 가 비면 홈. 점(.)으로 시작하는 폴더는 `hidden=1` 일 때만. `roots` 는 홈·데스크탑·문서·다운로드(있는 것만)·상위 폴더. `selectable: false` 면 `reason` 에 등록할 수 없는 이유. 상대 경로·없는 폴더·권한 없음 `400` |
| `POST` | `/api/fs/pick` | 이 컴퓨터의 **운영체제 폴더 선택 창**(macOS Finder `osascript choose folder`, Windows 탐색기 `FolderBrowserDialog`, Linux `zenity`·`kdialog`)을 띄우고 고를 때까지 기다린다(최대 10분). 브라우저가 서버와 같은 컴퓨터일 때만(루프백이거나 접속 주소가 서버 주소와 같음) 띄우고, 아니면(휴대폰 등) `{native: false}` → 웹 화면은 `/api/fs/list` 폴더 고르기 창을 쓴다. 고르면 `{native: true, path}`, 취소 `{native: true, cancelled: true}`, 등록할 수 없는 폴더 `{native: true, path, error}`. 창이 이미 열려 있으면 `409`. 접속 키 필요 |
| `GET` | `/api/projects` | `{projects: [...]}` |
| `POST` | `/api/projects` | `{path, name?, confirm: true}` → `{project}`. `confirm` 은 사용자가 동의 창에서 '전체 접근 허락'에 체크했다는 뜻이며 없으면 `400`. 같은 폴더를 다시 추가하면 새로 만들지 않고 이름·허락 시각만 갱신 |
| `PATCH` | `/api/projects/{id}` | `{name}` 이름 바꾸기(1~80자, 빈 이름 `400`) → `{project}`. 없는 id `404` |
| `DELETE` | `/api/projects/{id}` | 접근 해제(목록에서만 지움, 폴더·파일은 그대로) → `{ok: true}`. 없는 id `404` |

- 등록 거부(`400`, 한국어 사유): 절대 경로가 아님, 없음, 폴더가 아님, 디스크 최상위(`/`)·`/Volumes`·`/Users`·`/home` 자체·홈 폴더 자체,
  시스템 폴더(`/System`·`/Library`·`/usr`·`/bin`·`/sbin`·`/etc`·`/private`·`/var`·`/tmp`·`/Applications`·`/opt` 등과 그 안, 단 `/tmp/이름`·사용자 임시 폴더 안쪽 작업 폴더는 허용),
  `~/Library`·`~/.Trash`, 경로 어디에든 `.ssh`·`.gnupg`·`.aws`·`.kube`·`.docker`·`.config`·`Keychains`·`.claude`·`.codex`·`.gemini` 같은 자격 증명·설정 폴더가 있는 경우, 이 앱의 `.venv`.
  심볼릭 링크는 실제 위치로 바꿔 검사·저장한다. 업무 시작 때(`POST /api/run`) 다시 검사한다.
- 프로젝트로 실행하면 `runs/<id>/project.json` 에 `{id, name, path}` 를 남기고, 팀원은 그 폴더를 작업 폴더로 삼는다
  (claude-cli: 파일 도구 Read·Edit·Write·Glob·Grep 만, 허용 규칙은 그 폴더 안, Bash·웹·MCP 없음, 최대 30턴 / codex-cli: `--sandbox workspace-write` /
  antigravity-cli: `--mode accept-edits --add-dir` / gemini-cli: `--approval-mode auto_edit`). 지시문에 폴더 경로와 '폴더 밖은 건드리지 말 것'을 붙인다.
  API provider(anthropic·openai·google)는 파일 도구가 없어 안내 문구만 받는다. 모의 실행은 결과에 폴더 이름만 적고 파일은 건드리지 않는다.
- 웹 UI 는 고른 프로젝트 id 를 `localStorage`(`agentOffice.project`)에 기억하고 업무 지시 때 `project_id` 로 보낸다.

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
