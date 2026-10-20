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

/* 테마 설정(시스템/라이트/다크)과 '움직임 줄이기'. <html data-theme> 로 강제하고, 3D 테마(applyTheme)는 isDark() 를 읽는다. */
const PREF = {
  theme: ["system", "light", "dark"].includes(store.get("agentOffice.theme")) ? store.get("agentOffice.theme") : "system", // 직접 고르기 전에는 기기(시스템) 설정을 따른다
  reduce: store.get("agentOffice.reduce") === "1", rooms: store.get("agentOffice.rooms") !== "0", lastDark: null,
};
if (PREF.theme !== "system") document.documentElement.dataset.theme = PREF.theme;
else delete document.documentElement.dataset.theme;
if (PREF.reduce) document.body.classList.add("reduce-motion");
if (!PREF.rooms) document.body.classList.add("no-roomtags");
/** 지금 화면이 다크인지(강제 테마 > 시스템 설정). 3D 쪽 applyTheme() 도 이 값을 쓴다. */
function isDark() {
  const f = document.documentElement.dataset.theme;
  return f === "dark" || (f !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
}

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
  gpt: { label: window.SpaceTheme?.isZoo ? "디자인과장" : "GPT", initial: "G", color: "#10a37f" },
  gemini: { label: "Gemini", initial: "Ge", color: "#4f7cf7" },
};
/** 알려진 팀원 프리셋. 이름이 constructor·toString 같은 Object.prototype 키여도 프로토타입을 타지 않게 hasOwn 으로만 찾는다. */
const known = n => { const k = String(n).toLowerCase(); return Object.hasOwn(KNOWN, k) ? KNOWN[k] : null; };
const PALETTE = ["#8e6cd1", "#e8a317", "#e05a8a", "#1fa2b8", "#6f8f2e", "#c25b3f"];
const HAIR = ["#3b2a22", "#1f1f1f", "#5a3b1c", "#2c2c3a", "#6b4a2b", "#43302a"];
const DEMO_TEAM = {
  leader: "claude",
  members: [
    { name: "claude", provider: "anthropic", model: "opus", role: "팀장 겸 메인 담당. 기획·설계·개발·문서 등 핵심 업무 대부분, 업무 분해·배정, 결과 검수" },
    { name: "gpt", provider: "openai", model: "default", role: "디자이너. 이미지·그림 제작, UI/UX 탐색과 시안, 화면 개선 제안" },
    { name: "gemini", provider: "google", model: "gemini-3.8-flash-medium", role: "지원 담당. 자료 정리·요약·번역·확인 등 잡무" },
  ],
};
const EXAMPLE_GOAL = "아르떼365 뉴스레터 자동화 도구 만들기";
const KEY_MSG = "접속 키가 필요해요. 상단의 ‘접속 키 필요’ 표시나 설정에서 서버 터미널에 표시된 키를 넣거나, QR 코드로 다시 접속해 주세요.";
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
const mqReduceSys = matchMedia("(prefers-reduced-motion: reduce)");
const mqReduce = { get matches() { return mqReduceSys.matches || PREF.reduce; }, addEventListener: (...a) => mqReduceSys.addEventListener(...a) }; // 시스템 설정 + 설정의 '움직임 줄이기'

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
/* 평면도(테마 지도 Decor 가 기준, 공통 규격 theme-kit.js). 사무실 방: 앞쪽 현관·왼쪽 모서리 탕비실·업무 공간·오른쪽 회의실 1·팀장실·라운지·창가 베란다.
   decor.js 가 없으면 같은 좌표의 최소값으로 동작한다(가구 없는 단순 사무실·직선 이동). */
const HAS_DECOR = typeof Decor !== "undefined" && !!Decor.rooms;
const OW = HAS_DECOR ? Decor.OW : 32, OD = HAS_DECOR ? Decor.OD : 22;     // 사무실 가로·세로
const TABLE = HAS_DECOR ? Decor.TABLE : { x: 11, z: .5 };                 // 회의실 긴 테이블 중심(회의 의자가 바라보는 곳)
const WHITEBOARD = HAS_DECOR ? Decor.WHITEBOARD : { x: 6.2, z: .3 };      // 회의실 TV 앞(팀장이 계획을 쓰는 자리)
const BOARD_FACE = HAS_DECOR ? Decor.BOARD_FACE : { x: 5, z: .3 };        // TV(x=5 칸막이) — 팀장이 바라보는 곳
const COUNTER = HAS_DECOR ? Decor.COUNTER : { x: -15.6, z: -8.6 };        // 탕비실 커피 머신(커피 자리에서 바라보는 곳)
const COFFEE = HAS_DECOR ? Decor.COFFEE : [{ x: -14.5, z: -8.4 }, { x: -9.5, z: -7.6 }, { x: -13.6, z: -5.3 }, { x: -14.5, z: -9.6 }, { x: -12.6, z: -5.1 },
  { x: -9.6, z: -9.8 }, { x: -14.5, z: -7.2 }, { x: -13.6, z: -10 }, { x: -9.6, z: -5.4 }]; // 카운터 앞·테이블 둘레를 번갈아(한 줄로 서지 않게)
const ENTRANCE = HAS_DECOR ? Decor.ENTRANCE : { x: -14.3, z: 7.5 };       // 현관 유리문 바로 안(출근 지점)
const DOOR_OUT = HAS_DECOR && Decor.LOBBY_DOOR.axis === "x" ? { x: Decor.LOBBY_DOOR.x, z: Decor.LOBBY_DOOR.z + 1.4 } : { x: (HAS_DECOR ? Decor.LOBBY_DOOR.x : -OW / 2) - 1.4, z: HAS_DECOR ? Decor.LOBBY_DOOR.z : 7.5 };
const PANTRY_TABLE = HAS_DECOR ? Decor.PANTRY_TABLE : { x: -11.6, z: -7.6 }; // 탕비실 타원 테이블(그 옆 커피 자리는 테이블을 본다)
const REPORT_SPOT = HAS_DECOR && Decor.REPORT_SPOT ? Decor.REPORT_SPOT : { x: 12.9, z: -7.2 }; // 검수 보고 자리: 대표 책상 오른쪽 모서리에서 0.4 떨어진 앞쪽
const ROOMS = HAS_DECOR ? Decor.rooms : {                                 // 이름 → { x0, x1, z0, z1, label, door }
  lobby: { x0: -16, x1: -9.5, z0: 4, z1: 11, label: "현관", door: { x: -9.5, z: 7.5, axis: "z", w: 1.6 } },
  pantry: { x0: -16, x1: -8.5, z0: -11, z1: -4, label: "탕비실", door: { x: -10, z: -4, axis: "x", w: 1.6 } },
  work: { x0: -8.5, x1: 5, z0: -11, z1: 11, label: "업무 공간", door: null },
  exec: { x0: 5, x1: 16, z0: -11, z1: -3.5, label: "팀장실", door: { x: 5, z: -4.5, axis: "z", w: 1.6 } },
  meeting: { x0: 5, x1: 16, z0: -3.5, z1: 4.5, label: "회의실", door: { x: 5, z: 3.5, axis: "z", w: 1.6 } },
  lounge: { x0: 5, x1: 16, z0: 4.5, z1: 11, label: "라운지", door: null },
};
const BOOTH = { x0: ROOMS.meeting.x0, x1: ROOMS.meeting.x1, z0: ROOMS.meeting.z0, z1: ROOMS.meeting.z1, door: .8, h: HAS_DECOR ? Decor.PART_H : 2.6 }; // 회의실(유리 칸막이) 영역 — 예전 이름 유지
/* 공간 테마: 구조(자리 12·방 7·조연 3·손님 3)는 theme-kit.js 규격으로 모든 테마가 같고, 모양만 아래 LOOKS 와 각 테마 파일이 정한다 */
const SPACE = window.ThemeKit?.current?.() || { id: "office", label: "사무실" };
const MAX_DESKS = (HAS_DECOR && Decor.SEATS) || window.ThemeKit?.SEATS || 12; // 작업석 수(0번 = 팀장). 그 이상은 목록·보드에만 표시
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
function dispose(obj) {
  const resources=new Set();
  obj.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m){for(const v of Object.values(m))if(v?.isTexture)resources.add(v);resources.add(m);}});
  for(const resource of resources)resource.dispose();
} // 캔버스 텍스처(명패·화면)도 GPU 에서 내린다

/** 장면을 만든다. three.js·OrbitControls 가 없거나 WebGL 컨텍스트를 만들 수 없으면 false. */
function init3D() {
  if (!window.THREE || typeof THREE.OrbitControls !== "function") return false;
  try {
    renderer = window.SpaceTheme?.isPixel && window.PixelTheme ? new PixelTheme.Renderer() : new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    console.warn("장면 렌더링 사용 불가:", e);
    renderer = null;
    return false;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", window.SpaceTheme?.isPixel ? "2D 픽셀아트 사무실. 드래그로 이동, 휠이나 두 손가락으로 확대, 캐릭터를 클릭하면 대화합니다." : `3D ${SPACE.label}. 왼쪽 드래그 회전, 오른쪽 드래그 이동, 휠 확대. 방향키로 이동합니다.`);
  $("stage").append(renderer.domElement);

  scene = new THREE.Scene();
  if (window.ModelKit && !window.SpaceTheme?.isZoo && !window.SpaceTheme?.isPixel) scene.environment = ModelKit.environment(renderer).texture;
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  CAM_OFF = new THREE.Vector3(22, 20, 22);
  camera.position.copy(CAM_OFF);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  Object.assign(controls, {
    enablePan: true, screenSpacePanning: true, panSpeed: .65, enableDamping: true, minZoom: .6, maxZoom: mqMobile.matches ? 6.4 : 4.4, minPolarAngle: .5, maxPolarAngle: 1.2,
  });
  if(window.SpaceTheme?.isPixel){
    Object.assign(controls,{enableRotate:false,enableDamping:false,enableZoom:false,mouseButtons:{LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN},touches:{ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_PAN}});
    let wheelAmount=0,wheelAt=0;
    renderer.domElement.addEventListener('wheel',e=>{
      e.preventDefault();if(!e.deltaY)return;
      const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1),now=performance.now();
      if(Math.sign(wheelAmount)!==Math.sign(delta))wheelAmount=0;
      wheelAmount+=delta;
      if(Math.abs(wheelAmount)>=40&&now-wheelAt>=90){zoomCamera(wheelAmount<0?1:-1);wheelAmount=0;wheelAt=now;}
    },{passive:false});
    const fingers=new Map(),pinched=new Set();let pinch=null;
    renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(fingers.size===2){for(const id of fingers.keys())pinched.add(id);const [a,b]=[...fingers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:camera.zoom};}},{passive:true});
    renderer.domElement.addEventListener('pointermove',e=>{
      if(!fingers.has(e.pointerId))return;fingers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(fingers.size!==2||!pinch||pinch.distance<1)return;
      const [a,b]=[...fingers.values()],steps=Math.round(Math.log(Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance)/Math.log(1.2));
      const zoom=Math.min(controls.maxZoom,Math.max(controls.minZoom,pinch.zoom*1.2**steps));
      if(zoom!==camera.zoom)setView(cam.view,controls.target.clone(),false,zoom);
    },{passive:true});
    for(const event of ['pointerup','pointercancel'])renderer.domElement.addEventListener(event,e=>{if(pinched.delete(e.pointerId))e.pixelPinch=true;fingers.delete(e.pointerId);pinch=null;},{passive:true});
  }

  hemi = new THREE.HemisphereLight(0xffffff, 0xc9d2e3, .78);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff6e8, .8);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SMALL ? 1024 : 2048, SMALL ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 }); // 32×22 사무실 전체
  sun.shadow.radius = 4; sun.shadow.normalBias = .02;
  scene.add(sun);

  // 팀 구성에 따라 바뀌는 가구(책상·의자·명패)
  teamGroup = new THREE.Group();
  scene.add(teamGroup);

  // 사무실 장식(바닥·벽·창·칸막이·방별 가구·조명·방 이름표)은 decor.js 가 만든다. 없거나 실패하면 최소 사무실(buildBooth)
  let built = null;
  if (HAS_DECOR && typeof Decor.build === "function") {
    try {
      built = Decor.build(scene, { box, cyl, mat, small: SMALL, agents: () => { try { return D.names.map(n => A(n).group.position); } catch { return []; } } });
    } catch (e) { console.warn("사무실 장식을 만들지 못해 기본 사무실로 표시합니다:", e); built = null; }
  }
  if (built?.strokes) strokes = built.strokes; else buildBooth();

  // 카메라 맞춤용: 사무실 전체 외곽 점
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const x of [-OW / 2, OW / 2]) for (const z of [-OD / 2, OD / 2]) OFFICE_PTS.push(V(x, 0, z), V(x, 2, z));
  OFFICE_PTS.push(V(-OW / 2, 4, -OD / 2), V(OW / 2, 4, -OD / 2), V(-OW / 2, 4, OD / 2));
  return true;
}
/** decor.js 가 없을 때의 최소 사무실: 바닥·뒷벽·왼쪽 벽·회의실 유리 칸막이·긴 테이블·TV·계획 필기 줄. 장식 전체는 Decor.build 담당. */
function buildBooth() {
  Object.assign(themed, {
    floor: box(OW, .3, OD, 0xf1efea, 0, -.15, 0),
    wall: box(OW, 4, .3, 0xffffff, 0, 2, -OD / 2 - .15),
    side: box(.3, 4, OD, 0xfafafc, -OW / 2 - .15, 2, 0),
    base: box(OW, .15, .32, 0xd9dee8, 0, .08, -OD / 2 - .1),
  });
  const { x0, x1, z0, z1, h } = BOOTH;
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: .2, roughness: .05, metalness: .1, depthWrite: false });
  const pane = (len, x, z, alongX) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : .04, h, alongX ? .04 : len), glass); g.position.set(x, h / 2, z); g.renderOrder = 2; scene.add(g);
    const top = box(alongX ? len : .08, .08, alongX ? .08 : len, 0x3b3f49, x, h + .04, z); top.castShadow = false;
  };
  pane(z1 - z0, x0, (z0 + z1) / 2, false); pane(x1 - x0, (x0 + x1) / 2, z0, true); pane(x1 - x0, (x0 + x1) / 2, z1, true);
  box(3.6, .07, 1.3, 0xffffff, TABLE.x, .78, TABLE.z);
  box(.08, 1.47, 2.52, 0x30343c, BOARD_FACE.x + .1, 1.85, BOARD_FACE.z);
  strokes = [0, 1, 2, 3, 4].map(i => {
    const l = box(.012, .06, .01, 0x6b7489, BOARD_FACE.x + .17, 2.28 - i * .2, BOARD_FACE.z - .3);
    l.scale.z = 100 - (i * 23) % 40; l.castShadow = false; l.visible = false; return l;
  });
}
let strokeN = 0, strokeAt = 0;
function showStroke() { if (strokeN < strokes.length) strokes[strokeN++].visible = true; strokeAt = performance.now(); }
function clearStrokes() { strokes.forEach(s => (s.visible = false)); strokeN = 0; }

/** 책상 세트: 원목 상판·듀얼 모니터·키보드·마우스·머그·램프·화분·서랍장·칸막이·의자. 두 화면은 팀원별 캔버스(Screen) 두 개가 각각 칠한다.
    opts.exec 면 팀장실의 짙은 원목 책상(가죽 의자·왕관 명패). 돌려주는 값 { screen, mug }. decor.js 가 없으면 단순 책상. */
function desk(x, z, w, mats, opts = {}) {
  const g = teamGroup;
  if (HAS_DECOR && typeof Decor.deskSet === "function") {
    const d = Decor.deskSet(g, { x, z, w, mats, exec: !!opts.exec, color: opts.color, label: opts.label, light: !!opts.light, cols: opts.cols || 1, col: opts.col || 0, facing: opts.facing || 0 });
    if (typeof d.dispose === "function") DESK_DISPOSERS.push(d.dispose); // 팀을 다시 놓을 때 layout() 이 부른다(명패 캔버스·램프 등록 해제)
    return { screen: d.screen, mug: d.mug };
  }
  box(w, .08, 1.2, opts.exec ? 0x4b3627 : 0xd8bd97, x, .78, z, g);
  for (const dx of [-w / 2 + .1, w / 2 - .1]) for (const dz of [-.5, .5]) box(.06, .76, .06, opts.exec ? 0x4b3627 : 0xf4f5f7, x + dx, .38, z + dz, g);
  const s = Math.min(1, (w - .25) / 2.75);
  const screens = [[-.68, .2], [.68, -.2]].map(([dx, rot], i) => {
    const m = new THREE.Group();
    m.position.set(x + dx * s, .82, z - .34); m.rotation.y = rot; m.scale.setScalar(s); g.add(m);
    box(1.34, .84, .05, 0x23262f, 0, .665, 0, m);               // 베젤
    box(.08, .27, .06, 0x2b2f38, 0, .14, -.03, m);              // 목
    box(.38, .02, .22, 0x2b2f38, 0, .01, -.02, m);              // 받침
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.26, .76), mats[i]);
    scr.position.set(0, .665, .027); m.add(scr);
    return scr;
  });
  box(.62, .03, .2, 0xe8eaef, x - .05, .835, z + .14, g);       // 키보드
  box(.1, .03, .15, 0xe8eaef, x + .42, .835, z + .16, g);       // 마우스
  const mug = cyl(.075, .065, .16, 0xffffff, x + w / 2 - .3, .91, z + .2, g, 14);
  const sz = z + (opts.exec ? 1.3 : 1.15);
  cyl(.32, .32, .1, 0x2a2d35, x, .5, sz, g); box(.52, .55, .08, 0x2a2d35, x, .85, sz + .26, g); cyl(.04, .04, .45, 0x40465a, x, .25, sz, g);
  return { screen: screens[0], mug };
}
/** 팀 자리 배치(0번이 팀장). 기존 팀장 원목 책상과 팀원 책상을 업무 공간에 두고, 가로 3석의 두 줄을 서로 마주 보게 배치한다.
    회의 의자는 회의실 긴 테이블 둘레(장식이 놓은 의자 9개 중 앞 n개), 커피 자리는 탕비실. 길 찾기 격자도 여기서 다시 만든다.
    3D 가 없으면 위치만 계산한다(screen 없음). */
const DESK_DISPOSERS = []; // Decor.deskSet 이 돌려준 정리 함수(명패 캔버스·책상 램프 등록 해제). 팀을 다시 놓기 전에 전부 부른다
function layout(order, leaderColor) {
  if (HAS3D) {
    for (const f of DESK_DISPOSERS.splice(0)) { try { f(); } catch (e) { console.warn(e); } }
    for (const c of [...teamGroup.children]) { teamGroup.remove(c); dispose(c); }
  }
  const n = order.length, plan = HAS_DECOR ? Decor.spots(n) : fallbackSpots(n);
  const spots = plan.map((p, i) => {
    const spot = { seat: p.seat, monitorTarget: { x: p.desk.x, z: p.desk.z + (p.desk.facing ? .34 : -.34) }, meet: p.meet, coffee: p.coffee, screen: null, mug: null, tv: null, tv2: null };
    if (HAS3D) {
      spot.tv = new Screen(); spot.tv2 = new Screen();
      const label = typeof niceName === "function" ? niceName(order[i]) : String(order[i]);
      Object.assign(spot, desk(p.desk.x, p.desk.z, p.desk.w, [spot.tv.material, spot.tv2.material],
        { exec: i === 0, color: leaderColor, label, light: i > 0 && i <= 2, cols: p.desk.cols || 1, col: p.desk.col || 0, facing: p.desk.facing || 0 })); // 점광원은 팀원 책상 2개까지
    }
    return spot;
  });
  // 팀 책상이 없는 줄은 빈 책상으로 채운다(모니터는 켜 둔 고정 화면). 길 찾기 격자에도 들어간다(Decor.navRects)
  if (HAS3D && HAS_DECOR && typeof Decor.spareDesks === "function") for (const d of Decor.spareDesks(n)) desk(d.x, d.z, d.w, spareScreens(), { cols: d.cols, col: d.col, facing: d.facing || 0 });
  if (HAS_DECOR) { Decor.nav.build(Decor.navRects(n)); navDebug(); }
  if (HAS3D) ACT_PTS = activityPts(plan);
  return spots;
}
/** 빈 책상 모니터 두 장의 재질(코드 편집기·대시보드를 한 번 그린 고정 화면). layout() 이 팀 가구를 치울 때 재질도 정리되므로 매번 새로 만든다 */
function spareScreens() {
  const who = { def: { color: "#4f7cf7", label: "" }, name: "" };
  return ["code", "chart"].map((kind, i) => {
    const s = new Screen();
    try { s.draw(kind, 12000 + i * 777, who); } catch { s.draw("desktop", 0, who); }
    return s.material;
  });
}
/** decor.js 가 없을 때의 자리(같은 평면 기준): 팀장은 팀장실, 나머지는 업무 공간 3줄, 회의 자리는 테이블 둘레 타원. */
function fallbackSpots(n) {
  const rows = [-1.5, -7.5, 4.5];
  return Array.from({ length: n }, (_, i) => {
    const k = i - 1, r = Math.min(2, Math.floor(k / 3)), c = Math.max(0, k % 3), cnt = Math.max(1, Math.min(3, n - 1 - r * 3));
    const desk = i === 0 ? { x: 11, z: -8.8, w: 3 } : { x: -2.35 + (c - (cnt - 1) / 2) * 3.2, z: rows[r], w: 2.6, cols: cnt, col: c };
    const a = Math.PI + i * 2 * Math.PI / Math.max(1, n);
    return { desk, seat: { x: desk.x, z: desk.z + (i === 0 ? 1.3 : 1.15) }, meet: { x: TABLE.x + Math.cos(a) * 2.3, z: TABLE.z + Math.sin(a) * 1.3 }, coffee: COFFEE[i % COFFEE.length] };
  });
}
/** 카메라 맞춤용 '활동 영역' 점: 모든 책상(이름표 높이 포함)·회의실·팀장실·탕비실·현관·현관 문 밖(출근 시작점, 인사 말풍선 포함).
    패널 사이에 이것만은 꼭 보이게 한다. */
function activityPts(plan) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z), pts = [];
  for (const p of plan || []) { const d = p.desk; pts.push(V(d.x - d.w / 2, 3, d.z - .8), V(d.x + d.w / 2, 0, d.z + 1.8)); }
  const room = (r, h = 3) => pts.push(V(r.x0 + .3, 0, r.z1 - .3), V(r.x1 - .3, h, r.z0 + .3), V(r.x0 + .3, h, r.z0 + .3), V(r.x1 - .3, 0, r.z1 - .3));
  room(ROOMS.meeting); room(ROOMS.exec); room(ROOMS.pantry, 2.6);
  pts.push(V(ENTRANCE.x - 1.2, 3, ENTRANCE.z - 1.5), V(ENTRANCE.x, 0, ENTRANCE.z + 1.5), V(TABLE.x, 2.8, TABLE.z), V(COUNTER.x + 1.5, 0, COUNTER.z));
  pts.push(V(DOOR_OUT.x - .8, 2.6, DOOR_OUT.z - 1.3), V(DOOR_OUT.x - .8, 0, DOOR_OUT.z + 1.3)); // 문 밖에서 나타나는 팀원이 사이드바 밑에 숨지 않게
  return pts;
}

// 테마(라이트/다크): 배경·하늘빛·햇빛은 여기서, 바닥·벽·창 밖·램프는 decor.js(Decor.theme) 가 맞춘다. isDark() 는 공통 도구(없으면 시스템 설정)
const THEMES = {
  light: { clear: 0xf4f6fb, floor: 0xf1efea, wall: 0xffffff, side: 0xfafafc, base: 0xd9dee8, sky: 0xffffff, ground: 0xc9d2e3, hemi: .78, sun: .8, sunColor: 0xfff6e8 },
  // 다크는 참고 이미지(docs/ref/office-dark.png)의 '밤의 사무실': 숯색 배경, 낮은 하늘빛, 그림자를 만드는 따뜻한 위쪽 조명.
  // 나머지 빛(램프·LED 띠·빛 웅덩이)은 decor.js 가 맡는다. 휴대폰 크기에서도 가구가 구분되게 하늘빛을 너무 낮추지 않는다
  dark: { clear: 0x0c0f16, floor: 0x2c2c33, wall: 0x26272c, side: 0x1d1e23, base: 0x131417, sky: 0x7a7f9c, ground: 0x33271c, hemi: .52, sun: .3, sunColor: 0xffd6aa },
};
/* 사무실 조명(낮 ↔ 밤). 기본은 실제 해를 따른다(decor.js 의 Decor.sun): 해 고도 +5° 에서 어두워지기 시작해 -5° 에서 완전히 밤이 되고
   (일몰·일출 앞뒤 약 40~50분), 낮에는 그림자가 실제 해의 방위를 따라 돈다. 설정의 '사무실 조명'에서 '화면 테마'를 고르면 예전처럼
   화면 테마(라이트·다크)를 따른다. 라이트 화면에서는 해를 따르되, 다크 화면에서는 밤 조명을 우선한다.
   위치는 설정에서 맞춘 좌표(agentOffice.place) > 기기 시간대의 대표 도시. 사무실은 +z 가 남쪽, +x 가 동쪽이다(뒷벽 창은 북향). */
const OFFICE = { mode: store.get("agentOffice.officeLight") === "theme" ? "theme" : "sun", n: null, tween: null, now: null }; // now: 점검용 가상 시각
const useSun = () => OFFICE.mode === "sun" && HAS_DECOR && !!Decor.sun;
function sunPlace() {
  try { const p = JSON.parse(store.get("agentOffice.place") || "null"); if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return p; } catch { /* 잘못 저장된 값 */ }
  return HAS_DECOR && Decor.sun ? Decor.sun.zone() : { lat: 37.5665, lng: 126.978, label: "서울" };
}
/** 지금 사무실의 밤 정도: 0(낮) ~ 1(밤) */
function officeNight() {
  if (isDark()) return 1; // 다크 화면에서는 실제 시각보다 밤 조명을 우선한다.
  if (!useSun()) return 0;
  const p = sunPlace();
  return Decor.sun.night(OFFICE.now || new Date(), p.lat, p.lng);
}
/** 사무실 조명을 다시 맞춘다. 크게 바뀌면(설정·테마 변경) 1.2초에 걸쳐, 해를 따라 조금씩 바뀔 때는 바로 */
function applyTheme(instant) {
  if (!HAS3D) return;
  const to = officeNight();
  if (OFFICE.n == null || instant || mqReduce.matches || document.hidden || Math.abs(to - OFFICE.n) < .05) { OFFICE.tween = null; setOfficeLight(to); }
  else OFFICE.tween = { from: OFFICE.n, to, t0: performance.now() };
}
function stepOffice(now) {
  const tw = OFFICE.tween;
  if (!tw) return;
  const k = Math.min(1, (now - tw.t0) / 1200);
  setOfficeLight(tw.from + (tw.to - tw.from) * k * k * (3 - 2 * k));
  if (k === 1) OFFICE.tween = null;
}
const _ca = HAS3D ? new THREE.Color() : null, _cb = HAS3D ? new THREE.Color() : null;
/** 밤 정도 n 으로 하늘빛·햇빛·사무실 장식(Decor.theme)을 섞어 칠한다 */
function setOfficeLight(n) {
  OFFICE.n = n;
  const L = THEMES.light, K = THEMES.dark, num = k => L[k] + (K[k] - L[k]) * n;
  const mix = k => _ca.setHex(L[k]).lerp(_cb.setHex(K[k]), n);
  renderer.setClearColor(isDark() ? K.clear : L.clear); // 사무실 바깥(빈 공간)은 화면 테마 색
  for (const k in themed) if (L[k] != null && themed[k]?.material?.color) themed[k].material.color.copy(mix(k));
  hemi.color.copy(mix("sky")); hemi.groundColor.copy(mix("ground")); hemi.intensity = num("hemi");
  // 햇빛: 낮에는 실제 해의 방위·고도(그림자가 하루 동안 돈다, 너무 길어지지 않게 고도 20° 아래로는 낮추지 않는다).
  // 해가 낮을수록 노을빛으로 약해지고, 밤에는 위쪽의 따뜻한 조명(예전 고정 위치)으로 바뀐다
  let x = 10, y = 18, z = 8, warm = 0;
  if (useSun()) {
    const p = sunPlace(), s = Decor.sun.position(OFFICE.now || new Date(), p.lat, p.lng), alt = Math.max(.35, s.altitude);
    x = -Math.sin(s.azimuth) * Math.cos(alt) * 24; y = Math.sin(alt) * 24; z = Math.cos(s.azimuth) * Math.cos(alt) * 24;
    warm = Math.min(1, Math.max(0, 1 - s.altitude / (20 * Math.PI / 180)));
  }
  sun.position.set(x + (10 - x) * n, y + (18 - y) * n, z + (8 - z) * n);
  sun.color.copy(_ca.setHex(L.sunColor).lerp(_cb.setHex(0xffb27a), warm * .8)).lerp(_cb.setHex(K.sunColor), n);
  sun.intensity = L.sun * (1 - warm * .35) * (1 - n) + K.sun * n;
  if (HAS_DECOR && typeof Decor.theme === "function") Decor.theme(n);
  window.SpriteChars?.theme(n);
}
setInterval(() => { if (useSun() && !OFFICE.tween) applyTheme(); }, 30000); // 해를 따라 30초마다(가구 색은 2% 넘게 바뀔 때만 다시 칠한다)
document.addEventListener("visibilitychange", () => { if (!document.hidden && useSun()) applyTheme(true); });
function setOfficeMode(m) {
  OFFICE.mode = m === "theme" ? "theme" : "sun";
  store.set("agentOffice.officeLight", OFFICE.mode);
  applyTheme();
  if (VIEW.name === "settings") scheduleView();
}
/** 설정의 '현재 위치로 맞추기': 브라우저 위치(https·localhost 에서만)로 일출·일몰을 계산한다. 못 받으면 기기 시간대 기준 그대로 */
function locateSun() {
  if (!navigator.geolocation || !window.isSecureContext) {
    toast(`이 주소(${location.protocol}//${location.host})에서는 브라우저가 위치를 주지 않아요. ${sunPlace().label} 기준으로 계산합니다.`, "warn", 6500);
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    store.set("agentOffice.place", JSON.stringify({ lat: +pos.coords.latitude.toFixed(3), lng: +pos.coords.longitude.toFixed(3), label: "현재 위치" }));
    applyTheme(); toast("현재 위치의 일출·일몰 시각으로 맞췄어요.");
    if (VIEW.name === "settings") scheduleView();
  }, () => toast(`위치를 가져오지 못했어요. ${sunPlace().label} 기준으로 계산합니다.`, "warn", 6500), { timeout: 10000, maximumAge: 864e5 });
}
function resetSunPlace() {
  store.set("agentOffice.place", "");
  applyTheme(); if (VIEW.name === "settings") scheduleView();
}
/** 설정 행 설명: 모드 + 오늘 일출·일몰(위치 기준) */
function officeLightNote() {
  if (!HAS_DECOR || !Decor.sun) return "화면 테마(라이트·다크)에 맞춰 밝기가 바뀌어요.";
  const p = sunPlace(), t = Decor.sun.times(new Date(), p.lat, p.lng);
  const hm = d => d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const today = t ? `오늘 일출 ${hm(t.sunrise)} · 일몰 ${hm(t.sunset)} (${p.label} 기준)` : `오늘은 해가 뜨거나 지지 않아요 (${p.label} 기준)`;
  return OFFICE.mode === "sun" ? `라이트 화면에서는 해를 따라 서서히 밝기가 바뀌고, 다크 화면에서는 즉시 밤 조명으로 바뀝니다. ${today}` : `화면 테마(라이트·다크)를 따라요. ${today}`;
}
function officeLightControl() {
  const custom = !!store.get("agentOffice.place");
  return el("div", { class: "office-light" },
    el("div", { class: "seg office-seg", role: "group", "aria-label": "사무실 조명" },
      ...[["sun", "sun", "일출·일몰"], ["theme", "monitor", "화면 테마"]].map(([m, ic, label]) =>
        el("button", { type: "button", "data-mode": m, "aria-pressed": String(OFFICE.mode === m), onclick: () => setOfficeMode(m) }, icon(ic), label))),
    el("button", { class: "tbtn", type: "button", onclick: locateSun }, icon("house"), custom ? "현재 위치 다시 맞추기" : "현재 위치로 맞추기"),
    custom ? el("button", { class: "tbtn", type: "button", onclick: resetSunPlace }, "시간대 기준으로") : null);
}

/* 카메라: 사무실이 실제로 '보이는 영역'에 들어오도록 정사영 크기와 중심을 계산한다.
   - 세로 폰: 상단 바 아래 ~ 바텀 시트 위, 사무실 전체
   - 가로 폰: 상단 바 아래 ~ 화면 아래, 오른쪽 시트의 왼쪽, 사무실 전체
   - 태블릿 세로(오른쪽 열이 사무실 아래): 상단 바 아래 ~ 오른쪽 열 위, 아이콘 레일 오른쪽 ~ 화면 오른쪽, 사무실 전체
   - 태블릿 가로·데스크톱(패널이 양옆): 활동 영역이 좌우 패널 사이에 보이게 하되, 사무실 전체(outer)도 패널 밑으로 들어가지 않게 */
const cam = { view: 15, tween: null };
function visibleArea() {
  const viewport = $("officeFrame")?.getBoundingClientRect();
  if (viewport?.width) return { top: viewport.top + 42, bottom: viewport.bottom - 34, left: viewport.left + 16, right: viewport.right - 16, pts: OFFICE_PTS };
  const w = innerWidth, h = innerHeight, top = $("topbar").getBoundingClientRect().bottom;
  if (mqSide.matches) return { top: top + 4, bottom: h - 8, left: 8, right: Math.max(160, $("dock").getBoundingClientRect().left - 8), pts: OFFICE_PTS };
  if (mqMobile.matches) return { top: top + 4, bottom: Math.max(top + 140, $("dock").getBoundingClientRect().top - 4), left: 8, right: w - 8, pts: OFFICE_PTS };
  const L = document.querySelector(".panel.left").getBoundingClientRect(), R = document.querySelector(".panel.right").getBoundingClientRect();
  const lBelow = L.top > h * .4, rBelow = R.top > h * .4; // 패널이 사무실 아래에 있나(태블릿 세로는 오른쪽 열만 아래)
  const left = lBelow ? 8 : L.right + 8, right = rBelow ? w - 8 : Math.max(left + 160, R.left - 8);
  if (rBelow) return { top: top + 8, bottom: Math.max(top + 160, Math.min(R.top, lBelow ? L.top : Infinity) - 8), left, right, pts: OFFICE_PTS };
  return { top: top + 8, bottom: $("command").getBoundingClientRect().top - 8, left, right,
    pts: ACT_PTS.length ? ACT_PTS : OFFICE_PTS, outer: { top: top * .55, bottom: h - 30, left: L.right, right: R.left } }; // 외곽도 패널 사이에만
}
function frame(animate, zoom, points) {
  if (!HAS3D) return;
  const w = innerWidth, h = innerHeight;
  if (!w || !h) return; // 숨겨진 창(크기 0)에서는 계산하지 않는다
  const area = visibleArea();
  if (points?.length) area.pts = points;
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
  if (!animate || window.SpaceTheme?.isPixel || mqReduce.matches || document.hidden) { cam.tween = null; applyView(to); return; }
  cam.tween = { from: { view: cam.view, target: controls.target.clone(), zoom: camera.zoom }, to, t0: performance.now() };
}
/** 픽셀 공간은 20% 단계로 한 번에 바꾸어 도트 크기의 연속 재계산을 피한다. */
function zoomCamera(direction){
  if(!HAS3D)return;
  const next=window.SpaceTheme?.isPixel?camera.zoom*(direction>0?1.2:1/1.2):camera.zoom+(direction>0?.2:-.2);
  setView(cam.view,controls.target.clone(),true,Math.min(controls.maxZoom,Math.max(controls.minZoom,next)));
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
function resize() {
  window.Dashboard?.layout();
  if (HAS3D) { renderer.setSize(innerWidth, innerHeight); renderer.clear(); } // 크기가 바뀌면 캔버스가 비워지므로 첫 프레임 전에도 배경색이 보이게 한다
  UI.focused = null; frame(false);
  window.Dashboard?.restoreRoom();
}
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
   decor.js 의 격자 A*(칸 0.5, 벽·가구를 캐릭터 반지름 0.35 만큼 넓힘)로 길을 찾고, 시야가 트인 구간은 곧게 편다(string pulling).
   벽은 ROOMS 의 문 틈으로만 지나고, 걸을 수 없는 끝점(의자 안 등)은 가장 가까운 칸에서 출발·도착한다.
   격자는 layout()(팀 구성이 바뀔 때) 마다 다시 만든다. decor.js 가 없으면 직선으로 간다.
   주소 끝에 #debugnav 를 붙이면 막힌 칸(붉은색)과 최근 경로(주황 선)를 바닥에 그린다. */
const NAV = { debug: /debugnav/.test(location.hash), overlay: null, lines: [] };
/** 출발점을 뺀 경로 [{x,z}, …]. 마지막 점은 정확히 목적지. */
function route(from, to) {
  const p = { x: to.x, z: to.z };
  if (!HAS_DECOR || !Decor.nav.grid) return [p];
  const path = Decor.nav.route(from, p);
  if (NAV.debug && HAS3D) navTrace([{ x: from.x, z: from.z }, ...path]);
  return path;
}
/** 그 자리에 설 수 있나(벽·가구 안이 아닌가). */
const walkable = (x, z) => (HAS_DECOR ? Decor.walkable(x, z) : true);
/** #debugnav: 격자(초록=걸을 수 있음, 붉음=막힘)를 바닥에 그린다. layout() 마다 갱신. */
function navDebug() {
  if (!NAV.debug || !HAS3D || !HAS_DECOR) return;
  const nv = Decor.nav, cv = Object.assign(document.createElement("canvas"), { width: nv.nx * 4, height: nv.nz * 4 }), c = cv.getContext("2d");
  for (let j = 0; j < nv.nz; j++) for (let i = 0; i < nv.nx; i++) {
    c.fillStyle = nv.free(i, j) ? "rgba(40,180,90,.2)" : "rgba(220,50,50,.5)";
    c.fillRect(i * 4, j * 4, 3, 3); // 캔버스 위쪽(v=1)이 뒷벽(−z)
  }
  const tex = new THREE.CanvasTexture(cv); tex.minFilter = tex.magFilter = THREE.NearestFilter;
  if (!NAV.overlay) {
    NAV.overlay = new THREE.Mesh(new THREE.PlaneGeometry(OW, OD), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    NAV.overlay.rotation.x = -Math.PI / 2; NAV.overlay.position.y = .03; NAV.overlay.renderOrder = 5; scene.add(NAV.overlay);
  } else { NAV.overlay.material.map.dispose(); NAV.overlay.material.map = tex; NAV.overlay.material.needsUpdate = true; }
}
function navTrace(pts) {
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, .06, p.z)));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff8800 }));
  scene.add(line); NAV.lines.push(line);
  while (NAV.lines.length > 8) { const old = NAV.lines.shift(); scene.remove(old); old.geometry.dispose(); old.material.dispose(); }
}

/* ───────────────────────── 모니터 화면 ─────────────────────────
   팀원마다 캔버스 두 개(듀얼 모니터)를 텍스처로 쓴다.
   업무 중: 역할별 작업 화면(코드·분석·디자인) / 자리에서 쉴 때: 브라우저·메신저·바탕화면 / 자리 비움: 잠금화면 */
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const SCREEN_FPS = { code: 12, chart: 10, design: 10, browse: 6, chat: 4, desktop: 1, lock: 1 };
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); c.fill(); }

class Screen {
  constructor() {
    this.W = SMALL ? 256 : 384; this.H = Math.round(this.W * .6);
    this.canvas = Object.assign(document.createElement("canvas"), { width: this.W, height: this.H });
    this.c = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.material = new THREE.MeshBasicMaterial({ map: this.tex });
    this.state = ""; this.at = 0;
  }
  dispose() { this.tex.dispose(); this.material.dispose(); }
  draw(state, now, a) {
    if (state === this.state && now - this.at < 1000 / (SCREEN_FPS[state] || 2)) return;
    this.state = state; this.at = now;
    const { c, W, H } = this, t = now / 1000, col = a.def.color;
    c.save();
    (SCREENS[state] || SCREENS.desktop)(c, W, H, t, col, a);
    c.restore();
    this.tex.needsUpdate = true;
  }
}

const SCREENS = {
  /** 개발: 코드가 아래에서 위로 쓰여 올라가는 편집기 */
  code(c, W, H, t, col) {
    c.fillStyle = "#1b1f2b"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#232838"; c.fillRect(0, 0, W, H * .1);
    c.fillStyle = col; c.fillRect(W * .03, H * .015, W * .2, H * .085);
    c.fillStyle = "#2c3245"; c.fillRect(W * .24, H * .025, W * .16, H * .075);
    c.fillStyle = "#20253a"; c.fillRect(W * .86, H * .1, W * .14, H);          // 미니맵
    const lh = H * .072, top = H * .12, speed = 1.6, scroll = t * speed, base = Math.floor(scroll), frac = scroll - base;
    const pal = [col, "#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#c0caf5", "#7dcfff"];
    c.beginPath(); c.rect(0, top, W * .85, H - top); c.clip();
    const rows = Math.ceil((H - top) / lh) + 1;
    for (let r = 0; r <= rows; r++) {
      const n = base + r, y = top + (r - frac) * lh;
      c.fillStyle = "#3b4256"; c.fillRect(W * .015, y + lh * .32, W * .035, lh * .32);
      if (hash(n * 3.1) < .13) continue; // 빈 줄
      let x = W * .08 + Math.floor(hash(n * 7.7) * 4) * W * .035;
      const k = 1 + Math.floor(hash(n) * 4), last = r === rows - 1;
      const limit = last ? x + (W * .7) * frac : W * .83; // 맨 아래 줄은 지금 타이핑 중
      for (let i = 0; i < k && x < limit; i++) {
        const w = Math.min(W * (.04 + hash(n * 13 + i) * .13), limit - x);
        c.fillStyle = pal[Math.floor(hash(n * 5 + i * 9) * pal.length)];
        c.fillRect(x, y + lh * .25, w, lh * .45);
        x += w + W * .014;
      }
      if (last && Math.floor(t * 3) % 2) { c.fillStyle = "#f5f7ff"; c.fillRect(x + 2, y + lh * .15, 2, lh * .65); }
    }
  },
  /** 분석: 막대·선 그래프가 갱신되는 대시보드 + 읽는 중인 문서 */
  chart(c, W, H, t, col) {
    c.fillStyle = "#f4f6fb"; c.fillRect(0, 0, W, H);
    c.fillStyle = col; c.fillRect(0, 0, W, H * .1);
    c.fillStyle = "rgba(255,255,255,.85)"; c.fillRect(W * .03, H * .035, W * .2, H * .035);
    c.fillStyle = "#fff"; rr(c, W * .03, H * .14, W * .45, H * .5, 6); rr(c, W * .52, H * .14, W * .45, H * .5, 6);
    for (let i = 0; i < 7; i++) {
      const h = H * .38 * (.25 + .75 * (.5 + .5 * Math.sin(t * 1.2 + i * 1.3)) * (.5 + hash(i) * .5));
      c.fillStyle = i === Math.floor(t) % 7 ? col : "#c9d2e8";
      c.fillRect(W * (.06 + i * .057), H * .6 - h, W * .04, h);
    }
    c.strokeStyle = col; c.lineWidth = 2.5; c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const x = W * (.55 + i * .0165), y = H * (.42 - .14 * Math.sin(i * .5 + t * 1.5) - .06 * Math.sin(i * 1.3 - t));
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.fillStyle = "#fff"; rr(c, W * .03, H * .68, W * .94, H * .28, 6);
    const hl = Math.floor(t * .8) % 4;
    for (let i = 0; i < 4; i++) {
      if (i === hl) { c.fillStyle = "rgba(255,214,102,.55)"; c.fillRect(W * .05, H * (.715 + i * .06), W * .85, H * .04); }
      c.fillStyle = "#b7bfd2"; c.fillRect(W * .06, H * (.725 + i * .06), W * (.55 + hash(i + 3) * .3), H * .022);
    }
  },
  /** 퍼블리싱: 와이어프레임 시안 위를 커서가 돌아다니며 요소를 고른다 */
  design(c, W, H, t, col) {
    c.fillStyle = "#e9edf4"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#fff"; c.fillRect(W * .04, H * .06, W * .66, H * .88);
    c.fillStyle = "#f7f8fb"; c.fillRect(W * .73, H * .06, W * .23, H * .88);
    const boxes = [[.06, .1, .62, .08], [.06, .22, .62, .26], [.06, .53, .19, .3], [.275, .53, .19, .3], [.49, .53, .19, .3]];
    boxes.forEach(([x, y, w, h], i) => { c.fillStyle = i === 1 ? col + "33" : "#e3e8f2"; c.fillRect(W * x, H * y, W * w, H * h); });
    c.fillStyle = col; c.fillRect(W * .1, H * .29, W * .3, H * .05); c.fillRect(W * .1, H * .38, W * .14, H * .05);
    const sel = Math.floor(t / 1.6) % boxes.length, [sx, sy, sw, sh] = boxes[sel];
    c.strokeStyle = col; c.lineWidth = 2; c.strokeRect(W * sx - 2, H * sy - 2, W * sw + 4, H * sh + 4);
    for (let i = 0; i < 7; i++) { c.fillStyle = i === sel ? col : "#c3cad9"; c.fillRect(W * .75, H * (.12 + i * .1), W * (.08 + hash(i + sel) * .1), H * .03); }
    const p = (t / 1.6) % 1, [nx, ny, nw, nh] = boxes[(sel + 1) % boxes.length], e = p < .7 ? 0 : (p - .7) / .3;
    const cx = W * (sx + sw * .6 + (nx + nw * .6 - sx - sw * .6) * e), cy = H * (sy + sh * .6 + (ny + nh * .6 - sy - sh * .6) * e);
    c.fillStyle = "#1d2433"; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy + 16); c.lineTo(cx + 5, cy + 12); c.lineTo(cx + 11, cy + 12); c.closePath(); c.fill();
  },
  /** 쉬는 중: 웹 페이지를 천천히 스크롤 */
  browse(c, W, H, t, col) {
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    const off = (t * 18) % (H * 1.2), top = H * .14;
    c.save(); c.beginPath(); c.rect(0, top, W, H - top); c.clip();
    for (let k = -1; k < 3; k++) {
      const y0 = top + k * H * 1.2 - off;
      c.fillStyle = col + "2e"; rr(c, W * .08, y0 + H * .05, W * .84, H * .32, 6);
      for (let i = 0; i < 6; i++) { c.fillStyle = "#cfd5e2"; c.fillRect(W * .08, y0 + H * (.44 + i * .07), W * (.5 + hash(k * 9 + i) * .34), H * .025); }
      c.fillStyle = "#e8ecf4"; rr(c, W * .08, y0 + H * .9, W * .4, H * .22, 5); rr(c, W * .52, y0 + H * .9, W * .4, H * .22, 5);
    }
    c.restore();
    c.fillStyle = "#e4e8f0"; c.fillRect(0, 0, W, top);
    ["#ff6b6b", "#ffd166", "#06d6a0"].forEach((f, i) => { c.fillStyle = f; c.beginPath(); c.arc(W * (.03 + i * .03), top / 2, H * .018, 0, 7); c.fill(); });
    c.fillStyle = "#fff"; rr(c, W * .14, top * .22, W * .72, top * .56, top * .28);
  },
  /** 쉬는 중: 메신저 말풍선이 하나씩 올라온다 */
  chat(c, W, H, t, col) {
    c.fillStyle = "#f3f5f9"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#e4e8f0"; c.fillRect(0, 0, W * .26, H);
    for (let i = 0; i < 5; i++) { c.fillStyle = i === 1 ? "#fff" : "#d5dbe7"; rr(c, W * .02, H * (.05 + i * .17), W * .22, H * .13, 5); }
    const n = Math.floor(t / 1.4) % 7;
    for (let i = 0; i < 6; i++) {
      const k = n - (5 - i); if (k < 0) continue;
      const mine = hash(k * 4.2) > .5, w = W * (.2 + hash(k) * .3), y = H * (.08 + i * .145);
      c.fillStyle = mine ? col : "#ffffff"; rr(c, mine ? W * .96 - w : W * .3, y, w, H * .1, 8);
    }
  },
  /** 바탕화면: 팀원 색 배경 + 시계 + 독 */
  desktop(c, W, H, t, col, a) {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, col); g.addColorStop(1, "#1d2433");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,.9)"; c.font = `600 ${H * .16}px "Noto Sans KR", system-ui, sans-serif`; c.textAlign = "right";
    c.fillText(hhmm(), W * .95, H * .24);
    c.fillStyle = "rgba(255,255,255,.22)"; rr(c, W * .2, H * .82, W * .6, H * .13, 10);
    for (let i = 0; i < 5; i++) { c.fillStyle = ["#fff", "#ffd166", "#06d6a0", "#7aa2f7", "#ff8fab"][i]; rr(c, W * (.24 + i * .11), H * .845, W * .07, H * .085, 6); }
    c.fillStyle = "rgba(255,247,190,.95)"; c.fillRect(W * .06, H * .1, W * .2, H * .28);
    c.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 3; i++) c.fillRect(W * .08, H * (.16 + i * .07), W * .15, H * .02);
  },
  /** 자리 비움: 잠금화면 */
  lock(c, W, H, t, col, a) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0f1424"); g.addColorStop(1, "#1f2740");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = col; c.globalAlpha = .55;
    c.beginPath(); c.arc(W * (.5 + .35 * Math.sin(t * .3)), H * (.5 + .3 * Math.cos(t * .23)), H * .05, 0, 7); c.fill();
    c.globalAlpha = 1; c.textAlign = "center"; c.fillStyle = "#e8ecf7";
    c.font = `600 ${H * .2}px "Noto Sans KR", system-ui, sans-serif`; c.fillText(hhmm(), W / 2, H * .52);
    c.font = `500 ${H * .075}px "Noto Sans KR", system-ui, sans-serif`; c.fillStyle = "#9aa6c2"; c.fillText(`${a.def.label} · 자리 비움`, W / 2, H * .68);
  },
};
/** 업무 중 오른쪽 모니터: 개발자는 참고 문서, 분석가는 메신저, 퍼블리셔는 코드 */
const SIDE_SCREEN = { code: "browse", chart: "chat", design: "code" };
/** 역할 이름으로 업무 화면 종류를 고른다. */
const workScreen = role => /개발|코드|엔지니어|dev/i.test(role) ? "code" : /분석|리서치|데이터|research/i.test(role) ? "chart" : "design";

/* ───────────────────────── 캐릭터 ─────────────────────────
   앉아 있거나 커피를 마시거나 회의 중일 때는 몇 초마다 '행동'을 바꾼다(타이핑·스크롤·생각·한 모금·기지개·두리번·기대기·의자 돌리기·머리 긁기·턱 괴기·손짓·가리키기).
   [이름, 가중치, 최소 초, 최대 초] */
const ACTS = {
  type: [["typing", 7, 3, 7], ["scroll", 2, 2, 4], ["think", 2, 2, 4], ["sip", 1.2, 2.6, 3.4], ["lean", 1, 2, 3]],
  sit: [["browse", 3, 3, 6], ["sip", 2.5, 2.6, 3.4], ["typing", 1.5, 2, 4], ["relax", 2, 3, 6], ["look", 2, 2, 4], ["swivel", 1.5, 2.5, 4],
    ["stretch", 1, 2.2, 3], ["think", 1, 2, 3], ["chin", 1.6, 3, 5], ["scratch", .7, 1.5, 2.5]],
  lounge: [["look", 2, 2, 4], ["sip", 2, 2.6, 3.4], ["relax", 1.5, 3, 5], ["chin", 2, 3, 5], ["think", 1, 2, 3], ["scratch", .5, 1.5, 2.5]],
  coffee: [["hold", 3, 2, 4], ["sip", 2.5, 2.6, 3.4], ["look", 1.5, 2, 3]],
  talk: [["gesture", 3, 2, 4], ["nod", 2, 1.5, 3], ["listen", 2.5, 2, 4]],
  lead: [["gesture", 3, 2, 4], ["point", 2.5, 2, 3.5], ["nod", 1.5, 1.5, 3], ["listen", 1.5, 2, 3]], // 팀장: 태블릿 보며 가리키기
};
/** 이 행동 중에는 오른손에 컵을 계속 들고 있어도 된다(Gemini 의 커피컵) */
const CUP_ACTS = new Set(["sip", "hold", "look", "swivel", "listen", "nod"]);
/** 팔꿈치를 따로 지정하지 않으면 팔을 앞으로 올릴수록 조금씩 접는다 */
const autoElbow = armX => (armX < 0 ? Math.max(-1.3, armX * .45) : 0);
/** characters.js(프리셋 캐릭터)·labels.css(이름표)는 index.html 에 없어도 여기서 불러온다. 늦게 로드되면 characters-ready 로 캐릭터를 다시 만든다. */
function ensureCharacterAssets() {
  if (ensureCharacterAssets.done) return;
  ensureCharacterAssets.done = true;
  if (!document.querySelector('link[href$="labels.css"]')) document.head.append(el("link", { rel: "stylesheet", href: "labels.css" }));
  if (HAS3D && !window.Characters && !document.querySelector('script[src$="characters.js"]')) document.head.append(el("script", { src: "characters.js" }));
}
addEventListener("characters-ready", () => { if (D.teamKey && Object.values(D.agents).some(a => !a.ghost && !a.rig?.setFace)) buildTeam(JSON.parse(D.teamKey)); });
function pickAct(list, prev) {
  for (let tries = 0; tries < 3; tries++) {
    let r = Math.random() * list.reduce((s, a) => s + a[1], 0);
    for (const a of list) if ((r -= a[1]) <= 0) { if (a[0] !== prev || tries === 2) return [a[0], a[2] + Math.random() * (a[3] - a[2])]; break; }
  }
  return [list[0][0], list[0][2]];
}
/** 팀원별 선택 외형과 해당 인물의 표정 띠. 등록되지 않은 외형은 null. */
/* 팀원 외형 어댑터(테마마다 모양만 다르다): 고른 외형 · 표정 띠 · 3D 모델 · 이름표 아이콘 · 외형 고르기 창 · 안내 문구.
   동물원은 zoo-theme.js(동물 15종), 사무실은 character-looks.js·sprite-chars.js(사람 그림). 조연·손님도 def.kind 로 같은 길을 탄다 */
const LOOKS = window.SpaceTheme?.isPixel && window.PixelTheme ? {
  noun:"픽셀 캐릭터", of:n=>PixelTheme.lookOf(n),
  faces:n=>PixelTheme.faces(LOOKS.of(n)),build:(def,name,key)=>PixelTheme.buildCharacter(def,key||def.kind||LOOKS.of(name)),icon:null,pick:null,
  help:"에이전트 화면의 픽셀 얼굴을 눌러 외형을 바꾸고, 캐릭터나 이름을 눌러 개인 대화를 시작하세요. 팀의 AI·모델·역할은 설정에서 바꿀 수 있어요.",
} : window.SpaceTheme?.isZoo && window.ZooTheme ? {
  noun: "동물", of: n => window.ZooTheme.kindOf(n), faces: n => window.ZooTheme.faces(n),
  build: (def, name, key) => window.ZooTheme.buildAnimal(def, name, key || def.kind), icon: n => window.ZooTheme.icons[n] || "🐾",
  pick: n => window.ZooTheme.openPicker(n),
  help: "팀원의 동물 얼굴을 누르면 15종 가운데에서 동물을 고를 수 있어요(같은 동물은 한 명만). 이름을 누르면 개인 대화가 열립니다. AI·모델·하는 일·팀장은 오른쪽 위 ‘설정’에서 바꿔요.",
} : {
  noun: "사람 이미지", of: n => window.CharacterLooks?.get(n) || n, faces: n => window.SpriteChars?.faces(LOOKS.of(n)) || null,
  build: (def, name, key) => window.SpriteChars?.build(def, key || def.kind || LOOKS.of(name)) || null, icon: null, pick: null,
  help: "팀원의 사람 이미지를 누르면 외형을 선택할 수 있어요. 이름을 누르면 개인 대화가 열립니다. AI·모델·하는 일·팀장은 오른쪽 위 ‘설정’에서 바꿔요.",
};
const appearanceOf = n => LOOKS.of(n);
const facesOf = n => LOOKS.faces(n) || null;
/** 표정 아바타 CSS 변수: 띠 이미지·칸 수·보여 줄 칸(style.css 의 .face) */
const faceVars = (f, expr = "기본") => ({ "--face": `url("${f.src}")`, "--fn": f.n, "--fi": f.index(expr) });
/** 0→1→0 으로 올라갔다 내려오는 동작 곡선(올리기 25% · 유지 · 내리기 20%) */
const env = p => (p < .25 ? p / .25 : p > .8 ? Math.max(0, (1 - p) / .2) : 1);
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
    // 시트 캐릭터 외형을 기본으로 보존한다. 승인된 정밀 GLB가 생기기 전에는 도형 모델로 교체하지 않는다.
    // 둘 다 없으면 단순 도형 캐릭터. 모두 같은 rig 계약:
    // group(위치·방향) ─ legs(+knees) / body(엉덩이 축으로 기울기) ─ torso·arms(+elbows·hands)·head(목 축으로 고개)·cup·props
    // 그림 캐릭터는 뼈대가 비어 있고 rig.sprite 가 매 프레임 그림(프레임)을 고른다
    ensureCharacterAssets();
    let rig = window.SpaceTheme?.isZoo || window.SpaceTheme?.isPixel ? LOOKS.build(def, name) : null;
    const use3DChar = store.get("agentOffice.char3d") === "1" || /[?&]char=3d\b/.test(location.search);
    if (!rig && (!use3DChar || appearanceOf(name) !== name)) {
      try { rig = LOOKS.build(def, name); }
      catch (e) { console.warn(`그림 캐릭터 생성 실패(${name}), 3D 캐릭터로 대체:`, e); }
    }
    try { rig = rig || (window.Characters && Characters.build(def, name)); } // 프리셋 오류가 팀 전체 구성을 막지 않게
    catch (e) { console.warn(`캐릭터 생성 실패(${name}), 기본 모양으로 대체:`, e); }
    rig = this.rig = rig || this.primitiveRig(def);
    Object.assign(this, { group: rig.group, legs: rig.legs, body: rig.body, arms: rig.arms, head: rig.head, cup: rig.cup });
    this.props = rig.props || {}; this.pr = rig.preset || {};
    this.workKind = workScreen(def.role);
    Object.assign(this, { act: "", actMode: "", actAt: 0, actDur: 0, yaw: 0, expr: "기본", emoteExpr: "", emoteUntil: 0, phase: Math.random() * 6 });
    rig.group.position.set(this.seat.x, 0, this.seat.z);
    rig.group.rotation.y = Math.PI;
    scene.add(rig.group);
    this.makeLabel();
  }
  /** characters.js 를 못 불러왔을 때의 단순 도형 캐릭터(같은 rig 계약, 무릎·팔꿈치·표정 없음) */
  primitiveRig(def) {
    const g = new THREE.Group(), color = new THREE.Color(def.color);
    const legs = [-.12, .12].map(x => {
      const pivot = new THREE.Group(); pivot.position.set(x, .55, 0); g.add(pivot);
      box(.17, .55, .17, 0x2f3446, 0, -.27, 0, pivot); return pivot;
    });
    const body = new THREE.Group(); body.position.y = .55; g.add(body);
    const torso = new THREE.Group(); torso.position.y = -.55; body.add(torso);
    cyl(.26, .3, .6, color, 0, .85, 0, torso);
    const arms = [-.36, .36].map(x => {
      const pivot = new THREE.Group(); pivot.position.set(x, 1.1, 0); torso.add(pivot);
      box(.13, .5, .13, color, 0, -.22, 0, pivot);
      box(.12, .1, .12, SKIN, 0, -.5, 0, pivot); return pivot;
    });
    const cup = new THREE.Group(); cup.position.set(0, -.56, .06); arms[1].add(cup);
    cyl(.065, .055, .14, 0xffffff, 0, 0, 0, cup, 12);
    cyl(.067, .067, .03, color, 0, .03, 0, cup, 12);
    cup.visible = false;
    const head = new THREE.Group(); head.position.y = 1.18; torso.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(.25, 24, 16), mat(SKIN));
    skull.position.y = .24; skull.castShadow = true; head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.265, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(def.hair));
    hair.position.y = .27; hair.rotation.x = -.25; head.add(hair);
    for (const x of [-.09, .09]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 8), mat(0x1d2433));
      eye.position.set(x, .26, .22); head.add(eye);
    }
    return { group: g, legs, body, arms, head, cup, height: 1.9 };
  }
  /** 이름표: 흰 알약(팀원 색 점 + 이름 + 팀장 ★) 아래 연회색 역할 알약. 말풍선은 그 위. tag(이름표 알약)는 declutter() 가 겹침을 잰다 */
  makeLabel() {
    const d = this.def;
    this.bubble = el("div", { class: "bubble" });
    const f = this.rig?.faceStrip;
    this.faceEl = f ? el("i", { class: "face", style: faceVars(f) }) : null; // 그림 캐릭터: 색 점 대신 지금 표정의 얼굴
    this.tag = el("button", { type:"button", class: "nametag", "aria-label":`${d.label}에게 말 걸기`, onclick:()=>window.CharacterChat?.open(this.name) }, this.faceEl || el("i", { class: "dot" }), el("b", { text: d.label }), d.leader ? el("span", { class: "crown", title: "팀장", text: "★" }) : null);
    this.role = d.role ? el("div", { class: "roletag", text: d.role }) : null;
    this.label = el("div", { class: "tagwrap", style: { "--c": d.color } }, this.bubble, this.tag, this.role);
    this.ly = 0; // declutter() 가 겹친 이름표를 위로 밀어 올린 양(px)
    $("labels").append(this.label);
  }
  changeAppearance(key) {
    if (this.ghost) return;
    const rig = LOOKS.build(this.def, this.name, key);
    if (!rig) return;
    const previous = this.rig;
    rig.group.position.copy(this.group.position);
    rig.group.rotation.copy(this.group.rotation);
    scene.remove(this.group);
    previous.dispose?.();
    this.rig = rig;
    Object.assign(this, { group: rig.group, legs: rig.legs, body: rig.body, arms: rig.arms, head: rig.head, cup: rig.cup });
    this.props = rig.props || {}; this.pr = rig.preset || {};
    scene.add(this.group);
    this.label.remove(); this.makeLabel();
    this.expr = ""; this.setFace("기본");
  }
  dispose() {
    this._settle(false); clearTimeout(this._bt);
    this.tv?.dispose(); this.tv2?.dispose();
    if (this.ghost) return;
    scene.remove(this.group); dispose(this.group); this.rig.dispose?.(); this.label.remove();
  }
  /** 잠깐 짓는 표정(말할 때 웃음, 새 업무·오류에 놀람). ms 는 연출 시간 기준 */
  emote(expr, ms = 1500) { this.emoteExpr = expr; this.emoteUntil = this.t + ms / 1000; }
  setFace(expr) {
    if (expr === this.expr || !this.rig?.setFace) return;
    this.expr = expr; this.rig.setFace(expr);
    if (this.faceEl) this.faceEl.style.setProperty("--fi", this.rig.faceStrip.index(expr));
  }
  say(text, ms = 2600) {
    this.lastSay = performance.now();
    if (this.ghost) return;
    const shock = /😥|👀|오류|문제|실패/.test(text);
    this.emote(shock ? "놀람" : "웃음", shock ? 2000 : 1400);
    this.bubble.textContent = text;
    this.bubble.classList.add("show"); this._lw = 0; // 말풍선이 생기면 이름표 크기를 다시 잰다
    this.label.style.zIndex = ++SAY_Z;
    clearTimeout(this._bt);
    if (ms) this._bt = setTimeout(() => { this.bubble.classList.remove("show", "covered"); this.bubble.style.translate = ""; this._lw = 0; }, ms / SPEED);
  }
  _settle(ok) { const f = this._arrive; this._arrive = null; f && f(ok); }
  /** 아직 출근 전(문 밖)이면 캐릭터와 이름표를 숨긴다. 이동·순간 이동하면 다시 보인다. */
  setHidden(v) {
    if (this.ghost) return;
    this.hidden = !!v;
    this.group.visible = !v;
    this.label.style.display = v ? "none" : "";
  }
  /** 걸어서 이동. 도착하면 true, 다른 이동에 밀리면 false 로 끝난다. via 를 주면 그 지점을 거쳐 간다(현관 문 밖 → 문 안 → 자리). */
  walkTo(p, via) {
    this._settle(false);
    const pos = this.group.position;
    if (this.ghost || document.hidden || Math.hypot(p.x - pos.x, p.z - pos.z) < .05) { this.teleport(p); return Promise.resolve(true); }
    if (this.hidden) this.setHidden(false);
    this.path = via ? [{ x: via.x, z: via.z }, ...route(via, p)] : route(pos, p);
    this.mode = "walk";
    return new Promise(r => (this._arrive = r));
  }
  teleport(p, rot) {
    this._settle(false);
    this.path = [];
    if (this.hidden) this.setHidden(false);
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
    this.targetRot = Math.atan2((this.monitorTarget?.x ?? this.seat.x) - this.seat.x, (this.monitorTarget?.z ?? this.seat.z - 1) - this.seat.z); this.mode = mode;
    if (mode === "type") this.typingSince = performance.now();
  }
  update(dt) {
    this.t += dt;
    const g = this.group;
    if (this.mode === "walk" && this.path.length && !this.rig.sprite?.hold(this, dt)) { // 그림 캐릭터는 자리에서 일어나는 동안 멈춘다
      const p = this.path[0], dx = p.x - g.position.x, dz = p.z - g.position.z, dist = Math.hypot(dx, dz), step = this.speed * dt;
      if (dist > 1e-3) this.targetRot = Math.atan2(dx, dz);
      if (dist <= step) { g.position.x = p.x; g.position.z = p.z; this.path.shift(); }
      else { g.position.x += dx / dist * step; g.position.z += dz / dist * step; }
      if (!this.path.length) { this.mode = "stand"; this._settle(true); }
    }
    const atDesk = this.atDesk(), atMeet = this.atMeet();
    const seated = this.mode === "sit" || this.mode === "type" || (this.mode === "talk" && atMeet); // 회의 자리에서는 앉아서 이야기한다
    if (seated && atDesk && this.monitorTarget) this.targetRot = Math.atan2(this.monitorTarget.x - g.position.x, this.monitorTarget.z - g.position.z);
    const pose = { legL: 0, legR: 0, legLz: 0, legRz: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, elbL: null, elbR: null,
      headX: 0, headY: 0, lean: 0, yaw: 0, y: 0, cup: false, pocketL: false, pocketR: false, expr: "기본" };
    const t = this.t, s = Math.sin(t * 10);
    if (seated) Object.assign(pose, { legL: -1.45, legR: -1.45, kneeL: 1.45, kneeR: 1.45, y: -.43 });
    if (this.mode === "walk") Object.assign(pose, { legL: s * .6, legR: -s * .6, kneeL: Math.max(0, s) * .7, kneeR: Math.max(0, -s) * .7, armL: -s * .5, armR: s * .5, y: Math.abs(s) * .05 });
    else if (seated || this.mode === "coffee" || this.mode === "talk") this.doAct(pose, seated);
    else if (this.mode === "write") Object.assign(pose, { armR: -2.2 + Math.sin(t * 8) * .25, elbR: -.2, headX: -.12, headY: Math.sin(t * 2) * .1, expr: "집중" });
    else Object.assign(pose, { y: Math.sin(t * 1.5) * .01, headY: Math.sin(t * .7) * .3, legLz: -.03, legRz: .03 });
    this.dress(pose, seated, atDesk, atMeet);

    const k = Math.min(1, dt * 10), lerp = (o, key, v) => (o[key] += (v - o[key]) * k), R = this.rig;
    this.yaw += (pose.yaw - this.yaw) * k;
    let d = this.targetRot + this.yaw - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, dt * 10);
    if (R.sprite) { R.sprite.update(this, dt, seated, camera); return; } // 그림 캐릭터: 뼈대 대신 방향·자세에 맞는 그림을 고른다
    lerp(this.legs[0].rotation, "x", pose.legL); lerp(this.legs[1].rotation, "x", pose.legR);
    lerp(this.legs[0].rotation, "y", pose.legLy || 0); lerp(this.legs[1].rotation, "y", pose.legRy || 0);
    lerp(this.legs[0].rotation, "z", pose.legLz); lerp(this.legs[1].rotation, "z", pose.legRz);
    if (R.knees) { lerp(R.knees[0].rotation, "x", pose.kneeL); lerp(R.knees[1].rotation, "x", pose.kneeR); }
    lerp(this.arms[0].rotation, "x", pose.armL); lerp(this.arms[1].rotation, "x", pose.armR);
    lerp(this.arms[0].rotation, "y", pose.armLy || 0); lerp(this.arms[1].rotation, "y", pose.armRy || 0);
    lerp(this.arms[0].rotation, "z", pose.armLz); lerp(this.arms[1].rotation, "z", pose.armRz);
    if (R.elbows) { lerp(R.elbows[0].rotation, "x", pose.elbL ?? autoElbow(pose.armL)); lerp(R.elbows[1].rotation, "x", pose.elbR ?? autoElbow(pose.armR)); }
    if (R.wrists) {
      const wL = pose.wristL || [0, 0, 0], wR = pose.wristR || [0, 0, 0];
      lerp(R.wrists[0].rotation, "x", wL[0]); lerp(R.wrists[0].rotation, "y", wL[1]); lerp(R.wrists[0].rotation, "z", wL[2]);
      lerp(R.wrists[1].rotation, "x", wR[0]); lerp(R.wrists[1].rotation, "y", wR[1]); lerp(R.wrists[1].rotation, "z", wR[2]);
    }
    if (R.hands) {
      R.hands[0].visible = !pose.pocketL; R.hands[1].visible = !pose.pocketR;
      const cupHand = R.hands[pose.cupHand === "L" ? 0 : 1];
      if (cupHand && this.cup.parent !== cupHand) cupHand.add(this.cup);
    }
    lerp(this.head.rotation, "x", pose.headX); lerp(this.head.rotation, "y", pose.headY); lerp(this.head.rotation, "z", pose.headZ || 0);
    lerp(this.body.rotation, "x", pose.lean); lerp(this.body.rotation, "y", pose.bodyY || 0);
    this.cup.visible = pose.cup;
    if (this.mug) this.mug.visible = !(pose.cup && atDesk);
    const targetY = seated && R.seatOffset != null ? R.seatOffset + pose.y + .43 : pose.y + (seated ? .02 : 0);
    g.position.y += (targetY - g.position.y) * k;
    R.tick?.(t, this.act === "typing");
  }
  atDesk() { const p = this.group.position; return Math.hypot(p.x - this.seat.x, p.z - this.seat.z) < .35; }
  atMeet() { const p = this.group.position; return Math.hypot(p.x - this.meet.x, p.z - this.meet.z) < .35; }
  /** 프리셋 소품(태블릿·노트북·커피컵·주머니 손)과 표정을 상태에 맞춘다(docs/characters.md 포즈 매핑).
      Claude: 서고·걷고·회의할 때 태블릿을 가슴에 / GPT: 이동 중 노트북을 옆구리에, 회의 테이블에서는 펼쳐 놓고, 서 있으면 왼손은 주머니에
      Gemini: 타이핑할 때 빼고는 커피컵을 손에, 걸을 때는 노트북도 옆구리에 */
  dress(pose, seated, atDesk, atMeet) {
    const pr = this.pr, P = this.props, m = this.mode, moving = m === "walk" || m === "stand";
    const show = { tablet: false, laptop: false, laptopOpen: false, phone: false };
    const lifeKey = m !== "walk" && (["lounge", "tea"].includes(this.lifePose) ? this.lifePose : (this.presenting ? "present" : ""));
    if (lifeKey && window.Characters?.POSES?.[lifeKey]) {
      const sp = window.Characters.POSES[lifeKey](String(this.name || "").toLowerCase());
      Object.assign(pose, sp);
      show.phone = !!sp.phone;
      for (const k in show) if (P[k]) P[k].visible = show[k];
      this.setFace(this.t < this.emoteUntil ? this.emoteExpr : (sp.expr || pose.expr));
      return;
    }
    const busyHands = this.act === "typing" || this.act === "scroll" || this.act === "lean" || this.act === "relax" || this.act === "stretch";
    if (pr.tablet && !(seated && (atDesk || busyHands)) && m !== "coffee") { show.tablet = true; Object.assign(pose, { armL: -1.05, armLz: .55, elbL: -1.65 }); }
    if (pr.laptopOpen && atMeet && (m === "talk" || m === "sit")) {
      show.laptopOpen = true;
      if (this.act === "listen" || this.act === "nod" || this.act === "look") Object.assign(pose, { armL: -.95, armR: -.95, armLz: .12, armRz: -.12, elbL: -.75, elbR: -.75 });
    } else if (pr.laptop && moving) {
      show.laptop = true;
      Object.assign(pose, pr.laptop === "L" ? { armL: 0, armLz: -.12, elbL: -.35 } : { armR: 0, armRz: .12, elbR: -.35 });
    }
    if (pr.pocket && m === "stand") Object.assign(pose, pr.pocket === "L" ? { pocketL: true, armL: .05, armLz: .1, elbL: 0 } : { pocketR: true, armR: .05, armRz: -.1, elbR: 0 });
    if (pr.cupAlways && (moving || m === "coffee" || (m === "talk" && this.act !== "gesture" && this.act !== "point") || (seated && CUP_ACTS.has(this.act)))) {
      pose.cup = true;
      if (moving || (this.act !== "sip" && this.act !== "hold")) Object.assign(pose, { armR: -.35, armRz: .05, elbR: -1.25 }); // 컵을 배 앞에 들고
    }
    for (const k in show) if (P[k]) P[k].visible = show[k];
    this.setFace(this.t < this.emoteUntil ? this.emoteExpr : pose.expr);
  }
  /** 앉아 있거나 커피 코너·회의 중일 때의 자연스러운 행동. 몇 초마다 ACTS 에서 하나를 고른다. */
  doAct(pose, seated) {
    const m = this.mode;
    const list = m === "coffee" ? "coffee" : m === "talk" ? (this.def.leader ? "lead" : "talk") : m === "type" ? "type" : this.atDesk() ? "sit" : "lounge";
    if (list !== this.actMode || this.t - this.actAt > this.actDur) {
      [this.act, this.actDur] = list !== this.actMode && list === "type" ? ["typing", 3 + Math.random() * 3] : pickAct(ACTS[list], this.act);
      this.actMode = list; this.actAt = this.t;
    }
    const t = this.t, p = (t - this.actAt) / this.actDur, u = env(p), rest = seated ? -.55 : 0;
    Object.assign(pose, { armL: rest, armR: rest });
    switch (this.act) {
      case "typing":
        Object.assign(pose, { armL: -1.1 + Math.sin(t * 22) * .12, armR: -1.1 + Math.cos(t * 19) * .12, armLz: .1, armRz: -.1, headX: .2 + Math.sin(t * 2.3) * .04, lean: .06, expr: "집중" });
        break;
      case "scroll": case "browse":
        Object.assign(pose, { armR: -1.05 + Math.sin(t * 3) * .05, armRz: -.04 + Math.sin(t * 1.7) * .07, armL: -.65, headX: .1, headY: Math.sin(t * .8) * .1, expr: this.act === "scroll" ? "집중" : "기본" });
        if (this.act === "browse") pose.lean = -.05;
        break;
      case "think":
        Object.assign(pose, { armR: -2.35, armRz: -.42, armL: -.85, armLz: .12, headX: .02, headY: .18 + Math.sin(t * .6) * .05, expr: "생각" });
        break;
      case "chin": // 턱 괴고(앉았으면 다리도 꼬고) 생각
        Object.assign(pose, { armR: -2.1, armRz: -.3, elbR: -1.95, armL: -.7, elbL: -.9, headX: .06, headY: .14 + Math.sin(t * .5) * .06, lean: .08, expr: "생각" });
        if (seated) Object.assign(pose, { legR: -1.6, legRz: -.3, kneeR: .9 });
        break;
      case "sip": {
        const drink = p > .3 && p < .75;
        Object.assign(pose, { armR: rest + (-2.25 - rest) * u, armRz: -.5 * u, headX: drink ? -.2 : 0, cup: true });
        if (seated) pose.armL = -.6;
        break;
      }
      case "hold":
        Object.assign(pose, { armR: -1.25, armRz: -.25, headY: Math.sin(t * .9) * .25, cup: true });
        break;
      case "stretch":
        Object.assign(pose, { armL: rest + (-3 - rest) * u, armR: rest + (-3 - rest) * u, armLz: .25 * u, armRz: -.25 * u, elbL: 0, elbR: 0, lean: -.14 * u, headX: -.25 * u });
        break;
      case "relax": // 손깍지 끼고 뒤로 기대기
        Object.assign(pose, { armL: -2.75, armR: -2.75, armLz: .55, armRz: -.55, lean: -.16, headX: -.1, headY: Math.sin(t * .5) * .15 });
        break;
      case "look":
        Object.assign(pose, { headY: Math.sin(t * 1.6) * .7, yaw: seated ? Math.sin(t * .8) * .18 : 0 });
        break;
      case "swivel":
        Object.assign(pose, { yaw: Math.sin(t * 2.2) * .4, headY: -Math.sin(t * 2.2) * .2, armL: -.5, armR: -.5 });
        break;
      case "scratch":
        Object.assign(pose, { armR: -2.8 + Math.sin(t * 14) * .08, armRz: -.55, headX: .1, headY: -.15 });
        break;
      case "lean": // 화면 쪽으로 몸을 숙여 들여다보기
        Object.assign(pose, { armL: -.95, armR: -.95, armLz: .15, armRz: -.15, lean: .16, headX: .15, expr: "집중" });
        break;
      // 회의·보고: 손짓 / 가리키기(팀장) / 끄덕이기 / 듣기
      case "gesture":
        Object.assign(pose, { armR: -.6 + Math.sin(t * 4) * .4, armRz: -.1, headY: Math.sin(t * 1.3) * .25, y: seated ? pose.y : Math.abs(Math.sin(t * 3)) * .02, expr: Math.sin(t * .9 + this.phase) > .3 ? "웃음" : "기본" });
        break;
      case "point":
        Object.assign(pose, { armR: -1.55 + Math.sin(t * 3) * .08, armRz: -.12, elbR: -.05, headX: .05, headY: -.12 + Math.sin(t * .7) * .08 });
        break;
      case "nod":
        Object.assign(pose, { headX: .1 + Math.sin(t * 5) * .1, expr: "웃음" });
        break;
      case "listen":
        Object.assign(pose, { headY: Math.sin(t * .8) * .2, headX: .02 });
        break;
    }
  }
  /** 듀얼 모니터: 업무 중이면 왼쪽은 역할별 작업 화면·오른쪽은 참고 화면, 쉬는 중이면 브라우저·메신저·바탕화면, 자리를 비우면 잠금화면. */
  paint(now) {
    if (!this.tv || window.SpaceTheme?.isPixel) return; // 픽셀 화면은 2D 렌더러가 직접 그린다.
    let main = "lock", side = "lock";
    if (this.mode !== "walk" && this.atDesk()) {
      if (this.mode === "type") { main = this.workKind; side = SIDE_SCREEN[this.workKind]; }
      else if (this.act === "browse" || this.act === "typing") { main = hash(Math.floor(this.actAt)) > .5 ? "chat" : "browse"; side = "desktop"; }
      else { main = "desktop"; side = this.act === "relax" || this.act === "look" ? "browse" : "desktop"; }
    }
    this.tv.draw(main, now, this);
    this.tv2.draw(side, now + 37, this);
  }
  /** 이름표 기준점(머리 위)을 화면 좌표로. az 는 카메라 깊이(작을수록 가깝다) — declutter() 가 겹침 우선순위에 쓴다 */
  placeLabel(w, h) {
    const v = this.group.position.clone(); v.y += this.rig.height || 1.9;
    v.project(camera);
    this.ax = (v.x * .5 + .5) * w; this.ay = (-v.y * .5 + .5) * h; this.az = v.z; this.ly = 0;
    this.moveLabel();
  }
  /** 이름표를 화면 픽셀 격자에 맞춰 놓는다(소수점 위치·% 이동은 글자를 뿌옇게 만든다). 크기는 20프레임마다 또는 말풍선이 바뀔 때만 잰다 */
  moveLabel() {
    const L = this.label;
    if (!this._lw || this._bw === 0 || (this._mn = (this._mn || 0) + 1) % 20 === 0) { this._lw = L.offsetWidth; this._lh = L.offsetHeight; this._bw = 1; }
    const x = snapPx(this.ax - this._lw / 2), y = snapPx(this.ay - this.ly - this._lh);
    L.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
}

/** 화면 픽셀(기기 픽셀) 격자로 반올림 — 글자가 번지지 않게 */
function snapPx(v) { const d = devicePixelRatio || 1; return Math.round(v * d) / d; }

/* ───────────────────────── 상태 ───────────────────────── */
/* 이름 → 객체 표(agents·lanes)는 프로토타입 없는 객체: 팀원 이름이 constructor·toString 같아도 Object.prototype 을 타지 않는다 */
const D = {
  names: [], agents: Object.create(null), leader: "", teamKey: "", mock: false, greeted: false,
  ready: Object.create(null), // 팀원별 연결 준비 {ok, hint} (hello.team 의 ready/hint). 값이 없으면(데모·옛 서버) 표시하지 않는다
  run: null,      // 서버 기준 현재 실행(이벤트 도착 즉시 반영)
  shown: null,    // 화면(보드)에 보여 주는 실행(연출 진행에 맞춰 바뀜)
  lastRun: null,  // '최근 보고서 보기' 대상
  running: false, phaseText: "대기 중",
  stage: new Lane(), lanes: Object.create(null),
};
const UI = { submitting: false, subT: 0, focused: null, swipedAt: 0, dragY: null, mine: new Set() }; // mine: 이 화면에서 지시한 run_id
const A = n => D.agents[n];
const who = n => (Object.hasOwn(D.agents, n) ? n : D.leader);
const lane = n => (D.lanes[n] ||= new Lane());
const memberDef = n => A(n)?.def || { label: niceName(n || "?"), color: "#6b7489" };
function niceName(n) { n = String(n); return known(n)?.label || (n.length <= 3 ? n.toUpperCase() : n[0].toUpperCase() + n.slice(1)); }

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
  D.agents = Object.create(null); D.leader = team.leader; D.teamKey = JSON.stringify(team);
  const order = [team.leader, ...team.members.map(m => m.name).filter(n => n !== team.leader)];
  window.CharacterLooks?.reconcile(order);
  const used = new Set();
  let extra = 0;
  const defs = order.map((n, i) => {
    const m = team.members.find(x => x.name === n), k = known(n);
    let initial = k?.initial || niceName(n)[0];
    if (used.has(initial)) initial = niceName(n).slice(0, 2);
    used.add(initial);
    return {
      label: niceName(n), initial: LOOKS.icon ? LOOKS.icon(n) : initial, color: k?.color || PALETTE[extra++ % PALETTE.length], hair: HAIR[i % HAIR.length],
      role: m.role.split(".")[0].trim() || "팀원", model: m.model, provider: m.provider, leader: n === team.leader,
    };
  });
  const spots = layout(order.slice(0, MAX_DESKS), defs[0].color), nowhere = { x: 0, z: 0 };
  order.forEach((n, i) => (D.agents[n] = new Agent(n, defs[i], spots[i] || { seat: nowhere, meet: nowhere, coffee: nowhere, screen: null })));
  D.names = order;
  // 연결 전('연결 중…'·'접속 키 필요')에도 사무실이 비어 보이지 않게 자리에 앉혀 둔다. 첫 hello 가 오면 arrive() 가 같은 틱에 문 밖으로 옮겨 숨겼다가 출근시키므로 깜빡임은 없다
  if (HAS3D && order.length > MAX_DESKS) { // 팀장에게 몰아넣지 않고, 자리 없는 팀원은 목록·보드에만 보여 준다
    const msg = `팀원이 ${order.length}명이라 3D ${SPACE.label}에는 ${MAX_DESKS}명까지만 자리가 있어요. ${order.slice(MAX_DESKS).map(niceName).join(", ")}은(는) 팀원 목록과 업무 보드에만 표시됩니다.`;
    setTimeout(() => { toast(msg, "warn", 9000); log(msg); });
  }
  strokes.forEach((s, i) => s.material.color.set(i < defs.length && i < 4 ? defs[i].color : "#6b7489"));
  buildMembers();
  brandSub();
  if (VIEW.name === "members" || VIEW.name === "settings") scheduleView();
  UI.focused = null; frame(false);
  window.Dashboard?.restoreRoom(); // 책상 줄 길이가 바뀌었으니 카메라를 다시 맞춘다
}
function brandSub() {
  const names = D.names.length > 4 ? `팀원 ${D.names.length}명` : D.names.map(n => A(n).def.label).join(" · ");
  $("brandSub").textContent = `${names} | 멀티 에이전트 팀${D.mock ? " · 모의 실행" : ""}`;
}

/* ───────────────────────── 화면(UI) ─────────────────────────
   상단 바 · 왼쪽 사이드바(메뉴 + 오늘의 진행률) · 오른쪽 열(업무 보드 + 활동 로그) · 보기 오버레이 · 명령 입력창 · 검색 팔레트 */
const NS = "http://www.w3.org/2000/svg";
/** SVG 요소 생성(innerHTML 없이). */
function svgEl(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  n.append(...kids);
  return n;
}
/** 스프라이트 아이콘(index.html 의 <symbol id="i-이름">). */
function icon(name, cls = "ic") {
  const s = svgEl("svg", { class: cls, "aria-hidden": "true" }), u = svgEl("use", {});
  u.setAttribute("href", `#i-${name}`);
  s.append(u);
  return s;
}
const MEMBERS_EL = document.getElementById("members"); // 팀원 카드 목록(에이전트 보기에 들어갔다가 닫히면 #membersHome 으로 돌아온다)
const PROVIDER_KO = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", mock: "모의" };
/** 경과 시간 m:ss (padMin: mm:ss, 1시간 넘으면 h:mm:ss) */
function mmss(ms, padMin = false) {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s % 3600 / 60);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(m)}:${pad(s % 60)}` : `${padMin ? pad(m) : m}:${pad(s % 60)}`;
}
const isToday = ms => { const d = new Date(ms), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
function weekStart() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); } // 월요일 0시

/* 팀원 카드 (에이전트 보기). 상태(st)는 보기가 닫혀 있어도 계속 갱신된다. */
function buildMembers() {
  MEMBERS_EL.replaceChildren();
  for (const n of D.names) {
    const a = A(n), d = a.def;
    const badge = el("span", { class: "badge", text: "대기" }), task = el("span", { class: "task-text", text: "—" });
    const time = el("span", { class: "task-time" }), bar = el("span", { class: "bar" }, el("i"));
    const conn = el("span", { class: "conn-state", hidden: true }), setup = el("p", { class: "member-setup", hidden: true });
    const title = `${d.label}에게 말 걸기`;
    MEMBERS_EL.append(el("article", { class: "member", style: { "--c": d.color } },
      el("span", { class: "row" },
        el("button", { class: facesOf(n) ? "avatar face" : "avatar", type: "button", style: facesOf(n) ? faceVars(facesOf(n)) : null, "aria-label": `${d.label} ${LOOKS.noun} 바꾸기`, title: `${LOOKS.noun} 바꾸기`, onclick: () => openAppearancePicker(n), text: facesOf(n) ? null : d.initial }),
        el("button", { class: "who member-chat", type: "button", title, onclick: () => { closeView(); window.CharacterChat?.open(n); } },
          el("span", { class: "name" }, d.label, d.leader ? el("span", { title: "팀장", text: " 👑" }) : null),
          el("span", { class: "role", text: d.role })),
        badge),
      el("span", { class: "meta" },
        conn,
        el("span", { text: PROVIDER_KO[d.provider] || d.provider || "제공사 미정" }),
        d.model ? el("span", { text: d.model }) : null,
        d.leader ? el("span", { text: "팀장" }) : null),
      setup,
      el("span", { class: "task" }, task, time),
      bar));
    a.card = { badge, task, time, bar, conn, setup, st: { ...IDLE } };
    paintReady(n);
  }
  renderSummary();
}
/** 연결 표시(기획안 C1): 서버가 hello.team 에 실어 보낸 ready/hint 를 팀원 카드·팀원 얼굴(dashboard.js)에 반영 */
function setReady(team) {
  D.ready = Object.create(null);
  for (const m of Array.isArray(team?.members) ? team.members : [])
    if (m && typeof m.ready === "boolean") D.ready[String(m.name)] = { ok: m.ready, hint: String(m.hint || "") };
  for (const n of D.names) paintReady(n);
  window.Dashboard?.schedule();
  if (VIEW.name === "members") scheduleView();
}
function paintReady(n) {
  const c = A(n)?.card, r = D.ready[n];
  if (!c) return;
  c.conn.hidden = !r; c.setup.hidden = !r || r.ok;
  if (!r) return;
  c.conn.className = `conn-state ${r.ok ? "ok" : "off"}`;
  c.conn.textContent = r.ok ? "연결됨" : "연결 안 됨";
  c.conn.title = r.ok ? "실행 준비 완료(CLI 설치·API 키 확인. 로그인 여부는 업무를 맡길 때 확인돼요)" : r.hint;
  c.setup.textContent = r.ok ? "" : r.hint || "연결 설정이 필요해요.";
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
  window.Dashboard?.schedule();
  const groups = Object.create(null);
  for (const n of D.names) {
    const st = A(n).card?.st.status;
    if (BUSY.includes(st)) (groups[st] ||= []).push(A(n).def.label);
  }
  const act = Object.entries(groups).map(([st, ls]) => `${ls.join("·")} ${st}`).join(", ");
  $("summary").textContent = act ? `${D.phaseText} · ${act}` : D.running ? D.phaseText : `${D.phaseText} · 업무를 지시해 보세요`;
}
function setPhase(text, live) {
  D.phaseText = text;
  $("sumDot").classList.toggle("live", !!live);
  $("boardPhase").textContent = `· ${text}`;
  renderSummary();
  if (D.running) updateInput();
}

/* 업무 보드 카드: 진행 중 → 대기 → 완료/실패 순. 오른쪽 값은 완료 / 경과 m:ss / 대기 / 실패 */
const BOARD = { rows: [] };
function taskVal(t) {
  if (t.vstate === "doing") return (t.approx ? "≥" : "") + mmss(performance.now() - (t.t0 || performance.now()));
  return { todo: "대기", done: "완료", failed: "실패" }[t.vstate] || "";
}
function tickBoard() { for (const r of BOARD.rows) r.val.textContent = taskVal(r.t); }
const isFin = t => t.vstate === "done" || t.vstate === "failed";
function sortedTasks(run) {
  const order = { doing: 0, todo: 1, done: 2, failed: 2 };
  return run ? [...run.tasks.values()].sort((a, b) => order[a.vstate] - order[b.vstate] || (+a.id || 0) - (+b.id || 0)) : [];
}
function renderBoard() {
  const run = D.shown, tasks = sortedTasks(run), box = $("board");
  $("tabCount").textContent = tasks.length ? ` ${tasks.filter(isFin).length}/${tasks.length}` : "";
  BOARD.rows = [];
  if (!tasks.length) {
    box.replaceChildren(el("div", { class: "empty", text: run && D.running ? "팀장이 계획을 세우는 중입니다…" : "아직 업무가 없어요. 아래 입력창에서 팀에 업무를 지시해 보세요." }));
  } else {
    box.replaceChildren(...tasks.map(t => {
      const d = memberDef(t.assignee), f = isFin(t), val = el("span", { class: "val", text: taskVal(t) });
      if (t.vstate === "doing") BOARD.rows.push({ t, val });
      return el(f ? "button" : "div", { class: `trow ${t.vstate}`, type: f ? "button" : null, style: { "--c": d.color },
        title: `#${t.id} ${t.title}${f ? " · 결과 보기" : ""}`, onclick: f ? () => openTask(run, t.id) : null },
        el("span", { class: "sdot" }), el("span", { class: "ttl", text: t.title }), el("span", { class: "mchip", text: d.label }), val);
    }));
  }
  window.Dashboard?.schedule();
  renderBoardLink();
  if (VIEW.name === "board") scheduleView();
  scheduleProgress();
  if (typeof paintRunCard === "function") paintRunCard();
}
function renderBoardLink() {
  const tasks = D.shown ? [...D.shown.tasks.values()] : [];
  const doing = tasks.filter(t => t.vstate === "doing").length, fin = tasks.filter(isFin).length;
  $("boardLink").replaceChildren(doing ? `${doing}개 진행 중` : tasks.length ? `${fin}/${tasks.length} 완료` : "보드 열기", icon("chev-right"));
}

/* 활동 로그: 기록은 LOGS 에 쌓고(최근 300건), 카드에는 필터(전체/팀원)를 거쳐 보여 준다 */
const LOGS = [];
const LOGV = { filter: "" };
const passLog = e => !LOGV.filter || e.name === LOGV.filter;
function log(msg, n, cls) {
  const e = { at: new Date(), name: n && A(n) ? n : "", msg: String(msg), cls: cls || "", run: D.shown?.run_id || D.run?.run_id || "" };
  LOGS.push(e);
  if (LOGS.length > 300) LOGS.shift();
  if (passLog(e)) {
    const box = $("log");
    box.querySelector(".empty")?.remove();
    box.prepend(logRow(e));
    while (box.childElementCount > 200) box.lastChild.remove();
  }
  if (VIEW.name === "timeline") scheduleView();
}
function logRow(e) {
  const d = e.name ? memberDef(e.name) : null;
  return el("div", { class: `lrow ${e.cls}`, style: d ? { "--c": d.color } : null },
    el("time", { text: hhmm(e.at, true), datetime: e.at.toISOString() }),
    d ? (facesOf(e.name) ? el("span", { class: "lav face", style: faceVars(facesOf(e.name)) }) : el("span", { class: "lav", text: d.initial || d.label[0] })) : el("span", { class: "lav sys" }, icon("bot")),
    el("b", { class: d ? "mc" : "muted", text: d ? d.label : "시스템" }),
    el("span", { class: "lmsg", text: e.msg }));
}
function renderLog() {
  const rows = LOGS.filter(passLog).slice(-200).reverse().map(logRow);
  $("log").replaceChildren(...(rows.length ? rows : [el("div", { class: "empty", text: LOGV.filter ? "이 팀원의 기록이 아직 없어요." : "아직 기록이 없어요." })]));
}
function openLogFilter(btn) {
  const items = [{ label: "전체 (실시간)", value: "", icon: "activity" }, ...D.names.map(n => ({ label: A(n).def.label, value: n, color: A(n).def.color }))];
  popMenu(btn, items.map(it => ({ ...it, checked: LOGV.filter === it.value, onpick: () => {
    LOGV.filter = it.value;
    $("logFilterText").textContent = it.value ? A(it.value)?.def.label || it.label : "실시간";
    renderLog();
  } })));
}

/* 팝업 메뉴(로그 필터 등): 기준 요소 아래에 띄우고, 바깥 클릭·Esc 로 닫는다 */
const POP = { anchor: null };
function popMenu(anchor, items) {
  const m = $("popmenu");
  if (!m.hidden && POP.anchor === anchor) return closeMenu();
  closeMenu();
  // 항목: {label, icon|color, checked, onpick, sub(작은 설명)} · {heading: "구역 이름"} · {sep: true}(구분선) · {note: "안내 문구"}
  m.replaceChildren(...items.map(it => it.heading ? el("div", { class: "pm-head", role: "presentation", text: it.heading })
    : it.sep ? el("hr", { class: "pm-sep", role: "separator" })
    : it.note ? el("p", { class: "pm-note", text: it.note })
    : el("button", { type: "button", role: "menuitemradio", "aria-checked": String(!!it.checked), title: it.title || null, onclick: () => { closeMenu(); it.onpick(); } },
      it.color ? el("i", { class: "ldot", style: { "--c": it.color } }) : it.icon ? icon(it.icon) : null,
      it.sub ? el("span", { class: "pm-text" }, el("span", { class: "pm-label", text: it.label }), el("small", { class: "pm-sub", text: it.sub })) : it.label)));
  m.hidden = false; POP.anchor = anchor; anchor.setAttribute("aria-expanded", "true");
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw))}px`;
  m.style.top = `${r.bottom + 6 + mh > innerHeight - 8 ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
  (m.querySelector("[aria-checked='true']") || m.firstElementChild)?.focus({ preventScroll: true });
}
function closeMenu() {
  const m = $("popmenu");
  if (m.hidden) return;
  m.hidden = true;
  const a = POP.anchor; POP.anchor = null;
  if (a) { a.setAttribute("aria-expanded", "false"); if (!document.activeElement || document.activeElement === document.body || m.contains(document.activeElement)) a.focus({ preventScroll: true }); }
}

/* 상단 바: 날짜 칩 · 경과 시간 칩(현재 업무, 쉬는 중이면 00:00) */
const CLOCK = { day: "" };
function tickClock() {
  const r = D.run, live = D.running && r;
  $("clockText").textContent = live ? mmss(Date.now() - r.wall0, true) : "00:00";
  $("clock").classList.toggle("live", !!live);
  const d = new Date(), key = d.toDateString();
  if (CLOCK.day !== key) {
    const was = CLOCK.day; CLOCK.day = key;
    $("dateText").textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
    if (was) scheduleProgress(); // 날짜가 바뀌면 '오늘' 집계도 바뀐다
  }
}
function updateInput() {
  const busy = D.running || UI.submitting;
  $("goal").disabled = $("runBtn").disabled = $("attachBtn").disabled = busy || !!window.CharacterChat?.pending;
  if ($("projectBtn")) $("projectBtn").disabled = busy;
  $("runBtn").classList.toggle("busy", UI.submitting);
  $("runBtn").setAttribute("aria-label", D.running ? "진행 중" : UI.submitting ? "요청 중" : "업무 지시");
  $("goal").placeholder = D.running ? `팀이 업무를 진행하고 있어요… (${D.phaseText})` : UI.submitting ? "요청 중…" : "팀에 업무를 지시해보세요...";
  renderSummary();
}
function setSpeed(s) {
  SPEED = [1, 2, 4].includes(s) ? s : 1;
  store.set("agentOffice.speed", SPEED);
  for (const b of $("speed").children) { const on = +b.dataset.s === SPEED; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
  for (const b of document.querySelectorAll(".speed-seg [data-s]")) b.setAttribute("aria-pressed", String(+b.dataset.s === SPEED));
  $("speedCycle").textContent = `${SPEED}×`;
  $("speedCycle").setAttribute("aria-label", `연출 속도 ${SPEED}배 (눌러서 변경)`);
}
function focusAgent(n) {
  const a = A(n);
  if (!a || a.ghost || a.hidden) return; // 3D 가 없거나 자리가 없는 팀원, 아직 출근 전(문 밖에 숨은) 팀원은 카메라 이동 없음
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
/* 휴대폰 서랍(사이드바) */
function setDrawer(open) {
  open = !!open && mqMobile.matches;
  const was = document.body.classList.contains("drawer-open");
  document.body.classList.toggle("drawer-open", open);
  $("scrim").hidden = !open;
  $("menuBtn").setAttribute("aria-expanded", String(open));
  if (open) $("drawerClose").focus({ preventScroll: true });
  else if (was && $("sidebar").contains(document.activeElement)) $("menuBtn").focus({ preventScroll: true });
}

/* ── 테마: 시스템/라이트/다크 (isDark 는 파일 위쪽의 공통 도구) ── */
function setThemeMode(mode) {
  PREF.theme = ["light", "dark"].includes(mode) ? mode : "system";
  store.set("agentOffice.theme", PREF.theme);
  if (PREF.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = PREF.theme;
  themeChanged();
}
/** 실제 밝기(라이트/다크)가 바뀌었을 때: 3D 테마 적용 + 컨트롤·브라우저 색 동기화 */
function themeChanged() {
  const dark = isDark();
  if (PREF.lastDark !== dark) {
    PREF.lastDark = dark;
    if (HAS3D && typeof applyTheme === "function") applyTheme();
  }
  const forced = PREF.theme !== "system", col = dark ? "#0b1020" : "#f4f6fb";
  for (const id of ["themeColorLight", "themeColorDark"]) {
    const m = $(id);
    if (m) m.content = forced ? col : id === "themeColorDark" ? "#0b1020" : "#f4f6fb";
  }
  for (const b of document.querySelectorAll(".theme-seg [data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === PREF.theme));
}
function themeControl() {
  return el("div", { class: "seg theme-seg", role: "group", "aria-label": "테마" },
    ...[["system", "monitor", "시스템"], ["light", "sun", "라이트"], ["dark", "moon", "다크"]].map(([m, ic, label]) =>
      el("button", { type: "button", "data-mode": m, "aria-pressed": String(PREF.theme === m), onclick: () => setThemeMode(m) }, icon(ic), label)));
}
function speedControl() {
  return el("div", { class: "seg speed-seg", role: "group", "aria-label": "기본 연출 속도" },
    ...[1, 2, 4].map(s => el("button", { type: "button", "data-s": s, "aria-pressed": String(SPEED === s), onclick: () => setSpeed(s), text: `${s}x` })));
}
function switchControl(checked, onchange, label) {
  return el("label", { class: "switch" }, el("input", { type: "checkbox", checked: !!checked, "aria-label": label, onchange: e => onchange(e.target.checked) }), el("i"));
}
function setReduce(v) {
  PREF.reduce = !!v;
  store.set("agentOffice.reduce", PREF.reduce ? "1" : "0");
  document.body.classList.toggle("reduce-motion", PREF.reduce);
}
/** 방 이름표(현관·탕비실·업무 공간·팀장실·회의실·라운지 칩) 보이기/숨기기. decor.js 가 만든 .room-chip 을 body 클래스로 가린다 */
function setRoomTags(v) {
  PREF.rooms = !!v;
  store.set("agentOffice.rooms", PREF.rooms ? "1" : "0");
  document.body.classList.toggle("no-roomtags", !PREF.rooms);
}

/* ── 보기 오버레이: 업무 · 타임라인 · 분석 · 에이전트 · 프로젝트 · 자료실 · 설정 (사무실/대시보드는 3D 그대로) ── */
const VIEW = { name: "", t: 0 };
const VIEW_TITLES = { board: "업무", timeline: "타임라인", stats: "분석", members: "에이전트", projects: "프로젝트", library: "자료실", settings: "설정" }; // 왼쪽 메뉴(#sidenav) 이름과 같게 둔다
function showView(name) {
  if (!VIEW_TITLES[name]) return closeView();
  closeMenu(); closePalette(); setDrawer(false);
  if (mqMobile.matches) setDock(false);
  const same = VIEW.name === name;
  VIEW.name = name;
  $("viewTitle").textContent = VIEW_TITLES[name];
  $("view").hidden = false;
  renderView();
  markNav();
  if (!same) { $("viewBody").scrollTo(0, 0); $("viewTitle").setAttribute("tabindex", "-1"); $("viewTitle").focus({ preventScroll: true }); }
  if (name === "library" || name === "timeline" || name === "stats") loadRuns();
}
function closeView() {
  const was = VIEW.name;
  VIEW.name = "";
  if (was) {
    $("view").hidden = true;
    $("membersHome").append(MEMBERS_EL); // 팀원 목록은 숨은 집으로(setMember 가 계속 갱신한다)
    $("viewBody").replaceChildren();
    const back = document.querySelector(`#sidenav [data-view="${was}"]`);
    (back?.offsetParent ? back : $("goal")).focus({ preventScroll: true });
  }
  markNav();
}
function markNav() {
  const cur = VIEW.name || "office";
  for (const b of document.querySelectorAll("#sidenav [data-view]")) {
    if (b.dataset.view === cur) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
}
function scheduleView() { clearTimeout(VIEW.t); VIEW.t = setTimeout(() => VIEW.name && renderView(), 150); }
function renderView() {
  const body = $("viewBody"), r = VIEWS[VIEW.name];
  if (!r) return;
  const keep = body.contains(document.activeElement) ? document.activeElement.id : "";
  $("membersHome").append(MEMBERS_EL);
  body.replaceChildren(...[r()].flat(3).filter(Boolean));
  if (keep) $(keep)?.focus({ preventScroll: true });
}

/** 업무 보드(칸반): 대기 / 진행 중 / 완료. 끝난 카드는 결과를 연다 */
function kanbanView() {
  const run = D.shown, tasks = run ? [...run.tasks.values()] : [];
  if (!tasks.length) return [el("p", { class: "empty", text: run && D.running ? "팀장이 계획을 세우는 중입니다…" : `아직 업무가 없어요. 입력창에서 팀에 업무를 지시하면 팀장이 업무를 나눠 배정합니다. (예: ${EXAMPLE_GOAL})` })];
  const card = t => {
    const d = memberDef(t.assignee), f = isFin(t);
    const val = t.vstate === "doing" ? `진행 중 · ${taskVal(t)}` : t.vstate === "todo" ? "대기" : t.t1 && t.t0 && !t.approx ? `${STATE_KO[t.vstate]} · ${fmtDur(t.t1 - t.t0)}` : STATE_KO[t.vstate];
    return el(f ? "button" : "div", { class: `kcard ${t.vstate}`, type: f ? "button" : null, style: { "--c": d.color }, title: f ? "결과 보기" : null, onclick: f ? () => openTask(run, t.id) : null },
      el("span", { class: "ktitle", text: `#${t.id} ${t.title}` }),
      el("span", { class: "krow" }, el("span", { class: "mchip", text: d.label }),
        t.depends_on.length ? el("span", { text: `← #${t.depends_on.join(", #")}` }) : null,
        t.vstate === "failed" ? el("span", { class: "fail-badge", text: "실패" }) : null,
        el("span", { class: "val", text: val })));
  };
  const col = (title, dotc, list) => el("div", { class: "kcol" },
    el("h4", null, el("i", { style: { "--dotc": dotc } }), title, el("span", { class: "cnt", text: String(list.length) })),
    ...(list.length ? list.map(card) : [el("p", { class: "empty", text: "없음" })]));
  return [
    el("p", { class: "plan-sum" }, el("b", { text: "목표 · " }), clip(run.goal || run.run_id, 240)),
    run.summary ? el("p", { class: "plan-sum" }, el("b", { text: "계획 · " }), run.summary) : null,
    el("div", { class: "kanban" },
      col("대기", "var(--idle-dot)", tasks.filter(t => t.vstate === "todo")),
      col("진행 중", "var(--accent)", tasks.filter(t => t.vstate === "doing")),
      col("완료", "var(--teal)", tasks.filter(isFin))),
  ];
}
/** 타임라인: 지금 보는 실행의 이벤트(로그) + 오늘의 실행 목록 */
function timelineView() {
  const run = D.shown, id = run?.run_id || "";
  const events = LOGS.filter(e => !id || e.run === id);
  const today = allRuns().filter(r => isToday(r.created));
  return [
    el("h3", { class: "sec" }, icon("activity"), run ? `현재 업무 · ${clip(run.goal || run.run_id, 50)}` : "이벤트", el("span", { class: "cnt", text: `${events.length}건` })),
    events.length ? el("ol", { class: "tl" }, ...events.map(e => {
      const d = e.name ? memberDef(e.name) : null;
      return el("li", { class: `tl-item ${e.cls}`, style: d ? { "--c": d.color } : null },
        el("time", { text: hhmm(e.at, true) }),
        el("span", { class: "lmsg" }, d ? el("b", { class: "mc", text: `${d.label} ` }) : null, e.msg));
    })) : el("p", { class: "empty", text: "아직 기록이 없어요." }),
    el("h3", { class: "sec" }, icon("history"), "오늘의 업무", el("span", { class: "cnt", text: `${today.length}건` })),
    runList(today, NET.mode === "live" ? "오늘 실행한 업무가 아직 없어요." : NET.mode === "demo" ? "데모 모드: 이 화면에서 실행한 업무만 표시돼요." : "서버에 연결되면 오늘의 실행 목록을 불러와요."),
  ];
}
/** 분석: 팀원별 완료/실패(알고 있는 실행 기준), 오늘·이번 주 실행 수, 이번 세션 실측 평균 업무 시간 */
function statsView() {
  const per = Object.create(null), seen = new Set();
  const add = tasks => { for (const t of tasks) { const s = t.vstate || t.state; if (s === "done" || s === "failed") (per[t.assignee] ||= { done: 0, failed: 0 })[s]++; } };
  for (const run of RUNS.values()) if (run.run_id && !seen.has(run.run_id)) { seen.add(run.run_id); add([...run.tasks.values()]); }
  for (const [id, v] of HIST.details) if (!seen.has(id)) { seen.add(id); add(v.tasks); }
  const names = [...new Set([...D.names, ...Object.keys(per)])];
  const max = Math.max(1, ...names.map(n => (per[n]?.done || 0) + (per[n]?.failed || 0)));
  const all = allRuns(), today = all.filter(r => isToday(r.created)).length, week = all.filter(r => r.created >= weekStart()).length;
  const durs = SESSION.durations, avg = durs.length ? durs.reduce((s, d) => s + d.ms, 0) / durs.length : 0;
  const stat = (k, v, unit, note) => el("div", { class: "stat" }, el("div", { class: "k", text: k }), el("div", { class: "v" }, String(v), unit ? el("small", { text: unit }) : null), note ? el("div", { class: "k", text: note }) : null);
  // 사용량 막대(extras.js)와 같은 CSS 막대(.ubar). parts: [{w, fill}] (w: 0~1) 를 왼쪽부터 이어 붙인다
  const meter = (parts, total) => el("span", { class: "ubar", title: total, "aria-hidden": "true" },
    ...parts.filter(p => p.w > 0).map(p => el("i", { style: { width: `${Math.max(2, p.w * 100)}%`, background: p.fill } })));
  const bar = n => {
    const d = memberDef(n), p = per[n] || { done: 0, failed: 0 }, tot = p.done + p.failed;
    return el("div", { class: "brow", style: { "--c": d.color } }, el("span", { class: "bname mc", text: d.label }),
      meter([{ w: p.done / max, fill: "var(--c)" }, { w: p.failed / max, fill: "var(--err-dot)" }], `${d.label}: 완료 ${p.done}, 실패 ${p.failed}`),
      el("span", { class: "bval", text: tot ? `완료 ${p.done}${p.failed ? ` · 실패 ${p.failed}` : ""}` : "기록 없음" }));
  };
  const byName = Object.create(null);
  for (const x of durs) (byName[x.name] ||= []).push(x.ms);
  const dnames = Object.keys(byName), dmax = Math.max(1, ...dnames.map(n => byName[n].reduce((s, v) => s + v, 0) / byName[n].length));
  const dbar = n => {
    const d = memberDef(n), list = byName[n], a = list.reduce((s, v) => s + v, 0) / list.length;
    return el("div", { class: "brow", style: { "--c": d.color } }, el("span", { class: "bname mc", text: d.label }),
      meter([{ w: a / dmax, fill: "var(--c)" }], `${d.label}: 평균 ${fmtDur(a)} (${list.length}건)`),
      el("span", { class: "bval", text: `${fmtDur(a)} · ${list.length}건` }));
  };
  return [
    el("div", { class: "stat-grid" },
      stat("오늘 실행", today, "건"), stat("이번 주 실행", week, "건"),
      stat("평균 업무 시간", durs.length ? fmtDur(avg) : "—", "", `이번 세션 기준 · ${durs.length}건 실측`),
      stat("집계한 실행", seen.size, "건", HIST.list ? "이 화면 + 서버 오늘 상세" : "이 화면에서 본 실행")),
    el("h3", { class: "sec" }, icon("users"), "팀원별 완료 업무", el("span", { class: "cnt", text: "알고 있는 실행 기준" })),
    seen.size ? el("div", { class: "bars" }, ...names.map(bar)) : el("p", { class: "empty", text: "아직 집계할 업무가 없어요. 업무를 한 번 실행하면 여기에 쌓여요." }),
    el("h3", { class: "sec" }, icon("clock"), "팀원별 평균 업무 시간", el("span", { class: "cnt", text: "이번 세션 기준" })),
    dnames.length ? el("div", { class: "bars" }, ...dnames.map(dbar)) : el("p", { class: "empty", text: "이번 세션에서 시작부터 끝까지 지켜본 업무가 아직 없어요." }),
    el("p", { class: "muted small", text: "집계 범위: 이 화면에서 본 실행 + 서버에서 불러온 오늘 실행 상세(최대 10건). 평균 시간은 이번 세션에서 실측한 시작→완료 시간이며, 접속 전에 시작된 업무는 제외합니다." }),
  ];
}
/** 사람 이미지 클릭 시에만 전체 외형 목록을 연다. */
function openAppearancePicker(n) {
  if (LOOKS.pick) return LOOKS.pick(n); // 테마 전용 고르기 창(동물원: zoo-theme.js)
  const pixel=window.SpaceTheme?.isPixel;
  const available=id=>pixel?!D.names.some(other=>other!==n&&appearanceOf(other)===id):window.CharacterLooks.available(n,id,D.names);
  const options = pixel?['claude','gpt','gemini'].map(id=>({id,label:PixelTheme.assets.characters[id].label})):window.CharacterLooks.list.filter(person=>window.SpriteChars?.has(person.id));
  openModal([
    sheetHead(`${memberDef(n).label} ${LOOKS.noun}`, "외형을 선택하면 바로 적용되며 이 브라우저에 저장됩니다."),
    el("div", { class: "sheet-body" },
      el("div", { class: "appearance-grid", role: "group", "aria-label": `${memberDef(n).label} 외형 선택` },
        ...options.map(person => el("button", {
          type: "button", class: "appearance-option", "aria-pressed": appearanceOf(n) === person.id ? "true" : "false",
          disabled: !available(person.id),
          onclick: () => {
            if (!(pixel?PixelTheme.setLook(n,person.id,D.names):window.CharacterLooks.set(n, person.id, D.names))) {
              toast("다른 팀원이 사용 중인 사람이에요.", "warn"); return;
            }
            A(n).changeAppearance(person.id);
            const node = MEMBERS_EL.children[D.names.indexOf(n)]?.querySelector(".avatar");
            if (node) {
              node.classList.add("face"); node.textContent = "";
              for (const [k, v] of Object.entries(faceVars(facesOf(n)))) node.style.setProperty(k, v);
            }
            window.Dashboard?.schedule(); closeModal();
            toast(`${memberDef(n).label}의 외형을 ${person.label}(으)로 변경했어요.`);
          }
        }, el("span", { class: "appearance-portrait face", style: faceVars(window.SpaceTheme?.isPixel ? PixelTheme.faces(person.id) : window.SpriteChars.faces(person.id)), "aria-hidden": "true" }),
        el("span", { text: person.label }), el("small", { text: !available(person.id) ? "다른 팀원 사용 중" : person.age ? `${person.age}세` : "기존 캐릭터" }))))),
  ]);
}
/** 에이전트: 팀원 카드 + 새 에이전트 추가 안내 */
function membersView() {
  const conn = NET.mode === "live" ? (D.mock ? "서버 연결됨 · 모의 실행" : "서버 연결됨") : NET.mode === "demo" ? "데모 팀 (서버 없음)" : NET.mode === "auth" ? "접속 키 필요" : "서버 연결 대기";
  const live = NET.mode === "live", TS = window.TeamSettings;
  return [
    // 팀원 카드 위 머리줄: 왼쪽 요약, 오른쪽 [설정]·[에이전트 추가] (에이전트 설정 창: team-settings.js)
    el("div", { class: "members-head" },
      el("p", { class: "muted small", text: `팀원 ${D.names.length}명 · 팀장 ${memberDef(D.leader).label} · ${conn}` },
        D.names.some(n => D.ready[n]?.ok === false) ? el("strong", { class: "conn-warn", text: ` · 연결 안 된 팀원 ${D.names.filter(n => D.ready[n]?.ok === false).length}명` }) : null),
      el("div", { class: "members-actions" },
        el("button", { class: "tbtn", type: "button", disabled: !live || !TS, title: live ? "AI 선택·모델·하는 일·팀장 바꾸기" : "서버에 연결되면 바꿀 수 있어요", onclick: () => TS?.open() }, icon("gear"), "설정"),
        el("button", { class: "tbtn accent", type: "button", disabled: !live || !TS, title: live ? "새 팀원 추가" : "서버에 연결되면 추가할 수 있어요", onclick: () => TS?.add() }, icon("plus"), "에이전트 추가"))),
    MEMBERS_EL,
    el("p", { class: "muted small", text: LOOKS.help }),
    live ? null : el("p", { class: "muted small", text: "데모 모드에서는 설정을 바꿀 수 없어요. 서버(start-mac.command 등)를 켜고 다시 열어 주세요." }),
  ];
}
/** 자료실: 지난 실행 목록 + 검색. 항목을 누르면 보고서를 연다 */
const LIB = { q: "" };
function libraryView() {
  const input = el("input", { id: "libSearch", type: "search", placeholder: "목표·실행 ID로 검색", "aria-label": "지난 업무 검색", value: LIB.q, autocomplete: "off",
    oninput: e => { LIB.q = e.target.value; renderLibList(); } });
  return [
    el("div", { class: "toolbar" }, el("label", { class: "search-input", for: "libSearch" }, icon("search"), input),
      el("button", { class: "tbtn", type: "button", onclick: () => loadRuns(true) }, icon("history"), "새로 고침")),
    el("div", { id: "libList" }, ...libList()),
  ];
}
function libList() {
  const q = LIB.q.trim().toLowerCase(), all = allRuns();
  const list = q ? all.filter(r => `${r.goal} ${r.run_id}`.toLowerCase().includes(q)) : all;
  const empty = HIST.loading ? "불러오는 중…" : q ? "검색 결과가 없어요." : NET.mode === "live" ? "아직 저장된 업무가 없어요." : NET.mode === "demo" ? "데모 모드: 이 화면에서 실행한 업무만 표시돼요." : "서버에 연결되면 지난 업무를 불러와요.";
  return [el("p", { class: "muted small", text: `${list.length}건${HIST.list ? " · 서버 기록 최근 50건" : ""}` }), runList(list, empty)];
}
function renderLibList() { $("libList")?.replaceChildren(...libList()); }
function runList(list, empty) {
  if (!list.length) return el("p", { class: "empty", text: empty });
  return el("div", { class: "runs" }, ...list.map(r => el("div", { class: "run-row" },
    el("button", { class: "run-item", type: "button", onclick: () => openRunEntry(r), title: r.run_id },
      el("span", { class: "run-goal", text: clip(r.goal || "(목표 없음)", 140) }),
      el("span", { class: "run-meta" }, fmtCreated(r.created),
        r.local && !r.local.ended ? el("span", { class: "badge meet", text: "진행 중" }) : null,
        r.has_error ? el("span", { class: "fail-badge", text: "오류" }) : null,
        !r.has_report && !(r.local && !r.local.ended) ? el("span", { class: "muted", text: "· 보고서 없음" }) : null)),
    el("button", { class: "tbtn", type: "button", "aria-label": "보고서 열기", title: "보고서 열기", onclick: () => openRunEntry(r) }, icon("file")))));
}
/** 설정: 테마 · 기본 속도 · 움직임 줄이기 · 접속 키 · 서버 정보 */
function settingsView() {
  const row = (label, sub, ctrl) => el("div", { class: "set-row" }, el("div", { class: "lbl" }, label, sub ? el("small", { text: sub }) : null), ctrl);
  const conn = { live: "서버 연결됨", demo: "데모 모드 (서버 없음)", retry: "재연결 중", connecting: "연결 중", auth: "접속 키 필요" }[NET.mode] || NET.mode;
  const kv = [["연결 상태", conn], ["모의 실행", NET.mode === "live" ? (D.mock ? "켜짐 — API 호출 없이 모의 결과" : "꺼짐 — 실제 AI 호출") : "—"],
    ["팀장", memberDef(D.leader).label], ["팀원", D.names.map(n => memberDef(n).label).join(", ") || "—"], ["서버 주소", location.host || "(파일로 열림)"]];
  return [
    row("공간 테마", "사무실 또는 동물원을 선택해요. 업무 진행 중에는 바꿀 수 없어요.", window.SpaceTheme?.control()),
    row("화면 테마", "시스템 설정을 따르거나 라이트·다크로 고정해요.", themeControl()),
    HAS3D ? row(`${SPACE.label} 조명`, officeLightNote(), officeLightControl()) : null,
    row("기본 연출 속도", "말풍선·이동 연출의 빠르기. 상단 바에서도 바꿀 수 있어요.", speedControl()),
    row("움직임 줄이기", "카메라 이동과 전환 애니메이션을 최소화해요. 시스템의 '동작 줄이기' 설정은 항상 따릅니다.", switchControl(PREF.reduce, setReduce, "움직임 줄이기")),
    HAS3D && !window.SpaceTheme?.isZoo ? row("방 이름표", "3D 사무실 위에 현관·탕비실·회의실·베란다 같은 방 이름을 띄워요. 휴대폰에서는 확대했을 때만 보여요.", switchControl(PREF.rooms, setRoomTags, "방 이름표")) : null,
    row("프로젝트", "AI 팀이 파일을 읽고 고칠 수 있게 허락한 폴더를 관리해요.",
      el("button", { class: "tbtn", type: "button", onclick: () => showView("projects") }, icon("folder-open"), "프로젝트 관리")),
    row("접속 키", NET.mode === "auth" ? "이 서버는 접속 키가 있어야 쓸 수 있어요." : KEY ? "저장된 접속 키가 있어요." : "LAN 공개(--lan) 서버에서만 필요해요.",
      el("button", { class: "tbtn", type: "button", onclick: () => openKeyDialog() }, icon("key"), KEY ? "접속 키 변경" : "접속 키 입력")),
    el("h3", { class: "sec" }, icon("server"), "서버 정보"),
    el("dl", { class: "kv" }, ...kv.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
  ];
}
/** 프로젝트(폴더 접근) 목록. 실제 화면은 projects.js 가 그린다 */
function projectsView() {
  return window.Projects ? window.Projects.view() : [el("p", { class: "empty", text: "프로젝트 기능을 불러오지 못했어요." })];
}
const VIEWS = { board: kanbanView, timeline: timelineView, stats: statsView, members: membersView, projects: projectsView, library: libraryView, settings: settingsView };

/* ── 실행 기록: 이 화면이 아는 실행(RUNS) + 서버 목록(/api/runs) + 오늘 실행 상세(/api/runs/{id}, 최대 10건, 캐시) ── */
const RUNS = new Map();                                        // run_id → run (newRun 이 등록)
const HIST = { list: null, details: new Map(), loading: null, at: 0 };
const SESSION = { durations: [] };                             // {name, ms, ok} 이번 세션에서 실측한 task_start→task_done
function parseCreated(c, id) {
  const t = new Date(c).getTime();
  if (Number.isFinite(t)) return t;
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
}
async function loadRuns(force) {
  if (NET.mode !== "live" || location.protocol === "file:") return;
  if (HIST.loading) return HIST.loading;
  if (!force && HIST.list && Date.now() - HIST.at < 30000) return;
  HIST.loading = (async () => {
    try {
      const data = await getJSON("/api/runs");
      HIST.list = (Array.isArray(data) ? data : data?.runs || []).filter(r => r && r.run_id)
        .map(r => ({ run_id: String(r.run_id), goal: String(r.goal || ""), created: parseCreated(r.created, String(r.run_id)), has_report: !!r.has_report, has_error: !!r.has_error }));
      HIST.at = Date.now();
      const todays = HIST.list.filter(r => isToday(r.created) && !RUNS.has(r.run_id) && !HIST.details.has(r.run_id)).slice(0, 10);
      await Promise.all(todays.map(async r => {
        try { HIST.details.set(r.run_id, normRun(await getJSON(`/api/runs/${encodeURIComponent(r.run_id)}`), r.run_id)); } catch { /* 하나 실패해도 계속 */ }
      }));
    } catch (e) { console.warn("실행 기록을 불러오지 못했어요:", e.message); }
    finally { HIST.loading = null; }
    renderProgress();
    if (VIEW.name === "library") renderLibList(); else scheduleView();
  })();
  return HIST.loading;
}
/** 서버 목록 + 이 화면의 실행을 합쳐 최신순으로. 같은 run_id 는 이 화면의 상태가 우선 */
function allRuns() {
  const out = new Map();
  for (const r of HIST.list || []) out.set(r.run_id, { ...r, local: RUNS.get(r.run_id) || null });
  for (const run of RUNS.values()) {
    if (!run.run_id) continue;
    const prev = out.get(run.run_id);
    out.set(run.run_id, { run_id: run.run_id, goal: run.goal || prev?.goal || "", created: prev?.created || run.wall0, has_report: !!run.report || !!prev?.has_report, has_error: !!run.error || !!prev?.has_error, local: run });
  }
  return [...out.values()].sort((a, b) => b.created - a.created);
}
function openRunEntry(r) {
  if (r.local && (r.local.tasks.size || r.local.report || !NET.ever)) openReport(runView(r.local));
  else openRun(r.run_id);
}
/** 오늘의 진행률: 오늘 실행한 모든 업무(이 화면 + 서버 상세)의 완료/진행/대기/실패 */
function todayStats() {
  const seen = new Set(), c = { done: 0, doing: 0, todo: 0, failed: 0 };
  const count = tasks => { for (const t of tasks) { const s = t.vstate || t.state; c[s === "done" || s === "failed" || s === "doing" ? s : "todo"]++; } };
  for (const run of RUNS.values()) if (run.run_id && isToday(run.wall0) && !seen.has(run.run_id)) { seen.add(run.run_id); count([...run.tasks.values()]); }
  for (const [id, v] of HIST.details) {
    if (seen.has(id)) continue;
    const r = HIST.list?.find(x => x.run_id === id);
    if (r && isToday(r.created)) { seen.add(id); count(v.tasks); }
  }
  return { ...c, runs: seen.size };
}
const PROG = { t: 0 };
function scheduleProgress() { clearTimeout(PROG.t); PROG.t = setTimeout(renderProgress, 150); }
function renderProgress() {
  const c = todayStats(), total = c.done + c.doing + c.todo + c.failed, fin = c.done + c.failed;
  const pct = total ? Math.round(fin / total * 100) : null, C = 2 * Math.PI * 52;
  const note = total ? `오늘 ${c.runs}건 실행 · 업무 ${total}건 중 ${fin}건 마침${NET.mode === "demo" ? " · 데모" : ""}`
    : NET.mode === "demo" ? "데모 모드 · 이 화면에서 실행한 업무만 집계해요" : "오늘 실행한 업무가 아직 없어요";
  for (const slot of document.querySelectorAll(".progress-slot")) {
    let card = slot.querySelector(".progress");
    if (!card) { card = progressCard(slot.id); slot.append(card); }
    card.querySelector(".arc").style.strokeDashoffset = String(C * (1 - (pct ?? 0) / 100));
    card.querySelector(".pct").textContent = pct == null ? "—" : `${pct}%`;
    card.querySelector(".n-done").textContent = String(c.done);
    card.querySelector(".n-doing").textContent = String(c.doing);
    card.querySelector(".n-todo").textContent = String(c.todo);
    card.querySelector(".n-failed").textContent = String(c.failed);
    card.querySelector(".row-failed").hidden = !c.failed;
    card.querySelector(".note").textContent = note;
    card.title = `오늘의 진행률 ${pct == null ? "—" : pct + "%"} · 완료 ${c.done} · 진행 중 ${c.doing} · 대기 ${c.todo}${c.failed ? ` · 실패 ${c.failed}` : ""}`;
  }
}
function progressCard(key) {
  const C = 2 * Math.PI * 52;
  const svg = svgEl("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" },
    svgEl("defs", {}, svgEl("linearGradient", { id: `grad-${key}`, x1: "0", y1: "0", x2: "1", y2: "1" },
      svgEl("stop", { offset: "0", "stop-color": "#7c5cf6" }), svgEl("stop", { offset: "1", "stop-color": "#3d8bfd" }))),
    svgEl("circle", { class: "track", cx: 60, cy: 60, r: 52 }),
    svgEl("circle", { class: "arc", cx: 60, cy: 60, r: 52, stroke: `url(#grad-${key})`, "stroke-dasharray": C, "stroke-dashoffset": C }));
  const row = (k, dotc, label) => el("li", { class: `row-${k}` }, el("i", { style: { "--dotc": dotc } }), label, el("b", { class: `n-${k}`, text: "0" }));
  return el("section", { class: "progress", "aria-label": "오늘의 진행률" },
    el("h3", null, icon("chart"), "오늘의 진행률"),
    el("div", { class: "donut" }, svg, el("b", { class: "pct", text: "—" })),
    el("ul", { class: "legend" }, row("done", "var(--teal)", "완료"), row("doing", "var(--accent)", "진행 중"), row("todo", "var(--idle-dot)", "대기"), row("failed", "var(--err-dot)", "실패")),
    el("p", { class: "note", text: "" }));
}

/* ── 검색(명령 팔레트): 업무 · 로그 · 지난 업무 · 바로 가기. ↑↓ 이동, Enter 열기, Esc 닫기 ── */
const PAL = { items: [], sel: 0 };
function openPalette() {
  closeMenu(); setDrawer(false);
  if ($("palette").hidden) PAL.back = document.activeElement;
  $("palette").hidden = false;
  $("paletteInput").value = "";
  renderPalette("");
  $("paletteInput").focus({ preventScroll: true });
  loadRuns();
}
function closePalette() {
  if ($("palette").hidden) return;
  $("palette").hidden = true;
  if (PAL.back?.isConnected && PAL.back.offsetParent) PAL.back.focus({ preventScroll: true });
}
function paletteItems(q) {
  q = q.trim().toLowerCase();
  const hit = s => !q || String(s).toLowerCase().includes(q), items = [];
  const run = D.shown;
  if (!q) items.push(...Object.entries(VIEW_TITLES).map(([v, label]) => ({ group: "바로 가기", icon: { board: "kanban", timeline: "timeline", stats: "chart", members: "users", projects: "folder-open", library: "folder", settings: "gear" }[v], text: label, go: () => showView(v) })),
    { group: "바로 가기", icon: "plus", text: "에이전트 추가", go: openNewAgent });
  if (run) for (const t of sortedTasks(run)) {
    const d = memberDef(t.assignee);
    if (hit(`#${t.id} ${t.title} ${d.label}`)) items.push({ group: "업무", kind: STATE_KO[t.vstate], text: `#${t.id} ${t.title}`, color: d.color, go: () => (isFin(t) ? openTask(run, t.id) : showView("board")) });
  }
  let n = 0;
  for (let i = LOGS.length - 1; i >= 0 && n < 8; i--) {
    const e = LOGS[i], d = e.name ? memberDef(e.name) : null;
    if (hit(`${e.msg} ${d ? d.label : "시스템"}`)) { n++; items.push({ group: "로그", kind: hhmm(e.at, true), text: (d ? `${d.label}: ` : "") + e.msg, color: d?.color, icon: "activity", go: () => showView("timeline") }); }
  }
  n = 0;
  for (const r of allRuns()) {
    if (n >= 8) break;
    if (hit(`${r.goal} ${r.run_id}`)) { n++; items.push({ group: "지난 업무", kind: fmtCreated(r.created), text: r.goal || r.run_id, icon: "file", go: () => openRunEntry(r) }); }
  }
  if (q && items.length < 2 && VIEW_TITLES) for (const [v, label] of Object.entries(VIEW_TITLES)) if (label.toLowerCase().includes(q)) items.push({ group: "바로 가기", icon: "chev-right", text: label, go: () => showView(v) });
  return items;
}
function renderPalette(q) {
  PAL.items = paletteItems(q); PAL.sel = 0;
  const nodes = [];
  let group = "";
  PAL.items.forEach((it, i) => {
    if (it.group !== group) { group = it.group; nodes.push(el("div", { class: "pgroup", text: group })); }
    nodes.push(el("button", { class: "pitem", type: "button", role: "option", id: `pal-${i}`, "aria-selected": String(i === 0), onclick: () => pickPalette(i) },
      it.color ? el("i", { class: "ldot sdot", style: { "--c": it.color, width: "9px", height: "9px", "border-radius": "50%", background: it.color, flex: "none" } }) : icon(it.icon || "chev-right"),
      el("span", { class: "ptxt", text: it.text }), it.kind ? el("span", { class: "pk", text: it.kind }) : null));
  });
  $("paletteList").replaceChildren(...(nodes.length ? nodes : [el("p", { class: "empty", text: "검색 결과가 없어요." })]));
  $("paletteInput").setAttribute("aria-activedescendant", PAL.items.length ? "pal-0" : "");
}
function movePalette(dir) {
  if (!PAL.items.length) return;
  const prev = $(`pal-${PAL.sel}`);
  PAL.sel = (PAL.sel + dir + PAL.items.length) % PAL.items.length;
  const cur = $(`pal-${PAL.sel}`);
  prev?.setAttribute("aria-selected", "false"); cur?.setAttribute("aria-selected", "true");
  cur?.scrollIntoView({ block: "nearest" });
  $("paletteInput").setAttribute("aria-activedescendant", `pal-${PAL.sel}`);
}
function pickPalette(i) { const it = PAL.items[i]; closePalette(); it?.go(); }

/* ── 새 에이전트: team.toml 조각 생성 + 복사 (서버에 바로 추가되지는 않는다) ── */
const PROVIDERS = [["anthropic", "Anthropic (Claude)", "claude-opus-5-5"], ["openai", "OpenAI (GPT)", "gpt-5"], ["google", "Google (Gemini)", "gemini-flash-latest"]];
const tomlStr = s => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]+/g, " ")}"`;
function openNewAgent() {
  if (NET.mode === "live" && window.TeamSettings) return window.TeamSettings.add(); // 서버가 있으면 화면에서 바로 추가(team-settings.js)
  closeMenu(); closePalette(); setDrawer(false);
  const name = el("input", { id: "naName", class: "text-input", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "예: mistral", maxlength: "24", "aria-describedby": "naNameHelp" });
  const provider = el("select", { id: "naProvider", class: "select-input" }, ...PROVIDERS.map(([v, label]) => el("option", { value: v, text: label })));
  const model = el("input", { id: "naModel", class: "text-input", type: "text", autocomplete: "off", spellcheck: "false", placeholder: PROVIDERS[0][2], maxlength: "80" });
  const role = el("input", { id: "naRole", class: "text-input", type: "text", placeholder: "예: 리서처. 자료 조사, 요약, 참고 문헌 정리", maxlength: "200" });
  const err = el("p", { class: "error-text small", role: "alert", hidden: true });
  const out = el("pre", { class: "snippet", id: "naOut", tabindex: "0", "aria-label": "team.toml 조각" });
  const copyBtn = el("button", { class: "btn", type: "button" }, icon("copy"), "복사");
  const snippet = () => {
    const n = name.value.trim().toLowerCase(), p = provider.value, m = model.value.trim() || PROVIDERS.find(x => x[0] === p)[2], r = role.value.trim() || "팀원. 역할을 적어 주세요";
    return `[members.${n || "이름"}]\nprovider = ${tomlStr(p)}\nmodel = ${tomlStr(m)}\nrole = ${tomlStr(r)}`;
  };
  const validate = () => {
    const n = name.value.trim().toLowerCase();
    let msg = "";
    if (n && !/^[a-z][a-z0-9_-]{0,23}$/.test(n)) msg = "이름은 영문 소문자로 시작하고 영문·숫자·_·- 만 쓸 수 있어요.";
    else if (n && D.names.includes(n)) msg = `'${n}' 은(는) 이미 팀에 있는 이름이에요.`;
    err.textContent = msg; err.hidden = !msg;
    out.textContent = snippet();
    return !msg && !!n;
  };
  for (const f of [name, provider, model, role]) f.addEventListener("input", validate);
  provider.addEventListener("change", () => { model.placeholder = PROVIDERS.find(x => x[0] === provider.value)[2]; validate(); });
  copyBtn.addEventListener("click", async () => {
    if (!validate()) { name.focus(); if (!name.value.trim()) { err.textContent = "이름을 입력해 주세요."; err.hidden = false; } return; }
    const text = out.textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* 권한 없음·http 등 */ }
    if (!ok) {
      try { const sel = getSelection(), range = document.createRange(); range.selectNodeContents(out); sel.removeAllRanges(); sel.addRange(range); ok = document.execCommand("copy"); } catch { ok = false; }
    }
    if (ok) { toast("설정 조각을 복사했어요. team.toml 에 붙여 넣고 서버를 다시 시작하세요."); copyBtn.replaceChildren(icon("check"), "복사됨"); setTimeout(() => copyBtn.replaceChildren(icon("copy"), "복사"), 1800); }
    else toast("자동 복사가 안 되는 환경이에요. 조각을 직접 선택해 복사해 주세요.", "warn");
  });
  validate();
  const form = el("form", { class: "sheet-form", autocomplete: "off", onsubmit: e => { e.preventDefault(); copyBtn.click(); } },
    el("div", { class: "sheet-body" },
      el("p", { class: "muted small", text: "팀원은 서버의 team.toml 로 관리해요. 아래 조각을 복사해 team.toml 에 붙여 넣고 서버를 다시 시작하면 새 팀원이 출근합니다. (화면에서 바로 추가되지는 않아요)" }),
      el("div", { class: "form-grid" },
        el("div", { class: "field" }, el("label", { class: "field-label", for: "naName", text: "이름" }), name, el("small", { id: "naNameHelp", text: "영문 소문자·숫자·_·- (화면에는 첫 글자가 대문자로 표시)" })),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "naProvider", text: "제공사" }), provider),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "naModel", text: "모델" }), model, el("small", { text: "비우면 제공사 기본 모델" })),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "naRole", text: "역할" }), role, el("small", { text: "첫 문장이 직함으로 쓰여요 (예: '분석가. …')" }))),
      err,
      el("label", { class: "field-label", for: "naOut", text: "team.toml 에 추가할 조각" }), out,
      el("p", { class: "muted small", text: "팀장을 바꾸려면 [leader] 의 member 값을 수정하세요. 제공사의 API 키는 .env 에 넣어야 해요." })),
    el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", onclick: closeModal, text: "닫기" }), copyBtn));
  openModal([sheetHead("새 에이전트", "team.toml 설정 조각 만들기"), form]);
  if (!matchMedia("(pointer: coarse)").matches) name.focus({ preventScroll: true });
}

/* ── 첨부: txt·md·csv·json·html (200KB 이하) → 제출 때 목표 뒤에 붙인다(전체 4,000자 이내로 자름) ── */
const ATT = { name: "", text: "" };
async function pickAttachment(file) {
  if (!file) return;
  if (!/\.(txt|md|markdown|csv|json|html?)$/i.test(file.name)) { toast("txt·md·csv·json·html 파일만 첨부할 수 있어요.", "warn"); return; }
  if (file.size > 200 * 1024) { toast("200KB 이하 파일만 첨부할 수 있어요.", "warn"); return; }
  let text;
  try { text = await file.text(); } catch { toast("파일을 읽지 못했어요.", "error"); return; }
  ATT.name = file.name; ATT.text = text;
  $("attachName").textContent = file.name;
  $("attachChip").title = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))}KB`;
  $("attachChip").hidden = false;
  if (text.length > 4000 - 40) toast("첨부가 길어서 보낼 때 4,000자에 맞춰 잘려요.", "info", 3500);
}
function clearAttachment() {
  ATT.name = ""; ATT.text = "";
  $("attachChip").hidden = true;
  $("attachInput").value = "";
}
function composeGoal(goal) {
  if (!ATT.name) return { goal, truncated: false };
  const head = `${goal}\n\n[첨부: ${ATT.name}]\n`, room = 4000 - head.length;
  if (room <= 1) return { goal: goal.slice(0, 4000), truncated: true };
  const body = ATT.text.replace(/\r\n/g, "\n"), truncated = body.length > room;
  return { goal: head + (truncated ? body.slice(0, room - 1) + "…" : body), truncated };
}

/* 모달(보고서·지난 업무·접속 키·새 에이전트) */
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
  if (modal.back?.isConnected && modal.back.offsetParent) modal.back.focus({ preventScroll: true });
}
function sheetHead(title, sub, back) {
  return el("header", { class: "sheet-head" },
    back ? el("button", { class: "icon-btn", type: "button", "aria-label": "목록으로", onclick: back }, icon("back")) : null,
    el("div", { class: "sheet-title" }, el("h2", { id: "modalTitle", text: title }), sub ? el("p", { class: "sub", text: sub }) : null),
    el("button", { class: "icon-btn x", type: "button", "aria-label": "닫기", onclick: closeModal }, icon("x")));
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
/** 이벤트·기록의 project({id, name, path})를 믿을 수 있는 형태로. 없으면 null */
function normProject(p) {
  return p && typeof p === "object" && p.path ? { id: String(p.id || ""), name: String(p.name || "") || String(p.path).split("/").filter(Boolean).pop() || "", path: String(p.path) } : null;
}
const runView = run => ({ project: run.project || null, run_id: run.run_id, goal: run.goal, summary: run.summary, report: run.report, dir: run.dir, error: run.error, tasks: [...run.tasks.values()] });
/* 보고서 도착 표시: 최근 보고서를 아직 열어 보지 않았으면 입력창의 보고서 버튼에 빨간 점, 현재 업무 카드에 'NEW' 보고서 버튼.
   열어 보면 '읽음'(이 브라우저에 run_id 저장)이 되고, 닫아도 두 버튼은 남아 언제든 다시 볼 수 있다. */
const REPORT_SEEN = "agentOffice.reportSeen";
function paintReport(hide = false) {
  const r = D.lastRun, has = !hide && !!r?.report, unread = has && store.get(REPORT_SEEN) !== String(r.run_id);
  const btn = $("reportBtn"), card = $("runReport");
  btn.hidden = !has; btn.classList.toggle("unread", unread);
  btn.title = btn.ariaLabel = unread ? "새 보고서가 도착했어요 — 보기" : "최근 보고서 보기";
  if (card) { card.hidden = !has; card.classList.toggle("unread", unread); card.setAttribute("aria-label", unread ? "새로 도착한 최종 보고서 보기" : "최종 보고서 다시 보기"); card.title = unread ? "새 보고서 보기" : "보고서 다시 보기"; }
  paintRunCard();
}
/** 현재 업무 카드의 제목 부분도 누를 수 있다: 보고서가 있으면 보고서, 진행 중이면 업무별 진행 상황 */
function paintRunCard() {
  const strip = document.querySelector(".run-strip"), target = runCardTarget();
  if (strip) {
    strip.classList.toggle("clickable", !!target);
    const info = strip.querySelector(".run-info");
    if (info) { info.title = target ? (target.report ? "눌러서 최종 보고서 보기" : "눌러서 업무별 진행 상황 보기") : ""; info.tabIndex = target ? 0 : -1; info.setAttribute("role", target ? "button" : "group"); }
  }
}
/** 현재 업무 카드를 눌렀을 때 열 실행: 진행 중이면 지금 업무, 아니면 보고서가 있는 최근 업무 */
function runCardTarget() {
  if (D.running && D.shown?.tasks?.size) return D.shown;
  return D.lastRun?.report ? D.lastRun : D.shown?.tasks?.size ? D.shown : null;
}
function openReport(v, back) {
  if (v.report && v.run_id != null) { store.set(REPORT_SEEN, String(v.run_id)); paintReport(); } // 읽음 표시
  const items = v.tasks.map(t => {
    const d = memberDef(t.assignee), failed = t.state === "failed";
    return el("details", { class: "res" },
      el("summary", null, el("span", { class: "mchip", style: { "--c": d.color }, text: d.label }),
        el("span", { class: "ttl", text: `#${t.id} ${t.title}` }), failed ? el("span", { class: "fail-badge", text: "실패" }) : null),
      t.result ? md(t.result) : el("p", { class: "muted small", text: t.state === "doing" ? "진행 중입니다." : "결과가 아직 없습니다." }));
  });
  openModal([
    sheetHead("최종 보고서", v.goal || v.run_id, back),
    el("div", { class: "sheet-body" },
      v.project ? el("p", { class: "proj-line", title: v.project.path }, icon("folder-open"), el("b", { text: `프로젝트 · ${v.project.name}` }),
        el("code", { class: "proj-path", text: v.project.path })) : null,
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
      run.report ? el("button", { class: "tbtn", type: "button", onclick: () => openReport(runView(run)) }, icon("file"), "최종 보고서 보기") : null,
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
async function openRun(id, back) {
  const body = el("div", { class: "sheet-body" }, el("p", { class: "muted", text: "불러오는 중…" }));
  openModal([sheetHead("지난 업무", id, back), body]);
  try {
    const v = HIST.details.get(id) || normRun(await getJSON(`/api/runs/${encodeURIComponent(id)}`), id);
    HIST.details.set(id, v);
    if (body.isConnected) openReport(v, back);
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
  return { project: normProject(d.project), run_id: d.run_id || id, goal: String(d.goal || ""), summary: String(plan.summary || d.summary || ""), report: d.report ? String(d.report) : "",
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
  const run = { run_id: String(run_id ?? ""), goal: String(goal ?? ""), summary: "", report: null, dir: "", error: "",
    tasks: new Map(), gate, planned: false, ended: false, ok: false, wall0: Date.now() };
  if (run.run_id) RUNS.set(run.run_id, run); // 진행률·분석·자료실 집계용
  return run;
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
  if (["hello","run_start","plan_start","plan","task_start","review_start","run_error"].includes(ev.type)) window.OfficeLife?.interrupt();
  ev._at = performance.now();
  const T = ev.type;
  if (T === "hello") return onHello(ev);
  if (T === "retry") return onRetry(ev);
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
    D.run.project = normProject(ev.project);
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
  } else if (T === "rework") { // 팀장 보완 요청: 새 업무(보완: 원래 제목)로 보드에 붙는다
    const fresh = (Array.isArray(ev.tasks) ? ev.tasks : []).filter(t => t && typeof t === "object" && !run.tasks.has(tid(t.id)));
    if (!fresh.length) return false;
    for (const t of fresh) addTask(run, t);
    ev.tasks = fresh;
  } else if (T === "report") {
    run.report = String(ev.report || ""); run.dir = String(ev.dir || ""); D.lastRun = run;
  } else if (T === "run_error") run.error = String(ev.message || "알 수 없는 오류");
  else if (T === "run_end") { run.ended = true; run.ok = !!ev.ok; scheduleProgress(); setTimeout(() => loadRuns(true), 1500); }
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
    if (!t.approx && t.t1 > t.t0) SESSION.durations.push({ name: ev.assignee, ms: t.t1 - t.t0, ok: t.ok }); // 이번 세션 실측(분석)
  }
  lane(ev.assignee).push(() => (ev.type === "task_start" ? pTaskStart(ev) : pTaskDone(ev)), 150000);
}

const CAP = { run_start: 15000, plan_start: 30000, plan: 90000, rework: 200000, review_start: 200000, report: 30000, run_error: 15000, run_end: 20000 };
const PLAY = { run_start: pRunStart, plan_start: pPlanStart, plan: pPlan, rework: pRework, review_start: pReview, report: pReport, run_error: pError, run_end: pEnd };

/** 일시 오류로 다시 시도: 로그와 말풍선만(업무 순서는 그대로). */
function onRetry(ev) {
  const n = who(ev.assignee), a = A(n), what = ev.stage === "plan" ? "계획" : ev.stage === "review" ? "최종 보고" : ev.stage === "check" ? "중간 검수" : ev.id != null ? `#${ev.id}` : "업무";
  log(`${what} 다시 시도 (${ev.attempt}번째) · ${clip(String(ev.error || ""), 80)}`, n, "err");
  a?.say(pick(["잠깐 오류가 났어요, 다시 해볼게요 🔁", "한 번 더 시도할게요 💪", "연결이 끊겼네요, 다시!"]), 1600);
}

/** 팀장 중간 검수 → 보완 요청: 팀장이 자리에서 담당자를 불러 말해 준다. 보완 업무는 이어서 task_start/task_done 으로 진행된다. */
async function pRework(ev) {
  const g = epoch, run = ev._run, l = L();
  await capped(Promise.all(Object.values(D.lanes).map(x => x.p)), 150000); alive(g); // 첫 업무 연출이 끝난 뒤
  setPhase(ev.resumed ? "보완 업무 이어 하기" : "보완 요청", true);
  renderBoard();
  log(`중간 검수: 보완 요청 ${ev.tasks.length}건`, D.leader);
  if (!ev.resumed) l.say(`검토해 보니 ${ev.tasks.length}건만 보완하면 좋겠어요 🔁`, 2000);
  for (const t of ev.tasks) {
    const n = who(t.assignee), a = A(n);
    log(`#${t.of ?? t.id} 보완 요청: ${clip(String(t.feedback || ""), 120)}`, D.leader);
    if (ev.resumed || !a) continue;
    l.face(a.group.position);
    l.say(`${a.def.label}님, ${clip(String(t.feedback || "조금만 더 보완해 주세요"), 36)}`, 1900);
    await wait(1000);
    if (n !== D.leader) a.say(pick(["네, 바로 보완할게요!", "알겠습니다 ✍️", "좋은 지적이에요, 고칠게요"]), 1300);
    await wait(700);
  }
  setPhase("업무 진행", true);
  if (!ev.resumed && await go(l, l.seat)) l.sitDesk("sit");
}

/** 이동 + 시간 제한. 도착하면 true, 다른 이동에 밀리면 false. via: 거쳐 갈 지점(현관 문 안) */
async function go(a, p, cap = 20000, via) {
  const g = epoch;
  const r = await Promise.race([a.walkTo(p, via), sleep(cap).then(() => "late")]);
  alive(g);
  if (r === "late") { a.finishWalk(); return true; }
  return r;
}
const L = () => A(D.leader);
const shown = run => run === D.shown && renderBoard();
const later = p => p.catch(e => { if (e !== STALE) console.error(e); });
const sitAtDesk = (a, mode = "sit") => later(go(a, a.seat).then(ok => ok && a.sitDesk(mode)));

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
    a.face(coffeeFace(a.coffee)); a.mode = "coffee";
    if (Math.random() < .6) a.say(pick(["커피 한 잔 ☕", "잠깐 숨 돌릴게요", "다음 거 기다리는 중"]), 1500);
  }));
}
/** 탕비실 커피 자리에서 바라보는 곳: 카운터 앞 줄(x≤-14)은 커피 머신, 그 밖(타원 테이블 둘레)은 테이블 */
const coffeeFace = p => (Math.hypot(p.x - COUNTER.x, p.z - COUNTER.z) < Math.hypot(p.x - PANTRY_TABLE.x, p.z - PANTRY_TABLE.z) ? COUNTER : PANTRY_TABLE);

/** 출근 연출(처음 팀을 만들었을 때만, 재연결 때는 하지 않는다): 한 명씩 0.9초 간격으로 현관 유리문으로 들어와 인사하고
    자기 자리로 걸어간다(간격이 짧으면 인사 말풍선이 서로 포개진다). 팀장은 팀장실로.
    연출 중 재동기화(epoch)가 오면 그 자리에서 멈추고 applySnapshot 이 자리를 잡아 준다. */
const GREET = ["좋은 아침입니다 ☀️", "출근했습니다! 👋", "오늘도 화이팅 💪", "안녕하세요~ 😊"];
async function arrive() {
  const names = D.names.filter(n => !A(n).ghost);
  for (const n of names) { const a = A(n); a.teleport(DOOR_OUT, Math.PI / 2); a.mode = "stand"; a.setHidden(true); }
  const toDoor = Math.hypot(ENTRANCE.x - DOOR_OUT.x, ENTRANCE.z - DOOR_OUT.z); // 문 밖 → 문 안 거리
  for (const n of names) {
    const a = A(n), text = a.def.leader ? "다들 좋은 아침! ☀️" : pick(GREET);
    a.setHidden(false);
    later(go(a, a.seat, 40000, ENTRANCE).then(ok => ok && a.sitDesk("sit")));
    later(wait(toDoor / a.speed * 1000).then(() => a.say(text, 1600))); // 인사는 유리문을 지나 현관 안에 들어선 뒤(문 밖은 왼쪽 사이드바에 가까워 말풍선이 잘린다)
    await wait(900);
  }
}

async function pRunStart(ev) {
  const run = ev._run;
  D.shown = run; renderBoard(); clearStrokes();
  paintReport(true); // 새 업무 중에는 숨긴다(끝나면 새 보고서로 다시 보인다)
  for (const n of D.names) setMember(n, { ...IDLE });
  setPhase("업무 접수", true);
  log(`새 목표: “${clip(run.goal, 160)}”`);
  L()?.say("새 업무가 들어왔어요! 👀", 1800);
  await wait(600);
}

async function pPlanStart(ev) {
  const l = L();
  setPhase("계획 수립", true);
  setMember(D.leader, { status: "계획 중", cls: "meet", task: "자리에서 업무 정리 중", bar: "busy", t0: ev._at, t1: 0 });
  log("팀장이 자리에서 업무 계획을 정리하는 중입니다.", D.leader);
  l.say("목표 확인! 자리에서 정리해 볼게요 📝", 2200);
  // 팀장은 회의실로 가지 않고 자기 자리에서 정리한다. 정리(plan)가 끝나면 회의실에서 발표한다(pPlan).
  if (await go(l, l.seat)) l.sitDesk("type");
}

/** 정리가 끝나면 모두 회의실로: 팀장은 TV 앞에서 발표(PT), 팀원은 회의 테이블에 앉아 경청한다.
    TV 화면의 줄은 발표하면서 업무마다 한 장씩 넘기듯 채운다. */
const PRESENT_SPOT = HAS_DECOR && Decor.PRESENT_SPOT ? Decor.PRESENT_SPOT : { x: 6.6, z: 1.4 }; // 회의실 TV 옆 발표 자리
async function pPlan(ev) {
  const run = ev._run, l = L(), tasks = [...run.tasks.values()];
  setPhase("업무 배정 회의", true);
  clearStrokes();
  renderBoard();
  log(`업무 ${tasks.length}건으로 분해했습니다.`, D.leader);
  if (run.summary) log(`계획: ${clip(run.summary, 200)}`, D.leader);
  l.say("정리 끝! 다들 회의실로 모여 주세요 📣", 1800);
  setMember(D.leader, { status: "회의", cls: "meet", task: "업무 계획 발표", bar: "", t0: 0 });
  await capped(Promise.all(D.names.map(async n => {
    const a = A(n);
    if (n === D.leader) {
      if (await go(a, PRESENT_SPOT)) { a.face(TABLE); a.mode = "talk"; a.presenting = true; }
      return;
    }
    setMember(n, { ...IDLE, status: "회의", cls: "meet", task: "팀장 발표 경청" });
    if (await go(a, a.meet)) { a.face(PRESENT_SPOT); a.mode = "sit"; }
  })), 25000);
  l.face(TABLE); l.mode = "talk"; l.presenting = true;
  l.say(`업무 계획 발표하겠습니다 📊 총 ${tasks.length}건이에요`, 1700);
  await wait(900);
  const per = Math.max(1, Math.ceil(strokes.length / Math.max(1, tasks.length)));
  for (const t of tasks) {
    for (let i = 0; i < per; i++) showStroke(); // TV 화면을 한 장씩 넘기듯
    const a = A(t.assignee);
    l.say(`#${t.id} ${clip(t.title, 26)} → ${a.def.label}`, 1500);
    await wait(550);
    a.say(t.assignee === D.leader ? "제가 직접 맡을게요 ✍️" : pick(LINES.accept), 1100);
    log(`#${t.id} ${t.title} 배정`, t.assignee);
    await wait(450);
  }
  while (strokeN < strokes.length) showStroke();
  l.say("질문 없으면 시작해 볼까요? 🚀", 1400);
  await wait(500);
  setPhase("업무 진행", true);
  for (const n of D.names) { A(n).presenting = false; A(n).mode = "stand"; setMember(n, { ...IDLE }); }
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
    if (!(await go(a, REPORT_SPOT))) continue;
    a.face(l.group.position); a.mode = "talk";
    l.face(a.group.position); // 팀장은 의자를 돌려 보고자를 바라본다(끝나면 sitDesk 로 모니터 쪽 복귀)
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
  paintReport();
  await wait(900);
  // 보고서 창은 이 화면에서 업무를 지시한 사람에게만 자동으로 연다. 다른 접속자에게는 알림 + '최근 보고서' 버튼
  if (run === D.shown && UI.mine.has(run.run_id) && $("modal").hidden) openReport(runView(run));
  else if (run === D.shown) toast("최종 보고서가 도착했어요. 현재 업무 카드의 NEW 표시나 제목을 누르면 볼 수 있어요.", "info", 6000);
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
  D.stage = new Lane(); D.lanes = Object.create(null);
  const team = normTeam(ev.team);
  if (JSON.stringify(team) !== D.teamKey) buildTeam(team);
  setReady(ev.team); // 연결 상태는 teamKey 에 넣지 않는다(바뀌어도 캐릭터를 다시 만들지 않게)
  D.mock = !!ev.mock; brandSub();
  if (NET.mode === "live") setConn("live"); // 모의 여부가 정해졌으니 칩 설명·기록 갱신
  for (const n of D.names) { A(n).finishWalk(); A(n).presenting=false; }
  const first = !D.greeted;
  D.greeted = true;
  if (first) log(NET.mode === "demo" ? `데모 ${SPACE.label}에 모였습니다. 목표를 입력해 보세요.` : `${SPACE.label}에 팀이 모였습니다. 목표를 입력해 주세요.`);
  else log(ev._was === "demo" || ev._was === "auth" ? "서버에 연결되었습니다. 이제 실제 팀이 일합니다." : "서버에 다시 연결되었습니다.");
  applySnapshot(ev.snapshot && typeof ev.snapshot === "object" ? ev.snapshot : null, first);
  if (first && !D.running) later(arrive()); // 첫 출근: 진행 중인 업무가 없으면 현관으로 들어와 자리로 간다(있으면 스냅샷 자리 그대로)
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
  Object.assign(run, { project: normProject(s.project), summary: String(s.summary || ""), report: s.report ? String(s.report) : null, error: s.error ? String(s.error) : "",
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
  if (ph !== "plan" && ph !== "done") strokes.forEach(showStroke); // 계획 중에는 TV 가 비어 있다(발표 때 채운다)
  for (const n of D.names) {
    const a = A(n), mine = tasks.filter(t => t.assignee === n), doing = mine.find(t => t.state === "doing");
    if (ph === "plan" && n === D.leader) {
      a.teleport(a.seat, Math.PI); a.sitDesk("type"); // 계획은 자기 자리에서 정리한다
      setMember(n, { status: "계획 중", cls: "meet", task: "자리에서 업무 정리 중", bar: "busy", t0: now, approx: true });
    } else if (ph === "review" && n === D.leader) {
      a.teleport(a.seat, Math.PI); a.sitDesk("type");
      setMember(n, { status: "검수 중", cls: "meet", task: "결과물 검수", bar: "busy", t0: now, approx: true });
    } else if (ph === "work" && doing) {
      a.teleport(a.seat, Math.PI); a.sitDesk("type");
      setMember(n, { status: "작업 중", cls: "work", task: `#${doing.id} ${doing.title}`, bar: "busy", t0: now, approx: true });
    } else if (ph === "work" && mine.some(t => t.state === "todo")) {
      a.teleport(a.coffee); a.face(coffeeFace(a.coffee)); a.group.rotation.y = a.targetRot; a.mode = "coffee";
      setMember(n, { status: "대기", cls: "wait", task: "선행 업무 기다리는 중 ☕" });
    } else { a.teleport(a.seat, Math.PI); a.mode = "sit"; }
  }
  setPhase(ph === "done" ? (run.ok ? "완료" : "중단됨") : PHASE_KO[ph], ph !== "done");
  paintReport(!(ph === "done" && run.report));
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
  tickClock(); tickBoard();
  window.OfficeLife?.tick();
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
  $("conn").className = `chip conn ${cls}`;
  $("connText").textContent = text;
  $("conn").title = mode === "live" ? (D.mock ? "서버가 모의(mock) 모드로 실행 중입니다" : "서버에 연결됨") : mode === "auth" ? "눌러서 접속 키 입력" : mode === "demo" ? "서버 없이 데모로 동작 중" : "";
  if (mode === "live") loadRuns(true);
  scheduleProgress();
  if (VIEW.name === "settings" || VIEW.name === "members" || VIEW.name === "library") scheduleView();
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
  log(again ? "접속 키가 맞지 않습니다. 다시 확인해 주세요." : "이 서버는 접속 키가 필요합니다. 상단의 ‘접속 키 필요’ 표시를 누르거나 설정에서 터미널에 표시된 키를 넣어 주세요.", null, "err");
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
  if (D.running || UI.submitting || window.CharacterChat?.pending) return;
  if (NET.mode === "auth") { openKeyDialog(); return; }
  let goal = $("goal").value.trim();
  if (!goal && NET.mode === "demo" && !ATT.name) goal = EXAMPLE_GOAL;
  if (!goal) { toast("팀에게 맡길 업무를 입력해 주세요."); $("goal").focus(); return; }
  const { goal: full, truncated } = composeGoal(goal);
  if (NET.mode === "demo") {
    if (demo.busy) { toast("이미 진행 중인 업무가 있어요", "warn"); return; }
    if (truncated) toast("첨부 내용이 길어 4,000자에 맞춰 잘라 보냈어요.", "warn");
    $("goal").value = ""; fitGoal(); clearAttachment();
    if (mqMobile.matches) $("goal").blur();
    demoRun(full);
    return;
  }
  if (NET.mode !== "live") {
    toast(NET.mode === "connecting" ? "서버에 연결하는 중이에요. 잠시 후 다시 시도해 주세요." : "서버와 다시 연결하는 중이에요. 잠시 후 다시 시도해 주세요.", "warn");
    return;
  }
  // 외부 도구(MCP)가 등록돼 있으면 이번 업무에 쓸지 먼저 묻는다(extras.js). null = 취소
  const consent = window.Extras?.beforeRun ? await window.Extras.beforeRun() : {};
  if (consent === null) return;
  UI.submitting = true; updateInput();
  let ok = false;
  try {
    const project_id = window.Projects?.currentId() || undefined; // 고른 프로젝트 폴더 안에서 실행
    const tools = consent?.tools?.length ? consent.tools : undefined;
    const r = await api("/api/run", { method: "POST", body: JSON.stringify({ goal: full, project_id, tools }) });
    if (r.ok) {
      ok = true; $("goal").value = ""; fitGoal(); clearAttachment(); if (mqMobile.matches) $("goal").blur();
      if (truncated) toast("첨부 내용이 길어 4,000자에 맞춰 잘라 보냈어요.", "warn");
      const j = await r.json().catch(() => null);
      if (j?.run_id != null) UI.mine.add(String(j.run_id)); // 보고서 창을 자동으로 열 대상
    } else if (r.status === 409) toast("이미 진행 중인 업무가 있어요", "warn");
    else if (r.status === 404 && project_id) { window.Projects?.forget(project_id); toast("고른 프로젝트가 더 이상 없어요. 프로젝트를 다시 골라 주세요.", "warn"); }
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
function onConnClick() {
  if (NET.mode === "auth") return openKeyDialog();
  if (NET.mode === "demo") return toast("서버가 없어 데모로 동작 중이에요. 서버를 켜면 자동으로 연결돼요.", "info", 4000);
  if (NET.mode === "live") return toast(D.mock ? "서버 연결됨 · 모의 실행(API 호출 없음)" : "서버 연결됨 · 실제 팀이 일해요", "info", 2500);
  if (!NET.ws) { clearTimeout(NET.timer); connect(); }
  toast("서버에 연결하는 중이에요…", "info", 2500);
}

$("command").addEventListener("submit", e => { e.preventDefault(); submitGoal(); });
/* 명령창(여러 줄): Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중 Enter 는 보내지 않는다. 내용에 맞춰 최대 5줄까지 늘어난다 */
function fitGoal() { const g = $("goal"); g.style.height = "auto"; g.style.height = Math.min(g.scrollHeight, 140) + "px"; }
$("goal").addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault(); $("command").requestSubmit();
});
$("goal").addEventListener("input", fitGoal);
$("speed").addEventListener("click", e => { const s = +e.target.closest("button")?.dataset.s; if (s) setSpeed(s); });
$("speedCycle").addEventListener("click", () => setSpeed({ 1: 2, 2: 4, 4: 1 }[SPEED]));
$("reportBtn").addEventListener("click", () => D.lastRun && openReport(runView(D.lastRun)));
$("runReport")?.addEventListener("click", () => D.lastRun && openReport(runView(D.lastRun)));
for (const sel of [".run-strip .run-info", ".run-strip .run-symbol"]) {
  const node = document.querySelector(sel);
  if (!node) continue;
  const go = () => { const r = runCardTarget(); if (r) openReport(runView(r)); };
  node.addEventListener("click", go);
  node.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
}
$("conn").addEventListener("click", onConnClick);
$("attachBtn").addEventListener("click", () => $("attachInput").click());
$("attachInput").addEventListener("change", e => pickAttachment(e.target.files?.[0]));
$("attachRemove").addEventListener("click", () => { clearAttachment(); $("attachBtn").focus({ preventScroll: true }); });
for (const id of ["searchBtn", "drawerSearch"]) $(id).addEventListener("click", openPalette);
for (const id of ["newAgentBtn", "drawerNewAgent"]) $(id).addEventListener("click", openNewAgent);
$("menuBtn").addEventListener("click", () => setDrawer(!document.body.classList.contains("drawer-open")));
$("drawerClose").addEventListener("click", () => setDrawer(false));
$("scrim").addEventListener("click", () => setDrawer(false));
for (const b of document.querySelectorAll("#sidenav [data-view]")) b.addEventListener("click", () => showView(b.dataset.view));
$("viewClose").addEventListener("click", closeView);
$("boardLink").addEventListener("click", () => showView("board"));
$("logFilterBtn").addEventListener("click", () => openLogFilter($("logFilterBtn")));
$("palette").addEventListener("click", e => { if (e.target === $("palette")) closePalette(); });
$("paletteInput").addEventListener("input", e => renderPalette(e.target.value));
$("paletteInput").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { e.preventDefault(); movePalette(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(-1); }
  else if (e.key === "Enter") { e.preventDefault(); pickPalette(PAL.sel); }
});
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });
document.addEventListener("pointerdown", e => {
  const m = $("popmenu");
  if (!m.hidden && !m.contains(e.target) && !POP.anchor?.contains(e.target)) closeMenu();
});
if (HAS3D) {
  let characterPress=null;
  renderer.domElement.addEventListener("pointerdown",e=>{characterPress=e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;});
  renderer.domElement.addEventListener("pointercancel",()=>{characterPress=null;});
  renderer.domElement.addEventListener("pointerup",e=>{
    const start=characterPress;characterPress=null;
    if(e.pixelPinch||!start||start.id!==e.pointerId||Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)return;
    if(window.SpaceTheme?.isPixel){const a=renderer.pick(e.clientX,e.clientY);if(a&&!a.npc&&!a.guest)window.CharacterChat?.open(a.name);else if(a?.npc)a.tag?.click();return;}
    const r=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
    const meshes=[];
    for(const n of D.names){const a=A(n);if(!a.ghost&&!a.hidden)a.group.traverse(o=>{if(o.isMesh&&!o.material?.userData?.blob)meshes.push(o);});}
    const hit=ray.intersectObjects(meshes,false)[0];
    if(hit){const a=D.names.map(A).find(a=>{let o=hit.object;while(o){if(o===a.group)return true;o=o.parent;}return false;});if(a)window.CharacterChat?.open(a.name);}
  });
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
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); $("palette").hidden ? openPalette() : closePalette(); return; }
  if (e.key === "Escape") {
    if (!$("popmenu").hidden) closeMenu();
    else if (!$("palette").hidden) closePalette();
    else if (!$("modal").hidden) closeModal();
    else if (document.body.classList.contains("drawer-open")) setDrawer(false);
    else if (VIEW.name) closeView();
    else if ($("dock").classList.contains("open")) setDock(false);
  } else if (e.key === "Tab") { // 대화상자(모달·검색) 안에서만 포커스 순환
    const box = !$("modal").hidden ? $("sheet") : !$("palette").hidden ? $("palette") : null;
    if (!box) return;
    const f = [...box.querySelectorAll("button, summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent && !x.disabled);
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
  if (controls) controls.maxZoom = mqMobile.matches ? 6.4 : 4.4;
  if (!mqMobile.matches) { setDock(false); setDrawer(false); }
  updateInput(); resize();
};
mqMobile.addEventListener("change", onLayoutChange);
mqSide.addEventListener("change", onLayoutChange);
mqNarrow.addEventListener("change", updateInput);
mqDark.addEventListener("change", themeChanged);

/** 이름표·말풍선 겹침 정리(매 프레임, placeLabel 바로 뒤에 부른다).
    1) 이름표(이름 알약 + 역할 알약): 카메라에 가까운 팀원부터 자리를 잡고, 겹치는 뒤쪽 팀원(옆자리)의 이름표는 겹친 높이만큼 위로 밀어 올린다(ly). 데스크톱·휴대폰 공통.
    2) 말풍선: 가장 최근에 말한 팀원이 우선. 데스크톱에서는 겹치는 이전 말풍선을 그 위로 띄워 둘 다 읽히게 하고,
       휴대폰(좁은 화면)에서는 잠시 숨긴다(covered). 이름표·말풍선 z 순서도 최근 발화자가 맨 위. */
const hits = (r, k) => r.x0 < k.x1 && r.x1 > k.x0 && r.y0 < k.y1 && r.y1 > k.y0;
const rectOf = e => { const b = e.getBoundingClientRect(); return { x0: b.left, x1: b.right, y0: b.top, y1: b.bottom, w: b.width }; };
/** r 를 kept 와 겹치지 않을 때까지 위로 올린 양(px). gap: 띄울 간격 */
function liftOver(r, kept, gap) {
  let off = 0;
  for (let i = 0; i < 8 && kept.length; i++) {
    const k = kept.find(k => hits({ x0: r.x0, x1: r.x1, y0: r.y0 - off, y1: r.y1 - off }, k));
    if (!k) break;
    off = r.y1 - k.y0 + gap;
  }
  return off;
}
function declutter(mobile) {
  const agents = D.names.map(A).filter(a => !a.ghost && !a.hidden).sort((p, q) => p.az - q.az); // 가까운 순
  const tags = [];
  for (const a of agents) {
    const t = rectOf(a.tag); // placeLabel 직후 = 밀어 올리기 전 자리
    if (!t.w) continue;
    const ro = a.role ? rectOf(a.role) : null; // 역할 알약(휴대폰에서는 숨김 → 폭 0)
    const r = ro?.w ? { x0: Math.min(t.x0, ro.x0), x1: Math.max(t.x1, ro.x1), y0: t.y0, y1: ro.y1 } : t;
    const off = liftOver(r, tags, 2);
    if (off) { a.ly = off; a.moveLabel(); }
    tags.push({ a, x0: r.x0, x1: r.x1, y0: r.y0 - off, y1: r.y1 - off });
  }
  const kept = [];
  for (const a of agents.filter(a => a.bubble.classList.contains("show")).sort((p, q) => q.lastSay - p.lastSay)) {
    a.bubble.style.translate = "";
    const r = rectOf(a.bubble), others = tags.filter(t => t.a !== a); // 다른 팀원의 이름표(밀어 올린 것 포함)는 가리지 않는다
    const off = liftOver(r, mobile ? others : [...kept, ...others], mobile ? 4 : 6);
    if (off) a.bubble.style.translate = `0 ${-off}px`;
    const lifted = { x0: r.x0, x1: r.x1, y0: r.y0 - off, y1: r.y1 - off };
    if (mobile) { // 좁은 화면: 말풍선끼리 겹치면 이전 것을 잠시 숨긴다
      const hit = kept.some(k => hits(lifted, k));
      a.bubble.classList.toggle("covered", hit);
      if (hit) continue;
    }
    kept.push(lifted);
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
  stepOffice(now);
  controls.update();
  camera.updateMatrixWorld();
  if(window.SpaceTheme?.isPixel)PixelTheme.snapCamera(camera,controls.target,innerWidth,innerHeight);
  const w = innerWidth, h = innerHeight;
  for (const n of D.names) { const a = A(n); if (a.ghost) continue; a.update(raw * SPEED); a.paint(now); a.placeLabel(w, h); }
  declutter(mqMobile.matches); // 방 이름표(.room-chip)는 decor.js 가 바닥 메시의 onBeforeRender 에서 옮기고, 이름표와 겹치면 숨긴다
  renderer.render(scene, camera);
  if (!loop.rendered) { loop.rendered = true; document.body.classList.add("rendered"); } // 첫 프레임 뒤에야 이름표를 보인다(그 전엔 자리가 안 잡혀 왼쪽 위에 모인다)
}

PREF.lastDark = isDark();
if (HAS3D) { if (typeof applyTheme === "function") applyTheme(); } else enterListMode();
$("drawerTheme").append(themeControl());
setSpeed(SPEED);
buildTeam(normTeam(DEMO_TEAM)); // 연결 전에도 사무실이 비어 보이지 않게(같은 팀이면 hello 때 다시 만들지 않는다)
renderBoard();
renderLog();
renderProgress();
setPhase("대기 중", false);
updateInput();
tickClock();
markNav();
window.Dashboard?.init();
resize();
if (HAS3D) requestAnimationFrame(loop);
else if (mqMobile.matches && !mqSide.matches) setDock(true); // 목록 모드 휴대폰: 시트를 열어 둔다
setInterval(ambient, 1000);
connect();
