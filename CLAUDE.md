# Agent — 멀티 에이전트 팀 (GPT · Claude · Gemini)

## 구조
- `team.toml` : 팀원·역할·모델 설정 (팀장 지정 포함). 웹 '에이전트' 화면의 [설정]·[에이전트 추가](`web/team-settings.js` → `server/teamcfg.py`, `GET/PUT /api/team/config`)로도 고친다. 테스트는 실제 team.toml 을 쓰지 말고 임시 사본으로(tests/test_teamcfg.py)
- `agentteam/providers.py` : 사별 API 래퍼 (anthropic / openai / google / mock)
- `agentteam/team.py` : 계획 → 의존순 병렬 실행 → 검수 보고
- `main.py` : CLI (`run`, `ask`, `team`, `--mock`)
- `server/app.py` : 웹 서버 (FastAPI). REST `/api/*` + WebSocket `/ws` 실시간 중계 + `web/` 정적 파일
- `server/projects.py` : 프로젝트(폴더 접근) — 폴더 고르기 목록·위험 경로 거부·`projects.json` 저장. UI 는 `web/projects.js`·`projects.css`
- `serve.py` : 웹 서버 실행기 (`--mock`, `--lan`, `--host`, `--port`, `--config`)
- `web/` : 웹 UI (index.html, app.js, style.css). 서버가 없으면 데모 모드, 3D 를 못 쓰면 목록 모드
- `web/vendor/` : three.js r128 · OrbitControls(0.128.0) · marked 12.0.2 · DOMPurify 3.1.6 고정 사본 (인터넷 없는 Wi-Fi 에서도 동작. CDN 으로 바꾸지 말 것)
- `web/sprite-chars.js` : 그림 캐릭터(시트 그림을 세운 2.5D 빌보드)·표정 아바타. 시트에 없는 팀원은 `characters.js` 의 3D 캐릭터
- `web/sprites/` : 캐릭터 시트에서 자른 아틀라스·표정 띠·좌표표(`sprites.js`). `scripts/sprites/cut.py` 가 만든다(직접 고치지 말 것, docs/characters.md)
- `docs/ref/` : 사용자 제공 참고 이미지(캐릭터 시트·다크 모드 사무실)
- 사무실 조명(낮↔밤)은 기본으로 실제 일출·일몰을 따른다: `web/decor.js` 의 `Decor.sun`(해 고도 +5°→-5° 사이 약 40~50분에 걸쳐 섞임, 위치는 설정의 '현재 위치' 또는 기기 시간대 대표 도시).
  화면(패널) 테마와는 따로이며, 설정 '사무실 조명'에서 '화면 테마'를 고르면 예전처럼 테마를 따른다. 점검: 브라우저 콘솔에서 `OFFICE.now = new Date("2026-10-14T17:55:00+09:00"); applyTheme(true)`
- 바깥 풍경: 설정 '사무실 위치'에 주소를 넣으면 실제 주변 건물·도로·공원·철길(OpenStreetMap)을 사무실 둘레에 3D 로 세운다.
  `server/outside.py`(주소 검색·지도 받기·사무실 좌표로 다듬기) → `/api/outside/*`(docs/events.md) → `web/outside.js`·`outside.css`.
  사무실을 확대해 보면 숨고(예전 모습), 축소하면 건물이 솟아오른다. outside.js 는 app.js 를 고치지 않고 전역 이름·`setOfficeLight`·`VIEWS.settings` 를 감싸 붙는다.
  지도 원본·사무실 위치(실제 주소)는 `cache/outside/`(Git 제외)에만 둔다. 실제 주소를 커밋·문서·테스트에 넣지 말 것
- `android/` : 휴대폰 앱(APK) — 웹 UI 를 띄우는 WebView 껍데기. AI 는 컴퓨터의 `serve.py --lan` 이 구독 CLI 로 실행하고, 휴대폰은 Tailscale 이름(`android/local.properties` 의 `serverHost=`, Git 제외)으로 접속한다.
  릴리즈는 `python scripts/release.py -n "변경 내용"` 한 번: 버전 올림(build.gradle)→빌드→`dist/agent-office.apk`·`latest.json`→`android/CHANGELOG.md`→Drive `Agent/` 복사.
  앱은 열 때 `/api/app/latest` 를 보고 새 버전이면 `/api/app/apk` 를 받아 설치 창을 띄운다(뒤로 가기 메뉴 '업데이트 확인'). 서명은 이 Mac 의 debug 키라 다른 컴퓨터에서 빌드하면 업데이트 설치가 거부된다.
  기본 주소의 접속 키는 빌드 때 `.env` 의 `ACCESS_KEY` 에서 읽으므로 APK·`dist/` 는 Git 제외(커밋 금지)
- `scripts/launch.py` : 실행 메뉴(모든 OS 공용), `scripts/bootstrap.sh` : macOS·Linux 가상환경 준비
- 노션 업무 기록(`server/notion.py`): `.env` 의 `NOTION_TOKEN`(노션 내부 통합 토큰)·`NOTION_DATABASE_ID` 가 있으면 업무가 끝날 때마다 '에이전트 오피스 업무 기록' DB 에 한 쪽씩 쌓는다
  (지시·계획·업무 분담·팀원별 결과·최종 보고서). DB 를 그 통합에 '연결'해야 한다. 상태는 `GET /api/notion`
- `docs/events.md` : 서버 ↔ 웹 UI 이벤트 프로토콜 (변경 시 서버·UI 함께 수정)
- 팀 실행 보강(`agentteam/team.py`): 일시 오류 자동 재시도(`retry`), 팀장 중간 검수 → 보완 요청(`rework`, team.toml `[leader] rework`),
  `runs/<id>/state.json` 체크포인트로 끊긴 업무 이어 하기, `usage.json` 사용량 기록. 화면은 `web/extras.js`(이어 하기 카드·분석 사용량·
  설정 '결과 알림(n8n·웹훅)'·'외부 도구(MCP)'·업무 지시 전 도구 허락 창). 서버는 `server/notify.py`(cache/notify.json)·`server/mcptools.py`(mcp-servers.json, 둘 다 Git 제외)
- 공간 테마(docs/space-themes.md): **모양만 다르고 구조는 같다.** 공통 규격 `web/theme-kit.js`(작업석 12·회의 12·커피 12·방 7·조연 3·손님 3) · 테마 지도 `Decor`(사무실 `web/decor.js`, 동물원 `web/zoo-theme.js`) ·
  공통 조연 엔진 `web/life.js`(디자인팀장·본부장·경리팀장, 캐릭터끼리 대화, 손님 산책, 배경 생물) + 테마 내용 `web/life-office.js`·`web/life-zoo.js`. 팀원 외형은 `app.js` 의 `LOOKS` 어댑터.
  동물원 모양: `web/zoo-animals.js`(동물 12종+조연 3종) · `web/zoo-friends.js`(친구 3종) · `web/zoo-forest.js`(바깥 숲). 새 테마는 docs/space-themes.md '새 테마 더하기'를 따른다. 조연·손님은 D.names 에 넣지 않는다
- **브레인 모드(기본 공간)**: `web/brain.js`·`brain.css` + `server/brain.py`(`/api/brain*`, docs/events.md '브레인 모드'). 시안 A '커맨드 센터'(`web/brain-preview/`).
  테마 목록 첫 번째(`theme-kit.js` 의 `brain`, `flat: true`)라 3D 를 켜지 않고 목록 모드 위에 업무 화면을 띄운다(업무 지시·팀 상태·로그는 그대로).
  중요 일정 플로팅·브리핑·통합 캘린더(iCal 구독+직접 입력)·진행 중인 업무·루틴(확인 체크)·바로가기·스킬 목록. 설정은 `cache/brain.json`(Git 제외, 캘린더 주소는 화면에 안 보냄).
  메일 요약(`server/gmail.py`): 업무 메일만(한글 제목·광고 제외) 최근 3주를 쌓고 '다시 불러오기'·10분마다 새 것만 더한다(`cache/brain-mail-store.json`). 기본은 `claude -p` + claude.ai Gmail 커넥터(읽기 도구 2개만 `--allowedTools`, 쓰기 도구는 허용하지 않음)로 읽기·요약을 한 번에.
  `.env` 에 `GMAIL_USER`·`GMAIL_APP_PASSWORD`(앱 비밀번호)가 있으면 IMAP 읽기 전용 → 팀원(기본 gemini) 요약. 로그인 실패 시 claude 로 넘어간다.
  캘린더(`server/calconn.py`)도 `claude` + Notion 커넥터의 캘린더(Notion 캘린더에 연결된 Google 캘린더 포함, 목록 읽기 도구 2개만).
  회의록(`server/meetings.py`)도 `claude` + claude.ai Notion 커넥터(읽기 도구만, 공통 호출 `server/connectors.py`). 할 일 체크는 앱에만 저장.
  바로가기 'Vercel 가져오기'(`server/vercel.py`): `.env` 의 `VERCEL_TOKEN` 또는 Vercel CLI 로그인으로 프로젝트 목록만 읽는다.
  스킬(`server/skills.py`): 2×2 카드(한국어 짧은 이름 자동)·▶ 실행(전용 폴더, 셸 없음)·결과/파일·SKILL.md 편집(직접 만든 것만). Vercel 은 CLI 로그인 상태 표시·6시간마다 자동 추가.
  다음 단계: 자동 실행 루틴 예약. 처음 열 때 한 번 브레인으로 옮긴다(`agentOffice.brainDefault`)
- 화면 모션(`web/motion.js`·`motion.css`): WnC Motion(Moxie `proposals/agentoffice.html`) '풀' 단계. app.js 를 고치지 않고 전역 함수(toast·renderBoard·log·openReport 등)를 감싸 붙는다.
  `html.mo` 일 때만 동작하고 설정 '움직임 줄이기'·시스템 '동작 줄이기'면 꺼진다. 3D 사무실은 건드리지 않는다
- `tests/` : pytest (스냅샷 리듀서, API·WebSocket·인증)
- `runs/<시각>/` : plan.json, task-*.md, report.md (Git 제외)

## 규칙 (3개 AI 공통: Claude · Gemini · GPT)
- **작업 완료 시 자동화 워크플로우 (필수 준수)**:
  - 제미나이, 클로드, 지피티 모두 작업 완료 시 다음 절차를 차례대로 자동 수행합니다:
    1. **README 작업 내역 누적**: 작업 완료 시 `README.md` 제일 하단 `## 📝 변경 및 작업 이력` 섹션에 **해당 날짜(YYYY-MM-DD)**별로 작업 내용을 간략하게 누적하여 기록합니다.
    2. **한글 번역 및 정리**: 작업 결과 설명, 커밋 메시지, 주요 변경 요약은 한국어로 명확히 번역/작성합니다.
    3. **클린 커밋 검증**: `git status`로 `.DS_Store`, `.env`, 임시 파일이 포함되지 않았는지 점검합니다.
    4. **자동 커밋 (Auto Commit)**: Conventional Commits 접두사(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)를 준수하여 명확한 한글 커밋 메시지로 커밋합니다.
    5. **원격 동기화 (Pull & Push)**: 충돌 방지 및 최신 형상 유지를 위해 `git pull --rebase`를 먼저 수행한 뒤 `git push`로 원격 저장소에 반영합니다.
  - 위 1~5 는 `python scripts/finish.py "feat: 한글 커밋 메시지" -n "작업 요약 1" -n "작업 요약 2"` 한 번으로 실행한다
    (금지 파일 검사 → README 이력 누적 → 커밋 → pull --rebase → push). 다른 AI 세션이 같은 저장소에 동시에 커밋할 수 있으니
    커밋 전 `git log --oneline -5` 로 최근 이력을 확인하고, 다른 에이전트가 편집 중인 파일은 `--paths` 로 제외한다.
- **`._*` 파일은 보이는 즉시 모두 지운다.** 외장하드(exFAT)에서 macOS 가 자동으로 만드는 숨김 파일(AppleDouble)이다.
  작업 시작·끝, 패키지 설치나 서버 실행 뒤에 `find "/Volumes/외장하드/App/Agent" -name '._*' -exec rm -rf {} +` 로 지운다 (`.venv` 안에 생기면 pip 경고의 원인이 된다).
- API 키는 `.env` 에만 두고 절대 커밋하지 않는다.
- 새 provider 추가 시 `providers.py` 의 `_PROVIDERS` 에 등록하고 `team.toml` 에서 사용한다.
- 변경 후 `python main.py --mock run "테스트"` 로 흐름을 검증한다.
- 서버 변경 후 `.venv/bin/python -m pytest -q` 를 통과시킨다 (개발 의존성: `pip install -r requirements-dev.txt`).


## 프로젝트(폴더 접근)
- Claude 앱의 '프로젝트'처럼 로컬 폴더를 골라 AI 팀에게 전체 접근을 허락하면, 업무가 그 폴더 안에서 실행된다(명령창 폴더 버튼 · 왼쪽 메뉴 '프로젝트' · 설정).
- 흐름: 폴더 고르기 창(`GET /api/fs/list`, 하위 폴더 이름만) → 동의 창(체크 필수) → `POST /api/projects {confirm: true}` → `POST /api/run {project_id}`.
- 팀원 실행: `Member.ask(..., workdir=경로)` → claude-cli 는 그 폴더에서 Read·Edit·Write·Glob·Grep 만(허용 규칙도 폴더 안, Bash 없음, `acceptEdits`, 최대 30턴),
  codex-cli 는 `--sandbox workspace-write`, antigravity-cli 는 `--mode accept-edits --add-dir`(명령까지 승인하는 `--dangerously-skip-permissions` 는 쓰지 않음).
  프로젝트가 없으면 예전처럼 빈 임시 폴더·도구 없음.
- 위험한 경로(디스크 최상위·홈 전체·시스템 폴더·`~/Library`·`.ssh` 같은 자격 증명 폴더·앱 `.venv`)는 서버가 거부한다. 규칙은 `server/projects.py`, 프로토콜은 docs/events.md '프로젝트'.
- `projects.json`(실제 로컬 경로)은 Git 제외. 실제 경로를 커밋·문서·테스트에 넣지 말 것(테스트는 임시 폴더만).

## 실행 (더블클릭)
- macOS `start-mac.command` · Linux `./start-linux.sh` · Windows `start-windows.bat`
  → 가상환경 준비(macOS·Linux `.venv`, Windows `.venv-win`) 후 `scripts/launch.py` 메뉴: 1) 모의 실행(키 불필요) 2) 실제 실행(.env 키)
  → '휴대폰에서도 접속' 을 고르면 `--lan`: 터미널에 휴대폰 주소·QR 코드·접속 키 표시 (같은 Wi-Fi). 키를 모르는 기기는 화면의 '키 입력' 에 붙여 넣는다
- 메뉴 없이: `start-mac.command --mock --lan --port 8000 --no-browser`

## 팀원 연결 방식 (team.toml 의 provider)
- 기본은 **CLI 구독 로그인**: `claude-cli`(claude -p, Max/Pro) · `codex-cli`(codex exec, ChatGPT) · `antigravity-cli`(agy -p, Google AI Pro/Ultra).
  API 키·크레딧 없이 각 CLI 의 로그인 세션을 쓴다. 구현은 `agentteam/cli.py` (빈 임시 폴더에서 도구 없이 1턴 호출, 환경의 API 키는 넘기지 않음).
- CLI 모델명: claude-cli 는 `opus`/`sonnet`/`haiku` 별칭(전체 모델 ID 는 거부됨), codex-cli 는 `default`(CLI 기본값), antigravity-cli 는 `agy models` 의 슬러그(예: `gemini-3.8-flash-medium`).
- Gemini 는 **Gemini CLI 가 아니라 Antigravity CLI(`agy`)** 를 쓴다: Gemini CLI 의 개인·AI Pro/Ultra 로그인은 2026-06-18 에 종료됐다(유료 API 키만 가능).
  설치 `curl -fsSL https://antigravity.google/cli/install.sh | bash` → `~/.local/bin/agy`, 첫 로그인은 `agy` 대화형(Google OAuth). 헤드리스(`-p`)는 도구가 자동 거부되어 텍스트 전용이며 호출마다 약 2만 토큰의 기본 컨텍스트가 붙는다.
- `cli.py` 는 PATH 외에 `~/.local/bin`, `~/.npm-global/bin` 도 찾는다.
- 사용량은 각 구독 한도(Claude 5시간·주간 한도 등)에서 차감된다. 다른 사람에게 이 방식으로 접근을 제공하면 안 된다(개인 사용만).
- API 로 바꾸려면 provider 를 `anthropic`/`openai`/`google` 로 두고 `.env` 에 키를 넣는다.

## API 키 참고
- Gemini 를 API 로 돌릴 때(provider `google`) 무료 사용량은 Flash 계열만 된다(2026-10 기준 `gemini-3.6-flash` 가 빠름, `gemini-flash-latest` 는 40초 이상). Pro 는 Google AI Studio 결제 등록 필요.
- Anthropic 조직 단위 키는 `.env` 의 `ANTHROPIC_WORKSPACE_ID`(wrkspc_...) 가 필요하다.
- `ACCESS_KEY` 를 `.env` 에 두면 `--lan` 접속 키가 고정된다(없으면 실행마다 새로 생성).

## 웹 서버 실행
- `python serve.py --mock` : API 없이 모의 실행 (MOCK_DELAY 기본 3초) → http://127.0.0.1:8000
- `python serve.py` : 실제 API 사용, 이 컴퓨터에서만 접속 (접속 키 없음)
- `python serve.py --lan` : 같은 Wi-Fi 휴대폰에서 접속. 접속 키(`.env` 의 `ACCESS_KEY`, 없으면 자동 생성)가 붙은 주소와 QR 코드를 출력한다
- 개발 모드(기본 켜짐): `web/` 파일을 저장하면 열린 브라우저가 자동 새로고침되고(캐시 없음), `*.py`·`team.toml` 을 저장하면 서버가 자동 재시작된다. 끄려면 `--no-dev`. 구조는 `docs/events.md` 의 '개발 모드 채널'
- 업무는 한 번에 1개만 실행된다 (진행 중 `POST /api/run` 은 409).
