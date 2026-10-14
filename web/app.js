"use strict";
/* Agent Office 웹 클라이언트
   서버 이벤트(docs/events.md)를 받아 3D 사무실 연출로 보여 준다. 서버가 없으면 같은 이벤트를 만드는 데모 모드로 동작한다.
   순서: 공통 도구 → 3D 사무실 → 캐릭터 → 화면(UI) → 연출 감독 → 연결·데모 → 입력·초기화 */

/* ───────────────────────── 공통 도구 ───────────────────────── */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const clip = (s, n) => ((s = String(s ?? "")).length > n ? s.slice(0, n - 1) + "…" : s);
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const noop = () => {};
const tid = id => (id !== null && id !== "" && Number.isFinite(+id) ? +id : String(id));
const fmtDur = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${pad(s % 60)}초`; };
const hhmm = (d = new Date(), sec = false) => `${pad(d.getHours())}:${pad(d.getMinutes())}` + (sec ? `:${pad(d.getSeconds())}` : "");

/** 안전한 DOM 생성: 문자열 자식은 항상 텍스트 노드가 된다(LLM·사용자 입력을 innerHTML 로 넣지 않는다). */
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "style") for (const [p, x] of Object.entries(v)) n.style.setProperty(p, x);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(2)) if (c != null && c !== false) n.append(c);
  return n;
}

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

function toast(msg, kind = "info", ms = 4500) {
  const box = $("toasts");
  while (box.childElementCount >= 3) box.firstChild.remove();
  const t = el("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, msg);
  box.append(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
}

/* 연출 취소 장치: 재동기화(hello)마다 epoch 가 바뀌고, 이전 연출은 다음 대기 지점에서 STALE 로 멈춘다. */
const STALE = new Error("stale");
let epoch = 0;
const alive = g => { if (g !== epoch) throw STALE; };
const capped = (p, ms) => Promise.race([p, sleep(ms)]);
let SPEED = [1, 2, 4].includes(+store.get("agentOffice.speed")) ? +store.get("agentOffice.speed") : 1;
/** 연출용 대기. 속도 배율을 따르고, 탭이 숨겨져 있으면 즉시 넘어간다. */
function wait(ms) {
  const g = epoch;
  return (document.hidden ? Promise.resolve() : sleep(ms / SPEED)).then(() => alive(g));
}
function deferred() { let resolve; const p = new Promise(r => (resolve = r)); return { p, resolve }; }

/** 순차 실행 큐. 단계마다 최대 대기 시간을 두어 어떤 경우에도 막히지 않는다. */
class Lane {
  constructor() { this.p = Promise.resolve(); this.n = 0; }
  push(fn, cap = 60000) {
    const g = epoch;
    this.n++;
    this.p = this.p
      .then(() => (g === epoch ? capped(Promise.resolve().then(fn).catch(e => { if (e !== STALE) console.error(e); }), cap) : 0))
      .finally(() => this.n--);
    return this.p;
  }
}

/* ───────────────────────── 설정 ───────────────────────── */
const KNOWN = {
  claude: { label: "Claude", initial: "C", color: "#d97757" },
  gpt: { label: "GPT", initial: "G", color: "#10a37f" },
  gemini: { label: "Gemini", initial: "Ge", color: "#4f7cf7" },
};
const PALETTE = ["#8e6cd1", "#e8a317", "#e05a8a", "#1fa2b8", "#6f8f2e", "#c25b3f"];
const HAIR = ["#3b2a22", "#1f1f1f", "#5a3b1c", "#2c2c3a", "#6b4a2b", "#43302a"];
const DEMO_TEAM = {
  leader: "claude",
  members: [
    { name: "claude", provider: "anthropic", model: "claude-opus-5-5", role: "팀장 겸 퍼블리셔. 업무 분해·배정, 결과 검수, HTML/CSS 마크업, 문서화" },
    { name: "gpt", provider: "openai", model: "gpt-5", role: "개발자. 코드 구현, 리팩터링, 자동화 스크립트 작성" },
    { name: "gemini", provider: "google", model: "gemini-2.5-pro", role: "분석가. 긴 문서·대용량 자료 분석, 리서치, 요약" },
  ],
};
const EXAMPLE_GOAL = "아르떼365 뉴스레터 자동화 도구 만들기";
const KEY_MSG = "접속 키가 필요해요. 위쪽의 ‘키 입력’ 버튼을 눌러 서버 터미널에 표시된 키를 넣거나, QR 코드로 다시 접속해 주세요.";
const PHASE_KO = { plan: "계획 수립", work: "업무 진행", review: "검수·보고", done: "완료" };
const STATE_KO = { todo: "대기", doing: "진행 중", done: "완료", failed: "실패" };
const BUSY = ["작업 중", "계획 중", "검수 중", "보고"];
const IDLE = { status: "대기", cls: "", task: "—", bar: "", t0: 0, t1: 0, approx: false };
const LINES = {
  accept: ["넵, 맡겠습니다 👍", "좋아요, 해볼게요!", "접수했습니다 🙌"],
  start: ["자리로 가서 시작할게요 💻", "바로 착수합니다!", "좋아, 시작해 볼까 ✍️"],
  typing: ["집중 모드 🔥", "조금만 더…", "생각보다 괜찮네요", "자료 확인 중 🔍", "정리하는 중 📚"],
  planning: ["어떻게 나눌까… 🤔", "역할별로 정리 중 ✍️", "의존 관계 확인 중"],
  review: ["좋아요, 확인했습니다 👌", "꼼꼼하네요, 고마워요!", "이 부분 반영할게요 ✍️"],
};
const mqMobile = matchMedia("(max-width: 760px), (max-height: 500px) and (pointer: coarse)");
const mqSide = matchMedia("(max-height: 500px) and (pointer: coarse) and (min-width: 600px)"); // 가로 모드 폰: 오른쪽 세로 시트
const mqNarrow = matchMedia("(max-width: 1100px)"); // 태블릿: 입력창이 좁아 예시 없는 안내문
const mqDark = matchMedia("(prefers-color-scheme: dark)");
const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");

/** 접속 키: ?key= 로 받으면 저장하고 주소창에서 지운다. 없으면 저장된 키를 쓴다. 키 입력 창에서 바꿀 수 있다. */
let KEY = (() => {
  let k = null;
  try {
    const u = new URL(location.href);
    k = u.searchParams.get("key");
    if (k) { u.searchParams.delete("key"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); }
  } catch { /* file:// 등 */ }
  if (k) store.set("agentOffice.key", k);
  else k = store.get("agentOffice.key");
  return k || "";
})();

/* ───────────────────────── 3D 사무실 ─────────────────────────
   three.js 를 불러오지 못했거나(오프라인·차단) WebGL 을 쓸 수 없으면 HAS3D=false 로, 3D 없이 목록 모드로 동작한다.
   이때도 연결·이벤트 처리·보드·로그·카드·업무 지시는 그대로 돈다(캐릭터는 위치만 가진 '유령'이 된다). */
const SMALL = mqMobile.matches || Math.min(screen.width, screen.height) < 700;
const OW = 20, OD = 14;                   // 사무실 가로·세로
const DESK_Z = -4.3;                      // 책상 줄(뒷벽 쪽)
const TABLE = { x: 0, z: 3 };             // 회의 테이블
const WHITEBOARD = { x: -OW / 2 + 1.4, z: 2.5 }, BOARD_FACE = { x: -OW / 2, z: 2.5 };
const COUNTER = { x: 7.8, z: 5.6 };       // 커피 코너
const COFFEE = [{ x: 7, z: 4.4 }, { x: 8.2, z: 4.4 }, { x: 9.2, z: 4.1 }, { x: 6.3, z: 3.5 }, { x: 7.6, z: 3.3 }, { x: 8.9, z: 3.1 },
  { x: 5.6, z: 4.6 }, { x: 6.9, z: 2.3 }, { x: 8.3, z: 2.1 }];
const MAX_DESKS = 9; // 3D 자리는 9명까지(7명부터는 책상을 좁혀 한 줄에 놓는다). 그 이상은 목록·보드에만 표시
let renderer = null, scene = null, camera = null, controls = null, hemi = null, sun = null, teamGroup = null, CAM_OFF = null;
let strokes = [], OFFICE_PTS = [], ACT_PTS = [];
const themed = {};
const HAS3D = init3D();

function mat(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: .85 }); }
function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function cyl(rt, rb, h, color, x, y, z, parent = scene, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function dispose(obj) { obj.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }

/** 장면을 만든다. three.js·OrbitControls 가 없거나 WebGL 컨텍스트를 만들 수 없으면 false. */
function init3D() {
  if (!window.THREE || typeof THREE.OrbitControls !== "function") return false;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    console.warn("WebGL 사용 불가:", e);
    renderer = null;
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "에이전트들이 일하는 3D 사무실. 드래그로 회전, 휠이나 두 손가락으로 확대");
  $("stage").append(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  CAM_OFF = new THREE.Vector3(22, 20, 22);
  camera.position.copy(CAM_OFF);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enablePan: false, enableDamping: true, minZoom: .6, maxZoom: mqMobile.matches ? 3.2 : 2.2, minPolarAngle: .5, maxPolarAngle: 1.2,
  });

  hemi = new THREE.HemisphereLight(0xffffff, 0xc9d2e3, .75);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, .75);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SMALL ? 1024 : 2048, SMALL ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
  sun.shadow.radius = 4;
  scene.add(sun);

  // 바닥·벽 (테마에 따라 색이 바뀌는 것들)
  Object.assign(themed, {
    floor: box(OW, .3, OD, 0xf6f2ea, 0, -.15, 0),
    wall: box(OW, 4, .3, 0xffffff, 0, 2, -OD / 2 - .15),
    side: box(.3, 4, OD, 0xf7f8fb, -OW / 2 - .15, 2, 0),
    base: box(OW, .15, .32, 0xd9dee8, 0, .08, -OD / 2 - .1),
  });
  for (const x of [-5, 1, 7]) {
    box(3.2, 1.8, .05, 0xbfdcf5, x, 2.4, -OD / 2 + .02);
    box(.08, 1.8, .08, 0xffffff, x, 2.4, -OD / 2 + .06);
  }
  themed.rug = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), mat(0xdfe6f6));
  themed.rug.rotation.x = -Math.PI / 2; themed.rug.position.set(0, .01, 3); themed.rug.receiveShadow = true; scene.add(themed.rug);

  // 회의 테이블
  cyl(1.5, 1.5, .1, 0xffffff, TABLE.x, .78, TABLE.z, scene, 48);
  cyl(.12, .3, .78, 0xb7bdcb, TABLE.x, .39, TABLE.z);

  // 화이트보드 + 필기 줄
  box(.1, 1.6, 3, 0xffffff, -OW / 2 + .3, 1.9, 2.5);
  box(.12, 1.7, 3.1, 0x9aa1b2, -OW / 2 + .26, 1.9, 2.5);
  strokes = [0, 1, 2, 3, 4].map(i => {
    const l = box(.02, .07, .01, 0x6b7489, -OW / 2 + .36, 2.45 - i * .26, 2.5);
    l.scale.z = 120 - (i * 23) % 50; l.castShadow = false; l.visible = false; return l;
  });

  // 커피 코너
  box(2.6, .9, .8, 0xe2e5ec, COUNTER.x, .45, COUNTER.z);
  box(2.6, .06, .85, 0xb08d6b, COUNTER.x, .93, COUNTER.z);
  box(.5, .6, .4, 0x30343f, 7.2, 1.26, 5.6);
  cyl(.08, .07, .15, 0xffffff, 8.2, 1.04, 5.5);
  cyl(.08, .07, .15, 0xffffff, 8.5, 1.04, 5.7);

  // 책장 + 화분
  box(.6, 2.2, 2.6, 0xc8a47e, -OW / 2 + .45, 1.1, -3.6);
  const bookColors = [0xd97757, 0x4f7cf7, 0x10a37f, 0xe8a317, 0x8e6cd1];
  for (let s = 0; s < 3; s++) for (let i = 0; i < 6; i++)
    box(.4, .45, .25, bookColors[(s + i) % 5], -OW / 2 + .5, .5 + s * .7, -4.5 + i * .36);
  const plant = (x, z, s = 1) => {
    cyl(.3 * s, .22 * s, .5 * s, 0xe9e2d6, x, .25 * s, z);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.55 * s, 0), mat(0x5aa469));
    leaves.position.set(x, .95 * s, z); leaves.castShadow = true; scene.add(leaves);
  };
  plant(9.2, -6.2, 1.2); plant(-9.2, 6.2); plant(3, 6.3, .8); plant(-3, -6.3, .8);

  // 팀 구성에 따라 바뀌는 가구(책상·회의 의자·명패)
  teamGroup = new THREE.Group();
  scene.add(teamGroup);

  // 카메라 맞춤용: 사무실 전체 외곽 점
  for (const x of [-OW / 2, OW / 2]) for (const z of [-OD / 2, OD / 2]) OFFICE_PTS.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 2, z));
  OFFICE_PTS.push(new THREE.Vector3(-OW / 2, 4, -OD / 2), new THREE.Vector3(OW / 2, 4, -OD / 2), new THREE.Vector3(-OW / 2, 4, OD / 2));
  return true;
}
let strokeN = 0, strokeAt = 0;
function showStroke() { if (strokeN < strokes.length) strokes[strokeN++].visible = true; strokeAt = performance.now(); }
function clearStrokes() { strokes.forEach(s => (s.visible = false)); strokeN = 0; }

function desk(x, z, w) {
  const g = teamGroup;
  box(w, .1, 1.2, 0xc8a47e, x, .78, z, g);
  for (const dx of [-w / 2 + .1, w / 2 - .1]) for (const dz of [-.5, .5]) box(.08, .78, .08, 0x8d7660, x + dx, .39, z + dz, g);
  box(.6, .4, .05, 0x2b2f38, x, 1.2, z - .3, g);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.54, .34), new THREE.MeshBasicMaterial({ color: 0x3a4150 }));
  screen.position.set(x, 1.2, z - .27); g.add(screen);
  box(.06, .25, .06, 0x2b2f38, x, .95, z - .32, g);
  box(.5, .03, .18, 0xe8eaef, x, .845, z + .1, g);
  box(.2, .18, .2, 0xffffff, x + w / 2 - .35, .92, z - .2, g);
  cyl(.32, .32, .1, 0x40465a, x, .5, z + 1.1, g);
  box(.6, .55, .08, 0x40465a, x, .85, z + 1.42, g);
  cyl(.04, .04, .45, 0x777e90, x, .25, z + 1.1, g);
  return screen;
}
/** 1~9명: 책상은 뒷벽을 따라 한 줄(7명부터는 좁은 책상), 회의 의자는 원탁 둘레, 커피 자리는 카운터 앞. 0번이 팀장.
    3D 가 없으면 위치만 계산한다(screen 없음). */
function layout(order, leaderColor) {
  if (HAS3D) for (const c of [...teamGroup.children]) { teamGroup.remove(c); dispose(c); }
  const n = order.length, sp = n > 1 ? Math.min(5.3, 16.2 / (n - 1)) : 0, x0 = Math.max(-7.6, -.7 - (n - 1) * sp / 2);
  const narrow = n > 1 && sp < 3.2;
  const width = i => (narrow ? Math.min(2.4, sp - .3) : i === 0 ? 3 : 2.4);
  if (HAS3D) box(.5, .15, .08, leaderColor, x0 + width(0) / 2 - .5, .9, DESK_Z + .45, teamGroup); // 팀장 명패
  const spots = order.map((_, i) => {
    const x = x0 + i * sp, a = Math.PI + i * 2 * Math.PI / n;
    const meet = { x: TABLE.x + Math.cos(a) * 1.9, z: TABLE.z + Math.sin(a) * 1.9 };
    const spot = { seat: { x, z: DESK_Z + 1.1 }, meet, coffee: COFFEE[i % COFFEE.length], screen: null };
    if (HAS3D) {
      spot.screen = desk(x, DESK_Z, width(i));
      cyl(.3, .3, .08, 0x9aa6c2, meet.x, .5, meet.z, teamGroup);
    }
    return spot;
  });
  if (HAS3D) ACT_PTS = activityPts(x0 - width(0) / 2, x0 + (n - 1) * sp + width(n - 1) / 2);
  return spots;
}
/** 카메라 맞춤용 '활동 영역' 점: 책상 줄(이름표 높이 포함)·화이트보드·회의 테이블·커피 코너. 패널 사이에 이것만은 꼭 보이게 한다. */
function activityPts(xl, xr) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return [
    V(xl, 3, DESK_Z - .6), V(xr, 3, DESK_Z - .6), V(xl, 0, DESK_Z + 1.6), V(xr, 0, DESK_Z + 1.6),
    V(WHITEBOARD.x - 1.2, 3, WHITEBOARD.z - 1.6), V(WHITEBOARD.x, 0, WHITEBOARD.z + 1.6),
    V(TABLE.x - 2.6, 2.6, TABLE.z), V(TABLE.x + 2.6, 0, TABLE.z), V(TABLE.x, 0, TABLE.z + 2.8),
    V(COUNTER.x + 1.3, 0, COUNTER.z + .4), V(9.2, 2.6, 2.1), V(5.6, 2.6, 4.6),
  ];
}

// 테마(라이트/다크)
const THEMES = {
  light: { clear: 0xeef1f7, floor: 0xf6f2ea, wall: 0xffffff, side: 0xf7f8fb, base: 0xd9dee8, rug: 0xdfe6f6, sky: 0xffffff, ground: 0xc9d2e3, hemi: .75, sun: .75 },
  dark: { clear: 0x10141c, floor: 0x3b3f49, wall: 0x2c3342, side: 0x272d3a, base: 0x1d222d, rug: 0x34405e, sky: 0xc6d0ea, ground: 0x262c3b, hemi: .62, sun: .62 },
};
function applyTheme() {
  if (!HAS3D) return;
  const t = THEMES[mqDark.matches ? "dark" : "light"];
  renderer.setClearColor(t.clear);
  for (const k in themed) themed[k].material.color.setHex(t[k]);
  hemi.color.setHex(t.sky); hemi.groundColor.setHex(t.ground); hemi.intensity = t.hemi; sun.intensity = t.sun;
}

/* 카메라: 사무실이 실제로 '보이는 영역'에 들어오도록 정사영 크기와 중심을 계산한다.
   - 세로 폰: 상단 바 아래 ~ 바텀 시트 위, 사무실 전체
   - 가로 폰: 상단 바 아래 ~ 화면 아래, 오른쪽 시트의 왼쪽, 사무실 전체
   - 태블릿 세로(패널이 아래): 상단 바 아래 ~ 패널 위, 사무실 전체
   - 태블릿 가로·데스크톱(패널이 양옆): 활동 영역이 좌우 패널 사이에 보이게 하되, 사무실 전체가 화면보다 커지지 않게 */
const cam = { view: 15, tween: null };
function visibleArea() {
  const w = innerWidth, h = innerHeight, top = $("topbar").getBoundingClientRect().bottom;
  if (mqSide.matches) return { top: top + 4, bottom: h - 8, left: 8, right: Math.max(160, $("dock").getBoundingClientRect().left - 8), pts: OFFICE_PTS };
  if (mqMobile.matches) return { top: top + 4, bottom: Math.max(top + 140, $("dock").getBoundingClientRect().top - 4), left: 8, right: w - 8, pts: OFFICE_PTS };
  const L = document.querySelector(".panel.left").getBoundingClientRect(), R = document.querySelector(".panel.right").getBoundingClientRect();
  if (Math.min(L.top, R.top) > h * .4) return { top: top + 8, bottom: Math.max(top + 160, Math.min(L.top, R.top) - 8), left: 8, right: w - 8, pts: OFFICE_PTS };
  return { top: top + 8, bottom: $("command").getBoundingClientRect().top - 8, left: L.right + 8, right: Math.max(L.right + 160, R.left - 8),
    pts: ACT_PTS.length ? ACT_PTS : OFFICE_PTS, outer: { top: top * .55, bottom: h - 30, left: 0, right: w } };
}
function frame(animate, zoom) {
  if (!HAS3D) return;
  const w = innerWidth, h = innerHeight;
  if (!w || !h) return; // 숨겨진 창(크기 0)에서는 계산하지 않는다
  const area = visibleArea();
  const fwd = controls.target.clone().sub(camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const ext = pts => {
    const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const p of pts) {
      const x = p.dot(right), y = p.dot(up);
      e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y);
    }
    return e;
  };
  const fit = (e, a) => Math.max((e.x1 - e.x0) / Math.max(1, a.right - a.left), (e.y1 - e.y0) / Math.max(1, a.bottom - a.top)); // 화면 1px 당 월드 크기
  const e = ext(area.pts);
  const s = Math.max(fit(e, area), area.outer ? fit(ext(OFFICE_PTS), area.outer) : 0);
  // 맞출 대상의 중심이 보이는 영역 가운데 오도록 이동 (화면 y 는 아래로, 월드 up 은 위로)
  const tx = (e.x0 + e.x1) / 2 - ((area.left + area.right) / 2 - w / 2) * s;
  const ty = (e.y0 + e.y1) / 2 + ((area.top + area.bottom) / 2 - h / 2) * s;
  const base = right.clone().multiplyScalar(tx).addScaledVector(up, ty);
  setView(h * s, base.addScaledVector(fwd, -base.y / fwd.y), animate, zoom);
}
function setView(view, target, animate, zoom = camera.zoom) {
  const to = { view, target, zoom };
  if (!animate || mqReduce.matches || document.hidden) { cam.tween = null; applyView(to); return; }
  cam.tween = { from: { view: cam.view, target: controls.target.clone(), zoom: camera.zoom }, to, t0: performance.now() };
}
function applyView({ view, target, zoom }) {
  const a = innerWidth / innerHeight;
  cam.view = view;
  Object.assign(camera, { left: -view * a / 2, right: view * a / 2, top: view / 2, bottom: -view / 2, zoom });
  camera.updateProjectionMatrix();
  const off = camera.position.clone().sub(controls.target);
  controls.target.copy(target);
  camera.position.copy(target).add(off);
}
function stepTween(now) {
  const tw = cam.tween;
  if (!tw) return;
  const k = Math.min(1, (now - tw.t0) / 450), e = 1 - (1 - k) ** 3;
  applyView({
    view: tw.from.view + (tw.to.view - tw.from.view) * e,
    target: tw.from.target.clone().lerp(tw.to.target, e),
    zoom: tw.from.zoom + (tw.to.zoom - tw.from.zoom) * e,
  });
  if (k === 1) cam.tween = null;
}
function resetView() {
  UI.focused = null;
  if (!HAS3D) return;
  camera.position.copy(controls.target).add(CAM_OFF);
  frame(true, 1);
}
function resize() { if (HAS3D) renderer.setSize(innerWidth, innerHeight); UI.focused = null; frame(false); }
/** 시트가 열리고 닫힐 때 다시 맞춘다. 특정 팀원을 보고 있으면 그대로 둔다. */
function reframe() { if (!UI.focused) frame(true); }

/** 목록 모드(3D 없음): 3D 자리에 차분한 안내를 두고, 휴대폰에서는 시트를 열어 목록을 바로 보여 준다. */
function enterListMode() {
  document.body.classList.add("no3d");
  $("stage").append(el("div", { class: "stage-empty", role: "note" },
    el("div", { class: "stage-empty-card" },
      el("b", { text: "3D 사무실 없이 목록으로 보여 드려요" }),
      el("span", { text: "이 브라우저나 네트워크에서는 3D 화면을 불러오지 못했어요. 팀원 상태·업무 보드·활동 로그와 업무 지시는 그대로 실시간으로 동작합니다." }))));
  log("3D 화면을 쓸 수 없어 목록 모드로 표시합니다.");
}

/* ───────────────────────── 길 찾기 ─────────────────────────
   책상 줄(z < -1.5)은 통로(z = -1)로 드나들고, 원탁은 둘레(RING)를 따라 돌아간다. */
const AISLE = -1, ROW = -1.5, RING = 2.6;
const angT = p => Math.atan2(p.z - TABLE.z, p.x - TABLE.x);
const onRing = a => ({ x: TABLE.x + Math.cos(a) * RING, z: TABLE.z + Math.sin(a) * RING });
const distT = p => Math.hypot(p.x - TABLE.x, p.z - TABLE.z);
function segNear(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((TABLE.x - a.x) * dx + (TABLE.z - a.z) * dz) / L));
  return Math.hypot(a.x + dx * t - TABLE.x, a.z + dz * t - TABLE.z);
}
function route(from, to) {
  const head = [], tail = [{ x: to.x, z: to.z }];
  let a = { x: from.x, z: from.z }, b = tail[0];
  if (a.z < ROW) head.push(a = { x: a.x, z: AISLE });
  if (distT(a) < RING - .1) head.push(a = onRing(angT(a)));
  if (b.z < ROW) tail.unshift(b = { x: b.x, z: AISLE });
  if (distT(b) < RING - .1) tail.unshift(b = onRing(angT(b)));
  const mid = [];
  if (segNear(a, b) < RING - .05) {
    const a0 = angT(a), d = Math.atan2(Math.sin(angT(b) - a0), Math.cos(angT(b) - a0)), steps = Math.max(1, Math.ceil(Math.abs(d) / .5));
    for (let i = 0; i <= steps; i++) mid.push(onRing(a0 + d * i / steps));
  }
  return [...head, ...mid, ...tail];
}

/* ───────────────────────── 캐릭터 ───────────────────────── */
const SKIN = 0xf1c7a3;
let SAY_Z = 1; // 가장 최근에 말한 팀원의 라벨을 맨 위로
/** 팀원 캐릭터. 3D 가 없거나 3D 자리가 없는 팀원은 '유령'(ghost): 위치만 있고 그리지 않으며 이동은 즉시 끝난다. */
class Agent {
  constructor(name, def, spot) {
    Object.assign(this, { name, def }, spot); // seat, screen, meet, coffee
    Object.assign(this, { path: [], speed: 2.4, mode: "sit", t: Math.random() * 10, lastSay: 0, typingSince: 0, _arrive: null, targetRot: Math.PI });
    this.ghost = !HAS3D || !spot.screen;
    if (this.ghost) {
      this.group = { position: { x: this.seat.x, y: 0, z: this.seat.z, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, rotation: { y: Math.PI } };
      return;
    }
    const g = this.group = new THREE.Group(), color = new THREE.Color(def.color);
    this.legs = [-.12, .12].map(x => {
      const pivot = new THREE.Group(); pivot.position.set(x, .55, 0); g.add(pivot);
      box(.17, .55, .17, 0x2f3446, 0, -.27, 0, pivot); return pivot;
    });
    cyl(.26, .3, .6, color, 0, .85, 0, g);
    this.arms = [-.36, .36].map(x => {
      const pivot = new THREE.Group(); pivot.position.set(x, 1.1, 0); g.add(pivot);
      box(.13, .5, .13, color, 0, -.22, 0, pivot);
      box(.12, .1, .12, SKIN, 0, -.5, 0, pivot); return pivot;
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 24, 16), mat(SKIN));
    head.position.y = 1.42; head.castShadow = true; g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.265, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(def.hair));
    hair.position.y = 1.45; hair.rotation.x = -.25; g.add(hair);
    for (const x of [-.09, .09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 8), mat(0x1d2433));
      eye.position.set(x, 1.44, .22); g.add(eye);
    }
    g.position.set(this.seat.x, 0, this.seat.z);
    g.rotation.y = Math.PI;
    scene.add(g);
    this.makeLabel();
  }
  makeLabel() {
    this.bubble = el("div", { class: "bubble" });
    this.label = el("div", { class: "tagwrap" }, this.bubble,
      el("div", { class: "nametag", style: { background: this.def.color } }, this.def.label, this.def.leader ? el("span", { class: "crown", text: "👑" }) : null));
    $("labels").append(this.label);
  }
  dispose() {
    this._settle(false); clearTimeout(this._bt);
    if (this.ghost) return;
    scene.remove(this.group); dispose(this.group); this.label.remove();
  }
  say(text, ms = 2600) {
    this.lastSay = performance.now();
    if (this.ghost) return;
    this.bubble.textContent = text;
    this.bubble.classList.add("show");
    this.label.style.zIndex = ++SAY_Z;
    this._bw = 0; // 크기는 다음 프레임에 다시 잰다(겹침 정리용)
    clearTimeout(this._bt);
    if (ms) this._bt = setTimeout(() => this.bubble.classList.remove("show", "covered"), ms / SPEED);
  }
  _settle(ok) { const f = this._arrive; this._arrive = null; f && f(ok); }
  /** 걸어서 이동. 도착하면 true, 다른 이동에 밀리면 false 로 끝난다. */
  walkTo(p) {
    this._settle(false);
    const pos = this.group.position;
    if (this.ghost || document.hidden || Math.hypot(p.x - pos.x, p.z - pos.z) < .05) { this.teleport(p); return Promise.resolve(true); }
    this.path = route(pos, p);
    this.mode = "walk";
    return new Promise(r => (this._arrive = r));
  }
  teleport(p, rot) {
    this._settle(false);
    this.path = [];
    this.group.position.set(p.x, 0, p.z);
    if (rot != null) this.group.rotation.y = this.targetRot = rot;
    if (this.mode === "walk") this.mode = "stand";
  }
  /** 걷는 중이면 목적지로 즉시 이동(탭 숨김·시간 초과 시). */
  finishWalk() {
    if (this.mode !== "walk") return;
    const p = this.path[this.path.length - 1];
    if (p) this.group.position.set(p.x, 0, p.z);
    this.path = []; this.mode = "stand"; this._settle(true);
  }
  face(p) { this.targetRot = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z); }
  sitDesk(mode = "sit") {
    this.targetRot = Math.PI; this.mode = mode;
    if (mode === "type") this.typingSince = performance.now();
  }
  update(dt) {
    this.t += dt;
    const g = this.group;
    if (this.mode === "walk" && this.path.length) {
      const p = this.path[0], dx = p.x - g.position.x, dz = p.z - g.position.z, dist = Math.hypot(dx, dz), step = this.speed * dt;
      if (dist > 1e-3) this.targetRot = Math.atan2(dx, dz);
      if (dist <= step) { g.position.x = p.x; g.position.z = p.z; this.path.shift(); }
      else { g.position.x += dx / dist * step; g.position.z += dz / dist * step; }
      if (!this.path.length) { this.mode = "stand"; this._settle(true); }
    }
    let d = this.targetRot - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, dt * 10);
    const s = Math.sin(this.t * 10), seated = this.mode === "sit" || this.mode === "type";
    const pose = { legL: 0, legR: 0, armL: 0, armR: 0, y: 0 };
    if (this.mode === "walk") Object.assign(pose, { legL: s * .6, legR: -s * .6, armL: -s * .5, armR: s * .5, y: Math.abs(s) * .05 });
    else if (seated) {
      Object.assign(pose, { legL: -1.45, legR: -1.45, y: -.02 });
      if (this.mode === "type") { pose.armL = -1.1 + Math.sin(this.t * 22) * .12; pose.armR = -1.1 + Math.cos(this.t * 19) * .12; }
      else pose.armL = pose.armR = -.5;
    } else if (this.mode === "talk") { pose.armR = -.6 + Math.sin(this.t * 4) * .4; pose.y = Math.abs(Math.sin(this.t * 3)) * .02; }
    else if (this.mode === "write") pose.armR = -2.2 + Math.sin(this.t * 8) * .25;
    else if (this.mode === "coffee") { pose.armR = -1.3; pose.y = Math.sin(this.t * 1.5) * .01; }
    else pose.y = Math.sin(this.t * 1.5) * .01;
    const k = Math.min(1, dt * 12);
    this.legs[0].rotation.x += (pose.legL - this.legs[0].rotation.x) * k;
    this.legs[1].rotation.x += (pose.legR - this.legs[1].rotation.x) * k;
    this.arms[0].rotation.x += (pose.armL - this.arms[0].rotation.x) * k;
    this.arms[1].rotation.x += (pose.armR - this.arms[1].rotation.x) * k;
    g.position.y = pose.y + (seated ? .02 : 0);
  }
  paint(now) {
    const on = this.mode === "type";
    if (!on && !this._lit) return;
    this._lit = on;
    const c = this.screen.material.color.set(on ? this.def.color : "#3a4150");
    if (on) c.offsetHSL(0, 0, Math.sin(now / 180) * .05);
  }
  placeLabel(w, h) {
    const v = this.group.position.clone(); v.y += 1.9;
    v.project(camera);
    this.ax = (v.x * .5 + .5) * w; this.ay = (-v.y * .5 + .5) * h;
    this.label.style.transform = `translate3d(${this.ax.toFixed(1)}px, ${this.ay.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}

/* ───────────────────────── 상태 ───────────────────────── */
const D = {
  names: [], agents: {}, leader: "", teamKey: "", mock: false, greeted: false,
  run: null,      // 서버 기준 현재 실행(이벤트 도착 즉시 반영)
  shown: null,    // 화면(보드)에 보여 주는 실행(연출 진행에 맞춰 바뀜)
  lastRun: null,  // '최근 보고서 보기' 대상
  running: false, phaseText: "대기 중",
  stage: new Lane(), lanes: {},
};
const UI = { submitting: false, subT: 0, focused: null, swipedAt: 0, dragY: null, mine: new Set() }; // mine: 이 화면에서 지시한 run_id
const A = n => D.agents[n];
const who = n => (D.agents[n] ? n : D.leader);
const lane = n => (D.lanes[n] ||= new Lane());
const memberDef = n => A(n)?.def || { label: niceName(n || "?"), color: "#6b7489" };
function niceName(n) { n = String(n); return KNOWN[n.toLowerCase()]?.label || (n.length <= 3 ? n.toUpperCase() : n[0].toUpperCase() + n.slice(1)); }

/** 팀 정보 정리: 이름 중복 제거, 팀원 수 제한 없음(3D 자리는 MAX_DESKS 까지, 나머지는 목록 전용). 팀장은 항상 포함된다. */
function normTeam(t) {
  const seen = new Set();
  const members = (Array.isArray(t?.members) ? t.members : [])
    .filter(m => m && m.name != null && String(m.name) && !seen.has(String(m.name)) && seen.add(String(m.name)))
    .map(m => ({ name: String(m.name), role: String(m.role || ""), model: String(m.model || ""), provider: String(m.provider || "") }));
  if (!members.length) return normTeam(DEMO_TEAM);
  return { leader: seen.has(String(t.leader)) ? String(t.leader) : members[0].name, members };
}

/** hello.team 으로 팀원 카드·캐릭터·책상을 새로 만든다. */
function buildTeam(team) {
  for (const n of D.names) A(n).dispose();
  D.agents = {}; D.leader = team.leader; D.teamKey = JSON.stringify(team);
  const order = [team.leader, ...team.members.map(m => m.name).filter(n => n !== team.leader)];
  const used = new Set();
  let extra = 0;
  const defs = order.map((n, i) => {
    const m = team.members.find(x => x.name === n), k = KNOWN[n.toLowerCase()];
    let initial = k?.initial || niceName(n)[0];
    if (used.has(initial)) initial = niceName(n).slice(0, 2);
    used.add(initial);
    return {
      label: niceName(n), initial, color: k?.color || PALETTE[extra++ % PALETTE.length], hair: HAIR[i % HAIR.length],
      role: m.role.split(".")[0].trim() || "팀원", model: m.model, leader: n === team.leader,
    };
  });
  const spots = layout(order.slice(0, MAX_DESKS), defs[0].color), nowhere = { x: 0, z: 0 };
  order.forEach((n, i) => (D.agents[n] = new Agent(n, defs[i], spots[i] || { seat: nowhere, meet: nowhere, coffee: nowhere, screen: null })));
  D.names = order;
  if (HAS3D && order.length > MAX_DESKS) { // 팀장에게 몰아넣지 않고, 자리 없는 팀원은 목록·보드에만 보여 준다
    const msg = `팀원이 ${order.length}명이라 3D 사무실에는 ${MAX_DESKS}명까지만 자리가 있어요. ${order.slice(MAX_DESKS).map(niceName).join(", ")}은(는) 팀원 목록과 업무 보드에만 표시됩니다.`;
    setTimeout(() => { toast(msg, "warn", 9000); log(msg); });
  }
  strokes.forEach((s, i) => s.material.color.set(i < defs.length && i < 4 ? defs[i].color : "#6b7489"));
  buildMembers();
  $("memberCount").textContent = `${order.length}명`;
  brandSub();
  UI.focused = null; frame(false); // 책상 줄 길이가 바뀌었으니 카메라를 다시 맞춘다
}
function brandSub() {
  const names = D.names.length > 4 ? `팀원 ${D.names.length}명` : D.names.map(n => A(n).def.label).join(" · ");
  $("brandSub").textContent = `${names} 멀티 에이전트 팀${D.mock ? " · 모의 실행" : ""}`;
}

/* ───────────────────────── 화면(UI) ───────────────────────── */
function buildMembers() {
  const box = $("members");
  box.replaceChildren();
  for (const n of D.names) {
    const a = A(n), d = a.def;
    const badge = el("span", { class: "badge", text: "대기" }), task = el("span", { class: "task-text", text: "—" });
    const time = el("span", { class: "task-time" }), bar = el("span", { class: "bar" }, el("i"));
    const title = a.ghost ? `${d.label}${d.model ? ` · ${d.model}` : ""}${HAS3D ? " (3D 자리 없음)" : ""}` : `${d.label} 쪽으로 카메라 이동`;
    box.append(el("button", { class: "member", type: "button", style: { "--c": d.color }, title, onclick: () => focusAgent(n) },
      el("span", { class: "row" },
        el("span", { class: "avatar", text: d.initial }),
        el("span", { class: "who" },
          el("span", { class: "name" }, d.label, d.leader ? el("span", { title: "팀장", text: " 👑" }) : null),
          el("span", { class: "role", text: d.role, title: d.model || null })),
        badge),
      el("span", { class: "task" }, task, time),
      bar));
    a.card = { badge, task, time, bar, st: { ...IDLE } };
  }
  renderSummary();
}
function setMember(n, patch) {
  const a = A(n);
  if (!a?.card) return;
  const c = a.card, s = Object.assign(c.st, patch);
  c.badge.textContent = s.status; c.badge.className = `badge ${s.cls || ""}`;
  c.task.textContent = s.task || "—"; c.task.title = s.task || "";
  c.bar.className = `bar ${s.bar || ""}`;
  tickMember(a);
  renderSummary();
}
function tickMember(a) {
  const s = a.card?.st;
  if (s) a.card.time.textContent = s.t0 ? (s.approx && !s.t1 ? "≥" : "") + fmtDur((s.t1 || performance.now()) - s.t0) : "";
}
function renderSummary() {
  const groups = {};
  for (const n of D.names) {
    const st = A(n).card?.st.status;
    if (BUSY.includes(st)) (groups[st] ||= []).push(A(n).def.label);
  }
  const act = Object.entries(groups).map(([st, ls]) => `${ls.join("·")} ${st}`).join(", ");
  $("summary").textContent = act ? `${D.phaseText} · ${act}` : D.running ? D.phaseText : `${D.phaseText} · 목표를 입력해 보세요`;
}
function setPhase(text, live) {
  D.phaseText = text;
  $("phaseText").textContent = text;
  $("phaseDot").classList.toggle("live", !!live);
  $("sumDot").classList.toggle("live", !!live);
  renderSummary();
}
function renderBoard() {
  const run = D.shown, tasks = run ? [...run.tasks.values()] : [], box = $("board");
  $("taskCount").textContent = `${tasks.length}건`;
  $("tabCount").textContent = tasks.length ? ` ${tasks.filter(t => t.vstate === "done" || t.vstate === "failed").length}/${tasks.length}` : "";
  if (!tasks.length) {
    box.replaceChildren(el("div", { class: "empty", text: run && D.running ? "팀장이 계획을 세우는 중입니다…" : "목표를 입력하면 팀장이 업무를 배정합니다." }));
    return;
  }
  const card = t => {
    const d = memberDef(t.assignee), fin = t.vstate === "done" || t.vstate === "failed";
    return el(fin ? "button" : "div", { class: `card ${t.vstate}`, type: fin ? "button" : null, title: fin ? "결과 보기" : t.title, onclick: fin ? () => openTask(run, t.id) : null },
      el("span", { class: "tag", style: { background: d.color }, text: d.label }),
      el("span", { class: "ttl", text: `#${t.id} ${t.title}` }),
      t.vstate === "failed" ? el("span", { class: "fail-badge", text: "실패" }) : null,
      t.depends_on.length ? el("span", { class: "dep", text: `← #${t.depends_on.join(",#")}` }) : null);
  };
  // 빈 묶음은 숨기고, 지금 보는 것이 중요한 순서(진행 중 → 대기 → 완료)로 놓는다
  const col = (title, list) => (list.length ? [el("div", { class: "col-title", text: `${title} · ${list.length}` }), ...list.map(card)] : []);
  box.replaceChildren(...col("진행 중", tasks.filter(t => t.vstate === "doing")), ...col("대기", tasks.filter(t => t.vstate === "todo")),
    ...col("완료", tasks.filter(t => t.vstate === "done" || t.vstate === "failed")));
}
function log(msg, n, cls) {
  const d = n && A(n)?.def;
  const box = $("log");
  box.prepend(el("div", { class: cls || null }, el("time", { text: hhmm(new Date(), true) }),
    d ? el("b", { style: { color: d.color }, text: d.label }) : el("b", { class: "sys", text: "시스템" }), msg));
  while (box.childElementCount > 200) box.lastChild.remove();
}
function tickClock() {
  const r = D.run;
  if (D.running && r) { const s = Math.max(0, Math.floor((Date.now() - r.wall0) / 1000)); $("clock").textContent = `⏱ ${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
  else $("clock").textContent = hhmm();
}
function updateInput() {
  const busy = D.running || UI.submitting;
  $("goal").disabled = $("runBtn").disabled = busy;
  $("runBtn").textContent = D.running ? "진행 중…" : UI.submitting ? "요청 중…" : "업무 지시";
  $("goal").placeholder = D.running ? "팀이 업무를 진행하고 있어요…"
    : mqMobile.matches ? "목표를 입력하세요" : mqNarrow.matches ? "팀에게 맡길 목표를 입력하세요" : `팀에게 맡길 목표를 입력하세요 (예: ${EXAMPLE_GOAL})`;
  renderSummary();
}
function setSpeed(s) {
  SPEED = [1, 2, 4].includes(s) ? s : 1;
  store.set("agentOffice.speed", SPEED);
  for (const b of $("speed").children) { const on = +b.dataset.s === SPEED; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
  $("speedCycle").textContent = `${SPEED}×`;
  $("speedCycle").setAttribute("aria-label", `연출 속도 ${SPEED}배 (눌러서 변경)`);
}
function focusAgent(n) {
  const a = A(n);
  if (!a || a.ghost) return; // 3D 가 없거나 자리가 없는 팀원은 카메라 이동 없음
  if (mqMobile.matches && !mqSide.matches) setDock(false); // 가로 모드는 시트가 옆에 있어 닫을 필요가 없다
  if (UI.focused === n) { resetView(); return; }
  UI.focused = n;
  const p = a.group.position;
  setView(cam.view, new THREE.Vector3(p.x, 0, p.z), true, Math.min(controls.maxZoom, 1.8));
  a.say(`${a.def.role} ${a.def.label}입니다!`, 1800);
}
function setDock(open, tab) {
  const d = $("dock");
  if (tab) {
    d.dataset.tab = tab;
    for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.tab === tab);
  }
  if (d.classList.contains("open") === open) return;
  d.classList.toggle("open", open);
  $("dockHandle").setAttribute("aria-expanded", open);
  clearTimeout(UI.frameT);
  if (mqMobile.matches) UI.frameT = setTimeout(reframe, 320); // transitionend 가 안 오는 경우 대비
}

/* 모달(보고서·지난 업무) */
const modal = { back: null };
function openModal(children, compact = false) {
  const m = $("modal"), sheet = $("sheet");
  if (m.hidden) modal.back = document.activeElement;
  sheet.classList.toggle("compact", compact); // 짧은 내용(키 입력)은 휴대폰에서도 화면 전체를 덮지 않는다
  sheet.replaceChildren(...children);
  m.hidden = false;
  sheet.querySelector(".sheet-body")?.scrollTo(0, 0);
  sheet.querySelector(".x")?.focus({ preventScroll: true });
}
function closeModal() {
  $("modal").hidden = true;
  $("sheet").replaceChildren();
  if (modal.back?.isConnected) modal.back.focus({ preventScroll: true });
}
function sheetHead(title, sub, back) {
  return el("header", { class: "sheet-head" },
    back ? el("button", { class: "icon-btn", type: "button", "aria-label": "목록으로", onclick: back, text: "←" }) : null,
    el("div", { class: "sheet-title" }, el("h2", { id: "modalTitle", text: title }), sub ? el("p", { class: "sub", text: sub }) : null),
    el("button", { class: "icon-btn x", type: "button", "aria-label": "닫기", onclick: closeModal, text: "✕" }));
}
/* LLM 이 만든 마크다운(결과·보고서) 렌더링: marked → DOMPurify(엄격한 허용 목록) 를 거친 것만 innerHTML 로 넣는다.
   문서 구조(제목·목록·표·코드·인용·링크·이미지)만 남기고, 화면을 덮거나 꾸미거나 입력을 받는 요소·속성은 모두 뺀다.
   이미지는 data: 또는 같은 출처만 허용하고, 그 밖의 주소는 대체 텍스트로 바꾼다(외부로 요청이 나가지 않게). */
const PURIFY = {
  ALLOWED_TAGS: ["a", "abbr", "b", "blockquote", "br", "caption", "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span",
    "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "var"],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "align", "colspan", "rowspan", "start", "reversed", "open"],
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed", "video", "audio", "source",
    "picture", "svg", "math", "link", "meta", "base", "script", "template", "frame", "frameset", "dialog"],
  FORBID_ATTR: ["style", "id", "class", "name", "srcset", "action", "formaction", "background", "ping"],
  ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, ALLOW_UNKNOWN_PROTOCOLS: false,
};
const SAFE_DATA_IMG = /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);base64,/i;
function safeImgSrc(src) {
  if (SAFE_DATA_IMG.test(src)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^https?:/i.test(src)) return false; // data:(다른 형식)·blob: 등
  try { return new URL(src, location.href).origin === location.origin; } catch { return false; }
}
if (window.DOMPurify) {
  DOMPurify.addHook("uponSanitizeAttribute", (n, d) => { if (/^on/i.test(d.attrName)) d.keepAttr = false; });
  DOMPurify.addHook("afterSanitizeAttributes", n => {
    if (n.tagName === "A" && n.hasAttribute("href")) { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
    if (n.tagName === "IMG" && !safeImgSrc(n.getAttribute("src") || "")) n.removeAttribute("src"); // 아래 md() 에서 대체 텍스트로 바뀐다
  });
}
if (window.marked) marked.use({ renderer: { checkbox(c) { return (typeof c === "object" ? c?.checked : c) ? "☑" : "☐"; } } }); // input 대신 글자
function md(src) {
  const box = el("div", { class: "md" }), text = String(src ?? "");
  try {
    if (window.marked && window.DOMPurify) {
      box.innerHTML = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }), PURIFY);
      for (const img of box.querySelectorAll("img:not([src])")) {
        const alt = img.getAttribute("alt") || "";
        img.replaceWith(el("span", { class: "img-alt", title: "외부 이미지는 표시하지 않아요", text: alt ? `[이미지: ${alt}]` : "[이미지]" }));
      }
      return box;
    }
  } catch (e) { console.warn(e); }
  box.replaceChildren(el("pre", { class: "plain", text }));
  return box;
}
const runView = run => ({ run_id: run.run_id, goal: run.goal, summary: run.summary, report: run.report, dir: run.dir, error: run.error, tasks: [...run.tasks.values()] });
function openReport(v, back) {
  const items = v.tasks.map(t => {
    const d = memberDef(t.assignee), failed = t.state === "failed";
    return el("details", { class: "res" },
      el("summary", null, el("span", { class: "tag", style: { background: d.color }, text: d.label }),
        el("span", { class: "ttl", text: `#${t.id} ${t.title}` }), failed ? el("span", { class: "fail-badge", text: "실패" }) : null),
      t.result ? md(t.result) : el("p", { class: "muted small", text: t.state === "doing" ? "진행 중입니다." : "결과가 아직 없습니다." }));
  });
  openModal([
    sheetHead("최종 보고서", v.goal || v.run_id, back),
    el("div", { class: "sheet-body" },
      v.summary ? el("p", { class: "plan-sum" }, el("b", { text: "계획 · " }), v.summary) : null,
      v.error ? el("div", { class: "err-box", text: `오류: ${clip(v.error, 2000)}` }) : null,
      v.report ? md(v.report) : el("p", { class: "muted", text: "아직 최종 보고서가 없습니다." }),
      items.length ? [el("h3", { class: "sec", text: `업무별 결과 · ${items.length}건` }), items] : null),
    el("footer", { class: "sheet-foot" },
      v.dir ? el("span", { class: "muted small", title: v.dir, text: `저장 위치: ${v.dir}` }) : null,
      el("button", { class: "btn", type: "button", onclick: closeModal, text: "닫기" })),
  ]);
}
function openTask(run, id) {
  const t = run.tasks.get(id);
  if (!t) return;
  const d = memberDef(t.assignee);
  openModal([
    sheetHead(`#${t.id} ${t.title}`, `${d.label} · ${STATE_KO[t.state] || ""}${t.t1 && t.t0 && !t.approx ? ` · ${fmtDur(t.t1 - t.t0)}` : ""}`),
    el("div", { class: "sheet-body" }, t.result ? md(t.result) : el("p", { class: "muted", text: "결과가 아직 없습니다." })),
    el("footer", { class: "sheet-foot" },
      run.report ? el("button", { class: "tbtn", type: "button", onclick: () => openReport(runView(run)), text: "최종 보고서 보기" }) : null,
      el("button", { class: "btn", type: "button", onclick: closeModal, text: "닫기" })),
  ]);
}

/* 접속 키 입력: 4401(키 없음·틀림)이면 열린다. 터미널에 표시된 키나 ?key= 가 붙은 주소 전체를 붙여 넣으면 된다. */
function openKeyDialog(msg) {
  const input = el("input", { id: "keyInput", class: "key-input", type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
    spellcheck: "false", enterkeyhint: "go", "aria-describedby": "keyHelp", placeholder: "접속 키 붙여 넣기" });
  const err = el("p", { class: "error-text small", role: "alert", hidden: !msg, text: msg || "" });
  const form = el("form", { class: "sheet-form", autocomplete: "off", onsubmit: e => { e.preventDefault(); applyKey(input.value, err); } },
    el("div", { class: "sheet-body" },
      el("label", { class: "field-label", for: "keyInput", text: "접속 키" }),
      input, err,
      el("p", { id: "keyHelp", class: "muted small", text: "서버를 켠 컴퓨터의 터미널에 표시된 ‘접속 키’를 붙여 넣으세요. 휴대폰 주소 전체(…?key=…)를 붙여 넣어도 됩니다. QR 코드로 접속하면 자동으로 입력돼요." })),
    el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "submit", text: "연결" })));
  openModal([sheetHead("접속 키 입력", "이 서버는 접속 키가 있어야 쓸 수 있어요."), form], true);
  if (!matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
}
function applyKey(raw, err) {
  let k = String(raw || "").trim();
  const m = /[?&]key=([^&#\s]+)/.exec(k);
  if (m) { try { k = decodeURIComponent(m[1]); } catch { k = m[1]; } }
  if (!k) { err.textContent = "접속 키를 입력해 주세요."; err.hidden = false; return; }
  KEY = k; store.set("agentOffice.key", k);
  NET.keyTried = true;
  closeModal();
  setConn("connecting");
  clearTimeout(NET.timer);
  if (NET.ws) { const ws = NET.ws; NET.ws = null; ws.onclose = ws.onmessage = null; try { ws.close(); } catch { /* 이미 닫힘 */ } }
  connect();
}

/* 지난 업무 (GET /api/runs, /api/runs/{id}) */
function api(path, opt = {}) {
  const headers = { ...(opt.body ? { "Content-Type": "application/json" } : {}), ...(KEY ? { "X-Access-Key": KEY } : {}) };
  return fetch(path, { ...opt, headers, cache: "no-store" });
}
async function getJSON(path) {
  const r = await api(path);
  if (r.status === 401 || r.status === 403) throw new Error(KEY_MSG);
  if (!r.ok) throw new Error(`불러오지 못했어요 (${r.status})`);
  return r.json();
}
function fmtCreated(c) {
  const d = new Date(c);
  return Number.isNaN(d.getTime()) ? String(c || "") : `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${hhmm(d)}`;
}
async function openRuns() {
  const body = el("div", { class: "sheet-body" }, el("p", { class: "muted", text: "불러오는 중…" }));
  openModal([sheetHead("지난 업무", "저장된 실행 기록 (최근 50건)"), body]);
  try {
    const data = await getJSON("/api/runs");
    const list = (Array.isArray(data) ? data : data?.runs || []).filter(r => r && r.run_id);
    if (!body.isConnected) return;
    body.replaceChildren(list.length
      ? el("div", { class: "runs" }, list.map(r => el("button", { class: "run-item", type: "button", onclick: () => openRun(String(r.run_id)) },
        el("span", { class: "run-goal", text: clip(r.goal || "(목표 없음)", 140) }),
        el("span", { class: "run-meta" }, fmtCreated(r.created || r.run_id), r.has_error ? el("span", { class: "fail-badge", text: "오류" })
          : r.has_report === false ? el("span", { class: "muted", text: " · 보고서 없음" }) : null))))
      : el("p", { class: "muted", text: "아직 저장된 업무가 없어요." }));
  } catch (e) {
    if (body.isConnected) body.replaceChildren(el("p", { class: "error-text", text: e.message || "목록을 불러오지 못했어요." }));
  }
}
async function openRun(id) {
  const body = el("div", { class: "sheet-body" }, el("p", { class: "muted", text: "불러오는 중…" }));
  openModal([sheetHead("지난 업무", id, openRuns), body]);
  try {
    const v = normRun(await getJSON(`/api/runs/${encodeURIComponent(id)}`), id);
    if (body.isConnected) openReport(v, openRuns);
  } catch (e) {
    if (body.isConnected) body.replaceChildren(el("p", { class: "error-text", text: e.message || "기록을 불러오지 못했어요." }));
  }
}
/** /api/runs/{id} 응답(plan + task-*.md 파일)을 보고서 화면 형식으로 바꾼다. */
function normRun(d, id) {
  d = d && typeof d === "object" ? d : {};
  const plan = d.plan && typeof d.plan === "object" ? d.plan : {}, byId = new Map();
  for (const t of Array.isArray(plan.tasks) ? plan.tasks : []) {
    if (t && typeof t === "object") byId.set(String(t.id), { id: t.id, assignee: String(t.assignee || ""), title: String(t.title || `업무 ${t.id}`), state: "todo", result: "" });
  }
  for (const f of Array.isArray(d.tasks) ? d.tasks : []) {
    if (!f || typeof f !== "object") continue;
    const m = /^task-0*(\d+)-([^.]+)\.md$/.exec(String(f.file || ""));
    const key = m ? m[1] : String(f.id ?? "");
    const t = byId.get(key) || { id: key, assignee: m ? m[2] : String(f.assignee || ""), title: `업무 ${key}` };
    const body = String(f.content ?? f.result ?? "").replace(/^# #\d+[^\n]*\n+/, "");
    Object.assign(t, { result: body, state: /^\(실패: /.test(body.trim()) ? "failed" : "done" });
    byId.set(key, t);
  }
  return { run_id: d.run_id || id, goal: String(d.goal || ""), summary: String(plan.summary || d.summary || ""), report: d.report ? String(d.report) : "",
    error: d.error ? String(d.error) : "", tasks: [...byId.values()] };
}

/* ───────────────────────── 연출 감독(Director) ─────────────────────────
   이벤트는 언제 올지 모른다(LLM 호출 5~120초, 팀원별 업무는 동시에 시작·종료).
   - 단계 이벤트(run_start/plan_start/plan/review_start/report/run_error/run_end)는 전역 순차 큐(D.stage)
   - task_start/task_done 은 팀원별 순차 큐(lane). 계획 회의 연출이 끝나야(gate) 움직이고,
     업무 시작 연출은 선행 업무(depends_on)의 완료 연출(fin)이 끝난 뒤에 한다(최대 60초).
   - review_start 는 모든 팀원 큐가 비워질 때까지 기다린다.
   - 데이터(run.tasks[].state)는 도착 즉시, 화면(vstate·보드·로그)은 연출 시점에 바뀐다. 중복·순서 뒤바뀜은 상태로 걸러 낸다. */
function newRun(run_id, goal, open) {
  const gate = deferred();
  if (open) gate.resolve();
  return { run_id: String(run_id ?? ""), goal: String(goal ?? ""), summary: "", report: null, dir: "", error: "",
    tasks: new Map(), gate, planned: false, ended: false, ok: false, wall0: Date.now() };
}
const openGate = run => run && run.gate.resolve();
function addTask(run, raw) {
  const id = tid(raw.id), old = run.tasks.get(id);
  const t = Object.assign(old || { state: "todo", vstate: "todo", result: "", ok: true, t0: 0, t1: 0, approx: false, fin: deferred() }, {
    id, assignee: who(raw.assignee), title: String(raw.title || old?.title || `업무 ${id}`),
    depends_on: Array.isArray(raw.depends_on) ? raw.depends_on.map(tid) : old?.depends_on || [],
  });
  run.tasks.set(id, t);
  return t;
}
function runIdTime(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id || "");
  if (!m) return null;
  const t = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), now = Date.now();
  return t <= now + 60000 && now - t < 864e5 ? t : null;
}

function dispatch(ev) {
  ev._at = performance.now();
  const T = ev.type;
  if (T === "hello") return onHello(ev);
  if (T === "task_start" || T === "task_done") return onTask(ev);
  const play = PLAY[T];
  if (!play || !model(ev)) return;
  const done = D.stage.push(() => play(ev), CAP[T]);
  if (T === "plan") done.then(() => openGate(ev._run)); // 계획 연출이 어떻게 끝나든 팀원 큐는 풀어 준다
}

/** 단계 이벤트의 데이터 반영(도착 즉시). 중복이면 false. */
function model(ev) {
  const T = ev.type;
  if (T === "run_start") {
    if (D.run && !D.run.ended && D.run.run_id === String(ev.run_id)) return false;
    D.run = newRun(ev.run_id, ev.goal, false);
    UI.submitting = false; clearTimeout(UI.subT);
  } else if (T === "run_end") {
    if (!D.run || D.run.ended) return false;
  } else if (!D.run || D.run.ended) D.run = newRun(ev.run_id, "", T !== "plan_start" && T !== "plan");
  const run = ev._run = D.run;
  if (T === "plan") {
    if (run.planned) return false;
    run.planned = true;
    run.summary = String(ev.summary || "");
    for (const t of Array.isArray(ev.tasks) ? ev.tasks : []) if (t && typeof t === "object") addTask(run, t);
  } else if (T === "report") {
    run.report = String(ev.report || ""); run.dir = String(ev.dir || ""); D.lastRun = run;
  } else if (T === "run_error") run.error = String(ev.message || "알 수 없는 오류");
  else if (T === "run_end") { run.ended = true; run.ok = !!ev.ok; }
  if (T !== "run_end") D.running = true;
  updateInput();
  return true;
}

function onTask(ev) {
  if (!D.run || D.run.ended) D.run = newRun(ev.run_id, "", true);
  const run = ev._run = D.run;
  D.running = true; updateInput();
  ev.assignee = who(ev.assignee);
  ev.id = tid(ev.id);
  const t = run.tasks.get(ev.id) || addTask(run, { id: ev.id, assignee: ev.assignee, title: `업무 #${ev.id}` });
  if (ev.type === "task_start") {
    if (t.state !== "todo") return; // 중복
    t.state = "doing"; t.t0 = ev._at;
  } else {
    if (t.state === "done" || t.state === "failed") return; // 중복
    t.ok = ev.ok !== false; t.state = t.ok ? "done" : "failed";
    t.t1 = ev._at; t.t0 ||= ev._at; t.result = String(ev.result ?? "");
  }
  lane(ev.assignee).push(() => (ev.type === "task_start" ? pTaskStart(ev) : pTaskDone(ev)), 150000);
}

const CAP = { run_start: 15000, plan_start: 30000, plan: 90000, review_start: 200000, report: 30000, run_error: 15000, run_end: 20000 };
const PLAY = { run_start: pRunStart, plan_start: pPlanStart, plan: pPlan, review_start: pReview, report: pReport, run_error: pError, run_end: pEnd };

/** 이동 + 시간 제한. 도착하면 true, 다른 이동에 밀리면 false. */
async function go(a, p, cap = 20000) {
  const g = epoch;
  const r = await Promise.race([a.walkTo(p), sleep(cap).then(() => "late")]);
  alive(g);
  if (r === "late") { a.finishWalk(); return true; }
  return r;
}
const L = () => A(D.leader);
const shown = run => run === D.shown && renderBoard();
const later = p => p.catch(e => { if (e !== STALE) console.error(e); });
const sitAtDesk = (a, mode = "sit") => later(go(a, a.seat).then(ok => ok && a.sitDesk(mode)));
const REPORT_SPOT = l => ({ x: l.seat.x + 1.5, z: l.seat.z - .3 });

/** 할 일이 없을 때: 남은 업무가 있으면 커피 코너, 이번 업무가 아예 없으면 회의 테이블에서 쉰다. */
function idle(n, run) {
  const a = A(n);
  if (!a) return;
  const mine = run ? [...run.tasks.values()].filter(t => t.assignee === n) : [];
  if (mine.length && !mine.some(t => t.vstate === "todo")) {
    setMember(n, { status: "휴식", cls: "" });
  } else if (mine.length) setMember(n, { ...IDLE, status: "대기", cls: "wait", task: "선행 업무 기다리는 중 ☕" });
  else {
    setMember(n, { ...IDLE, task: "이번 업무는 배정 없음" });
    later(go(a, a.meet).then(ok => { if (ok) { a.face(TABLE); a.mode = "sit"; } }));
    return;
  }
  later(go(a, a.coffee).then(ok => {
    if (!ok) return;
    a.face(COUNTER); a.mode = "coffee";
    if (Math.random() < .6) a.say(pick(["커피 한 잔 ☕", "잠깐 숨 돌릴게요", "다음 거 기다리는 중"]), 1500);
  }));
}

async function pRunStart(ev) {
  const run = ev._run;
  D.shown = run; renderBoard(); clearStrokes();
  $("reportBtn").hidden = true;
  for (const n of D.names) setMember(n, { ...IDLE });
  setPhase("업무 접수", true);
  log(`새 목표: “${clip(run.goal, 160)}”`);
  L()?.say("새 업무가 들어왔어요! 👀", 1800);
  await wait(600);
}

async function pPlanStart(ev) {
  const l = L();
  setPhase("계획 수립", true);
  setMember(D.leader, { status: "계획 중", cls: "meet", task: "목표를 업무로 나누는 중", bar: "busy", t0: ev._at, t1: 0 });
  log("업무 계획을 세우는 중입니다.", D.leader);
  l.say("목표 확인! 계획 세워볼게요 📝", 2200);
  if (await go(l, WHITEBOARD)) { l.face(BOARD_FACE); l.mode = "write"; strokeAt = performance.now(); }
  // 계획(plan)이 올 때까지 필기는 계속된다(ambient 가 줄을 하나씩 채운다).
}

async function pPlan(ev) {
  const run = ev._run, l = L(), tasks = [...run.tasks.values()];
  setPhase("업무 배정 회의", true);
  if (l.mode === "write") while (strokeN < strokes.length) { showStroke(); await wait(200); }
  else for (let i = strokeN; i < strokes.length; i++) showStroke();
  renderBoard();
  log(`업무 ${tasks.length}건으로 분해했습니다.`, D.leader);
  if (run.summary) log(`계획: ${clip(run.summary, 200)}`, D.leader);
  l.say("다들 회의실로 모여주세요!", 1800);
  setMember(D.leader, { status: "회의", cls: "meet", task: "킥오프 회의", bar: "", t0: 0 });
  await capped(Promise.all(D.names.map(async n => {
    const a = A(n);
    if (n !== D.leader) setMember(n, { ...IDLE, status: "회의", cls: "meet", task: "킥오프 회의" });
    if (await go(a, a.meet)) { a.face(TABLE); a.mode = "talk"; }
  })), 25000);
  for (const t of tasks) {
    const a = A(t.assignee);
    l.say(`#${t.id} ${clip(t.title, 26)} → ${a.def.label}`, 1500);
    await wait(550);
    a.say(t.assignee === D.leader ? "제가 직접 맡을게요 ✍️" : pick(LINES.accept), 1100);
    log(`#${t.id} ${t.title} 배정`, t.assignee);
    await wait(450);
  }
  l.say("그럼 시작해 볼까요? 🚀", 1400);
  await wait(500);
  setPhase("업무 진행", true);
  for (const n of D.names) { A(n).mode = "stand"; setMember(n, { ...IDLE }); }
  openGate(run);
  for (const n of D.names) if (!lane(n).n) idle(n, run); // 바로 할 일이 없는 팀원은 커피/회의 테이블로
}

async function pTaskStart(ev) {
  const g = epoch, run = ev._run;
  await capped(run.gate.p, 90000); alive(g);
  let t = run.tasks.get(ev.id);
  // 선행 업무가 화면에서 '완료'로 보인 뒤에 시작한다(다른 팀원 큐가 앞서가도 순서가 뒤바뀌지 않게)
  const deps = (t?.depends_on || []).map(id => run.tasks.get(id)?.fin.p).filter(Boolean);
  if (deps.length) { await capped(Promise.all(deps), 60000); alive(g); }
  t = run.tasks.get(ev.id);
  const a = A(ev.assignee);
  if (!t || t.vstate !== "todo" || !a) return;
  t.vstate = "doing"; shown(run);
  setMember(ev.assignee, { status: "작업 중", cls: "work", task: `#${t.id} ${t.title}`, bar: "busy", t0: t.t0 || ev._at, t1: 0, approx: false });
  log(`#${t.id} 시작`, ev.assignee);
  a.say(pick(LINES.start), 1400);
  if (await go(a, a.seat)) a.sitDesk("type");
}

async function pTaskDone(ev) {
  const g = epoch, run = ev._run;
  await capped(run.gate.p, 90000); alive(g);
  const t = run.tasks.get(ev.id), a = A(ev.assignee);
  if (!t || t.vstate === "done" || t.vstate === "failed" || !a) return;
  if (t.vstate === "todo") await pTaskStart({ ...ev, type: "task_start" }); // 시작 연출을 못 했으면 먼저
  if (a.mode === "type") await wait(Math.max(0, 1400 - (performance.now() - a.typingSince) * SPEED)); // 타이핑은 잠깐이라도 보이게
  const ok = t.ok;
  t.vstate = ok ? "done" : "failed"; t.fin.resolve(); shown(run);
  setMember(ev.assignee, { status: ok ? "완료" : "실패", cls: ok ? "ok" : "fail", bar: ok ? "full" : "fail", t1: t.t1 || ev._at });
  if (a.mode === "type") a.mode = "sit";
  a.say(ok ? `#${t.id} 완료! ✅` : `#${t.id} 실패… 😥`, 1800);
  log(`#${t.id} ${ok ? "완료" : "실패"} · ${t.approx ? "≥" : ""}${fmtDur((t.t1 || ev._at) - (t.t0 || ev._at))}`, ev.assignee, ok ? null : "err");
  if (!ok) toast(`${a.def.label}: #${t.id} ${clip(t.title, 30)} 업무가 실패했어요.`, "warn");
  await wait(1200);
  if (lane(ev.assignee).n <= 1 && !run.ended) idle(ev.assignee, run);
}

async function pReview(ev) {
  const g = epoch, run = ev._run, l = L();
  await capped(Promise.all(Object.values(D.lanes).map(x => x.p)), 150000); alive(g);
  setPhase("검수·보고", true);
  setMember(D.leader, { status: "검수 중", cls: "meet", task: "결과물 검수", bar: "busy", t0: ev._at, t1: 0, approx: false });
  log("결과물을 검수합니다.", D.leader);
  if (await go(l, l.seat)) l.sitDesk("sit");
  const reporters = D.names.filter(n => n !== D.leader && [...run.tasks.values()].some(t => t.assignee === n));
  for (const n of reporters) {
    const a = A(n);
    setMember(n, { status: "보고", cls: "meet", task: "팀장에게 결과 보고", bar: "", t0: 0 });
    if (!(await go(a, REPORT_SPOT(l)))) continue;
    a.face(l.group.position); a.mode = "talk";
    a.say("결과물 보고드립니다 📄", 1500);
    await wait(1100);
    l.say(pick(LINES.review), 1300);
    await wait(900);
    setMember(n, { ...IDLE, task: "보고 완료" });
    sitAtDesk(a);
  }
  l.sitDesk("type");
  l.say("최종 보고서 작성 중… ✍️", 1800);
}

async function pReport(ev) {
  const run = ev._run, l = L();
  await wait(500);
  l.sitDesk("sit");
  l.say("최종 보고서 완성! 🎉", 3000);
  setMember(D.leader, { status: "완료", cls: "ok", task: "최종 보고서 작성", bar: "full", t1: ev._at });
  log("최종 보고서를 작성했습니다.", D.leader);
  setPhase("보고 완료", true);
  D.lastRun = run;
  $("reportBtn").hidden = false;
  await wait(900);
  // 보고서 창은 이 화면에서 업무를 지시한 사람에게만 자동으로 연다. 다른 접속자에게는 알림 + '최근 보고서' 버튼
  if (run === D.shown && UI.mine.has(run.run_id) && $("modal").hidden) openReport(runView(run));
  else if (run === D.shown) toast("최종 보고서가 도착했어요. 입력창 옆 ‘최근 보고서’ 버튼으로 볼 수 있어요.", "info", 6000);
}

async function pError(ev) {
  const run = ev._run, msg = run.error || String(ev.message || "알 수 없는 오류");
  L()?.say("문제가 생겼어요 😥", 3500);
  toast(`오류: ${clip(msg, 140)}`, "error", 7000);
  log(`오류: ${clip(msg, 400)}`, D.leader, "err");
  setPhase("오류 발생", false);
  await wait(1200);
}

async function pEnd(ev) {
  const run = ev._run;
  openGate(run);
  for (const t of run.tasks.values()) t.fin.resolve(); // 끝난 실행: 선행 업무를 기다리던 시작 연출을 풀어 준다
  await wait(600);
  clearStrokes();
  for (const n of D.names) {
    const a = A(n);
    setMember(n, { ...IDLE });
    if (a.mode !== "sit" || Math.hypot(a.group.position.x - a.seat.x, a.group.position.z - a.seat.z) > .1) sitAtDesk(a);
  }
  setPhase(run.ok ? "완료" : "중단됨", false);
  log(run.ok ? "업무를 마쳤습니다. 다음 목표를 기다립니다." : "업무가 중단되었습니다.");
  if (D.run === run) { D.running = false; updateInput(); }
}

/* hello: 팀 구성 + 스냅샷으로 즉시 재구성(중간 합류·재연결). 진행 중이던 연출은 모두 취소한다. */
function onHello(ev) {
  epoch++;
  openGate(D.run); openGate(D.shown);
  D.stage = new Lane(); D.lanes = {};
  const team = normTeam(ev.team);
  if (JSON.stringify(team) !== D.teamKey) buildTeam(team);
  D.mock = !!ev.mock; brandSub();
  for (const n of D.names) A(n).finishWalk();
  const first = !D.greeted;
  D.greeted = true;
  if (first) log(NET.mode === "demo" ? "데모 사무실에 출근했습니다. 목표를 입력해 보세요." : "사무실에 출근했습니다. 목표를 입력해 주세요.");
  else log(ev._was === "demo" || ev._was === "auth" ? "서버에 연결되었습니다. 이제 실제 팀이 일합니다." : "서버에 다시 연결되었습니다.");
  applySnapshot(ev.snapshot && typeof ev.snapshot === "object" ? ev.snapshot : null, first);
}

function applySnapshot(s, first) {
  clearStrokes();
  UI.submitting = false;
  for (const n of D.names) setMember(n, { ...IDLE });
  if (!s) {
    D.run = D.shown = null; D.running = false;
    for (const n of D.names) { const a = A(n); a.teleport(a.seat, Math.PI); a.mode = "sit"; }
    renderBoard(); setPhase("대기 중", false); updateInput();
    return;
  }
  const ph = PHASE_KO[s.phase] ? s.phase : "work", now = performance.now();
  const run = newRun(s.run_id, s.goal, ph !== "plan");
  Object.assign(run, { summary: String(s.summary || ""), report: s.report ? String(s.report) : null, error: s.error ? String(s.error) : "",
    ended: ph === "done", ok: !!s.ok, wall0: runIdTime(String(s.run_id)) ?? Date.now() });
  for (const raw of Array.isArray(s.tasks) ? s.tasks : []) {
    if (!raw || typeof raw !== "object") continue;
    const t = addTask(run, raw);
    t.state = t.vstate = STATE_KO[raw.state] ? raw.state : "todo";
    Object.assign(t, { result: String(raw.result ?? ""), ok: t.state !== "failed", t0: t.state === "todo" ? 0 : now, approx: t.state !== "todo" });
    if (t.state === "done" || t.state === "failed") t.fin.resolve();
  }
  run.planned = run.tasks.size > 0 || ph !== "plan";
  D.run = D.shown = run; D.running = ph !== "done";
  if (run.report) D.lastRun = run;
  renderBoard();
  const tasks = [...run.tasks.values()];
  if (ph === "plan") { showStroke(); showStroke(); } else if (ph !== "done") strokes.forEach(showStroke);
  for (const n of D.names) {
    const a = A(n), mine = tasks.filter(t => t.assignee === n), doing = mine.find(t => t.state === "doing");
    if (ph === "plan" && n === D.leader) {
      a.teleport(WHITEBOARD, -Math.PI / 2); a.mode = "write";
      setMember(n, { status: "계획 중", cls: "meet", task: "목표를 업무로 나누는 중", bar: "busy", t0: now, approx: true });
    } else if (ph === "review" && n === D.leader) {
      a.teleport(a.seat, Math.PI); a.sitDesk("type");
      setMember(n, { status: "검수 중", cls: "meet", task: "결과물 검수", bar: "busy", t0: now, approx: true });
    } else if (ph === "work" && doing) {
      a.teleport(a.seat, Math.PI); a.sitDesk("type");
      setMember(n, { status: "작업 중", cls: "work", task: `#${doing.id} ${doing.title}`, bar: "busy", t0: now, approx: true });
    } else if (ph === "work" && mine.some(t => t.state === "todo")) {
      a.teleport(a.coffee); a.face(COUNTER); a.group.rotation.y = a.targetRot; a.mode = "coffee";
      setMember(n, { status: "대기", cls: "wait", task: "선행 업무 기다리는 중 ☕" });
    } else { a.teleport(a.seat, Math.PI); a.mode = "sit"; }
  }
  setPhase(ph === "done" ? (run.ok ? "완료" : "중단됨") : PHASE_KO[ph], ph !== "done");
  $("reportBtn").hidden = !(ph === "done" && run.report);
  if (ph === "done") log(`최근 업무를 불러왔습니다: “${clip(run.goal, 80)}”`);
  else {
    log(`진행 중인 업무에 합류했습니다: “${clip(run.goal, 80)}”`);
    if (first) for (const t of tasks) if (t.state !== "todo") log(`#${t.id} ${t.title} · ${STATE_KO[t.state]}`, t.assignee, t.state === "failed" ? "err" : null);
  }
  updateInput();
}

/* 잔잔한 연출: 오래 걸리는 LLM 대기 동안 말풍선·필기를 조금씩 보여 준다. 경과 시간·시계도 여기서 갱신. */
function ambient() {
  // 화면이 가려져 프레임이 멈췄는데 hidden 이 아닌 경우(일부 브라우저·창 상태)에도 연출이 멈추지 않게 걷기를 끝낸다
  if (performance.now() - last > 1500) for (const n of D.names) A(n).finishWalk();
  if (document.hidden) return;
  tickClock();
  const now = performance.now();
  for (const n of D.names) {
    const a = A(n);
    tickMember(a);
    if (a.mode === "type" && now - a.lastSay > 12000) a.say(pick(LINES.typing), 1800);
    else if (a.mode === "write") {
      if (strokeN < strokes.length - 1 && now - strokeAt > 2600 / SPEED) showStroke();
      if (now - a.lastSay > 9000) a.say(pick(LINES.planning), 1800);
    }
  }
}

/* ───────────────────────── 연결 · 데모 ─────────────────────────
   - 4401(접속 키 없음·틀림): 서버는 켜져 있으므로 데모로 가지 않고 '접속 키 필요' + 키 입력 창. 재시도하지 않는다.
   - 1013(느린 접속 정리)·1012(서버 종료)·네트워크 끊김: 한 번이라도 연결됐으면 점점 늦추며 재연결.
   - 처음부터 서버에 닿지 않으면(또는 file://) 데모 모드. 데모 중에도 10초마다 조용히 서버를 다시 찾아 본다. */
const NET = { mode: "connecting", ws: null, ever: false, retry: 0, timer: 0, lastMsg: 0, keyTried: false };
function setConn(mode) {
  NET.mode = mode;
  const [cls, text] = {
    live: ["live", "서버 연결됨"], demo: ["demo", "데모 모드"], retry: ["retry", "재연결 중…"],
    connecting: ["retry", "연결 중…"], auth: ["err", "접속 키 필요"],
  }[mode];
  $("conn").className = `conn ${cls}`;
  $("connText").textContent = text;
  $("conn").title = mode === "live" && D.mock ? "서버가 모의(mock) 모드로 실행 중입니다" : "";
  $("historyBtn").hidden = !NET.ever || mode === "demo" || mode === "auth";
  $("keyBtn").hidden = mode !== "auth";
}
function wsURL() {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws${KEY ? `?key=${encodeURIComponent(KEY)}` : ""}`;
}
function connect() {
  if (location.protocol === "file:") return startDemo(true);
  if (NET.ws) return;
  let ws, hello = false;
  try { ws = new WebSocket(wsURL()); } catch { return lost(); }
  NET.ws = ws;
  const guard = setTimeout(() => !hello && drop(), 6000);
  function drop(e) {
    clearTimeout(guard);
    ws.onclose = ws.onmessage = null;
    try { ws.close(); } catch { /* 이미 닫힘 */ }
    if (NET.ws === ws) NET.ws = null;
    if (e?.code === 4401) return needKey(); // 키 거부: 재시도해도 소용없으니 멈추고 키를 받는다
    lost();
  }
  ws.onmessage = e => {
    NET.lastMsg = Date.now();
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (!ev || typeof ev !== "object" || typeof ev.type !== "string") return;
    if (ev.type === "hello") {
      hello = true; clearTimeout(guard);
      ev._was = NET.mode;
      if (NET.mode === "demo" || NET.mode === "auth") toast("서버에 연결되었어요.", "info", 3500);
      NET.ever = true; NET.retry = 0; NET.keyTried = false;
      clearTimeout(NET.timer);
      setConn("live");
      if ($("keyInput")) closeModal();
    }
    if (hello) dispatch(ev);
  };
  ws.onclose = drop;
}
function needKey() {
  clearTimeout(NET.timer);
  const again = NET.keyTried;
  setConn("auth");
  log(again ? "접속 키가 맞지 않습니다. 다시 확인해 주세요." : "이 서버는 접속 키가 필요합니다. 위쪽의 ‘키 입력’에서 터미널에 표시된 키를 넣어 주세요.", null, "err");
  if ($("modal").hidden || $("keyInput")) openKeyDialog(again ? "키가 맞지 않아요. 터미널에 표시된 키를 다시 확인해 주세요." : "");
  else toast(KEY_MSG, "error", 8000);
}
function lost() {
  clearTimeout(NET.timer);
  if (!NET.ever) { // 아직 한 번도 연결된 적 없음 → 데모. 서버가 나중에 켜지면 자동으로 연결된다
    startDemo(false);
    NET.timer = setTimeout(() => { if (NET.mode === "demo") (demo.busy ? lost : connect)(); }, 10000);
    return;
  }
  setConn("retry");
  NET.timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** NET.retry++));
}
// 연결 유지: 20초마다 ping, 90초 넘게 아무 메시지가 없으면 끊고 재연결
setInterval(() => {
  const ws = NET.ws;
  if (!ws || ws.readyState !== 1 || NET.mode !== "live") return;
  if (Date.now() - NET.lastMsg > 90000) { ws.close(); return; }
  try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* onclose 가 처리 */ }
}, 20000);

function startDemo(isFile) {
  if (NET.mode === "demo") return;
  setConn("demo");
  toast(isFile ? "파일로 열어 데모 모드로 보여 드려요. 실제 AI 호출은 없어요."
    : "서버에 연결되지 않아 데모 모드로 보여 드려요. 실제 AI 호출은 없어요. 서버가 켜지면 자동으로 연결돼요.", "info", 6000);
  dispatch({ type: "hello", team: DEMO_TEAM, mock: false, snapshot: null });
}

/* 데모: 서버(Team.run)와 똑같은 이벤트를 그럴듯한 시간 간격으로 만든다. 의존 순서와 '팀원 1명당 업무 1개'를 지킨다. */
const demo = { busy: false };
async function demoRun(goal) {
  demo.busy = true;
  const emit = ev => NET.mode === "demo" && dispatch(ev);
  const names = DEMO_TEAM.members.map(m => m.name), n = i => names[i % names.length], leader = DEMO_TEAM.leader;
  const d = new Date(), run_id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const jitter = ms => ms * (.8 + Math.random() * .4);
  UI.mine.add(run_id); // 데모는 늘 이 화면이 지시한 업무
  const tasks = [
    { id: 1, assignee: n(2), title: "요구사항·자료 분석", depends_on: [], dur: 6000 },
    { id: 2, assignee: n(1), title: "핵심 기능 구현", depends_on: [1], dur: 9000 },
    { id: 3, assignee: n(0), title: "화면 설계·마크업", depends_on: [1], dur: 7000 },
    { id: 4, assignee: n(2), title: "테스트 시나리오 작성", depends_on: [2], dur: 5000 },
  ].map(t => ({ ...t, instruction: `(데모) ${t.title}을 수행하세요.` }));
  try {
    emit({ type: "run_start", run_id, goal });
    emit({ type: "plan_start", leader });
    await sleep(jitter(4500));
    emit({ type: "plan", summary: "분석 → 구현·설계 병렬 → 테스트 순으로 진행", tasks: tasks.map(({ dur, ...t }) => t) });
    const fin = Object.fromEntries(tasks.map(t => [t.id, deferred()])), locks = {};
    await Promise.all(tasks.map(async t => {
      await Promise.all(t.depends_on.map(id => fin[id].p));
      const prev = locks[t.assignee] || Promise.resolve();
      let release;
      locks[t.assignee] = new Promise(r => (release = r));
      await prev;
      emit({ type: "task_start", id: t.id, assignee: t.assignee });
      await sleep(jitter(t.dur));
      emit({ type: "task_done", id: t.id, assignee: t.assignee, ok: true, result: demoResult(t, goal) });
      release(); fin[t.id].resolve();
    }));
    emit({ type: "review_start", leader });
    await sleep(jitter(4000));
    emit({ type: "report", report: demoReport(goal, tasks), dir: `runs/${run_id}` });
    emit({ type: "run_end", run_id, ok: true });
  } finally { demo.busy = false; }
}
function demoResult(t, goal) {
  const body = {
    1: `- 목표: ${goal}\n- 핵심 요구사항 3가지를 정리했습니다.\n  1. 반복 작업 자동화\n  2. 결과물 검수 단계 유지\n  3. 담당자가 쉽게 쓸 수 있는 화면\n\n> 실제 서버에 연결하면 이 자리에 팀원이 작성한 결과가 표시됩니다.`,
    2: "```python\ndef run(source: str) -> str:\n    \"\"\"원고를 읽어 배포용 결과물로 변환한다.\"\"\"\n    data = parse(source)\n    return render(data)\n```\n\n- 변환 스크립트와 명령줄 도구를 작성했습니다.\n- 예외 처리와 실행 로그를 추가했습니다.",
    3: "- 화면 구조와 마크업을 설계했습니다.\n- 모바일·데스크톱 반응형 레이아웃\n- 접근성(대체 텍스트, 키보드 이동) 점검 완료",
    4: "| # | 시나리오 | 기대 결과 |\n|---|---|---|\n| 1 | 정상 입력 | 결과물 생성 |\n| 2 | 빈 입력 | 안내 메시지 |\n| 3 | 대용량 입력 | 시간 내 처리 |",
  }[t.id];
  return `## ${t.title} 결과 (데모)\n\n${body}`;
}
function demoReport(goal, tasks) {
  const rows = tasks.map(t => `| #${t.id} | ${t.title} | ${niceName(t.assignee)} | 완료 |`).join("\n");
  return `## 1. 최종 결과물 (데모)\n\n**목표:** ${goal}\n\n팀원 결과를 통합한 데모 보고서입니다. 서버에 연결하면 팀장이 실제로 작성한 보고서가 이 자리에 표시됩니다.\n\n| # | 업무 | 담당 | 상태 |\n|---|---|---|---|\n${rows}\n\n## 2. 팀원별 검수 의견\n\n- **Gemini** — 자료 분석이 꼼꼼합니다. 출처 표기를 보완하면 좋겠습니다.\n- **GPT** — 핵심 기능이 동작합니다. 예외 상황 테스트를 더 추가해 주세요.\n- **Claude** — 마크업과 접근성 점검을 마쳤습니다.\n\n## 3. 남은 과제\n\n- 실제 API 키를 연결해 결과 품질 확인\n- 배포 환경 점검`;
}

/* ───────────────────────── 입력 · 초기화 ───────────────────────── */
async function submitGoal() {
  if (D.running || UI.submitting) return;
  if (NET.mode === "auth") { openKeyDialog(); return; }
  let goal = $("goal").value.trim();
  if (!goal && NET.mode === "demo") goal = EXAMPLE_GOAL;
  if (!goal) { toast("팀에게 맡길 목표를 입력해 주세요."); $("goal").focus(); return; }
  if (NET.mode === "demo") {
    if (demo.busy) { toast("이미 진행 중인 업무가 있어요", "warn"); return; }
    $("goal").value = "";
    if (mqMobile.matches) $("goal").blur();
    demoRun(goal);
    return;
  }
  if (NET.mode !== "live") {
    toast(NET.mode === "connecting" ? "서버에 연결하는 중이에요. 잠시 후 다시 시도해 주세요." : "서버와 다시 연결하는 중이에요. 잠시 후 다시 시도해 주세요.", "warn");
    return;
  }
  UI.submitting = true; updateInput();
  let ok = false;
  try {
    const r = await api("/api/run", { method: "POST", body: JSON.stringify({ goal }) });
    if (r.ok) {
      ok = true; $("goal").value = ""; if (mqMobile.matches) $("goal").blur();
      const j = await r.json().catch(() => null);
      if (j?.run_id != null) UI.mine.add(String(j.run_id)); // 보고서 창을 자동으로 열 대상
    } else if (r.status === 409) toast("이미 진행 중인 업무가 있어요", "warn");
    else if (r.status === 401 || r.status === 403) openKeyDialog("키가 맞지 않아요. 터미널에 표시된 키를 다시 확인해 주세요.");
    else {
      const detail = await r.json().then(j => (typeof j?.detail === "string" ? j.detail : ""), () => "");
      toast(detail || `업무를 시작하지 못했어요 (${r.status})`, "error");
    }
  } catch {
    toast("서버에 연결할 수 없어요. 네트워크 상태를 확인해 주세요.", "error");
  }
  // 성공하면 run_start 가 올 때까지(최대 6초) 입력을 잠가 둔다
  if (ok && !D.running) { clearTimeout(UI.subT); UI.subT = setTimeout(() => { UI.submitting = false; updateInput(); }, 6000); }
  else UI.submitting = false;
  updateInput();
}

$("command").addEventListener("submit", e => { e.preventDefault(); submitGoal(); });
$("speed").addEventListener("click", e => { const s = +e.target.closest("button")?.dataset.s; if (s) setSpeed(s); });
$("speedCycle").addEventListener("click", () => setSpeed({ 1: 2, 2: 4, 4: 1 }[SPEED]));
$("historyBtn").addEventListener("click", openRuns);
$("keyBtn").addEventListener("click", () => openKeyDialog());
$("reportBtn").addEventListener("click", () => D.lastRun && openReport(runView(D.lastRun)));
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });
if (HAS3D) {
  renderer.domElement.addEventListener("dblclick", resetView);
  renderer.domElement.addEventListener("gesturestart", e => e.preventDefault(), { passive: false }); // iOS: 3D 위 핀치는 카메라 확대로만(페이지 확대는 다른 곳에서 가능)
}

// 바텀 시트: 손잡이 탭/스와이프, 탭 버튼
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  const d = $("dock"), same = d.dataset.tab === b.dataset.tab;
  setDock(!(same && d.classList.contains("open")), b.dataset.tab);
});
$("panes").addEventListener("transitionend", e => {
  if (e.target === $("panes") && mqMobile.matches) { clearTimeout(UI.frameT); reframe(); }
});
// 스와이프는 pointerup 에서 처리한다. 터치 스와이프 뒤에는 click 이 오지 않으므로 '플래그'가 아니라 짧은 시간 창으로
// 마우스 드래그 직후 따라오는 click 만 무시한다(다음 탭이 먹히지 않던 문제).
$("dockHandle").addEventListener("pointerdown", e => { UI.dragY = e.clientY; });
$("dockHandle").addEventListener("pointercancel", () => { UI.dragY = null; });
$("dockHandle").addEventListener("pointerup", e => {
  const dy = UI.dragY == null ? 0 : e.clientY - UI.dragY;
  UI.dragY = null;
  if (Math.abs(dy) > 24) { UI.swipedAt = performance.now(); setDock(dy < 0); }
});
$("dockHandle").addEventListener("click", () => {
  if (performance.now() - UI.swipedAt < 350) return;
  setDock(!$("dock").classList.contains("open"));
});
// 휴대폰에서 입력을 시작하면 시트를 접어 키보드 위에 입력창만 남긴다
$("goal").addEventListener("focus", () => { if (mqMobile.matches) setDock(false); });

/* 화상 키보드: Android 는 viewport 의 interactive-widget=resizes-content 로 레이아웃이 줄어든다.
   iOS 는 레이아웃이 그대로라, 보이는 영역(visualViewport)에 맞춰 시트를 키보드 위로, 상단 바를 보이는 위쪽으로 옮긴다. */
const VV = window.visualViewport;
function syncViewport() {
  const typing = document.activeElement?.matches?.("input, textarea") && Math.abs((VV.scale || 1) - 1) < .01;
  const kb = typing ? Math.max(0, Math.round(innerHeight - VV.height - VV.offsetTop)) : 0;
  const root = document.documentElement.style;
  root.setProperty("--kb", `${kb > 40 ? kb : 0}px`);
  root.setProperty("--vvt", `${typing ? Math.max(0, Math.round(VV.offsetTop)) : 0}px`);
}
if (VV) {
  VV.addEventListener("resize", syncViewport);
  VV.addEventListener("scroll", syncViewport);
  document.addEventListener("focusin", () => setTimeout(syncViewport, 50));
  document.addEventListener("focusout", () => setTimeout(syncViewport, 50));
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("modal").hidden) closeModal();
    else if ($("dock").classList.contains("open")) setDock(false);
  } else if (e.key === "Tab" && !$("modal").hidden) { // 모달 안에서만 포커스 순환
    const f = [...$("sheet").querySelectorAll("button, summary, a[href], input, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { for (const n of D.names) A(n).finishWalk(); return; }
  last = performance.now();
  if (NET.mode === "retry" && !NET.ws) { clearTimeout(NET.timer); connect(); }
});
addEventListener("online", () => { if (NET.mode === "retry" && !NET.ws) { clearTimeout(NET.timer); connect(); } });
let resizeRaf = 0;
addEventListener("resize", () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(resize); });
const onLayoutChange = () => {
  if (controls) controls.maxZoom = mqMobile.matches ? 3.2 : 2.2;
  if (!mqMobile.matches) setDock(false);
  updateInput(); resize();
};
mqMobile.addEventListener("change", onLayoutChange);
mqSide.addEventListener("change", onLayoutChange);
mqNarrow.addEventListener("change", updateInput);
mqDark.addEventListener("change", applyTheme);

/** 휴대폰: 새 말풍선과 겹치는 이전 말풍선은 잠시 숨긴다(이름표·말풍선은 가장 최근에 말한 팀원이 맨 위). */
function declutter(mobile) {
  const kept = [];
  const shown = D.names.map(A).filter(a => !a.ghost && a.bubble.classList.contains("show")).sort((p, q) => q.lastSay - p.lastSay);
  for (const a of shown) {
    if (!a._bw) { a._bw = a.bubble.offsetWidth; a._bh = a.bubble.offsetHeight; a._lh = a.label.offsetHeight; }
    const r = { x0: a.ax - a._bw / 2, x1: a.ax + a._bw / 2, y0: a.ay - a._lh, y1: a.ay - a._lh + a._bh };
    const hit = mobile && kept.some(k => r.x0 < k.x1 && r.x1 > k.x0 && r.y0 < k.y1 && r.y1 > k.y0);
    a.bubble.classList.toggle("covered", hit);
    if (!hit) kept.push(r);
  }
}

// 렌더 루프 (탭이 숨겨지면 그리지 않는다). 3D 가 없으면 돌리지 않는다.
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const raw = Math.min(.05, (now - last) / 1000);
  last = now;
  if (document.hidden) return;
  stepTween(now);
  controls.update();
  camera.updateMatrixWorld();
  const w = innerWidth, h = innerHeight;
  for (const n of D.names) { const a = A(n); if (a.ghost) continue; a.update(raw * SPEED); a.paint(now); a.placeLabel(w, h); }
  declutter(mqMobile.matches);
  renderer.render(scene, camera);
}

if (HAS3D) applyTheme(); else enterListMode();
setSpeed(SPEED);
buildTeam(normTeam(DEMO_TEAM)); // 연결 전에도 사무실이 비어 보이지 않게(같은 팀이면 hello 때 다시 만들지 않는다)
renderBoard();
setPhase("대기 중", false);
updateInput();
tickClock();
resize();
if (HAS3D) requestAnimationFrame(loop);
else if (mqMobile.matches && !mqSide.matches) setDock(true); // 목록 모드 휴대폰: 시트를 열어 둔다
setInterval(ambient, 1000);
connect();
