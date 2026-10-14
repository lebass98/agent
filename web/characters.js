"use strict";
/* characters.js — 팀원 캐릭터 조립(docs/characters.md 기준). app.js 의 class Agent 가 Characters.build(def, name) 로 만든 rig 를 움직인다.
   rig 계약(모든 각도는 라디안, 축은 캐릭터 기준 +z 가 앞):
     group            위치·방향(THREE.Group)
     legs[L,R]        엉덩이 축(rotation.x 앞뒤 · rotation.z 벌림)      knees[L,R]  무릎 축(rotation.x, + 는 접힘)
     body             엉덩이 축(rotation.x 기울기) → 안에 torso
     arms[L,R]        어깨 축(rotation.x · rotation.z)                   elbows[L,R] 팔꿈치(rotation.x, − 는 앞으로 접힘)
     hands[L,R]       손(Group, visible=false 면 주머니에 넣은 손)
     head             목 축(rotation.x · rotation.y)
     cup              오른손 컵(Group, visible 토글)
     props            { tablet, laptop, laptopOpen } 중 프리셋에 있는 것(visible 토글)
     preset           { tablet, laptop:'L'|'R', laptopOpen, cupAlways, pocket:'L'|'R' } 소품 규칙
     height           이름표를 띄우는 높이
     setFace(expr)    표정 교체: 기본 · 웃음 · 놀람 · 집중 · 생각
     dispose()        geometry · material · texture 해제 */
(function () {
  const T = window.THREE;
  if (!T) return;
  const SKIN = 0xf1c7a3, SKIN_CSS = "#f1c7a3", NAVY = 0x1f2a5a;
  const EXPR = ["기본", "웃음", "놀람", "집중", "생각"];

  /* 프리셋(이름 소문자). hair: long(긴 웨이브) · short(짧은 머리+앞머리) · bun(똥머리) · bob(단발) */
  const PRESETS = {
    claude: {
      hair: "long", hairColor: 0x3a2314, iris: "#5b3a22", lashes: true, blush: .34,
      top: { kind: "shirt", color: 0xf5f0e4, trim: 0xe4dccb, rolled: true },
      pants: { color: 0xd8c5a6, wide: true, belt: 0x1a1a1a },
      shoes: { color: 0xffffff, accent: null },
      props: { tablet: true, cup: "mug" },
    },
    gpt: {
      hair: "short", hairColor: 0x141418, iris: "#2e2826", lashes: false, blush: .16, glasses: true,
      top: { kind: "sweater", color: 0x17171b, trim: 0x2e2e36 },
      pants: { color: 0x3a3d47, wide: false, belt: null },
      shoes: { color: 0xffffff, accent: 0x202228 },
      props: { laptop: "R", laptopOpen: true, pocket: "L", cup: "mug" },
    },
    gemini: {
      hair: "bun", hairColor: 0x121216, iris: "#2f2622", lashes: true, blush: .34,
      top: { kind: "shirt", color: 0xbdd7f4, trim: 0xa6c3e8, rolled: true },
      pants: { color: 0x1d1e26, wide: true, belt: null },
      shoes: { color: 0xffffff, accent: null },
      props: { cup: "takeaway", cupAlways: true, laptop: "L" },
    },
  };
  /* 모르는 팀원: 이름 해시로 옷장에서 고른다. 팀원 색은 사원증 띠·신발 포인트에만 쓴다 */
  const WARDROBE = {
    hair: ["short", "bun", "long", "bob"],
    top: [[0xffffff, 0xe6e6e6], [0xdfe9d6, 0xc9d8bd], [0xf6d9dd, 0xe8c3c8], [0x2b3550, 0x3b4668, "sweater"], [0xe9e2d0, 0xd9d0bb]],
    pants: [0x3a3d47, 0xd8c5a6, 0x253050, 0x1d1e26],
  };
  const hashStr = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  function wardrobe(def, key) {
    const h = hashStr(key || "x"), top = WARDROBE.top[(h >>> 2) % WARDROBE.top.length], hair = WARDROBE.hair[h % WARDROBE.hair.length];
    const kind = top[2] || "shirt";
    return {
      hair, hairColor: def.hair ?? 0x3b2a22, iris: "#3a2a22", lashes: hair !== "short", blush: .26, glasses: (h >>> 10) % 3 === 0,
      top: { kind, color: top[0], trim: top[1], rolled: kind === "shirt" },
      pants: { color: WARDROBE.pants[(h >>> 5) % WARDROBE.pants.length], wide: (h >>> 7) % 2 === 0, belt: (h >>> 8) % 2 ? 0x1a1a1a : null },
      shoes: { color: 0xffffff, accent: def.color || null },
      props: { cup: "mug", laptop: (h >>> 9) % 2 ? "L" : "R" },
    };
  }

  /* ── 얼굴(256×256 캔버스, 투명 배경 위에 눈·눈썹·입·홍조) ── */
  function drawFace(c, expr, P) {
    const W = 256, EX = [88, 168], EY = 124, hair = "#" + new T.Color(P.hairColor).getHexString(), line = "#2a1e1a";
    c.clearRect(0, 0, W, W);
    c.lineCap = "round"; c.lineJoin = "round";
    c.fillStyle = `rgba(236,110,110,${P.blush})`;
    for (const x of [58, 198]) { c.beginPath(); c.ellipse(x, 160, 20, 11, 0, 0, 7); c.fill(); }
    // 눈썹
    c.strokeStyle = hair; c.lineWidth = 4.5;
    EX.forEach((x, i) => {
      const s = i ? 1 : -1; // 바깥쪽
      c.beginPath();
      if (expr === "놀람") { c.moveTo(x - s * 22, 76); c.quadraticCurveTo(x, 60, x + s * 20, 70); }
      else if (expr === "집중") { c.moveTo(x - s * 19, 99); c.lineTo(x + s * 21, 87); }
      else if (expr === "생각" && i === 1) { c.moveTo(x - 20, 80); c.quadraticCurveTo(x, 64, x + 20, 76); }
      else { c.moveTo(x - s * 22, 90); c.quadraticCurveTo(x, 78, x + s * 20, 86); }
      c.stroke();
    });
    // 눈
    EX.forEach((x, i) => {
      const s = i ? 1 : -1;
      if (expr === "웃음") {
        c.strokeStyle = line; c.lineWidth = 5;
        c.beginPath(); c.moveTo(x - 20, 129); c.quadraticCurveTo(x, 98, x + 20, 129); c.stroke();
        return;
      }
      const big = expr === "놀람", rx = big ? 24 : 20, ry = big ? 28 : 24, dx = expr === "생각" ? 6 : 0, dy = expr === "생각" ? -8 : 0;
      c.fillStyle = "#fff"; c.beginPath(); c.ellipse(x, EY, rx, ry, 0, 0, 7); c.fill();
      c.fillStyle = P.iris; c.beginPath(); c.arc(x + dx, EY + dy + 2, big ? 13 : 14, 0, 7); c.fill();
      c.fillStyle = "#1a1512"; c.beginPath(); c.arc(x + dx, EY + dy + 2, big ? 6 : 7.5, 0, 7); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(x + dx - 6, EY + dy - 6, 5, 0, 7); c.fill();
      c.beginPath(); c.arc(x + dx + 5, EY + dy + 7, 2.5, 0, 7); c.fill();
      if (expr === "집중") { c.fillStyle = SKIN_CSS; c.beginPath(); c.ellipse(x, EY - 20, rx + 3, 17, 0, 0, 7); c.fill(); } // 눈꺼풀 내림
      c.strokeStyle = line; c.lineWidth = 3.5; c.beginPath();
      if (expr === "집중") c.ellipse(x, EY - 4, rx, 4, 0, Math.PI, 2 * Math.PI);
      else c.ellipse(x, EY, rx, ry, 0, Math.PI + .25, 2 * Math.PI - .25);
      c.stroke();
      if (P.lashes) { // 바깥쪽 속눈썹
        c.lineWidth = 3; c.beginPath();
        c.moveTo(x + s * (rx - 3), EY - ry + 6); c.lineTo(x + s * (rx + 7), EY - ry);
        c.moveTo(x + s * (rx - 1), EY - ry + 13); c.lineTo(x + s * (rx + 9), EY - ry + 9); c.stroke();
      }
    });
    // 코
    c.strokeStyle = "rgba(140,80,55,.45)"; c.lineWidth = 3; c.beginPath(); c.arc(126, 150, 6, .3, 1.6); c.stroke();
    // 입
    c.strokeStyle = "#9c4f43"; c.fillStyle = "#7a3b34"; c.lineWidth = 4.5;
    if (expr === "웃음") {
      c.beginPath(); c.moveTo(100, 166); c.quadraticCurveTo(128, 208, 156, 166); c.closePath(); c.fill();
      c.save(); c.clip(); c.fillStyle = "#fff"; c.fillRect(100, 166, 56, 8); c.fillStyle = "#e07a86"; c.beginPath(); c.ellipse(128, 196, 14, 8, 0, 0, 7); c.fill(); c.restore();
    } else if (expr === "놀람") {
      c.beginPath(); c.ellipse(128, 180, 10, 13, 0, 0, 7); c.fill();
      c.fillStyle = "#e07a86"; c.beginPath(); c.ellipse(128, 187, 6, 4, 0, 0, 7); c.fill();
    } else if (expr === "집중") { c.beginPath(); c.moveTo(112, 176); c.lineTo(144, 176); c.stroke(); }
    else if (expr === "생각") { c.beginPath(); c.ellipse(134, 176, 5, 4, 0, 0, 7); c.fill(); }
    else { c.beginPath(); c.moveTo(108, 172); c.quadraticCurveTo(128, 187, 148, 172); c.stroke(); }
  }

  /* ── 조립 ── */
  function build(def, name) {
    const key = String(name || "").toLowerCase();
    const P = Object.hasOwn(PRESETS, key) ? PRESETS[key] : wardrobe(def || {}, key); // 'constructor' 같은 이름이 Object.prototype 을 집지 않게
    const pool = [], texs = [];
    const G = g => (pool.push(g), g);
    const M = (color, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color, roughness: .85 }, o)); pool.push(m); return m; };
    const add = (geo, m, x, y, z, parent, shadow = true) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = shadow; parent.add(o); return o; };
    const grp = (x, y, z, parent) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const SPH = G(new T.SphereGeometry(1, 14, 10)); // 스케일로 타원체를 만든다
    const ell = (rx, ry, rz, m, x, y, z, parent) => { const o = add(SPH, m, x, y, z, parent); o.scale.set(rx, ry, rz); return o; };
    const cylG = (rt, rb, h, seg = 12) => G(new T.CylinderGeometry(rt, rb, h, seg));
    const boxG = (w, h, d) => G(new T.BoxGeometry(w, h, d));
    const torG = (r, tube, seg = 16) => G(new T.TorusGeometry(r, tube, 6, seg));
    const sweater = P.top.kind === "sweater";
    const mats = {
      skin: M(SKIN), hair: M(P.hairColor, { roughness: .7, side: T.DoubleSide }), top: M(P.top.color, { roughness: sweater ? .95 : .8 }),
      trim: M(P.top.trim), pants: M(P.pants.color), belt: M(P.pants.belt ?? 0x111111, { roughness: .6 }), shoe: M(P.shoes.color, { roughness: .6 }),
      sole: M(0xd9dde3), acc: M(P.shoes.accent ?? 0xd9dde3), navy: M(NAVY), white: M(0xffffff, { roughness: .5 }), dark: M(0x1b1f2a, { roughness: .5 }),
      metal: M(0xa9aeb8, { roughness: .4, metalness: .35 }), gray: M(0x8c929c, { roughness: .5 }), screen: M(0x1a2130, { roughness: .3, emissive: 0x0b1424 }),
      accent: M(def?.color || 0x4f7cf7), frame: M(0x111111, { roughness: .35 }),
    };
    const group = new T.Group();

    // 다리: 엉덩이 축 → 허벅지 → 무릎 축 → 종아리(와이드는 아래로 퍼짐) → 흰 스니커즈
    const legs = [], knees = [];
    [-.11, .11].forEach(x => {
      const hip = grp(x, .55, 0, group);
      add(cylG(.1, .105, .29), mats.pants, 0, -.145, 0, hip);
      const knee = grp(0, -.28, 0, hip);
      add(P.pants.wide ? cylG(.105, .135, .25) : cylG(.095, .09, .25), mats.pants, 0, -.12, 0, knee);
      add(boxG(.15, .07, .25), mats.shoe, 0, -.235, .04, knee);
      add(boxG(.155, .025, .255), mats.sole, 0, -.258, .04, knee);
      if (P.shoes.accent != null) add(boxG(.156, .018, .19), mats.acc, 0, -.232, .02, knee); // 검은 옆줄
      legs.push(hip); knees.push(knee);
    });

    // 몸통: body(엉덩이 축) → torso(원래 좌표). 바지 허리 → 벨트 → 셔츠(또는 스웨터)
    const body = grp(0, .55, 0, group), torso = grp(0, -.55, 0, body);
    add(cylG(.255, .235, .3, 14), mats.pants, 0, .69, 0, torso).scale.z = .8;
    if (P.pants.belt != null) {
      add(cylG(.262, .262, .04, 14), mats.belt, 0, .845, 0, torso).scale.z = .8;
      add(boxG(.045, .03, .02), mats.metal, 0, .845, .207, torso, false);
    }
    add(cylG(.245, .265, .37, 14), mats.top, 0, 1.025, 0, torso).scale.z = .78;
    if (!sweater) {
      for (const s of [-1, 1]) add(boxG(.13, .02, .075), mats.top, s * .065, 1.2, .165, torso).rotation.set(-.45, 0, s * .75); // 칼라
      for (const y of [1.11, 1.01, .91]) add(G(new T.SphereGeometry(.012, 6, 6)), mats.white, 0, y, .2, torso, false);   // 단추
    } else add(torG(.1, .024, 20), mats.trim, 0, 1.2, 0, torso).rotation.x = Math.PI / 2;                                  // 골지 목둘레
    // 네이비 목걸이 줄 + 흰 사원증(팀원 색 띠)
    add(torG(.14, .011, 28), mats.navy, 0, 1.1, .14, torso, false).rotation.x = -.7;
    add(boxG(.1, .13, .012), mats.white, 0, .93, .225, torso, false);
    add(boxG(.03, .024, .014), mats.dark, 0, .99, .225, torso, false);
    add(boxG(.08, .018, .014), mats.accent, 0, .962, .226, torso, false);
    add(boxG(.036, .04, .014), mats.gray, -.022, .915, .226, torso, false);

    // 팔: 어깨 축 → 윗팔(걷은 소매) → 팔꿈치 축 → 아랫팔(피부 또는 스웨터+커프) → 손
    const arms = [], elbows = [], hands = [];
    [-.31, .31].forEach(x => {
      const sh = grp(x, 1.12, 0, torso);
      ell(.08, .075, .075, mats.top, 0, 0, 0, sh);
      add(cylG(.063, .058, .26), mats.top, 0, -.14, 0, sh);
      if (P.top.rolled) add(torG(.06, .018, 14), mats.trim, 0, -.265, 0, sh).rotation.x = Math.PI / 2;
      const elb = grp(0, -.27, 0, sh);
      if (sweater) {
        add(cylG(.056, .052, .18), mats.top, 0, -.09, 0, elb);
        add(torG(.052, .014, 14), mats.trim, 0, -.18, 0, elb).rotation.x = Math.PI / 2;
        add(cylG(.045, .045, .08), mats.skin, 0, -.215, 0, elb);
      } else add(cylG(.055, .048, .25), mats.skin, 0, -.125, 0, elb);
      const hand = grp(0, -.26, 0, elb);
      ell(.058, .065, .045, mats.skin, 0, -.02, 0, hand);
      arms.push(sh); elbows.push(elb); hands.push(hand);
    });
    // 오른손 컵: 테이크아웃(흰 컵 + 갈색 슬리브 + 뚜껑) 또는 머그
    const cup = grp(0, -.03, .055, hands[1]);
    if (P.props.cup === "takeaway") {
      add(cylG(.058, .048, .17, 14), mats.white, 0, 0, 0, cup);
      add(cylG(.063, .057, .065, 14), M(0x9c6b3f), 0, -.01, 0, cup);
      add(cylG(.062, .062, .022, 14), M(0xe8e8ea), 0, .095, 0, cup);
    } else {
      add(cylG(.062, .055, .14, 12), mats.white, 0, 0, 0, cup);
      add(cylG(.064, .064, .03, 12), mats.accent, 0, .03, 0, cup);
      add(torG(.035, .01, 12), mats.white, .062, 0, 0, cup, false);
    }
    cup.visible = false;

    // 머리: 목 축 → 목 → 두상 → 귀 → 얼굴 데칼(구면을 따라 휜 평면) → 머리카락 → 안경
    const head = grp(0, 1.18, 0, torso);
    add(cylG(.07, .075, .12), mats.skin, 0, .05, 0, head);
    add(G(new T.SphereGeometry(.26, 26, 18)), mats.skin, 0, .28, 0, head);
    for (const s of [-1, 1]) ell(.035, .05, .025, mats.skin, s * .255, .28, 0, head);
    const fg = G(new T.PlaneGeometry(.36, .36, 12, 12)), fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), y = fp.getY(i); fp.setZ(i, Math.sqrt(Math.max(0, .268 * .268 - x * x - y * y))); }
    fg.computeVertexNormals();
    const faces = {};
    for (const e of EXPR) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      drawFace(cv.getContext("2d"), e, P);
      const tx = new T.CanvasTexture(cv); tx.anisotropy = 4; texs.push(tx); faces[e] = tx;
    }
    const faceMat = new T.MeshStandardMaterial({ map: faces["기본"], transparent: true, alphaTest: .02, roughness: .9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    pool.push(faceMat);
    add(fg, faceMat, 0, .27, 0, head, false);

    /** 머리 뚜껑: 위쪽 구면 조각. tilt 만큼 앞을 들어 이마를 드러내고 뒤는 목덜미를 덮는다 */
    const cap = (r, theta, tilt) => (add(G(new T.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, theta)), mats.hair, 0, .28, 0, head).rotation.x = -tilt);
    /** 머리카락 한 가닥: 살짝씩 다르게 기울인 가는 원기둥을 이어 붙인 사슬(끝으로 갈수록 굵게). x,y,z 는 두상 중심 기준 시작점 */
    const strand = (x, y, z, segs, len, w0, w1, leanX, leanZ, wave = .18) => {
      let p = grp(x, .28 + y, z, head); p.rotation.set(leanX, 0, leanZ);
      for (let k = 0; k < segs; k++) {
        const wa = w0 + (w1 - w0) * k / segs, wb = w0 + (w1 - w0) * (k + 1) / segs, alt = k % 2 ? 1 : -1;
        add(cylG(wa, wb, len + wb, 8), mats.hair, 0, -len / 2, 0, p);
        ell(wb, wb, wb, mats.hair, 0, -len, 0, p);
        const n = grp(0, -len, 0, p); n.rotation.set(wave * alt * .8, 0, wave * -alt * (x >= 0 ? .4 : -.4)); p = n;
      }
    };
    if (P.hair === "long") {
      cap(.275, Math.PI * .5, .62);
      ell(.13, .03, .04, mats.hair, .05, .45, .185, head).rotation.set(-.7, 0, -.15);  // 옆가르마 앞머리 결
      ell(.25, .42, .055, mats.hair, 0, .04, -.235, head);                             // 등을 덮는 머리 판(허리까지)
      for (const s of [-1, 1]) ell(.05, .3, .1, mats.hair, s * .245, -.08, .02, head);   // 얼굴 옆으로 흘러내리는 옆머리
      for (let i = 0; i < 5; i++) { // 머리 판 위로 흘러내리는 웨이브 가닥
        const phi = (-64 + i * 32) * Math.PI / 180;
        strand(Math.sin(phi) * .27, -.06, -Math.cos(phi) * .29 - .015, 4, .16, .018, .034, .06, Math.sin(phi) * .06, .14);
      }
      for (const s of [-1, 1]) strand(s * .27, -.3, .06, 2, .15, .024, .034, -.06, s * .12, .14); // 옆머리 끝(어깨 앞)
    } else if (P.hair === "bun") {
      cap(.272, Math.PI * .5, .58);
      ell(.105, .095, .105, mats.hair, 0, .59, -.03, head);           // 똥머리
      ell(.07, .035, .07, M(0x2b2b33), 0, .52, -.03, head);            // 머리끈
      for (const s of [-1, 1]) strand(s * .225, .04, .12, 2, .1, .012, .018, .08, -s * .04, .2); // 뺨 옆 잔머리
      ell(.018, .06, .018, mats.hair, .11, .41, .215, head).rotation.set(.3, 0, -.5);          // 앞 잔머리
    } else if (P.hair === "bob") {
      cap(.285, Math.PI * .62, .5);
      for (const s of [-1, 1]) ell(.05, .2, .1, mats.hair, s * .25, -.02, .03, head);
    } else { // short: 짧은 머리 + 이마로 내려오는 앞머리, 귀는 드러남
      cap(.27, Math.PI * .43, .45);
      [-.16, -.096, -.032, .032, .096, .16].forEach((x, i) => {
        const z = Math.sqrt(Math.max(0, .262 * .262 - x * x - .17 * .17)) + .012;
        ell(.04, .06, .028, mats.hair, x, .445, z, head).rotation.set(-.3, 0, i % 2 ? .2 : -.2);
      });
    }
    if (P.glasses) { // 얇은 검은 테 안경: 테 2개 + 브리지 + 다리
      for (const s of [-1, 1]) {
        add(torG(.05, .007, 24), mats.frame, s * .058, .278, .27, head, false);
        add(boxG(.008, .008, .24), mats.frame, s * .178, .284, .157, head, false).rotation.y = -s * .58;
      }
      add(boxG(.02, .008, .008), mats.frame, 0, .282, .274, head, false);
    }

    // 소품: 가슴에 안은 태블릿 / 옆구리에 낀 노트북(닫힘) / 회의 테이블 위 노트북(열림, group 기준)
    const props = {};
    if (P.props.tablet) {
      const t = props.tablet = grp(-.03, 1.0, .27, torso); t.rotation.set(-.3, 0, .12);
      add(boxG(.3, .4, .016), mats.gray, 0, 0, 0, t); add(boxG(.27, .36, .006), mats.screen, 0, 0, .008, t, false);
      t.visible = false;
    }
    if (P.props.laptop) {
      const s = P.props.laptop === "L" ? -1 : 1, l = props.laptop = grp(s * .4, .86, .02, torso);
      l.rotation.z = Math.PI / 2;
      add(boxG(.34, .024, .24), s > 0 ? mats.metal : mats.gray, 0, 0, 0, l);
      l.visible = false;
    }
    if (P.props.laptopOpen) {
      const l = props.laptopOpen = grp(0, .84, .55, group);
      add(boxG(.34, .018, .24), mats.metal, 0, .009, 0, l);
      add(boxG(.3, .005, .15), mats.dark, 0, .02, .02, l, false);
      const sc = grp(0, .018, .115, l); sc.rotation.x = .32;
      add(boxG(.34, .22, .012), mats.metal, 0, .11, 0, sc); add(boxG(.31, .19, .004), mats.screen, 0, .11, -.008, sc, false);
      l.visible = false;
    }

    // 성인 비율: 다리를 늘리고 몸통·두상을 줄인다. 관절 계약은 유지한다.
    legs.forEach(leg => { leg.position.y = .92; leg.scale.set(.8, 1.67, .85); });
    body.position.y = .92;
    torso.position.y = -.55 * .75;
    torso.scale.set(.78, .75, .85);
    head.scale.setScalar(.64);
    arms.forEach(arm => { arm.scale.y = 1.2; });
    group.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(group);
    const targetHeight = key === "gpt" ? 1.78 : key === "gemini" ? 1.68 : 1.72;
    const factor = targetHeight / (bounds.max.y - bounds.min.y);
    // 원점은 발바닥: 각 자식에 오프셋을 적용해 이동/회전 원점을 유지한다.
    for (const child of group.children) child.position.y -= bounds.min.y;
    group.scale.setScalar(factor);
    group.name = `character-${key || "member"}`;
    group.userData = { units: "meters", height: targetHeight, assetType: "articulated-character", forward: "+Z" };
    const hipHeight = legs[0].position.y * factor;

    let cur = "기본";
    const setFace = e => { if (e !== cur && faces[e]) { cur = e; faceMat.map = faces[e]; } };
    const dispose = () => { for (const t of texs) t.dispose(); for (const o of pool) o.dispose(); };
    return {
      group, legs, knees, body, torso, arms, elbows, hands, head, cup, props, height: targetHeight + .18, hipHeight, seatOffset: .535 - hipHeight, setFace, dispose, face: () => cur,
      preset: Object.assign({ tablet: false, laptop: null, laptopOpen: false, cupAlways: false, pocket: null }, P.props),
    };
  }

  window.Characters = { build, drawFace, EXPR, PRESETS };
  // app.js 보다 늦게 로드되었으면 알린다(app.js 가 캐릭터를 다시 만든다)
  window.dispatchEvent(new Event("characters-ready"));
})();
