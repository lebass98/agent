# Agent — 멀티 에이전트 팀 (GPT · Claude · Gemini)

## 구조
- `team.toml` : 팀원·역할·모델 설정 (팀장 지정 포함)
- `agentteam/providers.py` : 사별 API 래퍼 (anthropic / openai / google / mock)
- `agentteam/team.py` : 계획 → 의존순 병렬 실행 → 검수 보고
- `main.py` : CLI (`run`, `ask`, `team`, `--mock`)
- `server/app.py` : 웹 서버 (FastAPI). REST `/api/*` + WebSocket `/ws` 실시간 중계 + `web/` 정적 파일
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
- `scripts/launch.py` : 실행 메뉴(모든 OS 공용), `scripts/bootstrap.sh` : macOS·Linux 가상환경 준비
- `docs/events.md` : 서버 ↔ 웹 UI 이벤트 프로토콜 (변경 시 서버·UI 함께 수정)
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
