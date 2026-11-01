# 실시간 이벤트 프로토콜 (서버 ↔ 웹 UI)

`agentteam.Team.run(goal, emit=...)` 이 진행 단계마다 이벤트를 내보내고,
서버(`server/app.py`)가 WebSocket `/ws` 로 모든 접속자에게 그대로 브로드캐스트한다.
모든 메시지는 JSON 객체이며 `type` 필드로 구분한다.

## 서버 → 클라이언트

| type | 필드 | 의미 / UI 연출 |
|---|---|---|
| `hello` | `team`, `mock`, `snapshot` | 접속 직후 1회. 팀 구성, 모의 실행 여부, 현재(또는 마지막) 실행 상태 |
| `run_start` | `run_id`, `goal`, `project`, `tools`, `resumed` | 새 업무 시작. `project` 는 프로젝트 폴더에서 실행하면 `{id, name, path}`, 아니면 `null`. `tools` 는 이번 업무에 허락된 외부 도구(MCP 서버) 이름 목록. `resumed: true` 면 끊긴 업무를 이어 하는 것(같은 `run_id`) |
| `plan_start` | `leader` | 팀장이 계획 수립 시작 → 자기 자리에서 정리(이어 하기로 저장된 계획을 쓰면 오지 않는다) |
| `plan` | `summary`, `tasks[]`, `usage`, `resumed` | 계획 확정 → 회의실 발표, 업무 배정. `usage` 는 계획 호출 사용량(이어 하기면 `null`) |
| `task_start` | `id`, `assignee` | 팀원이 업무 착수 → 자리로 가서 타이핑 |
| `task_done` | `id`, `assignee`, `ok`, `result`, `usage`, `resumed`? | 업무 완료(또는 실패). `usage`: `{ms, provider, model, input_tokens?, output_tokens?, cost_usd?, turns?}`(재시도 끝에 실패하면 `null`). 이어 하기에서 이미 끝난 업무는 `task_start`·`task_done` 에 `resumed: true` 로 바로 온다 |
| `retry` | `stage`(plan·task·check·review), `id`, `assignee`, `attempt`, `error` | 일시 오류(시간 초과·빈 응답 등)로 다시 시도. 기본 1번(`AGENT_RETRIES`), 설치·로그인·키 문제는 다시 하지 않는다. 계획 JSON 이 깨져도 1번 다시 받는다 |
| `rework` | `round`, `tasks[]`(`id`, `of`, `assignee`, `title`, `feedback`, `depends_on`), `resumed`? | 팀장 중간 검수 → 보완 요청. 새 업무(`보완: 원래 제목`, `of` = 원래 업무 id)로 이어서 `task_start`/`task_done` 이 온다. 최대 횟수는 team.toml `[leader] rework`(기본 1, 0이면 끔, `AGENT_REWORK` 로 덮어씀). 최종 보고에는 성공한 보완본이 원래 업무 자리에 들어간다 |
| `review_start` | `leader` | 팀장 검수 시작 → 팀원들이 보고하러 이동 |
| `report` | `report`(마크다운), `dir`, `usage` | 최종 보고서 |
| `run_error` | `message` | 실행 중 오류(계획 JSON 해석 실패, API 오류 등) |
| `run_end` | `run_id`, `ok`, `usage` | 실행 종료(성공/실패 무관 항상 마지막). `usage` 는 이번 실행 합계 `{calls, ms, input_tokens, output_tokens, cost_usd}`. 결과 알림이 켜져 있으면 이때 웹훅을 보낸다(서버 종료로 끊긴 경우는 보내지 않음) |
| `pong` | — | 클라이언트 `ping` 에 대한 응답 |

### 공통 구조

```jsonc
// team (hello, GET /api/team)
{ "leader": "claude",
  "members": [{ "name": "claude", "provider": "anthropic", "model": "claude-opus-5-5", "role": "팀장 겸 퍼블리셔...",
                "ready": true,   // CLI 설치·API 키 준비 여부(로그인까지는 보지 않음). 모의 실행이면 항상 true
                "hint": "" }] }  // 준비 안 됐을 때 할 일(예: "`claude` 명령을 찾을 수 없어요. …"). 화면은 에이전트 카드·팀원 얼굴에 연결 표시로 보여 준다

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
| `GET` | `/api/team/config` | 에이전트 설정 화면용: `{config: {leader, guide, members: [{name, provider, model, role}]}, providers: [{id, brand, label, kind, models, ready, hint}], mock, limits}`. 모의 실행이어도 team.toml 에 적힌 실제 provider 를 돌려준다. `ready` 는 CLI 설치·API 키 준비 여부 |
| `PUT` | `/api/team/config` | `{config}` 를 검사해 team.toml 에 쓴다(맨 위 설명 주석 유지, 바로 전 파일은 `team.toml.bak`). 팀을 그 자리에서 다시 꾸리고 모든 접속자에게 `hello`(새 `team`, 현재 `snapshot`)를 다시 보낸다 → `{ok, team, config}`. 이름 `^[a-z][a-z0-9_-]{0,19}$`·중복 금지, provider 는 등록된 것만, claude-cli 모델은 opus·sonnet·haiku, 하는 일 1~300자, 팀장은 팀원 중, 배정 원칙 2,000자, 팀원 1~12명. 틀리면 `400`(파일 그대로), 업무·대화 진행 중 `409`. 개발 모드에서는 team.toml 저장으로 서버가 재시작되어 재접속 hello 로도 반영된다 |
| `POST` | `/api/run` | `{ "goal": "...", "project_id"?: "...", "tools"?: ["mcp 서버 이름"] }` 업무 시작 → `{ "run_id": "..." }`. `project_id` 가 있으면 그 프로젝트 폴더 안에서 실행(아래 '프로젝트'). `tools` 는 사용자가 확인 창에서 이번 업무에 허락한 외부 도구 — claude-cli 팀원에게만 `--mcp-config`·`--strict-mcp-config` 로 붙고 그 서버 도구만 미리 허용된다(없는 이름 `400`). n8n 등 외부 자동화도 이 주소로 업무를 시작할 수 있다(`--lan` 이면 `X-Access-Key` 헤더). 빈 목표·4,000자 초과·프로젝트 폴더가 사라졌거나 위험 경로로 바뀜 `400`, 없는 프로젝트 `404`, 진행 중 `409`, 형식 오류 `422` |
| `POST` | `/api/ask` | `{name, message, history?: [{role: "user" 또는 "assistant", content}]}` → `{name, answer, mock}`. 선택한 팀원에게 개인 질문. 빈 질문·4,000자 초과·이력 12건/24,000자 초과 `400`, 없는 팀원 `404`, 팀 업무/응답 진행 중 `409`, 연결 실패 `502`, 180초 초과 `504`. 동일 접속 키 인증 사용. |
| `GET` | `/api/runs` | 지난 실행 목록(최신순, 최대 50건) `[{run_id, goal, created, project, has_report, has_error}]` — `project` 는 프로젝트 이름 또는 `null` |
| `GET` | `/api/runs/resumable` | 이어 할 수 있는 실행(끊김 `interrupted`·오류 `error`, 보고서 없음, 최근 7일, 최대 5건) `{runs: [{run_id, goal, created, status, stage, done, total, project, error, tools}]}`. 업무 진행 중이면 빈 목록. 서버가 켜질 때 `state.json` 이 `running` 으로 남은 실행은 `interrupted` 로 바뀐다 |
| `POST` | `/api/runs/{run_id}/resume` | `{tools?}` → 저장된 계획(plan.json)을 다시 쓰고 `state.json` 에 성공으로 남은 업무는 건너뛰며 이어 한다. 같은 `run_id`. 프로젝트 폴더를 더 쓸 수 없으면·이어 할 상태가 아니면 `400`, 진행 중 `409` |
| `POST` | `/api/runs/{run_id}/dismiss` | 이어 하기 목록에서 뺀다(`status: dismissed`) |
| `GET` | `/api/usage?days=7` | 최근 N일(1~90) 사용량 `{days, runs, total, by_member, by_day, by_stage, by_provider}` (각 값은 `{calls, ms, input_tokens, output_tokens, cost_usd}`). `runs/<id>/usage.json` 을 모은 것. 토큰·비용은 CLI 가 알려 준 만큼(claude-cli 는 정확, 비용은 API 환산값) |
| `GET` | `/api/notify` | 결과 알림 설정 `{url, enabled, has_secret, last}` (비밀 키는 내보내지 않음) |
| `PUT` | `/api/notify` | `{url, enabled, secret?}` 저장(`cache/notify.json`, Git 제외). `secret` 생략=그대로, `""`=지움. http(s) 주소만 |
| `POST` | `/api/notify/test` | 시험 알림 1건 보내기 → `{ok, status, error}` |
| `GET` | `/api/notion` | 노션 업무 기록 상태 `{enabled, last: {at, run_id, ok, url, error}}`. `.env` 의 `NOTION_TOKEN`·`NOTION_DATABASE_ID` 가 둘 다 있으면 켜지고, 업무가 끝날 때마다(끊김 제외, 성공·실패 모두) 데이터베이스에 한 쪽(지시·계획·업무 분담·팀원별 결과·최종 보고서·사용량)을 쌓는다(`server/notion.py`) |
| `GET` | `/api/app/latest` | 휴대폰 앱 최신 릴리즈 `{versionCode, versionName, notes, size, sha256, released_at}`(`dist/latest.json`, `scripts/release.py` 가 만든다). 없으면 `404` |
| `GET` | `/api/app/apk` | 최신 APK(`dist/agent-office.apk`, `application/vnd.android.package-archive`). 앱이 새 버전이면 받아 설치 창을 띄운다. 없으면 `404` |
| `GET` | `/api/tools` | 외부 도구(MCP 서버) 목록 `{servers: [{name, description, kind(stdio·http·sse), target}], members: [도구를 쓸 수 있는 팀원]}` — env·headers 는 내보내지 않음 |
| `PUT` | `/api/tools/{name}` | `{config, description}` 등록·수정(`mcp-servers.json`, Git 제외, Claude Code mcpServers 형식). **서버가 켜진 컴퓨터에서만**(아니면 `403`) |
| `DELETE` | `/api/tools/{name}` | 삭제(같은 컴퓨터에서만). 없으면 `404` |
| `GET` | `/api/runs/{run_id}` | `{run_id, goal, project, plan, usage, status, tasks: [{file, content}], report, error}` — `project` 는 `runs/<id>/project.json`(`{id, name, path}`, 없으면 `null`) — `plan` 은 plan.json(없으면 `null`), `tasks` 는 task-*.md 번호순, `report`·`error` 는 없으면 `null`. 없는 id 는 `404` |
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

## 브레인 모드 (`/api/brain*`, server/brain.py · web/brain.js)

기본 공간인 브레인 모드의 업무 화면 데이터. 다른 `/api` 와 같이 `--lan` 이면 접속 키가 필요하다. 설정은 `cache/brain.json`(Git 제외).

| 요청 | 설명 |
|---|---|
| `GET /api/brain` | 설정 전체 `{shortcuts, routines, pins, calendars, events}`. 캘린더는 주소(`url`) 대신 `host` 만 준다 |
| `PUT /api/brain/{kind}` `{items: [...]}` | 목록 하나를 통째로 바꾼다. kind = `shortcuts`·`routines`·`pins`·`calendars`·`events`. 잘못된 값은 400 + 한국어 사유 |
| `POST /api/brain/routines/{id}/check` `{day: "YYYY-MM-DD", done}` | 확인 체크 루틴의 그날 체크(최근 100일 보관) |
| `GET /api/brain/calendar?days=14&refresh=0` | Claude 의 Notion 캘린더 연결(Google 캘린더 포함, server/calconn.py, 15분 재사용·`conn:{enabled,loading,error,count,at}`)+구독 캘린더(iCal)+직접 넣은 일정을 합친 `{events: [{title,start,end,allDay,where,src,cal,star?}], status: [{id,ok,count|error}]}` |
| `GET /api/brain/mail?refresh=0` | 쌓아 둔 업무 메일(server/gmail.py) 최근 30일(`GMAIL_DAYS`). 설정이 없으면 `{enabled:false}`. `{enabled, source, user, items:[{id,thread,from,addr,subject,date,unread,important,starred,summary,tag: reply·important·info,due,work}], total, added(이번에 더한 수), days, error, note, pending, loading, at}`. 처음 한 번 그 기간 치를 받고(기간을 늘리면 한 번 더 거슬러), 그 뒤엔 10분마다(`refresh=1` 이면 바로) 마지막으로 받은 뒤의 새 메일만 더한다. 제목에 한글이 없거나 업무가 아닌 메일(광고·뉴스레터·알림·개인)은 쌓지 않는다(`cache/brain-mail-store.json`) |
| `GET /api/brain/meetings?refresh=0` | Notion 회의록(server/meetings.py): `claude` CLI 의 Notion 커넥터로 읽기만(검색·페이지 읽기·회의록·DB 조회). 지정(`meetings` 목록 [{name, ref: 노션 주소·검색어}])이 없으면 '회의'로 찾는다. `{enabled, items:[{id,source,title,url,date,attendees,points[],actions[{text,owner,done}]}], loading, custom, error, at}` — 30분 재사용, 지정이 바뀌면 다시 읽음 |
| `POST /api/brain/meetings/check` `{key: "<페이지ID>:<번호>", done}` | 회의록 할 일 체크(이 앱에만 저장, 노션은 바꾸지 않음) |
| `POST /api/brain/shortcuts/vercel` | Vercel 프로젝트(개인+팀)를 바로가기로 더한다(같은 주소는 건너뜀). `{…설정, added, found}`. 토큰: `.env` 의 `VERCEL_TOKEN` → 없으면 Vercel CLI 로그인. 실패 400 + 안내 |
| `GET /api/brain/skills/file?ai=&name=` · `PUT /api/brain/skills/file` `{ai,name,content?,label?,input?}` | SKILL.md 읽기·저장(직접 만든 스킬만 저장, 설치한 것은 400) · 카드 이름·입력 받기(`skillnotes`) |
| `POST /api/brain/skills/run` `{ai,name,input}` · `GET /api/brain/skills/runs` · `GET /api/brain/skills/runs/{id}/file?path=` | 스킬 실행(server/skills.py): 전용 폴더 `runs/skills/<id>/` 에서 claude(`/스킬 입력`) 또는 codex. 허용: 그 폴더 읽기·쓰기·스킬 폴더 읽기·웹·메일/노션/캘린더 읽기(셸 없음). 동시 2개, 기록 30개(`cache/brain-skill-runs.json`), 결과 파일 받기 |
| `GET /api/brain/vercel?sync=0` | Vercel 연결 상태 `{connected,user,via: cli|env,error,synced,added}`. `sync=1` 이면 6시간마다 새 프로젝트를 바로가기로 자동 추가 |
| `GET /api/brain/skills` | `{skills: [{ai: claude|gpt|gemini, name, desc, mine, path, hint, label, input}], labeling}` — 직접 만든 것(mine)이 먼저. 카드 이름(label)이 없는 스킬은 뒤에서 한국어 짧은 이름을 지어 저장(labeling) |

- 항목 모양: 바로가기 `{name,url,abbr,color}` · 루틴 `{name,kind: check|auto,at:"HH:MM",days:[mon..sun],on,goal(auto 일 때 필수),checks}` ·
  중요 일정 `{title,when(ISO),note}` · 캘린더 `{name,kind: google|phone|notion|other,url,on}`(이미 있는 캘린더는 `url` 을 빼고 보내면 기존 주소 유지) ·
  일정 `{title,start,end,where,star}` · 회의 지정 `{name, ref}`(ref: notion.so 주소 또는 검색어). `id` 를 그대로 보내면 같은 항목으로 본다.
- 캘린더 주소는 `http(s)`·`webcal`(→https)만, 받은 것은 10분 동안 재사용. 같은 제목·같은 시작 시각 일정은 하나로 합친다.
- Gmail: ① `claude` CLI 의 claude.ai Gmail 커넥터(읽기 도구 `search_threads`·`get_thread` 만 허용, 읽기+요약 한 번에, 응답 `source: "claude"`·`loading`) 또는 ② `.env` 의 `GMAIL_USER`·`GMAIL_APP_PASSWORD`(앱 비밀번호)로 IMAP 읽기 전용(`source: "imap"`, 요약은 팀원·`cache/brain-mail.json`). `GMAIL_SOURCE=auto` 면 ② 가 로그인에 실패할 때 ① 로 넘어가고 `note` 로 알린다. `.env` 는 요청마다 다시 읽는다. ① 의 마지막 목록은 `cache/brain-mail-last.json`.
- 자동 실행 루틴(`kind: auto`)의 예약 실행은 다음 단계(아직 API 없음).

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
- 개발 모드를 끄면(`--no-dev`) `web/` 정적 파일에만 `Cache-Control: no-cache` 를 붙인다: 브라우저가 매번 ETag·Last-Modified 로 재검증하고 바뀌지 않았으면 `304`. `/api/*`·WebSocket 은 그대로.
- `*.py`·`team.toml` 이 바뀌면 uvicorn 이 서버를 재시작한다(진행 중이던 업무는 중단, `/ws` 는 1012 로 닫힘 → 클라이언트가 재접속).
