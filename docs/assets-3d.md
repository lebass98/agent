# 3D 모델링 에셋과 치수

`web/assets/3d/index.html`에서 모델을 회전해 확인하고 OBJ/MTL 또는 텍스처 포함 Three.js JSON을 저장한다. 사무실 실행 중 `/assets/3d/`로 접속한다.

## 제작 기준(실측 아님)

참고 시트와 사무실 이미지는 치수 도면이 아니다. 기존 평면을 보존하여 **1 단위=1m**로 정의했다. 넓은 사무실이며 총면적 704m²다. 사람을 크게 확대해 방 크기를 속이지 않는다.

| 대상 | 치수(m) |
|---|---|
| 사무실 바닥 | 32 × 22 |
| 외벽 / 내부 칸막이 | 높이 4 / 2.6 |
| 내부 출입구 | 폭 1.6 |
| Claude / GPT / Gemini | 키 1.72 / 1.78 / 1.68 |
| 일반 책상 | 2.6 × 1.2, 상판 상단 0.815 |
| 팀장 책상 | 3 × 1.2, 상판 상단 0.82 |
| 업무 의자 | 좌판 0.52 × 0.5, 상단 0.535 |
| 회의 테이블 | 3.6 × 1.3 |

방별 경계는 `web/assets/3d/dimensions.json`에 기록한다. 모두 +Y 위, +Z 정면이다. 캐릭터는 발바닥 원점, 사무실은 바닥 중심 원점이며 슬래브는 바닥 아래다.

## 산출물

- `claude.glb`, `gpt.glb`, `gemini.glb`, `characters.glb`: 512×512 얼굴 캔버스 텍스처, 웨이브/번 리본 헤어, 의상 주름·칼라·벨트·사원증·스니커즈·손가락 관절을 포함한 입체 GLB 모델 (`characters.glb`는 시트 3가지 대표 포즈 `lounge`·`tea`·`present` 3인 세트).
- `claude.obj/.mtl`, `gpt.obj/.mtl`, `gemini.obj/.mtl`: 성인 비율 정밀 조형 기본 모델. 머리·3D 이목구비·의상·신발·사원증·손가락 메시 포함. 숨긴 휴대 소품 제외.
- `office.obj/.mtl`: 바닥·벽·유리 칸막이·창·회의실·탕비실·라운지·가구 및 3인 책상 세트.
- `dimensions.json`: 동일한 좌표계의 치수와 방 경계.
- 브라우저의 JSON/GLB 저장: `web/assets/3d/index.html`(`/assets/3d/`)에서 **시트 3×3 포즈 비교(9개 동시 배치)** 및 **캐릭터 3인 스튜디오(포즈 6종 · 표정 5종 · 턴테이블 회전 · 와이어프레임)** 모드로 검수하고 GLB/JSON을 즉시 저장할 수 있다.

재생성: `node scripts/assets/build.cjs`. 기존 고정 Three.js만 사용하며 인터넷·외부 패키지가 필요 없다. 생성기는 세 캐릭터의 발바닥 0과 목표 키를 검증한다.

OBJ는 Blender 등으로 가져와 정밀 모델링할 기초 메시다. MTL과 같은 폴더에 둔다. 정점색을 지원하는 뷰어에서는 사무실 정점색이 보이고, 지원하지 않는 OBJ 임포터에서는 해당 메시가 단색으로 보일 수 있다. OBJ에는 얼굴 텍스처·뼈대·애니메이션이 없다. 웹앱의 걷기·앉기·표정은 원본 JS 관절 계층과 캔버스 재질이 담당한다.

현재 결과는 실제 입체인 절차형 기본 모델이며 반실사 스캔 모델이나 스키닝된 GLB/VRM은 아니다. 고급 제작 시 이 치수와 시트의 의상/헤어를 유지해 리토폴로지, UV, PBR 텍스처, 휴머노이드 스킨과 손가락을 추가한다. 외부 3D 모델 자동 생성 서비스는 사용하지 않았다.

## Apple 기기와 사무실 갱신 (2026-10-14)

`web/apple-assets.js`에서 Studio Display, Mac mini, Magic Keyboard, Magic Mouse, MacBook, iPad, Apple TV·Siri Remote, HomePod mini의 비공식 근사 모델을 직접 구성한다. 실제 제품의 공인 CAD/스캔 모델은 아니다. 업무 책상은 듀얼 Studio Display·외장 키보드·마우스·Mac mini로, 회의실은 MacBook·Apple TV로 교체했다. 현관 안내는 iPad, 공용 기기대는 MacBook·iPad·HomePod mini다. 냉장고·커피 머신은 Apple이 만들지 않는 제품이므로 일반 가전으로 유지한다.

`web/model-kit.js`는 모서리, 목재/패브릭 범프, 금속 반사용 환경 맵을 제공한다. 사무실 바닥 거칠기를 높이고 반복되는 원형 빛 웅덩이를 제거해 과도한 반사를 줄였다. 현재 런타임은 Three.js r128이며 레이트레이싱 품질의 렌더는 아니다.

- `apple.glb`, `office.glb`: 재질과 캔버스 색상 텍스처를 포함한 입체 모델. 캐릭터는 포함하지 않는다. GLTFExporter r128은 bumpMap을 내보내지 않으므로 런타임의 미세 범프는 GLB에 포함되지 않는다.
- `apple.obj/.mtl`, `office.obj/.mtl`: 텍스처/애니메이션 없이 형상을 전달하는 호환용 모델. 권장 검수는 GLB다.
- GLB 재생성: `npm install --prefix /tmp/agent-office-assets @napi-rs/canvas@0.1.80` 후 `NODE_PATH=/tmp/agent-office-assets/node_modules node scripts/assets/build-glb.cjs`. 패키지는 생성 시에만 필요하며 웹 실행은 고정 로컬 vendor 파일만 사용한다. GLTFExporter는 three.js 0.128.0 공식 examples의 MIT 배포본이다.
- `docs/ref/office-night-target.png`, `office-day-target.png`는 사용자가 제공한 목표 품질이다. 화면이 참고 렌더와 동일한 품질에 도달했다는 뜻이 아니다.

사무실 탭은 전체·현관·탕비실·업무 공간·팀장실·회의실·라운지를 제공한다. 최대 확대는 기존의 2배이며 우클릭 드래그/화살표 버튼/캔버스에 포커스한 방향키로 화면을 이동한다.
