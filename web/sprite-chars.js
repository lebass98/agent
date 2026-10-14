"use strict";
/* sprite-chars.js — 캐릭터 시트 그림을 그대로 쓰는 '그림 캐릭터'(2.5D 빌보드). docs/characters.md 의 '그림 캐릭터' 참고.
   sprites/sprites.js(window.SPRITE_META — scripts/sprites/cut.py 가 시트에서 잘라 만든 좌표표)의 프레임을
   카메라 쪽으로 돌린 세로 판에 붙인다. 판이 세로로 서 있어서 책상·의자·칸막이와의 앞뒤 가림이 3D 그대로 맞는다.

   app.js 의 Agent 가 쓰는 rig 계약(group·setFace·dispose·height …)을 따르되 팔다리 뼈대는 없고, 연출은 rig.sprite 가 한다.
     update(agent, dt, seated, camera)  매 프레임: 방향·자세에 맞는 프레임을 고르고 판을 카메라로 돌린다
       - 바라보는 방향과 카메라 방위의 차이로 정면·측면·후면을 고른다(측면 왼쪽은 오른쪽 그림의 거울상, 서 있을 때는 시트의 좌측면)
       - 걷기: 이동 거리에 맞춰 '걷기 ↔ 서기' 두 프레임을 번갈아 보이고 위아래로 살짝 튄다
       - 앉기/일어나기: '일어나는 중' 프레임을 잠깐 거친다. 앉은 그림에는 의자가 있으므로 그동안 자리의 3D 의자(Decor.chairNear)를 숨긴다
     hold(agent, dt)  자리에서 일어나는 동안 true(Agent 가 이동을 잠시 멈춘다)
   표정(setFace)은 이름표·팀원 카드의 얼굴 아바타(app.js)가 보여 준다. */
(function () {
  const T = window.THREE, META = window.SPRITE_META;
  if (!META) return;
  const has = name => Object.hasOwn(META.chars, String(name || "").toLowerCase());
  /** 아바타용 표정 띠: { src, n, names, index(expr) } — app.js 가 CSS 배경으로 쓴다(3D 가 없는 목록 모드에서도) */
  function faces(name) {
    const k = String(name || "").toLowerCase();
    if (!Object.hasOwn(META.chars, k)) return null;
    const f = META.chars[k].faces;
    return { src: f.src, n: f.names.length, names: f.names, index: e => Math.max(0, f.names.indexOf(e)) };
  }
  if (!T) { window.SpriteChars = { has, faces, build: () => null, theme() {} }; return; }
  const D2R = Math.PI / 180;
  // 정면 |rel|<30°, 후면 >150°, 그 사이는 측면(경계에서 깜빡이지 않게 ±8° 이력). 기본 시점에서 책상·회의 의자는 대각선(45°·135°)이라
  // 경계에서 충분히 떨어져 늘 측면으로 보인다(경계가 가까우면 직전 방향에 따라 같은 자리가 측면·후면으로 갈린다)
  const FRONT = 30 * D2R, BACK = 150 * D2R, HYST = 8 * D2R;
  const STEP = .32;   // 걷기 프레임 한 장이 맡는 이동 거리(월드 단위)
  const RISE = .35, SIT = .25; // 일어나기·앉기 전환 프레임 시간(초, 연출 배속 적용)
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  const atlases = {}; // 캐릭터별 아틀라스 텍스처(팀을 다시 만들어도 한 번만 불러 공유한다)
  function atlas(key) {
    if (atlases[key]) return atlases[key];
    const tex = new T.TextureLoader().load(META.chars[key].atlas);
    tex.anisotropy = 4;
    return (atlases[key] = tex);
  }
  let blobTex = null; // 발밑 그림자(가운데가 진한 원)
  function blob() {
    if (blobTex) return blobTex;
    const cv = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }), c = cv.getContext("2d");
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,.85)"); g.addColorStop(.45, "rgba(0,0,0,.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    return (blobTex = new T.CanvasTexture(cv));
  }
  const mats = new Set(); // 테마 색조를 맞출 재질들
  let dark = false;
  const TINT = { light: 0xffffff, dark: 0xf1e7dc }, SHADE = { light: .32, dark: .55 };
  function theme(d) {
    dark = !!d;
    for (const m of mats) {
      if (m.userData.blob) m.opacity = SHADE[dark ? "dark" : "light"];
      else m.color.setHex(TINT[dark ? "dark" : "light"]);
    }
  }

  function build(def, name) {
    const key = String(name || "").toLowerCase();
    if (!has(key)) return null;
    const C = META.chars[key], [AW, AH] = C.size;
    const group = new T.Group();
    const pivot = new T.Group(); group.add(pivot); // 카메라 쪽으로 도는 축(발 중심)
    const geo = new T.PlaneGeometry(1, 1); geo.translate(0, .5, 0); // 아래 가운데가 원점
    const mat = new T.MeshBasicMaterial({ map: atlas(key), alphaTest: .12, color: TINT[dark ? "dark" : "light"] });
    mat.alphaToCoverage = true; // MSAA 로 가장자리를 부드럽게(정렬 문제 없는 불투명 패스)
    const mesh = new T.Mesh(geo, mat); pivot.add(mesh);
    const shadowMat = new T.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: SHADE[dark ? "dark" : "light"] });
    shadowMat.userData.blob = true;
    const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .014; shadow.renderOrder = 1; group.add(shadow);
    mats.add(mat); mats.add(shadowMat);

    const uv = geo.attributes.uv;
    let cur = "", curMirror = false, frameH = 1.75;
    /** 프레임 교체: UV(거울상이면 좌우 바꿈)·크기·발 중심 맞춤 */
    function setFrame(fname, mirror, hk) {
      const f = C.frames[fname] || C.frames["stand.front"];
      const [x, y, w, h, ax, ppu] = f;
      if (fname !== cur || mirror !== curMirror) {
        cur = fname; curMirror = mirror;
        const u0 = x / AW, u1 = (x + w) / AW, vt = 1 - y / AH, vb = 1 - (y + h) / AH;
        const L = mirror ? u1 : u0, R = mirror ? u0 : u1;
        uv.setXY(0, L, vt); uv.setXY(1, R, vt); uv.setXY(2, L, vb); uv.setXY(3, R, vb);
        uv.needsUpdate = true;
        mesh.position.x = (mirror ? -1 : 1) * (w / 2 - ax) / ppu;
      }
      mesh.scale.set(w / ppu, h / ppu * hk, 1);
      frameH = h / ppu * hk;
    }
    /** 종류(stand·walk·sit·rise)와 방향(front·back·R·L)으로 프레임 이름·거울상. cycle 이면 왼쪽 서기도 오른쪽 그림의 거울상(걷기와 소품 손이 같게) */
    function pick(kind, view, cycle) {
      if (kind === "rise") return ["rise.middle", view === "L"];
      if (view === "front" || view === "back") return [`${kind}.${view}`, false];
      if (view === "L" && !cycle && C.frames[`${kind}.sideL`]) return [`${kind}.sideL`, false];
      return [`${kind}.sideR`, view === "L"];
    }

    const st = { view: "front", wasSeated: false, rise: 0, sit: 0, dist: 0, px: 0, pz: 0, chair: null, t: Math.random() * 10 };
    const _d = new T.Vector3();
    function chooseView(rel) {
      const a = Math.abs(rel), side = Math.sin(rel) >= 0 ? "R" : "L", v = st.view;
      // 지금 방향을 경계 밖 8° 까지는 유지한다
      if (v === "front" && a < FRONT + HYST) return "front";
      if (v === "back" && a > BACK - HYST) return "back";
      if ((v === "R" || v === "L") && a > FRONT - HYST && a < BACK + HYST) return Math.abs(Math.sin(rel)) < .05 ? v : side;
      return a < FRONT ? "front" : a > BACK ? "back" : side;
    }
    function hideChair(on) {
      if (on) {
        if (st.chair) return;
        const p = group.position, c = window.Decor && typeof Decor.chairNear === "function" ? Decor.chairNear(p.x, p.z, .5) : null;
        if (c && c.mesh.visible) { c.mesh.visible = false; st.chair = c; }
      } else if (st.chair) { st.chair.mesh.visible = true; st.chair = null; }
    }

    const sprite = {
      hold(a, dt) {
        if (st.wasSeated && a.mode === "walk") { st.wasSeated = false; st.rise = RISE; } // 앉아 있다가 걷기 시작: 먼저 일어난다
        if (st.rise > 0) { st.rise -= dt; return st.rise > 0; }
        return false;
      },
      update(a, dt, seated, camera) {
        st.t += dt;
        const p = group.position, moved = Math.hypot(p.x - st.px, p.z - st.pz);
        st.px = p.x; st.pz = p.z;
        const walking = a.mode === "walk" && moved > 1e-4 && moved < .5; // 순간 이동은 걸음으로 치지 않는다
        if (walking) st.dist += moved;
        if (seated && !st.wasSeated) st.sit = SIT;          // 막 앉았다: '일어나는 중'을 거꾸로 잠깐
        if (!seated && st.wasSeated && st.rise <= 0) st.rise = RISE; // 걷기 말고 다른 이유로 일어남(서서 이야기 등)
        st.wasSeated = seated;
        if (st.sit > 0) st.sit -= dt;
        const rising = st.rise > 0 && !seated;
        if (rising && a.mode !== "walk") st.rise -= dt;       // 걷기면 hold() 가 줄인다

        // 카메라 방위·높이: 판은 수직으로 세워 카메라 쪽으로 돌리고, 위에서 내려다보며 납작해 보이는 만큼 키를 조금 늘린다
        camera.getWorldDirection(_d);
        const camYaw = Math.atan2(-_d.x, -_d.z), elev = Math.asin(Math.min(1, Math.max(0, -_d.y)));
        const hk = Math.min(1.2, 1 / Math.sqrt(Math.max(.3, Math.cos(elev))));
        pivot.rotation.y = camYaw - group.rotation.y;
        // 앉아 있을 때는 의자 돌리기·두리번(yaw)에 흔들리지 않게 목표 방향으로 고른다
        const facing = seated ? a.targetRot : group.rotation.y;
        st.view = chooseView(wrap(facing - camYaw));

        let kind = "stand", cycle = false, bob = 0, breathe = 0;
        if (seated && st.sit > 0) kind = "rise";
        else if (seated) kind = "sit";
        else if (rising) kind = "rise";
        else if (walking || (a.mode === "walk" && a.path.length)) {
          const ph = (st.dist / STEP) % 2;
          kind = ph < 1 ? "walk" : "stand"; cycle = true;
          bob = .035 * Math.sin(Math.PI * (ph % 1));
        } else breathe = Math.sin(st.t * 2.1) * .006;
        if (seated && kind === "sit") {
          if (a.mode === "type" || a.act === "typing") bob = Math.abs(Math.sin(st.t * 9)) * .006;      // 타이핑: 어깨가 잘게
          else if (a.mode === "talk" && a.act === "gesture") bob = Math.abs(Math.sin(st.t * 3)) * .012; // 말하며 손짓
          else breathe = Math.sin(st.t * 1.8) * .005;
        }
        const [fname, mirror] = pick(kind, st.view, cycle);
        setFrame(fname, mirror, hk * (1 + breathe));
        pivot.position.y = bob;
        hideChair(seated || kind === "rise");
        // 그림자: 서 있으면 발 크기, 의자에 앉으면 의자 다리 크기
        const s = kind === "sit" || kind === "rise" ? 1.05 : walking ? .78 - bob * 2 : .72;
        shadow.scale.set(s, s * .8, 1);
        rig.height = frameH + bob + .1;
      },
    };
    const rig = {
      group, legs: [], arms: [], body: new T.Object3D(), head: new T.Object3D(), cup: new T.Object3D(), props: {},
      preset: { tablet: false, laptop: null, laptopOpen: false, cupAlways: false, pocket: null },
      height: 1.95, sprite, faceStrip: faces(key), frame: () => (curMirror ? `${cur}~` : cur), // frame(): 지금 프레임 이름(~ 는 거울상, 점검용)
      setFace() {}, // 얼굴은 그림에 그려져 있다 — 표정은 아바타(app.js)가 맡는다
      dispose() { hideChair(false); mats.delete(mat); mats.delete(shadowMat); geo.dispose(); mat.dispose(); shadow.geometry.dispose(); shadowMat.dispose(); },
    };
    return rig;
  }

  window.SpriteChars = { has, build, faces, theme };
})();
