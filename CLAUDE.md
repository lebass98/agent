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
- `scripts/launch.py` : 실행 메뉴(모든 OS 공용), `scripts/bootstrap.sh` : macOS·Linux 가상환경 준비
- `docs/events.md` : 서버 ↔ 웹 UI 이벤트 프로토콜 (변경 시 서버·UI 함께 수정)
- `tests/` : pytest (스냅샷 리듀서, API·WebSocket·인증)
- `runs/<시각>/` : plan.json, task-*.md, report.md (Git 제외)

## 규칙
- API 키는 `.env` 에만 두고 절대 커밋하지 않는다.
- 새 provider 추가 시 `providers.py` 의 `_PROVIDERS` 에 등록하고 `team.toml` 에서 사용한다.
- 변경 후 `python main.py --mock run "테스트"` 로 흐름을 검증한다.
- 서버 변경 후 `.venv/bin/python -m pytest -q` 를 통과시킨다 (개발 의존성: `pip install -r requirements-dev.txt`).

## 실행 (더블클릭)
- macOS `start-mac.command` · Linux `./start-linux.sh` · Windows `start-windows.bat`
  → 가상환경 준비(macOS·Linux `.venv`, Windows `.venv-win`) 후 `scripts/launch.py` 메뉴: 1) 모의 실행(키 불필요) 2) 실제 실행(.env 키)
  → '휴대폰에서도 접속' 을 고르면 `--lan`: 터미널에 휴대폰 주소·QR 코드·접속 키 표시 (같은 Wi-Fi). 키를 모르는 기기는 화면의 '키 입력' 에 붙여 넣는다
- 메뉴 없이: `start-mac.command --mock --lan --port 8000 --no-browser`

## API 키 참고
- Gemini 무료 사용량은 Flash 모델만 된다(`gemini-flash-latest`). Pro 는 Google AI Studio 결제 등록 필요.
- Anthropic 조직 단위 키는 `.env` 의 `ANTHROPIC_WORKSPACE_ID`(wrkspc_...) 가 필요하다.
- `ACCESS_KEY` 를 `.env` 에 두면 `--lan` 접속 키가 고정된다(없으면 실행마다 새로 생성).

## 웹 서버 실행
- `python serve.py --mock` : API 없이 모의 실행 (MOCK_DELAY 기본 3초) → http://127.0.0.1:8000
- `python serve.py` : 실제 API 사용, 이 컴퓨터에서만 접속 (접속 키 없음)
- `python serve.py --lan` : 같은 Wi-Fi 휴대폰에서 접속. 접속 키(`.env` 의 `ACCESS_KEY`, 없으면 자동 생성)가 붙은 주소와 QR 코드를 출력한다
- 업무는 한 번에 1개만 실행된다 (진행 중 `POST /api/run` 은 409).
