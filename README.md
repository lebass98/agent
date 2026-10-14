# 🏢 Agent Office — 멀티 에이전트 협업 오피스 (GPT · Claude · Gemini)

![Agent Office UI](./index-screenshot.png)

> **Agent Office**는 최신 주요 파운데이션 모델(**Anthropic Claude**, **OpenAI GPT**, **Google Gemini**)을 하나의 팀으로 조직화하여 복잡한 목표를 스스로 분해하고, 의존 관계에 따라 병렬로 협업하며, 최종 검수 보고서까지 완성하는 **지능형 멀티 에이전트 워크스페이스**입니다.
> 
> Three.js 기반 3D 가상 오피스 웹 환경을 통해 AI 에이전트들이 회의하고, 각자의 책상에서 작업하고, 보고서를 제출하는 과정을 실시간 애니메이션으로 직관적으로 관제할 수 있습니다.

---

## 🌟 주요 특징 (Key Features)

### 1. 🤝 이종 LLM 기반의 유기적 팀 협업
- **역할 특화 배정**: 
  - **Claude (팀장 겸 퍼블리셔)**: 업무 분해·지시, 최종 통합 검수, 마크업 및 문서화 총괄
  - **GPT (개발자)**: 핵심 비즈니스 로직, 코드 구현, 리팩터링 및 자동화 스크립트 작성
  - **Gemini (분석가)**: 방대한 컨텍스트 처리 능력을 바탕으로 자료 리서치, 대용량 문서 분석 및 요약
- **DAG(방향성 비순환 그래프) 의존성 스케줄링**: 
  - 서로 독립적인 태스크는 동시에 병렬 수행하고, 선행 작업이 필요한 태스크는 결과물이 나온 후 자동 착수합니다.

### 2. 🖥️ Three.js 기반 실시간 3D 가상 오피스 UI
- **살아 숨쉬는 오피스 시각화**:
  - 팀장의 화이트보드 앞 계획 수립 애니메이션
  - 팀원들의 개인 업무 책상 착석 및 타이핑 상태 연출
  - 최종 검수 시 팀원들의 회의실/팀장석 이동 브리핑
- **반응형 듀얼 모드**: 3D 가속을 지원하지 않거나 모바일 환경인 경우 가볍고 직관적인 2D 카드 목록 모드로 자동 전환됩니다.
- **100% 로컬 독립 동작 (No External CDN)**: `Three.js`, `OrbitControls`, `marked`, `DOMPurify` 등 프론트엔드 핵심 의존성을 `web/vendor`에 내장하여 폐쇄망이나 불안정한 네트워크에서도 끊김 없이 작동합니다.

### 3. 📱 무선 LAN 접속 & 모바일 관제
- 같은 Wi-Fi 환경에 있는 스마트폰이나 태블릿에서 터미널에 자동 생성되는 **QR 코드 스캔**만으로 손쉽게 접속 가능 (`--lan`).
- 안전한 토큰 기반 접속 키(`ACCESS_KEY`) 인증 시스템 내장.

### 4. 🧪 API 키 없이 테스트 가능한 모의 실행 (Mock Mode)
- 각 사의 API 키가 없어도 전체 오피스 라이프사이클과 애니메이션, 보고서 생성 흐름을 검증할 수 있는 모의 시뮬레이션 모드(`--mock`) 기본 지원.

### 5. 🚀 더블클릭 크로스 플랫폼 실행
- macOS (`start-mac.command`), Windows (`start-windows.bat`), Linux (`start-linux.sh`) 클릭 한 번으로 가상환경 구축부터 서버 실행까지 자동 완료.

---

## 🔄 아키텍처 및 워크플로우

```mermaid
flowchart TD
    User([사용자 / 웹 UI / CLI]) -->|목표 전달| Leader[팀장 에이전트: Claude]
    
    subgraph Planning [1. 계획 수립 단계]
        Leader -->|목표 분석 & 역할별 태스크 분해| Plan[JSON 실행 계획: plan.json]
    end
    
    subgraph Execution [2. 병렬 작업 수행 단계 (DAG)]
        Plan --> Task1[Task 1: Gemini 분석 리서치]
        Plan --> Task2[Task 2: GPT 코드 구현]
        Task1 -.->|선행 결과 전달| Task3[Task 3: Claude 마크업/문서화]
        Task2 -.->|선행 결과 전달| Task3
    end
    
    subgraph Review [3. 검수 및 보고서 작성]
        Task1 -->|작업물 산출| Integration[팀장 최종 검수]
        Task2 -->|작업물 산출| Integration
        Task3 -->|작업물 산출| Integration
        Integration -->|통합·보완·피드백| Report[최종 완성 보고서: report.md]
    end

    Report --> RunsArchive[(runs/ 실행 기록 아카이빙)]
    Report --> WebSocket[FastAPI WebSocket 실시간 중계]
    WebSocket --> Client([실시간 3D Web UI / 모바일 브라우저])
```

---

## 📂 프로젝트 구조

```text
.
├── agentteam/               # 멀티 에이전트 핵심 패키지
│   ├── providers.py         # Anthropic, OpenAI, Google API 및 Mock 래퍼
│   └── team.py              # 계획 분해, DAG 병렬 실행, 검수 파이프라인
├── server/                  # 웹 백엔드 (FastAPI)
│   └── app.py               # REST API (/api/*) + 실시간 WebSocket (/ws) 중계
├── web/                     # 프론트엔드 웹 오피스 UI
│   ├── index.html           # 대시보드 뷰
│   ├── app.js               # Three.js 3D 렌더링 & WebSocket 이벤트 제어
│   ├── style.css            # 반응형 및 테마 스타일
│   └── vendor/              # Three.js, marked, DOMPurify 등 오프라인 내장 라이브러리
├── scripts/                 # 실행 스크립트 모음
│   ├── launch.py            # OS 공용 대화형 실행 메뉴
│   └── bootstrap.sh         # macOS/Linux 가상환경 셋업
├── docs/
│   └── events.md            # 서버 ↔ 클라이언트 실시간 이벤트 프로토콜 명세
├── tests/                   # 단위 및 통합 테스트 (pytest)
├── runs/                    # 실행별 산출물 보관소 (plan.json, task-*.md, report.md)
├── team.toml                # 팀원 구성, 역할, AI 모델 설정 파일
├── main.py                  # CLI 실행 엔트리포인트
├── serve.py                 # 웹 서버 실행 엔트리포인트
├── start-mac.command        # macOS 더블클릭 실행기
├── start-windows.bat        # Windows 더블클릭 실행기
├── start-linux.sh           # Linux 실행 쉘 스크립트
├── requirements.txt         # 런타임 필수 의존성 목록
└── requirements-dev.txt     # 개발 및 테스트 의존성 목록
```

---

## ⚙️ 사전 준비 및 환경 설정

### 1. 요구 사항
- **Python 3.10 이상** 권장

### 2. 가상환경 및 패키지 설치
터미널에서 수동으로 설치할 경우:

```bash
# 가상환경 생성 및 활성화
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 필수 패키지 설치
pip install -r requirements.txt

# 테스트 및 개발 도구 설치 (선택)
pip install -r requirements-dev.txt
```

### 3. API 키 설정 (`.env`)
프로젝트 루트의 `.env.example`을 복사하여 `.env` 파일을 생성하고 각 서비스의 API 키를 입력합니다:

```bash
cp .env.example .env
```

`.env` 파일 내용:
```env
# Anthropic Claude API Key
ANTHROPIC_API_KEY=sk-ant-...
# (선택) Anthropic 조직 단위 키인 경우에만 입력 (wrkspc_...)
ANTHROPIC_WORKSPACE_ID=

# OpenAI API Key
OPENAI_API_KEY=sk-...

# Google Gemini API Key (무료 티어는 Flash 모델만 지원)
GEMINI_API_KEY=AIzaSy...

# (선택) 모바일 LAN 접속용 고정 키 (미설정 시 서버 구동마다 임의 생성)
# ACCESS_KEY=my-secure-access-key-1234
```

> ⚠️ **주의사항**: 
> - `.env` 파일은 절대 Git 리포지토리에 커밋하지 마세요.
> - Google Gemini의 무료 티어 사용량은 `gemini-flash-latest` 등 Flash 모델에서만 정상 동작합니다.

---

## 🚦 실행 방법

### 방법 A. 더블클릭 간편 실행 (권장)
각 운영체제에 맞는 스크립트를 더블클릭(또는 터미널 실행)하면 가상환경 세팅 후 대화형 메뉴가 나타납니다:
- **macOS**: `start-mac.command`
- **Windows**: `start-windows.bat`
- **Linux**: `./start-linux.sh`

실행 후 나타나는 메뉴에서 모의 실행(키 불필요) 또는 실제 API 실행을 선택하고, 모바일 동시 접속 여부를 손쉽게 지정할 수 있습니다.

---

### 방법 B. 웹 서버 직접 실행 (`serve.py`)

#### 1) 로컬 개발 및 모의 실행 (API 키 불필요)
```bash
python serve.py --mock
```
- 브라우저 주소: `http://127.0.0.1:8000`
- `MOCK_DELAY` 기본 3초 간격으로 각 에이전트의 작업 단계가 시뮬레이션됩니다.

#### 2) 실제 AI 모델로 로컬 실행
```bash
python serve.py
```
- `.env`에 입력된 실제 API 키를 사용하여 에이전트 팀이 업무를 수행합니다.

#### 3) 모바일/같은 Wi-Fi 기기 공유 실행 (`--lan`)
```bash
python serve.py --lan
```
- 터미널에 로컬 IP 주소와 접속 키가 포함된 **QR 코드**가 출력됩니다.
- 같은 Wi-Fi에 연결된 스마트폰 카메라로 QR 코드를 촬영하면 즉시 접속하여 실시간 모니터링 및 업무 지시가 가능합니다.

---

### 방법 C. CLI 터미널 실행 (`main.py`)

웹 브라우저 없이 터미널에서 즉시 에이전트 팀을 운용할 수 있습니다.

#### 1) 팀 구성 현황 및 API 키 유효성 확인
```bash
python main.py team
```
```text
팀장: claude
- claude  [anthropic/claude-opus-5-5] (키 ✓) 팀장 겸 퍼블리셔...
- gpt     [openai/gpt-5]              (키 ✓) 개발자...
- gemini  [google/gemini-flash-latest] (키 ✓) 분석가...
```

#### 2) 전체 팀 단위 업무 수행 (`run`)
```bash
# 기본 실행
python main.py run "웹 접근성 가이드라인을 준수한 로그인 폼 컴포넌트 설계 및 구현"

# API 키 없이 모의 흐름 테스트
python main.py --mock run "반응형 랜딩 페이지 제작"

# 긴 요구사항 문서를 파일에서 직접 읽어 전달
python main.py run -f requirements.md
```
- 실행 완료 시 `runs/<생성시각>/` 디렉토리에 `plan.json`, 각 에이전트의 개별 산출물 `task-*.md`, 그리고 최종 검수본 `report.md`가 자동 저장됩니다.

#### 3) 특정 에이전트에게 1:1 개별 지시 (`ask`)
```bash
python main.py ask gpt "FastAPI WebSocket 재연결 핸들러 작성해줘"
python main.py ask gemini "2026년 프론트엔드 최신 성능 최적화 트렌드 요약"
```

---

## 👥 팀 구성 커스터마이징 (`team.toml`)

`team.toml` 파일을 수정하여 원하는 모델, 공급자(Provider), 역할을 손쉽게 재구성할 수 있습니다:

```toml
# 팀장 지정: 전체 업무 분배, 의존성 계획, 결과물 검수 및 통합 보고서 작성
[leader]
member = "claude"

# 팀원별 모델 및 역할 설정
[members.claude]
provider = "anthropic"
model = "claude-opus-5-5"
role = "팀장 겸 퍼블리셔. 업무 분해·배정, 결과 검수, HTML/CSS 마크업, 문서화"

[members.gpt]
provider = "openai"
model = "gpt-5"
role = "개발자. 코드 구현, 리팩터링, 자동화 스크립트 작성"

[members.gemini]
provider = "google"
model = "gemini-flash-latest"
role = "분석가. 긴 문서·대용량 자료 분석, 리서치, 요약"
```

---

## 📡 REST API & WebSocket 명세

자세한 이벤트 규격은 [`docs/events.md`](./docs/events.md)를 참고하세요.

### 주요 REST API 엔드포인트
| 메서드 | 엔드포인트 | 설명 |
|---|---|---|
| `GET` | `/api/team` | 현재 구성된 팀원 목록 및 역할 반환 |
| `POST` | `/api/run` | 새 업무 시작 요청 (`{"goal": "..."}`) |
| `GET` | `/api/runs` | 과거 실행 이력 목록 조회 (최신순 최대 50건) |
| `GET` | `/api/runs/{run_id}` | 특정 실행의 상세 계획, 태스크별 산출물, 최종 보고서 조회 |

### 주요 WebSocket 이벤트 (`/ws`)
- `hello`: 접속 초기 스냅샷 및 팀 구성 전달
- `run_start` / `run_end`: 업무 착수 및 전체 종료 통보
- `plan_start` / `plan`: 팀장의 계획 수립 착수 및 태스크 분해 확정
- `task_start` / `task_done`: 팀원들의 개별 업무 착수 및 산출물 완료 통보
- `review_start` / `report`: 최종 검수 진행 및 완성된 마크다운 보고서 브로드캐스트

---

## 🧪 테스트 실행

통합 테스트 및 상태 리듀서(Snapshot Reducer) 무결성 검증:

```bash
# 전체 테스트 실행
pytest -q

# 세부 로그와 함께 실행
pytest -v
```

---

## 🔒 개발 및 기여 가이드라인 (3개 AI 공통: Claude · Gemini · GPT)

- **작업 완료 시 자동화 워크플로우**:
  1. **README 작업 이력 누적**: 작업 완료 시 `README.md` 최하단에 해당 날짜(`YYYY-MM-DD`)별로 수행 내역을 간략하게 누적 기록합니다.
  2. **한글 번역 및 정리**: 작업 결과 설명, 커밋 메시지, 주요 변경 요약은 한국어로 명확히 번역/작성합니다.
  3. **클린 커밋 유지**: `.DS_Store`, `.env`, 임시 파일이 포함되지 않도록 `git status`로 철저히 검증합니다.
  4. **자동 커밋 & 동기화**: Conventional Commits 규칙에 맞추어 한글 커밋 후 `git pull --rebase` 및 `git push`를 수행합니다.
- **시크릿 관리**: `.env`, 인증 토큰, API 키 파일은 절대로 Git 스테이징 및 커밋에 포함하지 않습니다.
- **단일 소스 원칙 (Single Source of Truth)**: 프로젝트 규칙은 `CLAUDE.md`를 단일 소스로 하며, `GEMINI.md`, `AGENTS.md`, `.cursorrules`가 심볼릭 링크로 연결되어 동일하게 공유됩니다.

---

## 📄 라이선스

본 프로젝트는 내부 연구 및 프로젝트용으로 개발되었습니다.
자세한 문의나 기능 제안은 이슈 또는 팀 관리자에게 문의 바랍니다.

---

## 📝 변경 및 작업 이력

### 2026-10-14
- **상세 README.md 작성**:
  - Agent Office 멀티 에이전트 시스템 개요, 3D 가상 오피스 UI 스크린샷(`index-screenshot.png`) 연동
  - 이종 LLM(Claude·GPT·Gemini) 협업 구조, DAG 병렬 스케줄링 및 아키텍처 다이어그램(Mermaid) 추가
  - 실행 모드(원클릭 OS 런처, 웹 서버 `serve.py`, CLI `main.py`) 및 LAN/QR 모바일 연동 안내 작성
  - 팀원 커스터마이징(`team.toml`), REST API 및 WebSocket 이벤트 명세([docs/events.md](./docs/events.md)) 정리
- **3개 AI 공통 규칙 수립 및 동기화**:
  - Claude, Gemini, GPT 3개 AI 모두 작업 완료 시 `README.md` 하단 날짜별 작업 내용 누적, 한글 번역, 자동 커밋, 푸시 및 풀 자동화 규칙 추가
  - `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursorrules` 심볼릭 링크 체계 완성
- **3D 가상 오피스 그래픽 및 애니메이션 고도화 (`web/app.js`)**:
  - 에이전트 캐릭터 신체 구조 분할(엉덩이/목 피벗, 커피 모금 연출용 컵 추가)
  - 책상 모니터 듀얼 베젤 및 화면 매핑, 소품(머그컵, 마우스 등) 디테일 개선
- 개발 모드 추가: `web/` 파일을 저장하면 열린 브라우저가 자동 새로고침(정적 파일 캐시 금지), `*.py`·`team.toml` 저장 시 서버 자동 재시작 (`serve.py` 기본 켜짐, `--no-dev`로 끔)
- 작업 완료 절차 스크립트 `scripts/finish.py` 추가: 금지 파일 검사 → README 이력 누적 → 한글 커밋 → `git pull --rebase` → `git push`
- 캐릭터 시트 명세 `docs/characters.md` 추가, `docs/events.md`에 개발 모드 채널(`/__dev/ws`) 설명 추가, 개발 모드 테스트 5건 추가
- API 키·크레딧 없이 구독 로그인된 CLI(`claude -p`, `codex exec`, `gemini -p`)를 호출하는 provider 추가 (`agentteam/cli.py`, 가짜 CLI 테스트 8건)
- `team.toml` 기본값을 CLI 방식으로 변경 (Claude `opus`, Codex·Gemini `default`), `main.py team` 에 CLI 설치 상태 표시, Gemini CLI 는 `~/.npm-global` 설치 지원
- 앱 셸 리디자인: 상단 바(내비·연결·날짜·속도·경과 시계), 사이드바(대시보드·업무 보드·팀원 관리·자료실·설정, 오늘의 진행률 도넛), 오른쪽 업무 보드·활동 로그 카드, 하단 명령 바(첨부·전송), 검색 팔레트, 새 에이전트 안내, 테마(시스템/라이트/다크)
- 3D 사무실을 평면도대로 재구성 (`web/decor.js`): 현관·탕비실·업무 공간·대표님실·회의실·라운지, 유리 칸막이·미닫이문·방 이름표, 창가 스카이라인(낮/밤), A* 길찾기(문·가구 회피), 출근 연출, 회의실 TV 계획·탕비실 커피·대표님실 보고 동선
- 캐릭터를 캐릭터 시트대로 제작 (`web/characters.js`): Claude(긴 웨이브 머리·크림 셔츠·태블릿), GPT(안경·검은 스웨터·노트북), Gemini(똥머리·연파랑 셔츠·커피컵), 표정 5종(기본·웃음·놀람·집중·생각), 앉아서 쉬는 행동(턱 괴기·기지개·한 모금 등), 이름표+역할 알약
- 검수 지적 수정: 현관 그림 가림, 방 이름표가 팀장 이름표에 가려짐, 출근 시작점이 사이드바에 가려짐, 태블릿 세로 레이아웃, 접속 전 빈 사무실, 이름표·말풍선 겹침, 탕비실 대기 자리, 보고 위치·팀장 시선, 다크 테마 밝기, 상단 바 라벨, 팀 재구성 시 텍스처 누수, 9명 팀 회의 자리
- `characters.js`: 이름 해시의 부호 있는 시프트로 일부 이름(reviewer 등)에서 옷장 인덱스가 음수가 되던 문제와 'constructor' 같은 이름이 프리셋 조회에서 오류를 내던 문제 수정, 캐릭터 생성 실패 시 기본 모양으로 대체
- Gemini CLI 의 Google 개인 로그인이 지원 종료(Antigravity 로 이전)되어 Gemini 는 무료 API 키 + `gemini-3.6-flash`(응답 2.8초, `flash-latest` 는 40초 이상)로 운영
- Gemini API 호출에 제한 시간(API_TIMEOUT, 기본 600초) 추가 — 응답이 멈춰도 팀 전체가 기다리지 않음
- 캐릭터 시트 그림을 그대로 쓰는 그림 캐릭터(2.5D 빌보드) 추가 — 방향별 정면·측면·후면, 걷기↔서기 프레임 교대, 앉기·일어나기 전환, 앉은 자리 3D 의자 숨김
- 시트 자르기 도구 scripts/sprites/cut.py 추가(macOS Vision 배경 제거, 겹친 인물 분리, 가장자리 배경색 정리)
- 이름표·팀원 카드·활동 로그에 표정 얼굴 아바타 적용
- 다크 모드를 참고 이미지(docs/ref/office-dark.png)의 밤 사무실로 개편 — 원목·검은 가구 다시 칠하기, LED 띠·빛 웅덩이·벽 조명, 점광원 추가, 야경·현관 간판 개선
- 팀 책상이 없는 줄을 빈 책상으로 채움, 업무 공간 펜던트를 책상 줄 위로 이동, 화이트보드가 액자에 묻히던 문제 수정
- 외장하드 ._ 파일은 보이는 즉시 지운다는 규칙 추가(CLAUDE.md)


