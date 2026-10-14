"use strict";
/* sprite-chars.js — 초고해상도(2048px급) HD 사진 에셋 + 3D 원통형 릴리프 곡면 + 스튜디오 볼륨/림라이트 셰이더 + 실시간 태양 그림자.
   sprites/sprites.js(window.SPRITE_META), work-seated.js, office-life.js 의 고해상도 프레임을
   카메라를 향한 3D 곡면 릴리프 메시에 매핑하여 반실사 3D 렌더 품질로 연출한다.

   app.js 의 Agent 가 쓰는 rig 계약(group·setFace·dispose·height …)을 그대로 따른다:
     update(agent, dt, seated, camera)  매 프레임: 방향·자세에 맞는 프레임을 고르고 3D 곡면을 카메라로 정렬
     hold(agent, dt)  자리에서 일어나는 동안 true(Agent 가 이동을 잠시 멈춘다)
   표정(setFace)은 이름표·팀원 카드의 고해상도 얼굴 아바타(app.js)가 보여 준다. */
(function () {
  const T = window.THREE, META = window.SPRITE_META;
  if (!META) return;
  const has = name => Object.hasOwn(META.chars, String(name || "").toLowerCase());
  /** 아바타용 표정 띠: { src, n, names, index(expr) } — app.js 가 CSS 배경으로 쓴다 */
  function faces(name) {
    const k = String(name || "").toLowerCase();
    if (!Object.hasOwn(META.chars, k)) return null;
    const f = META.chars[k].faces;
    return { src: f.src, n: f.names.length, names: f.names, index: e => Math.max(0, f.names.indexOf(e)) };
  }
  if (!T) { window.SpriteChars = { has, faces, build: () => null, theme() {} }; return; }
  const D2R = Math.PI / 180;
  const FRONT = 30 * D2R, BACK = 150 * D2R, HYST = 8 * D2R;
  const STEP = .32;   // 걷기 프레임 한 장이 맡는 이동 거리(월드 단위)
  const RISE = .35, SIT = .25; // 일어나기·앉기 전환 프레임 시간(초)
  const SEGS_X = 12, SEGS_Y = 8; // 3D 원통형 릴리프 곡면 분할 수
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function prepTex(tx) {
    tx.encoding = T.sRGBEncoding;
    tx.anisotropy = 16;
    tx.minFilter = T.LinearMipmapLinearFilter;
    tx.magFilter = T.LinearFilter;
    tx.generateMipmaps = true;
    return tx;
  }

  const atlases = {}, lifeAtlases = {}, workAtlases = {};
  function lifeAtlas(key) {
    if (!lifeAtlases[key]) lifeAtlases[key] = prepTex(new T.TextureLoader().load(OFFICE_LIFE_META.chars[key].atlas));
    return lifeAtlases[key];
  }
  function workAtlas(key) {
    if (!window.WORK_SEATED_META?.chars[key]) return null;
    if (!workAtlases[key]) workAtlases[key] = prepTex(new T.TextureLoader().load(WORK_SEATED_META.chars[key].atlas));
    return workAtlases[key];
  }
  function atlas(key) {
    if (atlases[key]) return atlases[key];
    return (atlases[key] = prepTex(new T.TextureLoader().load(META.chars[key].atlas)));
  }

  let blobTex = null; // 발밑 이중 소프트 접지 그림자(Ambient Occlusion)
  function blob() {
    if (blobTex) return blobTex;
    const cv = Object.assign(document.createElement("canvas"), { width: 128, height: 128 }), c = cv.getContext("2d");
    const g = c.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, "rgba(8,10,16,.92)");
    g.addColorStop(.38, "rgba(8,10,16,.58)");
    g.addColorStop(.72, "rgba(8,10,16,.18)");
    g.addColorStop(1, "rgba(8,10,16,0)");
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    return (blobTex = new T.CanvasTexture(cv));
  }

  const mats = new Set();
  let night = 0; // 사무실 밤 정도 0(낮) ~ 1(밤)
  const TINT = { light: 0xffffff, dark: 0xf4ebe2 }, SHADE = { light: .38, dark: .62 };
  const tint = () => new T.Color(TINT.light).lerp(new T.Color(TINT.dark), night);
  const shade = () => SHADE.light + (SHADE.dark - SHADE.light) * night;
  function theme(n) {
    night = typeof n === "number" ? Math.min(1, Math.max(0, n)) : n ? 1 : 0;
    const c = tint(), o = shade();
    for (const m of mats) {
      if (m.userData.blob) m.opacity = o;
      else {
        m.color.copy(c);
        if (m.userData.uNight) m.userData.uNight.value = night;
      }
    }
  }

  /** 3D 원통형 릴리프 곡면 생성: 중앙이 앞으로 볼록하게 솟아올라 조명·회전 시 입체감을 형성 */
  function createReliefGeometry() {
    const geo = new T.PlaneGeometry(1, 1, SEGS_X, SEGS_Y);
    geo.translate(0, 0.5, 0); // 발바닥 중심이 원점(0, 0, 0)
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      // 가로 중심(x=0)이 볼록하고 가장자리로 갈수록 부드럽게 감싸는 3D 실린더 릴리프 곡면
      const archX = Math.cos(x * Math.PI * 0.92);
      const archY = Math.sin(Math.min(1, Math.max(0, y)) * Math.PI);
      pos.setZ(i, archX * 0.055 + archY * 0.018);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /** 반실사 3D 스튜디오 셰이더 주입: 상단 키라이트 + 하단 접지 AO + 측면 3D 곡면 림라이트 */
  function applyStudio3DShader(mat) {
    const uNight = { value: night };
    mat.userData.uNight = uNight;
    mat.onBeforeCompile = shader => {
      shader.uniforms.uNight = uNight;
      shader.vertexShader = "varying vec2 vLocalPos;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLocalPos = vec2(position.x, position.y);"
      );
      shader.fragmentShader = "varying vec2 vLocalPos;\nuniform float uNight;\n" + shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // 1) 수직 스튜디오 키라이트 & 발밑 접지 AO 그라데이션
        float vGrad = smoothstep(0.0, 0.22, vLocalPos.y) * 0.09 + smoothstep(0.45, 0.98, vLocalPos.y) * 0.045 - 0.04;
        // 2) 가로 3D 원통형 볼륨 하이라이트 & 따뜻한 스튜디오 림라이트
        float dome = cos(vLocalPos.x * 2.6) * 0.035;
        float rim = smoothstep(0.26, 0.48, abs(vLocalPos.x)) * smoothstep(0.25, 0.92, vLocalPos.y) * (0.045 + uNight * 0.035);
        vec3 rimTint = mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.91, 0.80), uNight);
        diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + vGrad + dome) + rimTint * rim, 0.0, 1.0);`
      );
    };
  }

  function build(def, name) {
    const key = String(name || "").toLowerCase();
    if (!has(key)) return null;
    const C = META.chars[key], [AW, AH] = C.size;
    const group = new T.Group();
    const pivot = new T.Group(); group.add(pivot); // 카메라 쪽으로 도는 축(발 중심)
    const geo = createReliefGeometry();
    const baseTex = atlas(key);
    const mat = new T.MeshBasicMaterial({ map: baseTex, alphaTest: .08, color: tint(), toneMapped: false });
    mat.alphaToCoverage = true; // MSAA 서브픽셀 외곽선 안티앨리어싱
    applyStudio3DShader(mat);

    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true; // 실제 해/조명 방향으로 사람 모양 3D 그림자 투사
    const depthMat = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: baseTex, alphaTest: .32 });
    mesh.customDepthMaterial = depthMat;
    pivot.add(mesh);

    const shadowMat = new T.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: shade() });
    shadowMat.userData.blob = true;
    const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .014; shadow.renderOrder = 1; group.add(shadow);
    mats.add(mat); mats.add(shadowMat);

    const uv = geo.attributes.uv;
    let cur = "", curMirror = false, frameH = 1.75;
    /** 프레임 교체: 세분화된 3D 곡면 UV 전체 보간·크기·발 중심 맞춤 */
    function setFrame(fname, mirror, hk) {
      const work = fname.startsWith("work.") && window.WORK_SEATED_META?.chars[key];
      const life = fname.startsWith("life.") && window.OFFICE_LIFE_META?.chars[key];
      const f = life ? life.frames[fname.slice(5)] : work ? work.frames[fname] : C.frames[fname] || C.frames["stand.front"];
      const [atlasW, atlasH] = life ? life.size : work ? work.size : [AW, AH];
      const activeTex = life ? lifeAtlas(key) : work ? workAtlas(key) : atlas(key);
      if (mat.map !== activeTex) {
        mat.map = activeTex;
        depthMat.map = activeTex;
        depthMat.needsUpdate = true;
      }
      const [x, y, w, h, ax, ppu] = f;
      if (fname !== cur || mirror !== curMirror) {
        cur = fname; curMirror = mirror;
        const u0 = x / atlasW, u1 = (x + w) / atlasW, vt = 1 - y / atlasH, vb = 1 - (y + h) / atlasH;
        const L = mirror ? u1 : u0, R = mirror ? u0 : u1;
        for (let iy = 0, idx = 0; iy <= SEGS_Y; iy++) {
          const v = vt + (vb - vt) * (iy / SEGS_Y);
          for (let ix = 0; ix <= SEGS_X; ix++, idx++) {
            uv.setXY(idx, L + (R - L) * (ix / SEGS_X), v);
          }
        }
        uv.needsUpdate = true;
        mesh.position.x = (mirror ? -1 : 1) * (w / 2 - ax) / ppu;
      }
      mesh.scale.set(w / ppu, h / ppu * hk, 1);
      frameH = h / ppu * hk;
    }

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
        if (st.wasSeated && a.mode === "walk") { st.wasSeated = false; st.rise = RISE; }
        if (st.rise > 0) { st.rise -= dt; return st.rise > 0; }
        return false;
      },
      update(a, dt, seated, camera) {
        st.t += dt;
        const p = group.position, moved = Math.hypot(p.x - st.px, p.z - st.pz);
        st.px = p.x; st.pz = p.z;
        const walking = a.mode === "walk" && moved > 1e-4 && moved < .5;
        if (walking) st.dist += moved;
        if (seated && !st.wasSeated) st.sit = SIT;
        if (!seated && st.wasSeated && st.rise <= 0) st.rise = RISE;
        st.wasSeated = seated;
        if (st.sit > 0) st.sit -= dt;
        const rising = st.rise > 0 && !seated;
        if (rising && a.mode !== "walk") st.rise -= dt;

        camera.getWorldDirection(_d);
        const camYaw = Math.atan2(-_d.x, -_d.z), elev = Math.asin(Math.min(1, Math.max(0, -_d.y)));
        const hk = Math.min(1.2, 1 / Math.sqrt(Math.max(.3, Math.cos(elev))));
        pivot.rotation.y = camYaw - group.rotation.y;
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
          if (a.mode === "type" || a.act === "typing") bob = Math.abs(Math.sin(st.t * 9)) * .006;
          else if (a.mode === "talk" && a.act === "gesture") bob = Math.abs(Math.sin(st.t * 3)) * .012;
          else breathe = Math.sin(st.t * 1.8) * .005;
        }
        const workingSeat = kind === "sit" && seated && a.lifePose !== "lounge" && !!window.WORK_SEATED_META?.chars[key];
        const [fname, mirror] = workingSeat ? (st.view === "front" || st.view === "back" ? [`work.${st.view}`, false] : ["work.sideR", st.view === "L"]) : pick(kind, st.view, cycle);
        const lifePose = !walking && !rising && window.OFFICE_LIFE_META?.chars[key] && (["lounge", "tea"].includes(a.lifePose) ? a.lifePose : (a.presenting ? "present" : ""));
        setFrame(lifePose ? `life.${lifePose}` : fname, lifePose ? st.view === "L" : mirror, (workingSeat || lifePose ? 1 : hk) * (1 + breathe));
        pivot.position.y = bob + (a.lifeSeatY || 0);
        hideChair((seated || kind === "rise") && lifePose !== "lounge");
        const s = kind === "sit" || kind === "rise" ? 1.08 : walking ? .82 - bob * 2 : .76;
        shadow.scale.set(s, s * .82, 1);
        rig.height = frameH + bob + .1;
      },
    };
    const rig = {
      group, legs: [], arms: [], body: new T.Object3D(), head: new T.Object3D(), cup: new T.Object3D(), props: {},
      preset: { tablet: false, laptop: null, laptopOpen: false, cupAlways: false, pocket: null },
      height: 1.95, sprite, faceStrip: faces(key), frame: () => (curMirror ? `${cur}~` : cur),
      setFace() {},
      dispose() {
        hideChair(false); mats.delete(mat); mats.delete(shadowMat);
        geo.dispose(); mat.dispose(); depthMat.dispose(); shadow.geometry.dispose(); shadowMat.dispose();
      },
    };
    return rig;
  }

  window.SpriteChars = { has, build, faces, theme };
})();
