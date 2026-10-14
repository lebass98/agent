"use strict";
/* characters.js — 정밀 조각(Sculpted Profile & Ribbon Curve) 3D 팀원 캐릭터 및 시트 포즈 엔진.
   docs/characters.md 및 업로드된 3×3 캐릭터 시트(Claude · GPT · Gemini / 소파 착석 · 커피 타임 · 발표 포즈) 기준.
   app.js 의 class Agent 가 Characters.build(def, name) 로 만든 rig 를 움직이며, 기존 rig 계약을 100% 준수한다:
     group            위치·방향(THREE.Group, 원점=발바닥 y=0, +Y 위, +Z 정면)
     legs[L,R]        엉덩이 축(rotation.x 앞뒤 · rotation.z 벌림)      knees[L,R]  무릎 축(rotation.x, + 는 접힘)
     body             엉덩이 축(rotation.x 기울기) → 안에 torso
     arms[L,R]        어깨 축(rotation.x · rotation.z)                   elbows[L,R] 팔꿈치(rotation.x, − 는 앞으로 접힘)
     hands[L,R]       손(Group, 손가락 관절 포함, visible=false 면 주머니에 넣은 손)
     head             목 축(rotation.x · rotation.y)
     cup              손에 든 머그컵/테이크아웃 컵(Group, visible 토글)
     props            { tablet, laptop, laptopOpen, phone } 소품(visible 토글)
     preset           { tablet, laptop:'L'|'R', laptopOpen, cupAlways, pocket:'L'|'R', phone }
     height           이름표를 띄우는 높이
     setFace(expr)    표정 교체: 기본 · 웃음 · 놀람 · 집중 · 생각
     setPose(name, t) 시트 대표 포즈 즉시 적용: stand · lounge(1열 착석) · tea(2열 머그컵) · present(3열 발표) · walk · work
     dispose()        geometry · material · texture 해제 */
(function () {
  const T = window.THREE;
  if (!T) return;
  const SKIN = 0xf4cbb1, SKIN_CSS = "#f4cbb1", SKIN_DEEP = 0xe2af90, NAVY = 0x1d2b5b;
  const EXPR = ["기본", "웃음", "놀람", "집중", "생각"];

  /* ── 캐릭터 시트 3인 정밀 프리셋 ── */
  const PRESETS = {
    claude: {
      gender: "female", targetHeight: 1.72,
      hair: "long", hairColor: 0x3b2314, hairHighlight: 0x52321e, iris: "#4e2f1d", lashes: true, blush: 0.36, lipColor: "#d46a6a",
      top: { kind: "blouse", color: 0xf6f1e6, trim: 0xe8dfd0, button: 0xfdfbf7, rolled: true },
      pants: { color: 0xd7c2a3, crease: 0xc6ae8c, wide: true, highWaist: true, belt: 0x18181c, buckle: 0xc8cdd6 },
      shoes: { color: 0xfafafa, sole: 0xe6e8ec, accent: null },
      props: { tablet: true, cup: "mug", phone: true, pocket: "R" },
    },
    gpt: {
      gender: "male", targetHeight: 1.78,
      hair: "short", hairColor: 0x15161c, hairHighlight: 0x252730, iris: "#27211e", lashes: false, blush: 0.16, lipColor: "#b86b63", glasses: true,
      top: { kind: "sweater", color: 0x181920, trim: 0x23252f, rolled: false },
      pants: { color: 0x2e3038, crease: 0x23252c, wide: false, highWaist: false, belt: null },
      shoes: { color: 0xfafafa, sole: 0xe4e7ec, accent: 0x15161b },
      props: { laptop: "R", laptopOpen: true, pocket: "L", cup: "mug", phone: true },
    },
    gemini: {
      gender: "female", targetHeight: 1.68,
      hair: "bun", hairColor: 0x17151a, hairHighlight: 0x2a242c, iris: "#38241b", lashes: true, blush: 0.36, lipColor: "#d6686b",
      top: { kind: "shirt", color: 0x90b9f8, trim: 0x7aa5ea, button: 0xf8fbff, rolled: true },
      pants: { color: 0x20222a, crease: 0x16181f, wide: true, highWaist: true, belt: null },
      shoes: { color: 0xfafafa, sole: 0xe6e8ec, accent: null },
      props: { cup: "mug", cupAlways: true, laptop: "L", phone: true, pocket: "R" },
    },
  };

  /* 시트에 없는 추가 팀원용 의상실 */
  const WARDROBE = {
    hair: ["short", "bun", "long", "bob"],
    top: [[0xffffff, 0xe6e6e6, "shirt"], [0xdfe9d6, 0xc9d8bd, "shirt"], [0xf6d9dd, 0xe8c3c8, "blouse"], [0x2b3550, 0x3b4668, "sweater"], [0xe9e2d0, 0xd9d0bb, "shirt"]],
    pants: [0x3a3d47, 0xd8c5a6, 0x253050, 0x1d1e26],
  };
  const hashStr = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  function wardrobe(def, key) {
    const h = hashStr(key || "x"), top = WARDROBE.top[(h >>> 2) % WARDROBE.top.length], hair = WARDROBE.hair[h % WARDROBE.hair.length];
    const kind = top[2] || "shirt", fem = hair === "long" || hair === "bun" || hair === "bob";
    return {
      gender: fem ? "female" : "male", targetHeight: fem ? 1.70 : 1.76,
      hair, hairColor: def.hair ?? 0x3b2a22, hairHighlight: 0x523b2f, iris: "#3a2a22", lashes: fem, blush: 0.26, lipColor: fem ? "#d26a6a" : "#b86b63",
      glasses: (h >>> 10) % 3 === 0,
      top: { kind, color: top[0], trim: top[1], button: 0xffffff, rolled: kind !== "sweater" },
      pants: { color: WARDROBE.pants[(h >>> 5) % WARDROBE.pants.length], crease: 0x22242b, wide: (h >>> 7) % 2 === 0, highWaist: fem, belt: (h >>> 8) % 2 ? 0x1a1a1a : null, buckle: 0xc8cdd6 },
      shoes: { color: 0xfafafa, sole: 0xe6e8ec, accent: def.color || null },
      props: { cup: "mug", laptop: (h >>> 9) % 2 ? "L" : "R", phone: true, pocket: "L" },
    };
  }

  /* ── 기하학 조형 헬퍼 (외부 에셋 없이 순수 코드로 정밀 인체·의상·헤어 곡면 생성) ── */

  /** 단면 링 배열을 따라 매끄러운 해부학/의상 곡면 BufferGeometry 생성
      각 ring: { y, rx, rz, z?:0, x?:0, front?:1, back?:1, crease?:0, pleat?:0 } */
  function loftRings(rings, segs = 28, capBottom = true, capTop = true) {
    const pos = [], uvs = [], idx = [];
    const R = rings.length;
    for (let r = 0; r < R; r++) {
      const { y, rx, rz, z = 0, x = 0, front = 1, back = 1, crease = 0, pleat = 0 } = rings[r];
      const v = R > 1 ? r / (R - 1) : 0;
      for (let s = 0; s <= segs; s++) {
        const u = s / segs, a = u * Math.PI * 2;
        const sn = Math.sin(a), cs = Math.cos(a); // cs > 0 이 정면(+Z)
        let px = x + sn * rx;
        let pz = z + cs * rz * (cs >= 0 ? front : back);
        // 바지 앞주름(핀턱) 또는 옷 주름 디테일
        if (crease && cs > 0.55) pz += Math.pow((cs - 0.55) / 0.45, 2) * crease;
        if (pleat) {
          const wave = Math.sin(a * 6) * pleat * (0.4 + 0.6 * Math.abs(cs));
          px += sn * wave; pz += cs * wave;
        }
        pos.push(px, y, pz);
        uvs.push(u, v);
      }
    }
    const stride = segs + 1;
    for (let r = 0; r < R - 1; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * stride + s, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    if (capBottom && rings[0].rx > 1e-4) {
      const cIdx = pos.length / 3;
      pos.push(rings[0].x || 0, rings[0].y, rings[0].z || 0); uvs.push(0.5, 0);
      for (let s = 0; s < segs; s++) idx.push(cIdx, s + 1, s);
    }
    if (capTop && rings[R - 1].rx > 1e-4) {
      const cIdx = pos.length / 3, base = (R - 1) * stride;
      pos.push(rings[R - 1].x || 0, rings[R - 1].y, rings[R - 1].z || 0); uvs.push(0.5, 1);
      for (let s = 0; s < segs; s++) idx.push(cIdx, base + s, base + s + 1);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** 3D Catmull-Rom 곡선을 따라 굵기가 변하는 리본/컬 머리카락·스트랩 메시 생성 */
  function ribbonCurve(points, rStart, rMid, rEnd, tubularSegs = 20, radialSegs = 10, flatZ = 0.62) {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0], p[1], p[2])));
    const frames = curve.computeFrenetFrames(tubularSegs, false);
    const pos = [], uvs = [], idx = [];
    const P = new T.Vector3(), N = new T.Vector3(), B = new T.Vector3();
    for (let i = 0; i <= tubularSegs; i++) {
      const t = i / tubularSegs;
      curve.getPointAt(t, P);
      N.copy(frames.normals[i]);
      B.copy(frames.binormals[i]);
      // 뿌리와 끝은 가늘고 중간은 볼륨감 있게 보간
      const r = t < 0.45
        ? rStart + (rMid - rStart) * Math.sin((t / 0.45) * (Math.PI / 2))
        : rMid + (rEnd - rMid) * (1 - Math.cos(((t - 0.45) / 0.55) * (Math.PI / 2)));
      const rx = Math.max(0.002, r), rz = Math.max(0.002, r * flatZ);
      for (let j = 0; j <= radialSegs; j++) {
        const u = j / radialSegs, a = u * Math.PI * 2;
        const ca = Math.cos(a) * rx, sa = Math.sin(a) * rz;
        pos.push(P.x + N.x * ca + B.x * sa, P.y + N.y * ca + B.y * sa, P.z + N.z * ca + B.z * sa);
        uvs.push(u, t);
      }
    }
    const stride = radialSegs + 1;
    for (let i = 0; i < tubularSegs; i++) {
      for (let j = 0; j < radialSegs; j++) {
        const a = i * stride + j, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** 해부학적 두상(턱선·볼·이마·뒤통수 곡률 반영) BufferGeometry 생성 */
  function sculptHeadGeometry(female = true) {
    const geo = new T.SphereGeometry(0.245, 36, 28);
    const p = geo.attributes.position;
    const v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const ny = v.y / 0.245; // -1(턱끝) ~ +1(정수리)
      let sx = female ? 0.90 : 0.93, sy = 1.06, sz = 0.95;
      // 아래쪽(볼~턱)으로 갈수록 갸름한 V라인/턱선 조형
      if (ny < 0.05) {
        const t = Math.min(1, (0.05 - ny) / 1.05);
        const jawTaper = 1 - t * (female ? 0.42 : 0.34);
        sx *= jawTaper;
        sz *= 1 - t * 0.22;
        if (v.z > 0) v.z += (1 - t) * 0.012 + (t > 0.65 ? 0.014 : 0); // 턱끝 살짝 앞으로
      } else {
        // 이마·두상 윗부분 볼륨
        sx *= 1 - Math.pow(ny, 2) * 0.05;
      }
      // 얼굴 정면(+Z)을 구면보다 살짝 평평하고 자연스러운 안면 곡률로 다듬음
      if (v.z > 0.05 && ny > -0.65 && ny < 0.55) {
        const faceMask = Math.cos(((ny + 0.05) / 0.65) * (Math.PI / 2));
        v.z *= 0.93 + 0.04 * Math.max(0, faceMask);
        // 광대/볼 볼륨
        if (ny > -0.35 && ny < 0.05 && Math.abs(v.x) > 0.06) {
          v.z += 0.012 * Math.cos(((ny + 0.15) / 0.25) * (Math.PI / 2));
        }
      }
      p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /* ── 고해상도(512×512) 얼굴 표현 캔버스 (투명 배경 + 정밀 눈·속눈썹·눈썹·코 음영·입술·홍조) ── */
  function drawFace(c, expr, P) {
    const W = 512, EX = [174, 338], EY = 248;
    const hair = "#" + new T.Color(P.hairColor).getHexString(), line = "#241814";
    c.clearRect(0, 0, W, W);
    c.lineCap = "round"; c.lineJoin = "round";

    // 두상 볼륨에 맞춘 은은한 볼 홍조 그라데이션
    for (const bx of [118, 394]) {
      const grad = c.createRadialGradient(bx, 316, 4, bx, 316, 48);
      grad.addColorStop(0, `rgba(238, 112, 112, ${P.blush})`);
      grad.addColorStop(1, "rgba(238, 112, 112, 0)");
      c.fillStyle = grad;
      c.beginPath(); c.ellipse(bx, 316, 48, 28, 0, 0, Math.PI * 2); c.fill();
    }

    // 눈썹 (결이 살아있는 테이퍼드 브로우)
    c.strokeStyle = hair; c.fillStyle = hair;
    EX.forEach((x, i) => {
      const s = i ? 1 : -1;
      c.lineWidth = P.gender === "male" ? 11 : 8.5;
      c.beginPath();
      if (expr === "놀람") {
        c.moveTo(x - s * 44, 154); c.quadraticCurveTo(x, 122, x + s * 42, 144);
      } else if (expr === "집중") {
        c.moveTo(x - s * 38, 194); c.quadraticCurveTo(x, 180, x + s * 44, 172);
      } else if (expr === "생각" && i === 1) {
        c.moveTo(x - 40, 162); c.quadraticCurveTo(x, 130, x + 42, 152);
      } else {
        c.moveTo(x - s * 44, 178); c.quadraticCurveTo(x - s * 6, 154, x + s * 42, 170);
      }
      c.stroke();
    });

    // 눈 & 쌍꺼풀 & 홍채 & 하이라이트
    EX.forEach((x, i) => {
      const s = i ? 1 : -1;
      // 은은한 쌍꺼풀 라인
      c.strokeStyle = "rgba(120, 72, 52, 0.38)";
      c.lineWidth = 3.5;
      c.beginPath(); c.arc(x, EY - 4, 42, Math.PI + 0.35, Math.PI * 2 - 0.35); c.stroke();

      if (expr === "웃음") {
        c.strokeStyle = line; c.lineWidth = 9.5;
        c.beginPath(); c.moveTo(x - 40, 256); c.quadraticCurveTo(x, 202, x + 40, 256); c.stroke();
        if (P.lashes) {
          c.lineWidth = 6;
          c.beginPath(); c.moveTo(x + s * 34, 248); c.lineTo(x + s * 50, 238); c.stroke();
        }
        return;
      }

      const big = expr === "놀람", rx = big ? 44 : 38, ry = big ? 48 : 42;
      const dx = expr === "생각" ? 10 : 0, dy = expr === "생각" ? -12 : 0;

      // 흰자위(공막) + 윗그림자
      c.save();
      c.beginPath(); c.ellipse(x, EY, rx, ry, 0, 0, Math.PI * 2); c.clip();
      c.fillStyle = "#ffffff"; c.fillRect(x - rx, EY - ry, rx * 2, ry * 2);
      c.fillStyle = "rgba(180, 155, 145, 0.25)"; c.fillRect(x - rx, EY - ry, rx * 2, ry * 0.45);

      // 홍채 그라데이션 & 테두리(Limbal ring)
      const ir = big ? 25 : 27, ix = x + dx, iy = EY + dy + 3;
      c.fillStyle = "#1c130e"; c.beginPath(); c.arc(ix, iy, ir + 2, 0, Math.PI * 2); c.fill();
      const ig = c.createRadialGradient(ix, iy + 6, 4, ix, iy, ir);
      ig.addColorStop(0, "#7a4e35");
      ig.addColorStop(0.65, P.iris);
      ig.addColorStop(1, "#1e140f");
      c.fillStyle = ig; c.beginPath(); c.arc(ix, iy, ir, 0, Math.PI * 2); c.fill();

      // 동공
      c.fillStyle = "#110d0b"; c.beginPath(); c.arc(ix, iy, big ? 12 : 13.5, 0, Math.PI * 2); c.fill();
      // 듀얼 캐치라이트(눈망울 반사광)
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(ix - 10, iy - 10, 8.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(ix + 9, iy + 10, 4.5, 0, Math.PI * 2); c.fill();

      // 집중 표정 반쯤 감긴 눈꺼풀
      if (expr === "집중") {
        c.fillStyle = SKIN_CSS;
        c.fillRect(x - rx - 4, EY - ry - 4, rx * 2 + 8, ry * 0.72);
      }
      c.restore();

      // 윗 아이라인 & 속눈썹
      c.strokeStyle = line; c.lineWidth = P.lashes ? 8.5 : 7;
      c.beginPath();
      if (expr === "집중") {
        c.moveTo(x - rx, EY - 10); c.quadraticCurveTo(x, EY - 20, x + rx, EY - 10);
      } else {
        c.ellipse(x, EY, rx, ry, 0, Math.PI + 0.2, Math.PI * 2 - 0.2);
      }
      c.stroke();

      // 언더라인 음영
      c.strokeStyle = "rgba(110, 68, 52, 0.35)"; c.lineWidth = 3.5;
      c.beginPath(); c.ellipse(x, EY, rx * 0.88, ry * 0.92, 0, 0.35, Math.PI - 0.35); c.stroke();

      if (P.lashes && expr !== "집중") {
        c.strokeStyle = line; c.lineWidth = 6;
        c.beginPath();
        c.moveTo(x + s * (rx - 5), EY - ry * 0.62); c.lineTo(x + s * (rx + 13), EY - ry * 0.82);
        c.moveTo(x + s * (rx - 1), EY - ry * 0.35); c.lineTo(x + s * (rx + 16), EY - ry * 0.48);
        c.stroke();
      }
    });

    // 코 음영 하이라이트 (입체 코 메시와 자연스럽게 어우러짐)
    c.strokeStyle = "rgba(145, 82, 58, 0.42)"; c.lineWidth = 4.5;
    c.beginPath(); c.arc(254, 300, 10, 0.25, 1.75); c.stroke();

    // 입술 & 표정별 입 모양
    const lip = P.lipColor || "#c86464";
    c.strokeStyle = "#8e4339"; c.fillStyle = "#7a352e"; c.lineWidth = 7.5;
    if (expr === "웃음") {
      c.beginPath(); c.moveTo(202, 336); c.quadraticCurveTo(256, 408, 310, 336); c.closePath(); c.fill();
      c.save(); c.clip();
      c.fillStyle = "#ffffff"; c.fillRect(202, 334, 108, 18);
      c.fillStyle = "#e57b84"; c.beginPath(); c.ellipse(256, 388, 28, 16, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      c.strokeStyle = lip; c.lineWidth = 6.5;
      c.beginPath(); c.moveTo(202, 336); c.quadraticCurveTo(256, 408, 310, 336); c.stroke();
    } else if (expr === "놀람") {
      c.beginPath(); c.ellipse(256, 360, 18, 24, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#e07a86"; c.beginPath(); c.ellipse(256, 372, 11, 8, 0, 0, Math.PI * 2); c.fill();
    } else if (expr === "집중") {
      c.fillStyle = lip;
      c.beginPath(); c.ellipse(256, 352, 26, 7, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#8a3f36"; c.lineWidth = 5.5;
      c.beginPath(); c.moveTo(226, 352); c.quadraticCurveTo(256, 355, 286, 352); c.stroke();
    } else if (expr === "생각") {
      c.fillStyle = lip;
      c.beginPath(); c.ellipse(264, 354, 14, 9, 0, 0, Math.PI * 2); c.fill();
    } else {
      // 기본: 윗입술·아랫입술 볼륨과 부드러운 미소 입꼬리
      c.fillStyle = lip;
      c.beginPath();
      c.moveTo(214, 346);
      c.quadraticCurveTo(242, 338, 256, 343);
      c.quadraticCurveTo(270, 338, 298, 346);
      c.quadraticCurveTo(256, 376, 214, 346);
      c.fill();
      c.strokeStyle = "#8c3d35"; c.lineWidth = 5.5;
      c.beginPath(); c.moveTo(212, 345); c.quadraticCurveTo(256, 366, 300, 345); c.stroke();
    }
  }

  /* ── 시트 3×3 대표 포즈 프리셋 정의 ──
     1열(lounge): 앉아서 무릎 위에 두 손 포개고 오른쪽 위를 보며 미소
     2열(tea): 발목 교차해 서서 한 손은 주머니, 다른 손은 흰 머그컵을 든 자세
     3열(present): 스마트폰을 한 손에 들고 다른 팔을 뻗어 손바닥을 보이며 발표하는 자세 */
  const POSES = {
    stand: () => ({
      y: 0, lean: 0, bodyY: 0, bodyZ: 0,
      legL: 0, legR: 0, legLz: -0.025, legRz: 0.025, legLy: 0, legRy: 0, kneeL: 0.02, kneeR: 0.02,
      armL: -0.06, armR: -0.06, armLz: 0.07, armRz: -0.07, armLy: 0, armRy: 0, elbL: -0.18, elbR: -0.18,
      wristL: [0, 0, 0], wristR: [0, 0, 0],
      headX: -0.02, headY: 0, headZ: 0,
      cup: false, phone: false, pocketL: false, pocketR: false, expr: "기본",
    }),
    lounge: () => ({
      // 1열: 소파/의자 착석, 무릎을 살짝 오른쪽으로 모아 앉고 두 손을 무릎 위에 포갠 자세
      y: -0.37, lean: 0.13, bodyY: 0.14, bodyZ: -0.02,
      legL: -1.36, legR: -1.38, legLz: 0.04, legRz: -0.03, legLy: -0.12, legRy: -0.14, kneeL: 1.28, kneeR: 1.34,
      armL: -0.78, armR: -0.82, armLz: -0.28, armRz: 0.28, armLy: 0.22, armRy: -0.22, elbL: -0.92, elbR: -0.96,
      wristL: [0.15, 0.35, -0.2], wristR: [0.15, -0.35, 0.2],
      headX: -0.13, headY: 0.32, headZ: -0.05,
      cup: false, phone: false, pocketL: false, pocketR: false, expr: "웃음",
    }),
    tea: key => {
      // 2열: 다리 교차해 서서 한 손은 바지 주머니, 다른 손은 가슴 앞에서 흰 머그컵을 든 자세
      const gpt = key === "gpt";
      return {
        y: -0.01, lean: -0.03, bodyY: 0.16, bodyZ: 0.02,
        legL: 0.05, legR: -0.22, legLz: -0.05, legRz: 0.18, legLy: 0.05, legRy: -0.12, kneeL: 0.03, kneeR: 0.32,
        armL: gpt ? -0.45 : 0.08, armR: gpt ? 0.08 : -0.48,
        armLz: gpt ? -0.18 : 0.11, armRz: gpt ? -0.11 : 0.18,
        armLy: gpt ? 0.25 : 0, armRy: gpt ? 0 : -0.25,
        elbL: gpt ? -1.42 : -0.12, elbR: gpt ? -0.12 : -1.45,
        wristL: [0, 0, 0], wristR: [0, 0, 0],
        headX: -0.04, headY: 0.26, headZ: -0.03,
        cup: true, cupHand: gpt ? "L" : "R", phone: false,
        pocketL: !gpt, pocketR: gpt, expr: "기본",
      };
    },
    present: () => ({
      // 3열: 오른손(화면 왼쪽)에 스마트폰을 들고, 왼팔(화면 오른쪽)을 옆·위로 뻗어 안내/발표하는 자세
      y: 0, lean: -0.02, bodyY: 0.18, bodyZ: 0,
      legL: 0.04, legR: -0.11, legLz: -0.06, legRz: 0.09, legLy: 0.04, legRy: -0.14, kneeL: 0.02, kneeR: 0.12,
      armL: -0.46, armR: -0.78,
      armLz: -0.32, armRz: -0.68,
      armLy: 0.18, armRy: -0.25,
      elbL: -1.42, elbR: -0.82,
      wristL: [-0.25, 0.3, 0], wristR: [-0.35, -0.45, 0.45],
      headX: -0.04, headY: 0.28, headZ: -0.03,
      cup: false, phone: true, pocketL: false, pocketR: false, expr: "웃음",
    }),
    work: () => ({
      y: -0.42, lean: 0.08, bodyY: 0, bodyZ: 0,
      legL: -1.45, legR: -1.45, legLz: -0.04, legRz: 0.04, legLy: 0, legRy: 0, kneeL: 1.45, kneeR: 1.45,
      armL: -1.08, armR: -1.08, armLz: 0.10, armRz: -0.10, armLy: 0, armRy: 0, elbL: -1.15, elbR: -1.15,
      wristL: [0, 0, 0], wristR: [0, 0, 0],
      headX: 0.16, headY: 0, headZ: 0,
      cup: false, phone: false, pocketL: false, pocketR: false, expr: "집중",
    }),
  };

  /* ── 메인 캐릭터 빌더 ── */
  function build(def, name) {
    const key = String(name || "").toLowerCase();
    const P = Object.hasOwn(PRESETS, key) ? PRESETS[key] : wardrobe(def || {}, key);
    const fem = P.gender === "female";
    const pool = [], texs = [];
    const G = g => (pool.push(g), g);
    const M = (color, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.04 }, o)); pool.push(m); return m; };
    const add = (geo, m, x, y, z, parent, shadow = true, meshName = "") => {
      const o = new T.Mesh(geo, m);
      o.position.set(x, y, z);
      if (meshName) o.name = meshName;
      o.castShadow = o.receiveShadow = shadow;
      parent.add(o);
      return o;
    };
    const grp = (x, y, z, parent, gName = "") => {
      const g = new T.Group();
      g.position.set(x, y, z);
      if (gName) g.name = gName;
      parent.add(g);
      return g;
    };
    const SPH = G(new T.SphereGeometry(1, 20, 16));
    const ell = (rx, ry, rz, m, x, y, z, parent, shadow = true) => {
      const o = add(SPH, m, x, y, z, parent, shadow);
      o.scale.set(rx, ry, rz);
      return o;
    };
    const cylG = (rt, rb, h, seg = 18) => G(new T.CylinderGeometry(rt, rb, h, seg));
    const boxG = (w, h, d) => G(new T.BoxGeometry(w, h, d));
    const torG = (r, tube, seg = 22) => G(new T.TorusGeometry(r, tube, 10, seg));
    const rBoxG = (w, h, d, r) => G(window.ModelKit ? window.ModelKit.roundedBox(w, h, d, r) : new T.BoxGeometry(w, h, d));

    const sweater = P.top.kind === "sweater";
    const mats = {
      skin: M(SKIN, { roughness: 0.72 }),
      skinShade: M(SKIN_DEEP, { roughness: 0.75 }),
      hair: M(P.hairColor, { roughness: 0.54, metalness: 0.08, side: T.DoubleSide }),
      hairHi: M(P.hairHighlight || P.hairColor, { roughness: 0.48, metalness: 0.1, side: T.DoubleSide }),
      top: M(P.top.color, { roughness: sweater ? 0.92 : 0.74 }),
      trim: M(P.top.trim, { roughness: sweater ? 0.94 : 0.76 }),
      button: M(P.top.button || 0xffffff, { roughness: 0.35, metalness: 0.1 }),
      pants: M(P.pants.color, { roughness: 0.82 }),
      crease: M(P.pants.crease || P.pants.color, { roughness: 0.85 }),
      belt: M(P.pants.belt ?? 0x18181c, { roughness: 0.42, metalness: 0.18 }),
      buckle: M(P.pants.buckle ?? 0xc8cdd6, { roughness: 0.25, metalness: 0.75 }),
      shoe: M(P.shoes.color, { roughness: 0.52 }),
      sole: M(P.shoes.sole || 0xe4e7ec, { roughness: 0.78 }),
      acc: M(P.shoes.accent ?? 0xd9dde3, { roughness: 0.45 }),
      navy: M(NAVY, { roughness: 0.65 }),
      white: M(0xffffff, { roughness: 0.42 }),
      dark: M(0x181b24, { roughness: 0.45 }),
      metal: M(0xb4bac4, { roughness: 0.32, metalness: 0.65 }),
      gray: M(0x888f9a, { roughness: 0.48, metalness: 0.25 }),
      screen: M(0x162032, { roughness: 0.2, metalness: 0.15, emissive: 0x0d1b30 }),
      accent: M(def?.color || 0x4f7cf7, { roughness: 0.45 }),
      frame: M(0x16171d, { roughness: 0.28, metalness: 0.25 }),
      lens: M(0xdceeff, { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.18 }),
      coffee: M(0x3b2214, { roughness: 0.25 }),
      lip: M(P.lipColor || "#cc6666", { roughness: 0.55 }),
      eyeWhite: M(0xffffff, { roughness: 0.25 }),
      iris: M(P.iris || "#3b2518", { roughness: 0.2 }),
      pupil: M(0x110e0c, { roughness: 0.1 }),
    };

    const group = new T.Group();

    /* ── 1. 다리(엉덩이 → 허벅지 → 무릎 → 종아리/와이드 슬랙스 주름 → 정밀 스니커즈) ── */
    const legs = [], knees = [];
    const hipSpacing = fem ? 0.102 : 0.112;
    [-hipSpacing, hipSpacing].forEach((x, idx) => {
      const side = idx === 0 ? -1 : 1;
      const hip = grp(x, 0.55, 0, group, idx === 0 ? "legL" : "legR");

      // 허벅지: 와이드 슬랙스는 자연스럽게 아래로 퍼지고, 테이퍼드 슬랙스는 깔끔하게 떨어짐
      const thighGeo = G(loftRings(
        P.pants.wide
          ? [
              { y: -0.285, rx: 0.112, rz: 0.116, z: 0.004, crease: 0.009, pleat: 0.003 },
              { y: -0.19,  rx: 0.110, rz: 0.114, z: 0.005, crease: 0.009, pleat: 0.003 },
              { y: -0.09,  rx: 0.108, rz: 0.112, z: 0.004, crease: 0.008 },
              { y: 0.015,  rx: 0.106, rz: 0.110, z: 0.000, crease: 0.005 },
            ]
          : [
              { y: -0.285, rx: 0.092, rz: 0.096, z: 0.002, crease: 0.005 },
              { y: -0.18,  rx: 0.098, rz: 0.102, z: 0.004, crease: 0.005 },
              { y: -0.08,  rx: 0.104, rz: 0.108, z: 0.003, crease: 0.004 },
              { y: 0.015,  rx: 0.106, rz: 0.110, z: 0.000 },
            ],
        24, true, true
      ));
      add(thighGeo, mats.pants, 0, 0, 0, hip, true, "thigh");

      // 바지 옆주머니 재봉선 디테일
      const pocketSeam = G(ribbonCurve([
        [side * 0.096, -0.01, 0.045],
        [side * 0.106, -0.06, 0.025],
        [side * 0.108, -0.12, 0.002],
      ], 0.004, 0.004, 0.003, 8, 6, 0.6));
      add(pocketSeam, mats.crease, 0, 0, 0, hip, false);

      // 무릎 관절 구체(앉을 때 틈이 보이지 않게)
      ell(P.pants.wide ? 0.106 : 0.090, 0.055, P.pants.wide ? 0.108 : 0.092, mats.pants, 0, -0.28, 0.003, hip);

      const knee = grp(0, -0.28, 0, hip, idx === 0 ? "kneeL" : "kneeR");

      // 정강이/종아리 & 바지 밑단(와이드 슬랙스는 발목까지 넉넉한 플레어 + 핀턱 주름, 테이퍼드는 발목으로 좁아짐)
      const calfGeo = G(loftRings(
        P.pants.wide
          ? [
              { y: -0.222, rx: 0.126, rz: 0.132, z: 0.014, crease: 0.010, pleat: 0.004 },
              { y: -0.215, rx: 0.132, rz: 0.138, z: 0.014, crease: 0.011, pleat: 0.005 },
              { y: -0.14,  rx: 0.122, rz: 0.128, z: 0.008, crease: 0.010, pleat: 0.004 },
              { y: -0.06,  rx: 0.114, rz: 0.120, z: 0.004, crease: 0.009, pleat: 0.003 },
              { y: 0.005,  rx: 0.108, rz: 0.114, z: 0.002, crease: 0.008 },
            ]
          : [
              { y: -0.210, rx: 0.084, rz: 0.090, z: 0.006, crease: 0.004 },
              { y: -0.14,  rx: 0.090, rz: 0.096, z: 0.002, crease: 0.005 },
              { y: -0.07,  rx: 0.094, rz: 0.100, z: -0.004, crease: 0.005 },
              { y: 0.005,  rx: 0.091, rz: 0.095, z: 0.000, crease: 0.004 },
            ],
        24, true, true
      ));
      add(calfGeo, mats.pants, 0, 0, 0, knee, true, "calf");

      // 발목/양말(앉거나 걸을 때 바지 밑단 아래로 자연스럽게 연결)
      add(cylG(0.052, 0.055, 0.06, 14), mats.white, 0, -0.215, 0.005, knee, false);

      /* ── 정밀 3D 스니커즈 (바닥 y = -0.2705 기준) ── */
      const shoe = grp(0, 0, 0, knee, "sneaker");
      // 1) 아웃솔 & 미드솔 (둥근 앞코와 뒷굽을 갖춘 입체 컵솔)
      const soleGeo = G(loftRings([
        { y: -0.2705, rx: 0.074, rz: 0.132, z: 0.044, front: 1.04, back: 0.92 },
        { y: -0.262,  rx: 0.077, rz: 0.136, z: 0.044, front: 1.05, back: 0.94 },
        { y: -0.246,  rx: 0.075, rz: 0.134, z: 0.043, front: 1.04, back: 0.93 },
      ], 24, true, true));
      add(soleGeo, mats.sole, 0, 0, 0, shoe, true, "sole");

      // 2) 스니커즈 갑피(어퍼: 발등·앞코·발목 칼라)
      const upperGeo = G(loftRings([
        { y: -0.247, rx: 0.073, rz: 0.130, z: 0.043, front: 1.03, back: 0.92 },
        { y: -0.228, rx: 0.070, rz: 0.122, z: 0.038, front: 1.00, back: 0.88 },
        { y: -0.212, rx: 0.062, rz: 0.088, z: 0.012, front: 0.82, back: 0.92 },
      ], 24, false, true));
      add(upperGeo, mats.shoe, 0, 0, 0, shoe, true, "shoeUpper");

      // 3) 설포(운동화 혀) & 발등 운동화 끈 3줄
      add(rBoxG(0.068, 0.022, 0.055, 0.006), mats.shoe, 0, -0.208, 0.048, shoe, false).rotation.x = 0.42;
      for (let l = 0; l < 3; l++) {
        add(rBoxG(0.066, 0.007, 0.012, 0.003), mats.white, 0, -0.214 - l * 0.006, 0.056 + l * 0.018, shoe, false).rotation.x = 0.45;
      }

      // 4) GPT 전용: 시트 2행과 동일한 검은색 측면 스우시/스트라이프 & 힐탭 포인트
      if (P.shoes.accent != null) {
        for (const s of [-1, 1]) {
          const swoosh = G(ribbonCurve([
            [s * 0.071, -0.224, 0.068],
            [s * 0.074, -0.236, 0.036],
            [s * 0.072, -0.222, -0.012],
            [s * 0.066, -0.216, -0.048],
          ], 0.005, 0.011, 0.006, 12, 8, 0.35));
          add(swoosh, mats.acc, 0, 0, 0, shoe, false, "shoeSwoosh");
        }
        // 검은 힐탭
        add(rBoxG(0.064, 0.018, 0.016, 0.004), mats.acc, 0, -0.214, -0.064, shoe, false);
      }

      legs.push(hip);
      knees.push(knee);
    });

    /* ── 2. 몸통(body 엉덩이 축 → torso: 골반·허리·벨트·가슴·어깨·칼라·단추·사원증) ── */
    const body = grp(0, 0.55, 0, group, "body");
    const torso = grp(0, -0.55, 0, body, "torso");

    // 골반~바지 허리단 (하이웨이스트 여부에 따라 허리선 높이 차등)
    const waistTopY = P.pants.highWaist ? 0.865 : 0.825;
    const pelvisGeo = G(loftRings([
      { y: 0.50, rx: fem ? 0.218 : 0.215, rz: 0.145, z: -0.004, crease: P.pants.wide ? 0.006 : 0 },
      { y: 0.58, rx: fem ? 0.248 : 0.236, rz: 0.176, z: -0.006, back: 1.08, crease: P.pants.wide ? 0.008 : 0, pleat: P.pants.wide ? 0.004 : 0 },
      { y: 0.70, rx: fem ? 0.242 : 0.234, rz: 0.172, z: -0.004, back: 1.05, crease: P.pants.wide ? 0.007 : 0, pleat: P.pants.wide ? 0.004 : 0 },
      { y: waistTopY, rx: fem ? 0.212 : 0.228, rz: fem ? 0.152 : 0.166, z: 0.000, pleat: P.pants.wide ? 0.003 : 0 },
    ], 28, true, true));
    add(pelvisGeo, mats.pants, 0, 0, 0, torso, true, "pelvis");

    // 벨트 & 메탈 버클 & 벨트 루프 (Claude 베이지 슬랙스 + 검은 가죽 벨트)
    if (P.pants.belt != null) {
      const beltY = waistTopY - 0.018;
      const beltGeo = G(loftRings([
        { y: beltY - 0.022, rx: 0.218, rz: 0.157, z: 0.001 },
        { y: beltY + 0.022, rx: 0.216, rz: 0.156, z: 0.001 },
      ], 28, false, false));
      add(beltGeo, mats.belt, 0, 0, 0, torso, false, "belt");
      // 실버 프레임 버클 & 가죽 끝단
      add(rBoxG(0.056, 0.048, 0.018, 0.004), mats.buckle, 0, beltY, 0.158, torso, false);
      add(rBoxG(0.038, 0.032, 0.020, 0.003), mats.belt, 0, beltY, 0.159, torso, false);
      add(rBoxG(0.022, 0.006, 0.022, 0.002), mats.buckle, -0.008, beltY, 0.161, torso, false);
      // 벨트 고리(루프) 5개
      for (const a of [-0.55, 0.55, -1.35, 1.35, Math.PI]) {
        const lx = Math.sin(a) * 0.217, lz = Math.cos(a) * 0.156;
        const loop = add(rBoxG(0.014, 0.050, 0.014, 0.003), mats.pants, lx, beltY, lz, torso, false);
        loop.rotation.y = a;
      }
    }

    // 상의 토르소 (여성 블라우스/셔츠는 허리 턱인 볼륨과 가슴 라인, 남성 스웨터는 자연스러운 드레이프와 시보리 밑단)
    const topGeo = G(loftRings(
      fem
        ? [
            { y: waistTopY - 0.005, rx: 0.210, rz: 0.150, z: 0.001 },
            { y: 0.89, rx: 0.224, rz: 0.164, z: 0.006, pleat: 0.004 }, // 셔츠 턱인 자연스러운 주름
            { y: 0.98, rx: 0.236, rz: 0.184, z: 0.014, front: 1.12, back: 0.94 }, // 가슴 볼륨
            { y: 1.07, rx: 0.242, rz: 0.176, z: 0.008, front: 1.08, back: 0.95 },
            { y: 1.15, rx: 0.248, rz: 0.152, z: 0.000 }, // 어깨 연결부
            { y: 1.195, rx: 0.145, rz: 0.112, z: -0.004 }, // 승모근/목 밑단
          ]
        : [
            { y: 0.79, rx: 0.234, rz: 0.172, z: 0.002 }, // 스웨터 시보리 하단
            { y: 0.83, rx: 0.242, rz: 0.178, z: 0.004 },
            { y: 0.95, rx: 0.252, rz: 0.184, z: 0.006, front: 1.04 },
            { y: 1.07, rx: 0.268, rz: 0.186, z: 0.004, front: 1.04 },
            { y: 1.15, rx: 0.272, rz: 0.164, z: 0.000 },
            { y: 1.195, rx: 0.155, rz: 0.120, z: -0.004 },
          ],
      28, true, true
    ));
    add(topGeo, mats.top, 0, 0, 0, torso, true, "topTorso");

    if (!sweater) {
      // 셔츠/블라우스 오픈 V넥 목 피부 노출부
      const vNeck = add(cylG(0.075, 0.025, 0.11, 16), mats.skin, 0, 1.165, 0.058, torso, false);
      vNeck.scale.set(0.95, 1, 0.85);
      vNeck.rotation.x = 0.35;

      // 입체 셔츠 칼라(깃): 뒷깃 스탠드 + 좌우 오픈 라펠 깃
      const backCollar = G(ribbonCurve([
        [-0.088, 1.185, 0.045],
        [-0.095, 1.215, -0.02],
        [0.000, 1.222, -0.088],
        [0.095, 1.215, -0.02],
        [0.088, 1.185, 0.045],
      ], 0.018, 0.022, 0.018, 16, 8, 0.45));
      add(backCollar, mats.top, 0, 0, 0, torso, false, "collarBack");

      for (const s of [-1, 1]) {
        const lapel = add(rBoxG(0.085, 0.018, 0.115, 0.005), mats.top, s * 0.068, 1.178, 0.092, torso, false);
        lapel.rotation.set(0.48, s * 0.32, -s * 0.48);
      }

      // 앞 중심 플래킷(단추 여밈 단) & 진주빛 단추
      const placket = add(rBoxG(0.034, 0.25, 0.014, 0.004), mats.trim, 0, 0.995, 0.184, torso, false);
      placket.rotation.x = -0.04;
      for (const by of [1.09, 1.02, 0.95, 0.89]) {
        add(cylG(0.011, 0.011, 0.008, 12), mats.button, 0, by, 0.192, torso, false).rotation.x = Math.PI / 2;
      }
    } else {
      // GPT 크루넥 스웨터: 입체 골지(시보리) 넥라인 & 허리 시보리 밴드
      const crewNeck = add(torG(0.098, 0.022, 24), mats.trim, 0, 1.192, 0.012, torso, false);
      crewNeck.rotation.x = Math.PI / 2 + 0.16;
      crewNeck.scale.set(1.06, 0.88, 1);
      const waistRib = G(loftRings([
        { y: 0.782, rx: 0.233, rz: 0.171, z: 0.002 },
        { y: 0.828, rx: 0.243, rz: 0.179, z: 0.004 },
      ], 28, false, false));
      add(waistRib, mats.trim, 0, 0, 0, torso, false, "sweaterRib");
    }

    /* ── 공통 소품: 네이비 목걸이 줄(Lanyard) + 메탈 클립 + 사원증 ── */
    const zFront = fem ? 0.194 : 0.190;
    const lanyardGeo = G(ribbonCurve([
      [0.000, 1.015, zFront + 0.012],
      [-0.058, 1.095, zFront - 0.006],
      [-0.096, 1.185, 0.055],
      [-0.088, 1.220, -0.055],
      [0.000, 1.226, -0.092],
      [0.088, 1.220, -0.055],
      [0.096, 1.185, 0.055],
      [0.058, 1.095, zFront - 0.006],
      [0.000, 1.015, zFront + 0.012],
    ], 0.011, 0.012, 0.011, 32, 8, 0.42));
    add(lanyardGeo, mats.navy, 0, 0, 0, torso, false, "lanyard");

    // 사원증 메탈 클립 & 흰색 배지 케이스
    add(cylG(0.008, 0.008, 0.022, 10), mats.metal, 0, 1.002, zFront + 0.014, torso, false);
    const badge = grp(0, 0.928, zFront + 0.016, torso, "idBadge");
    badge.rotation.x = -0.05;
    add(rBoxG(0.092, 0.126, 0.010, 0.004), mats.white, 0, 0, 0, badge, false);
    add(rBoxG(0.032, 0.012, 0.012, 0.002), mats.dark, 0, 0.050, 0.001, badge, false); // 스트랩 홀
    add(rBoxG(0.078, 0.016, 0.012, 0.002), mats.accent, 0, 0.030, 0.001, badge, false); // 팀 컬러 헤더
    add(rBoxG(0.034, 0.040, 0.012, 0.002), mats.gray, -0.018, -0.008, 0.001, badge, false); // 사진 칸
    add(rBoxG(0.032, 0.008, 0.012, 0.001), mats.dark, 0.020, 0.002, 0.001, badge, false); // 이름 줄
    add(rBoxG(0.028, 0.006, 0.012, 0.001), mats.gray, 0.018, -0.012, 0.001, badge, false);

    /* ── 3. 팔 & 손가락 관절 (어깨 → 윗팔·소매 롤업 → 팔꿈치 → 전완 → 손목·손바닥·5손가락) ── */
    const arms = [], elbows = [], hands = [], wrists = [];
    const shX = fem ? 0.285 : 0.308;
    [-shX, shX].forEach((x, idx) => {
      const side = idx === 0 ? -1 : 1;
      const sh = grp(x, 1.125, 0, torso, idx === 0 ? "armL" : "armR");

      // 어깨 캡 & 윗팔 소매 (자연스러운 주름과 롤업 커프스)
      ell(0.076, 0.078, 0.074, mats.top, -side * 0.012, 0.005, 0, sh);
      const upperArmGeo = G(loftRings([
        { y: -0.255, rx: 0.060, rz: 0.060, pleat: 0.002 },
        { y: -0.14,  rx: 0.063, rz: 0.063, pleat: 0.002 },
        { y: -0.02,  rx: 0.068, rz: 0.068 },
      ], 18, true, true));
      add(upperArmGeo, mats.top, 0, 0, 0, sh, true, "upperSleeve");

      if (P.top.rolled) {
        // 팔꿈치 위쪽으로 자연스럽게 걷어 올린 이중 롤업 소매 커프스
        const cuffGeo = G(loftRings([
          { y: -0.278, rx: 0.064, rz: 0.064 },
          { y: -0.252, rx: 0.068, rz: 0.068, pleat: 0.003 },
          { y: -0.226, rx: 0.065, rz: 0.065 },
        ], 18, true, true));
        add(cuffGeo, mats.trim, 0, 0, 0, sh, false, "rolledCuff");
      }

      const elb = grp(0, -0.27, 0, sh, idx === 0 ? "elbowL" : "elbowR");
      ell(0.052, 0.052, 0.052, sweater ? mats.top : mats.skin, 0, 0, 0, elb);

      if (sweater) {
        // GPT 스웨터: 아랫팔 중간까지 살짝 걷어 올린 소매 + 골지 시보리 + 손목 피부 노출
        const sweaterForeGeo = G(loftRings([
          { y: -0.165, rx: 0.054, rz: 0.054, pleat: 0.002 },
          { y: -0.08,  rx: 0.058, rz: 0.058, pleat: 0.002 },
          { y: 0.00,   rx: 0.058, rz: 0.058 },
        ], 18, true, true));
        add(sweaterForeGeo, mats.top, 0, 0, 0, elb, true);
        add(torG(0.050, 0.012, 16), mats.trim, 0, -0.17, 0, elb, false).rotation.x = Math.PI / 2;
        const wristSkinGeo = G(loftRings([
          { y: -0.245, rx: 0.039, rz: 0.034 },
          { y: -0.17,  rx: 0.046, rz: 0.044 },
        ], 16, true, false));
        add(wristSkinGeo, mats.skin, 0, 0, 0, elb, true);
      } else {
        // 셔츠 롤업 시 매끄럽게 좁아지는 전완(아랫팔) 피부 라인
        const forearmGeo = G(loftRings([
          { y: -0.245, rx: 0.038, rz: 0.033 },
          { y: -0.16,  rx: 0.046, rz: 0.043 },
          { y: -0.07,  rx: 0.053, rz: 0.051 },
          { y: 0.00,   rx: 0.052, rz: 0.050 },
        ], 16, true, true));
        add(forearmGeo, mats.skin, 0, 0, 0, elb, true, "forearm");
      }

      /* ── 정밀 손바닥 & 5손가락(엄지 + 검지·중지·약지·소지) ── */
      const hand = grp(0, -0.252, 0, elb, idx === 0 ? "handL" : "handR");
      const wrist = grp(0, 0, 0, hand, "wrist");
      // 손바닥
      const palm = add(rBoxG(0.058, 0.062, 0.028, 0.010), mats.skin, 0, -0.028, 0.004, wrist, true, "palm");
      palm.scale.set(1, 1, 0.92);
      // 엄지손가락 (안쪽/앞쪽으로 자연스럽게 굽은 관절)
      const thumb = grp(-side * 0.028, -0.022, 0.012, wrist, "thumb");
      thumb.rotation.set(0.35, side * 0.35, -side * 0.48);
      add(cylG(0.010, 0.009, 0.026, 8), mats.skin, 0, -0.012, 0, thumb, false);
      const thumbTip = add(cylG(0.009, 0.007, 0.020, 8), mats.skin, 0, -0.028, 0.004, thumb, false);
      thumbTip.rotation.x = -0.28;
      // 4손가락 (검지·중지·약지·소지 길이 차등 및 자연스러운 곡률)
      const fingerLens = [0.042, 0.046, 0.043, 0.035];
      [-0.020, -0.007, 0.007, 0.020].forEach((fx, fi) => {
        const fIdx = side < 0 ? fi : 3 - fi;
        const fl = fingerLens[fIdx];
        const fg = grp(fx, -0.056, 0.005, wrist);
        fg.rotation.x = -0.22 - fIdx * 0.04;
        add(cylG(0.0085, 0.0072, fl * 0.58, 8), mats.skin, 0, -fl * 0.28, 0, fg, false);
        const fTip = grp(0, -fl * 0.55, 0, fg);
        fTip.rotation.x = -0.28;
        add(cylG(0.0072, 0.0058, fl * 0.46, 8), mats.skin, 0, -fl * 0.22, 0, fTip, false);
        ell(0.0058, 0.0058, 0.0058, mats.skin, 0, -fl * 0.45, 0, fTip, false);
      });

      arms.push(sh);
      elbows.push(elb);
      hands.push(hand);
      wrists.push(wrist);
    });

    /* ── 손에 드는 소품 1: 흰색 세라믹 머그컵 (`cup`) ── */
    const cup = grp(0, -0.032, 0.058, hands[1], "cup");
    if (P.props.cup === "takeaway") {
      add(cylG(0.056, 0.044, 0.155, 18), mats.white, 0, 0, 0, cup);
      add(cylG(0.059, 0.052, 0.062, 18), M(0x9c6b3f), 0, -0.008, 0, cup);
      add(cylG(0.060, 0.060, 0.020, 18), M(0xe8e8ea), 0, 0.084, 0, cup);
    } else {
      // 시트 2열과 동일한 깔끔한 화이트 세라믹 머그컵 + 커피 수면 + 손잡이
      add(cylG(0.054, 0.050, 0.128, 20), mats.white, 0, 0, 0, cup);
      add(cylG(0.047, 0.047, 0.006, 18), mats.coffee, 0, 0.058, 0, cup, false);
      const handle = add(torG(0.032, 0.0085, 16), mats.white, -0.054, 0, 0, cup, false);
      handle.rotation.y = Math.PI / 2;
    }
    cup.visible = false;

    /* ── 4. 머리(목 축 → 목·쇄골 → 해부학 두상 → 입체 코·귀·3D 눈/입 베이스 → 512px 얼굴 텍스처 → 헤어 → 안경) ── */
    const head = grp(0, 1.185, 0, torso, "head");

    // 목 & 승모근 연결
    const neckGeo = G(loftRings([
      { y: -0.01, rx: fem ? 0.072 : 0.080, rz: fem ? 0.068 : 0.076, z: -0.004 },
      { y: 0.05,  rx: fem ? 0.064 : 0.072, rz: fem ? 0.062 : 0.070, z: 0.002 },
      { y: 0.12,  rx: fem ? 0.066 : 0.074, rz: fem ? 0.064 : 0.072, z: 0.006 },
    ], 18, false, false));
    add(neckGeo, mats.skin, 0, 0, 0, head, true, "neck");

    // 정밀 조형 두상
    const headGeo = G(sculptHeadGeometry(fem));
    add(headGeo, mats.skin, 0, 0.28, 0, head, true, "headMesh");

    // 입체 콧대 & 코끝 (정면과 측면 실루엣 모두 자연스럽게)
    const noseBridge = G(ribbonCurve([
      [0, 0.295, 0.222],
      [0, 0.262, 0.242],
      [0, 0.246, 0.248],
      [0, 0.238, 0.232],
    ], 0.009, 0.015, 0.011, 10, 8, 0.85));
    add(noseBridge, mats.skin, 0, 0, 0, head, false, "nose");

    // 입체 귀 (귓바퀴 + 귓불)
    for (const s of [-1, 1]) {
      const ear = grp(s * (fem ? 0.220 : 0.228), 0.272, -0.008, head, "ear");
      ear.rotation.y = -s * 0.22;
      ear.rotation.z = -s * 0.08;
      ell(0.024, 0.046, 0.032, mats.skin, 0, 0, 0, ear);
      ell(0.016, 0.030, 0.020, mats.skinShade, -s * 0.004, 0.002, 0.006, ear, false);
    }

    // OBJ 내보내기(캔버스 텍스처 미포함 뷰어)에서도 눈·눈썹·입이 뚜렷하게 보이도록 두상 표면에 미세 3D 이목구비 배치
    for (const s of [-1, 1]) {
      const ex = s * 0.076, ey = 0.286, ez = 0.214;
      ell(0.028, 0.026, 0.012, mats.eyeWhite, ex, ey, ez, head, false);
      ell(0.018, 0.019, 0.010, mats.iris, ex, ey - 0.002, ez + 0.006, head, false);
      ell(0.009, 0.010, 0.008, mats.pupil, ex, ey - 0.002, ez + 0.010, head, false);
      ell(0.004, 0.004, 0.005, mats.white, ex - 0.006, ey + 0.005, ez + 0.014, head, false);
      const brow = add(rBoxG(0.056, 0.009, 0.010, 0.003), mats.hair, ex, ey + 0.048, ez - 0.002, head, false);
      brow.rotation.z = -s * 0.08;
    }
    const mouth3d = add(rBoxG(0.054, 0.012, 0.012, 0.005), mats.lip, 0, 0.198, 0.214, head, false);
    mouth3d.rotation.x = 0.15;

    // 고해상도 512×512 캔버스 얼굴 데칼(안면 곡면을 정밀하게 감싸는 메시)
    const fg = G(new T.PlaneGeometry(0.34, 0.34, 18, 18)), fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i);
      const ny = (y - 0.01) / 0.245;
      const jaw = ny < 0.05 ? 1 - Math.min(1, (0.05 - ny) / 1.05) * 0.22 : 1;
      const baseZ = Math.sqrt(Math.max(0, 0.246 * 0.246 - (x / 0.9) * (x / 0.9) - (y / 1.06) * (y / 1.06))) * 0.965 * jaw + 0.012;
      fp.setZ(i, baseZ);
    }
    fg.computeVertexNormals();
    const faces = {};
    for (const e of EXPR) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 512;
      drawFace(cv.getContext("2d"), e, P);
      const tx = new T.CanvasTexture(cv);
      tx.anisotropy = 4;
      texs.push(tx);
      faces[e] = tx;
    }
    const faceMat = new T.MeshStandardMaterial({
      map: faces["기본"], transparent: true, alphaTest: 0.02, roughness: 0.85,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    pool.push(faceMat);
    add(fg, faceMat, 0, 0.272, 0, head, false, "faceDecal");

    /* ── 5. 캐릭터별 입체 헤어 조각 (Wave Ribbon Locks & Volumetric Crown) ── */
    /** 정수리~뒤통수 기본 볼륨 캡 */
    const hairCrown = (rx, ry, rz, tilt = 0.48) => {
      const capGeo = G(new T.SphereGeometry(1, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62));
      const m = add(capGeo, mats.hair, 0, 0.292, -0.012, head, true, "hairCrown");
      m.scale.set(rx, ry, rz);
      m.rotation.x = -tilt;
      return m;
    };

    if (P.hair === "long") {
      // ── Claude: 옆가르마 다크브라운 롱 웨이브 헤어 (어깨 앞 컬 + 등 뒤 풍성한 S웨이브 층) ──
      hairCrown(0.242, 0.268, 0.256, 0.52);

      // 가르마 루트 볼륨 & 양옆으로 우아하게 흐르는 사이드 커튼뱅
      add(G(ribbonCurve([
        [-0.04, 0.535, 0.12],
        [-0.14, 0.505, 0.165],
        [-0.225, 0.405, 0.145],
        [-0.252, 0.275, 0.095],
        [-0.235, 0.145, 0.115],
        [-0.255, 0.015, 0.135],
        [-0.215, -0.115, 0.145],
      ], 0.036, 0.058, 0.024, 24, 10, 0.52)), mats.hair, 0, 0, 0, head, true);

      add(G(ribbonCurve([
        [-0.03, 0.538, 0.125],
        [0.095, 0.522, 0.172],
        [0.195, 0.435, 0.155],
        [0.248, 0.305, 0.105],
        [0.232, 0.165, 0.118],
        [0.252, 0.035, 0.138],
        [0.212, -0.105, 0.145],
      ], 0.038, 0.062, 0.025, 24, 10, 0.52)), mats.hair, 0, 0, 0, head, true);

      // 어깨 앞으로 넘어오는 세컨드 웨이브 컬
      for (const s of [-1, 1]) {
        add(G(ribbonCurve([
          [s * 0.18, 0.44, 0.04],
          [s * 0.255, 0.31, 0.03],
          [s * 0.272, 0.16, 0.055],
          [s * 0.248, 0.02, 0.095],
          [s * 0.268, -0.12, 0.105],
          [s * 0.228, -0.23, 0.115],
        ], 0.034, 0.052, 0.020, 22, 10, 0.55)), s > 0 ? mats.hairHi : mats.hair, 0, 0, 0, head, true);
      }

      // 등 뒤를 덮는 베이스 볼륨 + 9가닥의 풍성한 S웨이브 롱 헤어 락
      const backCurtain = G(loftRings([
        { y: -0.26, rx: 0.245, rz: 0.065, z: -0.215, pleat: 0.012 },
        { y: -0.10, rx: 0.265, rz: 0.075, z: -0.225, pleat: 0.014 },
        { y: 0.08,  rx: 0.268, rz: 0.085, z: -0.210, pleat: 0.010 },
        { y: 0.26,  rx: 0.248, rz: 0.115, z: -0.165 },
        { y: 0.42,  rx: 0.215, rz: 0.145, z: -0.105 },
      ], 24, true, true));
      add(backCurtain, mats.hair, 0, 0, 0, head, true, "hairBackCurtain");

      for (let i = 0; i < 9; i++) {
        const u = (i - 4) / 4; // -1 ~ +1
        const ang = u * 1.18;
        const sx = Math.sin(ang) * 0.235, sz = -Math.cos(ang) * 0.205 - 0.03;
        const alt = i % 2 === 0 ? 1 : -1;
        const lock = G(ribbonCurve([
          [sx * 0.78, 0.42, sz * 0.75],
          [sx * 0.98, 0.26, sz - 0.015],
          [sx * 1.08 + alt * 0.018, 0.10, sz - 0.035 + alt * 0.015],
          [sx * 1.02 - alt * 0.020, -0.06, sz - 0.025 - alt * 0.018],
          [sx * 1.10 + alt * 0.022, -0.22, sz - 0.040 + alt * 0.016],
          [sx * 0.96, -0.35, sz - 0.020],
        ], 0.035, 0.056, 0.022, 22, 9, 0.56));
        add(lock, i % 3 === 1 ? mats.hairHi : mats.hair, 0, 0, 0, head, true);
      }
    } else if (P.hair === "bun") {
      // ── Gemini: 깔끔하게 올려 묶은 하이 번(똥머리) + 옆 잔머리 컬 + 앞머리 잔결 ──
      hairCrown(0.238, 0.262, 0.248, 0.44);

      // 뒷목~정수리로 모아 올린 뒷머리 볼륨
      const updoBack = G(loftRings([
        { y: 0.14, rx: 0.155, rz: 0.115, z: -0.135 },
        { y: 0.26, rx: 0.218, rz: 0.165, z: -0.115, pleat: 0.005 },
        { y: 0.40, rx: 0.212, rz: 0.175, z: -0.075, pleat: 0.006 },
        { y: 0.51, rx: 0.135, rz: 0.125, z: -0.045 },
      ], 22, true, true));
      add(updoBack, mats.hair, 0, 0, 0, head, true);

      // 정수리 위 풍성한 트위스트 하이 번(똥머리 코어 + 3가닥 꼬임 링 + 헤어 스크런치)
      const bunGroup = grp(0, 0.565, -0.045, head, "highBun");
      add(torG(0.068, 0.024, 20), mats.dark, 0, -0.042, 0, bunGroup, false).rotation.x = Math.PI / 2 - 0.15; // 머리끈
      ell(0.108, 0.096, 0.108, mats.hair, 0, 0.018, 0, bunGroup);
      for (let b = 0; b < 3; b++) {
        const ba = (b * Math.PI * 2) / 3;
        const coil = add(torG(0.074, 0.036, 18), b === 1 ? mats.hairHi : mats.hair, Math.cos(ba) * 0.018, 0.022, Math.sin(ba) * 0.018, bunGroup);
        coil.rotation.set(Math.PI / 2 + Math.sin(ba) * 0.35, ba, Math.cos(ba) * 0.35);
      }
      // 번 위로 살짝 삐져나온 귀여운 잔머리 가닥
      add(G(ribbonCurve([
        [0.04, 0.07, 0.02],
        [0.09, 0.11, 0.04],
        [0.12, 0.09, 0.01],
      ], 0.014, 0.018, 0.005, 10, 7, 0.5)), mats.hair, 0, 0, 0, bunGroup, false);

      // 이마 헤어라인 볼륨 & 자연스러운 잔머리
      for (const s of [-1, 1]) {
        add(G(ribbonCurve([
          [s * 0.02, 0.515, 0.155],
          [s * 0.12, 0.485, 0.182],
          [s * 0.20, 0.415, 0.145],
          [s * 0.228, 0.325, 0.065],
        ], 0.030, 0.042, 0.024, 16, 8, 0.52)), mats.hair, 0, 0, 0, head, true);

        // 귀 앞/볼 옆으로 흘러내리는 S컬 애교머리(잔머리)
        add(G(ribbonCurve([
          [s * 0.205, 0.365, 0.115],
          [s * 0.228, 0.285, 0.132],
          [s * 0.212, 0.215, 0.148],
          [s * 0.226, 0.155, 0.135],
        ], 0.015, 0.020, 0.006, 16, 8, 0.5)), mats.hair, 0, 0, 0, head, false);
      }
      // 이마 앞 시스루 잔머리 두 가닥
      add(G(ribbonCurve([
        [0.05, 0.505, 0.175],
        [0.09, 0.445, 0.215],
        [0.12, 0.395, 0.218],
      ], 0.012, 0.016, 0.005, 12, 7, 0.45)), mats.hair, 0, 0, 0, head, false);
    } else if (P.hair === "bob") {
      hairCrown(0.246, 0.268, 0.256, 0.48);
      for (const s of [-1, 1]) {
        add(G(ribbonCurve([
          [s * 0.05, 0.52, 0.15],
          [s * 0.19, 0.44, 0.15],
          [s * 0.245, 0.28, 0.08],
          [s * 0.225, 0.12, 0.10],
        ], 0.035, 0.055, 0.022, 18, 9, 0.55)), mats.hair, 0, 0, 0, head, true);
      }
    } else {
      // ── GPT: 시트 2행의 볼륨감 있는 검은 웨이브 쇼트 헤어 (귀 노출 + 이마 위 웨이브 앞머리) ──
      hairCrown(0.242, 0.266, 0.254, 0.38);

      // 뒷머리 테이퍼드 컷 & 정수리 볼륨 컬
      const shortBack = G(loftRings([
        { y: 0.15, rx: 0.145, rz: 0.115, z: -0.132 },
        { y: 0.25, rx: 0.215, rz: 0.165, z: -0.112, pleat: 0.008 },
        { y: 0.38, rx: 0.238, rz: 0.195, z: -0.075, pleat: 0.010 },
        { y: 0.50, rx: 0.205, rz: 0.185, z: -0.025, pleat: 0.008 },
      ], 22, true, true));
      add(shortBack, mats.hair, 0, 0, 0, head, true);

      // 이마와 관자놀이를 자연스럽게 감싸는 7가닥의 웨이브 컬 앞머리/옆머리
      const bangSpecs = [
        [[-0.03, 0.535, 0.11], [-0.14, 0.505, 0.185], [-0.21, 0.435, 0.175], [-0.228, 0.355, 0.115]],
        [[-0.02, 0.542, 0.13], [-0.09, 0.495, 0.218], [-0.13, 0.415, 0.228], [-0.105, 0.365, 0.222]],
        [[-0.01, 0.545, 0.14], [-0.04, 0.492, 0.228], [-0.05, 0.422, 0.238], [-0.025, 0.378, 0.232]],
        [[0.02, 0.545, 0.14], [0.05, 0.495, 0.228], [0.07, 0.425, 0.236], [0.045, 0.378, 0.230]],
        [[0.03, 0.540, 0.13], [0.11, 0.498, 0.215], [0.15, 0.422, 0.222], [0.125, 0.368, 0.218]],
        [[0.04, 0.532, 0.11], [0.16, 0.502, 0.182], [0.215, 0.432, 0.170], [0.228, 0.352, 0.112]],
        [[0.00, 0.555, 0.02], [0.08, 0.565, 0.09], [0.16, 0.515, 0.13], [0.21, 0.445, 0.08]],
      ];
      bangSpecs.forEach((pts, bi) => {
        add(G(ribbonCurve(pts, 0.028, 0.044, 0.014, 16, 9, 0.58)), bi % 2 ? mats.hairHi : mats.hair, 0, 0, 0, head, true);
      });

      // 구레나룻(귀 앞쪽 깔끔한 라인)
      for (const s of [-1, 1]) {
        add(G(ribbonCurve([
          [s * 0.222, 0.365, 0.065],
          [s * 0.228, 0.315, 0.042],
          [s * 0.224, 0.275, 0.028],
        ], 0.018, 0.020, 0.008, 10, 7, 0.5)), mats.hair, 0, 0, 0, head, false);
      }
    }

    /* ── 6. 얇은 검은 테 라운드 스퀘어 안경 (GPT 전용, 렌즈·브리지·안경다리 포함) ── */
    if (P.glasses) {
      const glGroup = grp(0, 0.284, 0.238, head, "glasses");
      for (const s of [-1, 1]) {
        const rim = add(torG(0.054, 0.0065, 28), mats.frame, s * 0.068, 0, 0, glGroup, false);
        rim.scale.set(1.08, 0.92, 1);
        const lens = add(cylG(0.052, 0.052, 0.003, 24), mats.lens, s * 0.068, 0, 0, glGroup, false);
        lens.rotation.x = Math.PI / 2;
        lens.scale.set(1.08, 1, 0.92);
        // 안경다리 (귀 위로 자연스럽게 걸림)
        const temple = G(ribbonCurve([
          [s * 0.124, 0.006, -0.002],
          [s * 0.185, 0.008, -0.105],
          [s * 0.218, 0.004, -0.215],
          [s * 0.214, -0.022, -0.255],
        ], 0.0055, 0.0055, 0.0045, 12, 6, 0.7));
        add(temple, mats.frame, 0, 0, 0, glGroup, false);
      }
      // 안경 브리지
      const bridge = G(ribbonCurve([
        [-0.016, 0.008, 0.004],
        [0.000, 0.014, 0.008],
        [0.016, 0.008, 0.004],
      ], 0.005, 0.005, 0.005, 8, 6, 0.8));
      add(bridge, mats.frame, 0, 0, 0, glGroup, false);
    }

    /* ── 7. 업무/발표용 소품: 스마트폰(`phone`), 태블릿(`tablet`), 노트북(`laptop`, `laptopOpen`) ── */
    const props = {};
    // 오른손(`hands[0]`, 캐릭터 기준 오른쪽 = 정면에서 볼 때 왼쪽 손)에 쥐는 스마트폰 (3열 발표 포즈용)
    const phone = props.phone = grp(0.012, -0.042, 0.032, wrists[0], "phone");
    phone.rotation.set(0.25, -0.18, 0.12);
    add(rBoxG(0.072, 0.010, 0.142, 0.004), mats.dark, 0, 0, 0, phone, false);
    add(rBoxG(0.066, 0.004, 0.134, 0.002), mats.screen, 0, 0.005, 0, phone, false);
    phone.visible = false;

    if (P.props.tablet) {
      const t = props.tablet = grp(-0.03, 1.0, 0.24, torso, "tablet");
      t.rotation.set(-0.3, 0, 0.12);
      add(rBoxG(0.28, 0.38, 0.014, 0.004), mats.gray, 0, 0, 0, t);
      add(rBoxG(0.25, 0.34, 0.006, 0.002), mats.screen, 0, 0, 0.006, t, false);
      t.visible = false;
    }
    if (P.props.laptop) {
      const s = P.props.laptop === "L" ? -1 : 1, l = props.laptop = grp(s * 0.36, 0.86, 0.02, torso, "laptop");
      l.rotation.z = Math.PI / 2;
      add(rBoxG(0.32, 0.020, 0.22, 0.004), s > 0 ? mats.metal : mats.gray, 0, 0, 0, l);
      l.visible = false;
    }
    if (P.props.laptopOpen) {
      const l = props.laptopOpen = grp(0, 0.84, 0.55, group, "laptopOpen");
      add(rBoxG(0.32, 0.016, 0.22, 0.004), mats.metal, 0, 0.008, 0, l);
      add(rBoxG(0.28, 0.005, 0.14, 0.002), mats.dark, 0, 0.018, 0.02, l, false);
      const sc = grp(0, 0.016, 0.105, l);
      sc.rotation.x = 0.32;
      add(rBoxG(0.32, 0.21, 0.010, 0.004), mats.metal, 0, 0.105, 0, sc);
      add(rBoxG(0.29, 0.18, 0.004, 0.002), mats.screen, 0, 0.105, -0.006, sc, false);
      l.visible = false;
    }

    /* ── 8. 성인 7.5등신 비율 조정 및 미터(m) 단위 정밀 스케일 정규화 ── */
    legs.forEach(leg => { leg.position.y = 0.92; leg.scale.set(0.84, 1.66, 0.86); });
    body.position.y = 0.92;
    torso.position.y = -0.55 * 0.76;
    torso.scale.set(0.80, 0.76, 0.86);
    head.scale.setScalar(0.62);
    arms.forEach(arm => { arm.scale.set(0.92, 1.18, 0.92); });

    group.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(group);
    const targetHeight = P.targetHeight || (key === "gpt" ? 1.78 : key === "gemini" ? 1.68 : 1.72);
    const factor = targetHeight / (bounds.max.y - bounds.min.y);
    const baseLegY = 0.92 - bounds.min.y;
    // 원점은 발바닥(y = 0): 각 자식에 오프셋을 적용해 이동/회전 원점을 유지한다
    for (const child of group.children) child.position.y -= bounds.min.y;
    group.scale.setScalar(factor);
    group.name = `character-${key || "member"}`;
    group.userData = { units: "meters", height: targetHeight, assetType: "articulated-character", forward: "+Z" };
    const hipHeight = legs[0].position.y * factor;

    let cur = "기본", curPose = "stand";
    const setFace = e => { if (e !== cur && faces[e]) { cur = e; faceMat.map = faces[e]; } };

    /** 시트 대표 포즈(`stand`, `lounge`, `tea`, `present`, `work`) 즉시 적용 */
    function setPose(poseName = "stand") {
      curPose = poseName;
      const fn = POSES[poseName] || POSES.stand;
      const p = fn(key);
      // 다리·엉덩이·몸통 위치를 기본값으로 복원한 뒤 포즈 오프셋 적용
      legs.forEach((leg, i) => {
        leg.position.y = baseLegY + (p.y || 0);
        leg.rotation.set(i === 0 ? p.legL : p.legR, i === 0 ? (p.legLy || 0) : (p.legRy || 0), i === 0 ? p.legLz : p.legRz);
      });
      knees[0].rotation.set(p.kneeL || 0, 0, 0);
      knees[1].rotation.set(p.kneeR || 0, 0, 0);
      body.position.y = baseLegY + (p.y || 0);
      body.rotation.set(p.lean || 0, p.bodyY || 0, p.bodyZ || 0);

      arms[0].rotation.set(p.armL || 0, p.armLy || 0, p.armLz || 0);
      arms[1].rotation.set(p.armR || 0, p.armRy || 0, p.armRz || 0);
      elbows[0].rotation.set(p.elbL || 0, 0, 0);
      elbows[1].rotation.set(p.elbR || 0, 0, 0);
      wrists[0].rotation.set(...(p.wristL || [0, 0, 0]));
      wrists[1].rotation.set(...(p.wristR || [0, 0, 0]));

      hands[0].visible = !p.pocketL;
      hands[1].visible = !p.pocketR;
      head.rotation.set(p.headX || 0, p.headY || 0, p.headZ || 0);

      // 머그컵 위치(왼손/오른손 전환 지원) 및 스마트폰 표시
      const cupHandIdx = p.cupHand === "L" ? 0 : 1;
      if (cup.parent !== hands[cupHandIdx]) hands[cupHandIdx].add(cup);
      cup.visible = !!p.cup;
      if (props.phone) props.phone.visible = !!p.phone;
      if (props.tablet) props.tablet.visible = false;
      if (props.laptop) props.laptop.visible = false;
      if (props.laptopOpen) props.laptopOpen.visible = false;
      if (p.expr) setFace(p.expr);
      group.updateMatrixWorld(true);
      return rig;
    }

    const dispose = () => { for (const t of texs) t.dispose(); for (const o of pool) o.dispose(); };
    const rig = {
      group, legs, knees, body, torso, arms, elbows, hands, wrists, head, cup, props,
      height: targetHeight + 0.18, hipHeight, seatOffset: 0.535 - hipHeight,
      setFace, setPose, pose: () => curPose, dispose, face: () => cur,
      preset: Object.assign({ tablet: false, laptop: null, laptopOpen: false, cupAlways: false, pocket: null, phone: false }, P.props),
    };
    return rig;
  }

  window.Characters = { build, drawFace, EXPR, PRESETS, POSES };
  window.dispatchEvent(new Event("characters-ready"));
})();
