'use strict';
/* 선택한 동물원 공간: 사무실과 같은 Decor/Agent 계약(build·spots·deskSet·spareDesks·navRects·nav·rooms·LIFE·theme)을 쓴다.
   넓은 동물원(타원 섬 45×35): 정문 광장 · 회의실(유리벽 회의 건물) · 팀장 전망대 · 서식지 마을 5곳(대나무 숲·호수·정글·극지·사바나, 작업석 12) ·
   카페 · 피크닉 잔디밭 · 호수 데크. 모든 장식은 three.js 기본 도형이며 많은 것(나무·대나무·꽃·울타리)은 InstancedMesh 로 한 번에 그린다.
   팀원 동물은 zoo-animals.js(12종)에서 만들고, 팀원별 동물 선택은 이 브라우저에 저장한다(같은 동물은 한 팀원만). */
window.ZooTheme = (() => {
  const office = window.Decor;
  const RX = 22.5, RZ = 17.5, OW = 48, OD = 38;            // 섬 반지름(가로·세로), 길 찾기 격자 크기
  const inIsland = (x, z, m = 0) => (x / (RX - m)) ** 2 + (z / (RZ - m)) ** 2 < 1;

  /* ── 자리 ── 0번은 팀장(전망대), 나머지는 마을 순서대로 채운다(처음 세 명: 팀장·대나무 숲·호수) */
  const desks = [
    { x: 0, z: -10.6, w: 2.6, zone: 'exec' },
    { x: 9, z: -9.6, w: 2.2, zone: 'bamboo' }, { x: 9.6, z: -.9, w: 2.2, zone: 'lake' }, { x: -11, z: -1.4, w: 2.2, zone: 'jungle' },
    { x: -9, z: -10.2, w: 2.2, zone: 'polar' }, { x: 9.4, z: 9.2, w: 2.2, zone: 'savanna' }, { x: 13, z: -9.6, w: 2.2, zone: 'bamboo' },
    { x: 9.6, z: 3.3, w: 2.2, zone: 'lake' }, { x: -15, z: -1.4, w: 2.2, zone: 'jungle' }, { x: -13, z: -10.2, w: 2.2, zone: 'polar' },
    { x: 13.4, z: 9.2, w: 2.2, zone: 'savanna' }, { x: -13, z: 3.4, w: 2.2, zone: 'jungle' },
  ];
  // 회의실: 섬 가운데의 유리벽 회의 건물(나무 아랫벽 + 유리 + 문 네 곳). 긴 회의 테이블 둘레 의자 12석, 북쪽 벽에 발표 화면.
  // 팀장은 화면 옆에서 발표하고 팀원은 의자에 앉아 듣는다. 위에서 보이도록 지붕은 두지 않는다(사무실 회의실과 같다)
  const ROOM = { x0: -5.6, x1: 5.6, z0: -4.6, z1: 3.6 };
  const DOORS = { s: [-.9, .9], w: [-.6, 1.2], e: [-.6, 1.2], n: [-4.4, -2.6] };   // 벽마다 문 틈(가로 벽은 x 범위, 세로 벽은 z 범위)
  const MEET_TABLE = { x: 0, z: .2, w: 5.2, d: 1.3 };
  const SCREEN = { x: .4, w: 3.2 };                                                // 북쪽 벽 안쪽 발표 화면
  const STAGE = { ...MEET_TABLE };                                                  // (예전 이름 유지) 회의 테이블 가운데
  const meetings = [...[-2, -1, 0, 1, 2].map(x => ({ x, z: -1.05 })), ...[-2, -1, 0, 1, 2].map(x => ({ x, z: 1.45 })), { x: -3.3, z: .2 }, { x: 3.3, z: .2 }];
  const CAFE = { x: 4.5, z: 10.4 };
  const coffees = Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2 + .26; return { x: +(CAFE.x + Math.cos(a) * 2).toFixed(2), z: +(CAFE.z + Math.sin(a) * 2).toFixed(2) }; })
    .filter(p => p.z < 12.2);
  while (coffees.length < 12) coffees.push({ ...coffees[coffees.length % 8] });
  const LAKE = { x: 16.5, z: 0, rx: 4, rz: 4.5 };
  const FOUNTAIN = { x: 0, z: 11.2 };

  // 서식지 마을·주요 장소(표지판·나무 심지 않을 곳)
  const zones = [
    { id: 'exec', x: 0, z: -11.5, r: 4.6, sign: '팀장 전망대', ground: 0x8fb36d },
    { id: 'meeting', x: 0, z: -.5, r: 7.6, sign: '회의실', ground: 0xd9bd8d },
    { id: 'lobby', x: 0, z: 13.8, r: 3.8, sign: 'WordNCode 동물원', ground: 0xd9bd8d },
    { id: 'cafe', x: 4.5, z: 11.3, r: 3.2, sign: '카페 · 매점', ground: 0xe2c79c },
    { id: 'picnic', x: -10, z: 10.6, r: 4.2, sign: '피크닉 잔디밭', ground: 0x86b766 },
    { id: 'polar', x: -11, z: -10.8, r: 4.4, sign: '극지 마을', ground: 0xe9f1f4 },
    { id: 'bamboo', x: 11.2, z: -10.4, r: 4, sign: '대나무 숲', ground: 0x77a35f },
    { id: 'jungle', x: -13, z: .8, r: 4.6, sign: '정글 마을', ground: 0x5f9150 },
    { id: 'lake', x: 13.5, z: .4, r: 5.6, sign: '호수 데크', ground: 0x8fb36d },
    { id: 'savanna', x: 11.4, z: 9.6, r: 4.2, sign: '사바나 마을', ground: 0xd8c27e },
  ];
  const R = (x, z, w, d, tag) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, tag });
  /** 회의실 벽 조각(문 틈을 뺀 부분): {axis: 'x'(가로 벽)|'z'(세로 벽), at: 벽 위치, a~b: 벽 범위} */
  function wallSegments() {
    const out = [], cut = (axis, at, a, b, gap) => { if (gap) { out.push({ axis, at, a, b: gap[0] }, { axis, at, a: gap[1], b }); } else out.push({ axis, at, a, b }); };
    cut('x', ROOM.z0, ROOM.x0, ROOM.x1, DOORS.n); cut('x', ROOM.z1, ROOM.x0, ROOM.x1, DOORS.s);
    cut('z', ROOM.x0, ROOM.z0, ROOM.z1, DOORS.w); cut('z', ROOM.x1, ROOM.z0, ROOM.z1, DOORS.e);
    return out;
  }

  /* ── 팀원 동물(종류 선택은 이 브라우저에 저장) ── */
  const LOOK_KEY = 'agentOffice.zooLooks';
  const DEFAULT = { claude: 'fox', gpt: 'penguin', gemini: 'otter' };
  // 기존 브라우저의 GPT 외형도 이번 역할 변경 때 한 번만 갱신한다.
  try {
    if (window.SpaceTheme?.isZoo && !localStorage.getItem('agentOffice.designPenguin.v1')) {
      const looks = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}');
      for (const k of Object.keys(looks)) if (k !== 'gpt' && looks[k] === 'penguin') delete looks[k];
      looks.gpt = 'penguin'; localStorage.setItem(LOOK_KEY, JSON.stringify(looks));
      localStorage.setItem('agentOffice.designPenguin.v1', '1');
    }
  } catch { /* 저장 불가 시 새 기본 외형 사용 */ }
  const LEGACY = [{ id: 'fox', label: '여우', emoji: '🦊' }, { id: 'panda', label: '판다', emoji: '🐼' }, { id: 'otter', label: '수달', emoji: '🦦' }];
  const species = () => (window.ZooAnimals?.species?.length ? window.ZooAnimals.species : LEGACY);
  const validKind = k => species().some(s => s.id === k);
  const saved = () => { try { const v = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const teamNames = () => { try { return D.names.slice(); } catch { return []; } };
  /** 팀 전체의 동물 배정: 저장한 선택 → 기본(Claude 여우·GPT 판다·Gemini 수달) → 남은 동물 차례로. 같은 동물은 한 명만 */
  function assign(names = teamNames()) {
    const s = saved(), out = {}, used = new Set();
    const keys = names.map(n => String(n).toLowerCase());
    for (const k of keys) if (validKind(s[k]) && !used.has(s[k])) { out[k] = s[k]; used.add(s[k]); }
    for (const k of keys) if (!out[k] && DEFAULT[k] && validKind(DEFAULT[k]) && !used.has(DEFAULT[k])) { out[k] = DEFAULT[k]; used.add(DEFAULT[k]); }
    for (const k of keys) if (!out[k]) { const free = species().find(sp => !used.has(sp.id)); out[k] = free ? free.id : 'fox'; used.add(out[k]); }
    return out;
  }
  function kindOf(name) {
    const k = String(name).toLowerCase(), names = teamNames();
    return assign(names.map(n => String(n).toLowerCase()).includes(k) ? names : [...names, k])[k] || DEFAULT[k] || 'fox';
  }
  function setKind(name, kind) {
    if (!validKind(kind)) return false;
    const k = String(name).toLowerCase(), now = assign();
    if (Object.entries(now).some(([n, v]) => n !== k && v === kind)) return false;
    const s = saved(); s[k] = kind;
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경: 이번 화면에서만 */ }
    return true;
  }
  const speciesOf = kind => species().find(s => s.id === kind) || species()[0];
  const icon = name => speciesOf(kindOf(name)).emoji || '🐾';
  const portraits = new Map();
  function emojiFace(kind) {
    if (!portraits.has(kind)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.font = '92px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(speciesOf(kind).emoji || '🐾', 64, 70);
      portraits.set(kind, { src: canvas.toDataURL(), n: 1, index: () => 0 });
    }
    return portraits.get(kind);
  }
  // 팀원이 아닌 동물원 사람(원장 코끼리·공작새 디자인팀장): zoo-animals.js 의 extras. 이름이 곧 종류다
  const extraIds = () => (window.ZooAnimals?.extras || []).map(e => (typeof e === 'string' ? e : e.id));
  const isExtra = name => extraIds().includes(String(name));
  const faces = name => (isExtra(name) ? window.ZooAnimals.faces(String(name)) : window.ZooAnimals?.faces ? window.ZooAnimals.faces(kindOf(name)) : emojiFace(kindOf(name)));

  // 메쉬·재질은 호출별로 소유한다. 팀 재배치 시 공용 재질을 함께 dispose하지 않는다.
  function kit() {
    const T = THREE, materials = new Map();
    function material(color, extra) { const key = extra ? `${color}:${JSON.stringify(extra)}` : color; if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .85, ...(extra || {}) })); return materials.get(key); }
    function mesh(p, g, c, x = 0, y = 0, z = 0, extra) { const m = new T.Mesh(g, material(c, extra)); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; p.add(m); return m; }
    function box(p, c, x, y, z, w, h, d) { return mesh(p, new T.BoxGeometry(w, h, d), c, x, y, z); }
    function ball(p, c, x, y, z, sx, sy = sx, sz = sx) { const m = mesh(p, new T.SphereGeometry(1, 20, 14), c, x, y, z); m.scale.set(sx, sy, sz); return m; }
    function cylinder(p, c, x, y, z, r, h, seg = 20) { return mesh(p, new T.CylinderGeometry(r, r, h, seg), c, x, y, z); }
    function beam(p, c, a, b, r) { const start = new T.Vector3(...a), end = new T.Vector3(...b), delta = end.clone().sub(start); const m = cylinder(p, c, ...start.clone().add(end).multiplyScalar(.5).toArray(), r, delta.length(), 8); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); return m; }
    /** 같은 모양 여러 개를 한 번에 그린다. items: {x,y,z,s|sx,sy,sz,rx,ry,rz,color?} */
    function many(p, geometry, color, items, opts = {}) {
      if (!items.length) return null;
      const m = new T.InstancedMesh(geometry, new T.MeshStandardMaterial({ color: 0xffffff, roughness: opts.rough ?? .85, ...(opts.mat || {}) }), items.length);
      const o = new T.Object3D(), c = new T.Color();
      items.forEach((it, i) => {
        o.position.set(it.x, it.y || 0, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        o.scale.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, c.setHex(it.color ?? color));
      });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = opts.cast !== false; m.receiveShadow = true; p.add(m); return m;
    }
    return { T, mesh, box, ball, cylinder, beam, many };
  }

  /* ── 동물 ── zoo-animals.js 가 있으면 12종, 없으면 기존 세 종(여우·판다·수달) */
  function buildAnimal(def, name, kind) {
    if (!kind && isExtra(name)) kind = String(name);
    kind = validKind(kind) || isExtra(kind) ? kind : kindOf(name);
    if (window.ZooAnimals?.build) {
      const rig = window.ZooAnimals.build(kind, name);
      rig.faceStrip = faces(name);
      return rig;
    }
    return legacyAnimal(kind, name);
  }
  function legacyAnimal(kind, name) {
    const { T, mesh, box, ball, cylinder } = kit();
    if (!['fox', 'panda', 'otter'].includes(kind)) kind = 'fox';
    const orange = 0xd98039, cream = 0xf2dec0, dark = 0x30332e, brown = 0x8d6247;
    const color = kind === 'fox' ? orange : kind === 'panda' ? 0xf2eee0 : brown;
    const group = new T.Group(), body = new T.Group(), head = new T.Group(); group.add(body); head.position.set(0, 1.8, .04); body.add(head);
    ball(body, color, 0, .92, 0, .53, .68, .43); ball(body, kind === 'panda' ? color : cream, 0, .94, .34, .36, .43, .13);
    ball(head, color, 0, 0, 0, .61, .53, .49);
    const legs = [], arms = [], eyes = [];
    for (const side of [-1, 1]) {
      const leg = new T.Group(); leg.position.set(side * .28, .4, 0); group.add(leg); legs.push(leg);
      ball(leg, kind === 'panda' ? dark : color, 0, -.12, .13, .22, .2, .31);
      const arm = new T.Group(); arm.position.set(side * .51, 1.2, .02); body.add(arm); arms.push(arm);
      ball(arm, kind === 'panda' ? dark : color, side * .02, -.22, .06, .18, .35, .19);
      if (kind === 'fox') {
        const ear = mesh(head, new T.ConeGeometry(.23, .6, 4), orange, side * .4, .57, -.03); ear.rotation.z = -side * .2;
        const inner = mesh(head, new T.ConeGeometry(.12, .35, 3), cream, side * .4, .58, .12); inner.rotation.z = -side * .2;
      } else ball(head, kind === 'panda' ? dark : brown, side * .43, .4, -.04, .22, .22, .14);
      if (kind === 'panda') ball(head, dark, side * .24, .03, .404, .18, .21, .07);
      eyes.push(ball(head, 0x171f1b, side * .23, .07, .465, .065)); ball(head, 0xffffff, side * .21, .1, .512, .018);
    }
    ball(head, cream, 0, -.21, .43, .31, .2, .18); ball(head, 0x292c26, 0, -.12, .6, .09, .065, .07);
    if (kind !== 'panda') {
      const tail = ball(body, color, kind === 'fox' ? .45 : 0, .65, -.48, .26, .32, kind === 'fox' ? .72 : .65); tail.rotation.y = kind === 'fox' ? -.65 : 0;
      if (kind === 'fox') ball(body, cream, .76, .65, -.95, .22, .25, .27);
    }
    box(body, kind === 'fox' ? 0x68865b : kind === 'panda' ? 0x3c8781 : 0xc6a05b, 0, 1.32, .36, .31, .16, .15);
    const cup = new T.Group(); arms[1].add(cup); cup.position.set(0, -.4, .1); cylinder(cup, 0xf4e7cc, 0, 0, 0, .085, .16); cup.visible = false;
    group.name = `zoo-agent-${name}`; group.userData.kind = kind;
    return { group, body, head, legs, arms, cup, props: {}, preset: {}, height: 2.95, seatOffset: .02,
      faceStrip: faces(name), setFace(expr) { for (const eye of eyes) eye.scale.y = expr === '웃음' ? .025 : expr === '놀람' ? .085 : .065; }, dispose() {} };
  }

  /* ── 장식 배치 데이터 ── */
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const nearZone = (x, z, pad = 0) => zones.some(q => Math.hypot(x - q.x, z - q.z) < q.r + pad);
  const nearDesk = (x, z, pad) => desks.some(d => Math.abs(x - d.x) < d.w / 2 + pad && z > d.z - .6 - pad && z < d.z + 1.6 + pad);
  // 길(광장 중심에서 각 장소로 뻗는 산책로)
  const PATHS = [[0, -1, 0, -8], [0, -1, -9, -8], [0, -1, 9, -8], [0, -1, -10, -.4], [0, -1, 11.2, .4], [0, -1, 9, 8], [0, -1, 4.2, 9], [0, -1, -8, 9], [0, -1, 0, 14]];
  const onPath = (x, z, pad = 1) => PATHS.some(([ax, az, bx, bz]) => {
    const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < pad;
  });
  // 나무는 시야를 가리지 않게 최소로: 카메라 반대쪽(북서쪽 울타리 가)의 낮은 나무 몇 그루만
  const TREES = [[-17.2, -8.6, .7], [-6, -15.4, .7], [-19.6, -2.6, .65]];
  const BAMBOO = [[11.2, -13.6], [7.2, -12.8]];   // 대나무 덤불 중심
  const PALMS = [[-17.4, -3.2], [-16.8, 4.2]];
  const ACACIA = [[15.6, 12]];
  const PINES = [[-7, -13.4], [-15.4, -12.4]];
  const IGLOO = { x: -11, z: -13.8 };
  // 표지판 자리(책상·길과 겹치지 않게 손으로 둔다). 정문은 아치 위
  const SIGNS = { exec: [-3.4, -9], meeting: [6.6, -5.4], lobby: [0, 15.8], cafe: [7.4, 12.6], picnic: [-6.6, 12.8], polar: [-11, -6.8],
    bamboo: [11, -6.6], jungle: [-17.6, 1.8], lake: [11, -3.2], savanna: [11.4, 6.6] };
  const EDGE = .6; // 울타리 안쪽으로 걸을 수 있는 여유
  const TREEHOUSE = { x: 0, z: -14.9 };

  function build(scene) {
    const { T, mesh, box, ball, cylinder, beam, many } = kit();
    try { Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27 }); sun.shadow.camera.updateProjectionMatrix(); } catch { /* 해(sun)는 app.js 가 만든다 */ }
    // 섬 바닥·흙 테두리
    const ground = cylinder(scene, 0x7b9d66, 0, -.45, 0, RX + 1.2, .8, 72); ground.scale.z = (RZ + 1.2) / (RX + 1.2);
    const slab = cylinder(scene, 0xb89a74, 0, -.89, 0, RX + 1.15, .15, 72); slab.scale.z = ground.scale.z;
    // 구역 바닥(얇은 원판: 극지 눈밭·사바나 마른 풀·광장 모래)
    zones.forEach((q, i) => { const d = cylinder(scene, q.ground, q.x, -.03 + i * .002, q.z, q.r * (q.id === 'lake' ? .7 : .92), .06, 40); d.castShadow = false; });
    // 산책로
    for (const [ax, az, bx, bz] of PATHS) {
      const len = Math.hypot(bx - ax, bz - az), p = box(scene, 0xd9bd8d, (ax + bx) / 2, -.005, (az + bz) / 2, 1.5, .03, len);
      p.rotation.y = Math.atan2(bx - ax, bz - az); p.castShadow = false;
    }

    // ── 회의실: 나무 바닥·아랫벽·유리벽·문·긴 테이블·의자 12·발표 화면·조명 ──
    const roomW = ROOM.x1 - ROOM.x0, roomD = ROOM.z1 - ROOM.z0, rcx = (ROOM.x0 + ROOM.x1) / 2, rcz = (ROOM.z0 + ROOM.z1) / 2;
    box(scene, 0xcaa47a, rcx, .02, rcz, roomW, .04, roomD).castShadow = false;
    const glass = new T.MeshStandardMaterial({ color: 0xcfe6ee, roughness: .1, metalness: .1, transparent: true, opacity: .28, depthWrite: false });
    for (const seg of wallSegments()) {
      const along = seg.axis === 'x', len = seg.b - seg.a, mid = (seg.a + seg.b) / 2;
      const [x, z] = along ? [mid, seg.at] : [seg.at, mid], [w, d] = along ? [len, .16] : [.16, len];
      box(scene, 0x9c7851, x, .45, z, w, .9, d);                                   // 나무 아랫벽
      const g = new T.Mesh(new T.BoxGeometry(w, 1.5, d * .4), glass); g.position.set(x, 1.65, z); scene.add(g); // 유리
      box(scene, 0x7d5c3d, x, 2.42, z, w, .08, d);                                 // 윗 난간
      for (const e of [seg.a, seg.b]) { const [px, pz] = along ? [e, seg.at] : [seg.at, e]; box(scene, 0x7d5c3d, px, 1.23, pz, .18, 2.46, .18); }
    }
    // 긴 회의 테이블과 의자(등받이는 바깥쪽)
    box(scene, 0xd4b07c, MEET_TABLE.x, .78, MEET_TABLE.z, MEET_TABLE.w, .1, MEET_TABLE.d);
    for (const dx of [-MEET_TABLE.w / 2 + .3, MEET_TABLE.w / 2 - .3]) for (const dz of [-MEET_TABLE.d / 2 + .2, MEET_TABLE.d / 2 - .2]) box(scene, 0x916d47, MEET_TABLE.x + dx, .38, MEET_TABLE.z + dz, .1, .76, .1);
    for (let i = 0; i < 4; i++) box(scene, 0xf2ead8, -1.6 + i * 1.05, .85, MEET_TABLE.z + (i % 2 ? .25 : -.25), .45, .02, .32); // 테이블 위 서류
    many(scene, new T.BoxGeometry(.5, .08, .5), 0xba9364, meetings.map(p => ({ x: p.x, y: .45, z: p.z })));
    many(scene, new T.BoxGeometry(.5, .5, .07), 0x9c7851, meetings.map(p => {
      const out = Math.abs(p.x) > 3 ? [Math.sign(p.x) * .24, 0] : [0, Math.sign(p.z - MEET_TABLE.z) * .24];
      return { x: p.x + out[0], y: .72, z: p.z + out[1], ry: Math.abs(p.x) > 3 ? Math.PI / 2 : 0 };
    }));
    many(scene, new T.CylinderGeometry(.04, .04, .45, 6), 0x7d5c3d, meetings.map(p => ({ x: p.x, y: .22, z: p.z })));
    // 북쪽 벽 안쪽 발표 화면(계획 줄이 한 장씩 채워진다)
    box(scene, 0x2e3a40, SCREEN.x, 1.75, ROOM.z0 + .2, SCREEN.w + .2, 1.6, .1); box(scene, 0xeef3ee, SCREEN.x, 1.75, ROOM.z0 + .26, SCREEN.w, 1.4, .02);
    const strokes = Array.from({ length: 6 }, (_, i) => { const m = box(scene, i % 2 ? 0x3c8781 : 0x567963, SCREEN.x - .2, 2.25 - i * .18, ROOM.z0 + .28, 2 - i * .18, .07, .02); m.material = m.material.clone(); m.visible = false; return m; });
    // 화분·물병 정수기 같은 소품
    for (const [x, z] of [[-5.1, -4.1], [5.1, -4.1], [5.1, 3.1], [-5.1, 3.1]]) { cylinder(scene, 0xb07a52, x, .25, z, .22, .5, 12); ball(scene, 0x5a8c50, x, .75, z, .35, .4, .35); }
    // 테이블 위 매달린 등(밤에 켜진다)
    cylinder(scene, 0x3b3f42, 0, 2.9, MEET_TABLE.z, .02, .9, 6);
    const pendantMat = new T.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc76a, emissiveIntensity: 0, roughness: .4 });
    const pendant = new T.Mesh(new T.ConeGeometry(.45, .35, 18, 1, true), pendantMat); pendant.position.set(0, 2.35, MEET_TABLE.z); pendant.material.side = T.DoubleSide; scene.add(pendant);

    // ── 정문 광장: 아치 문·매표소·분수 ──
    for (const x of [-2.4, 2.4]) { cylinder(scene, 0x8a6a48, x, 1.6, 15.8, .22, 3.2); ball(scene, 0x6a9859, x, 3.3, 15.8, .42); }
    const arch = mesh(scene, new T.TorusGeometry(2.4, .16, 10, 30, Math.PI), 0x9c7851, 0, 3.1, 15.8); arch.castShadow = true;
    box(scene, 0x9c7851, 0, 3.75, 15.8, 3.2, .7, .14);
    box(scene, 0xc49a68, -4.4, 1, 14.5, 1.8, 2, 1.3); box(scene, 0xd65c4a, -4.4, 2.15, 14.5, 2.1, .2, 1.6); box(scene, 0x30413a, -4.4, 1.2, 15.16, 1, .55, .02);
    cylinder(scene, 0xb7b2a6, FOUNTAIN.x, .25, FOUNTAIN.z, 1.25, .5, 32); const pool = cylinder(scene, 0x5fb6c4, FOUNTAIN.x, .48, FOUNTAIN.z, 1.08, .06, 32); pool.material.roughness = .25;
    cylinder(scene, 0xb7b2a6, FOUNTAIN.x, .95, FOUNTAIN.z, .2, 1); const spray = ball(scene, 0x9ad7e0, FOUNTAIN.x, 1.55, FOUNTAIN.z, .38, .3, .38); spray.material.transparent = true; spray.material.opacity = .7;

    // ── 팀장 전망대 언덕: 나무집·망원경 ──
    cylinder(scene, 0x7d5c3d, TREEHOUSE.x, 1.6, TREEHOUSE.z, .45, 3.2);
    box(scene, 0xa07b52, TREEHOUSE.x, 3.2, TREEHOUSE.z, 2.8, .18, 2.4); box(scene, 0xd9b27c, TREEHOUSE.x, 3.95, TREEHOUSE.z, 2, 1.3, 1.7);
    mesh(scene, new T.ConeGeometry(1.75, 1.1, 4), 0xc0573f, TREEHOUSE.x, 5.15, TREEHOUSE.z).rotation.y = Math.PI / 4;
    ball(scene, 0x4b8051, TREEHOUSE.x + 1.1, 4.3, TREEHOUSE.z - .9, .7, .6, .6);
    for (const y of [.5, 1, 1.5, 2, 2.5]) box(scene, 0x8a6a48, TREEHOUSE.x + .9, y, TREEHOUSE.z + 1.25, .5, .06, .06);
    cylinder(scene, 0x8a6a48, -2.6, .2, -13.2, .36, .4, 14); cylinder(scene, 0xa07b52, -2.6, .55, -12.2, .45, .08, 16); cylinder(scene, 0x7d5c3d, -2.6, .27, -12.2, .07, .5, 8); // 원장 자리
    cylinder(scene, 0x5d6b73, 2.8, .55, -12.8, .06, 1.1); const scope = cylinder(scene, 0x34434c, 2.8, 1.2, -12.8, .1, .7); scope.rotation.x = 1.1;

    // ── 극지 마을: 이글루·눈더미·얼음 연못·눈 덮인 침엽수 ──
    const igloo = mesh(scene, new T.SphereGeometry(1.5, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0xf4f8fa, IGLOO.x, 0, IGLOO.z);
    igloo.material.roughness = .6; box(scene, 0xe6eef2, IGLOO.x, .45, IGLOO.z + 1.45, .9, .9, .8);
    many(scene, new T.SphereGeometry(1, 12, 8), 0xffffff, [[-7.6, -7.4], [-14.6, -7.6], [-8.4, -13.2], [-13.6, -14]].map(([x, z], i) => ({ x, y: .05, z, sx: .7 + i * .1, sy: .35, sz: .6 })));
    const ice = cylinder(scene, 0xbfe3ef, -14.6, .01, -11.4, 1.2, .04, 28); ice.scale.z = .7; ice.material.roughness = .15;
    for (const [x, z] of PINES) { cylinder(scene, 0x6b5139, x, .3, z, .1, .6); mesh(scene, new T.ConeGeometry(.6, 1.1, 10), 0x3e6b4f, x, 1.05, z); mesh(scene, new T.ConeGeometry(.38, .7, 10), 0xf2f6f8, x, 1.7, z); }

    // ── 대나무 숲 ──
    const stalks = [], rings = [], tufts = [];
    const rb = rng(11);
    for (const [cx, cz] of BAMBOO) for (let i = 0; i < 6; i++) {
      const x = cx + (rb() - .5) * 1.6, z = cz + (rb() - .5) * 1.4, h = 1.5 + rb() * .8;
      stalks.push({ x, y: h / 2, z, sx: 1, sy: h, sz: 1, rz: (rb() - .5) * .08 });
      for (let j = 1; j < 4; j++) rings.push({ x, y: j * h / 4, z });
      tufts.push({ x: x + .15, y: h - .2, z, sx: .32, sy: .12, sz: .14 });
    }
    many(scene, new T.CylinderGeometry(.075, .075, 1, 8), 0x5a8c48, stalks); many(scene, new T.CylinderGeometry(.09, .09, .05, 8), 0x91b967, rings); many(scene, new T.SphereGeometry(1, 8, 6), 0x709b48, tufts);

    // ── 호수: 물·돌 테두리·연잎·작은 섬·나무 데크 ──
    const lakeBed = cylinder(scene, 0x8fbaa7, LAKE.x, .01, LAKE.z, LAKE.rx + .35, .05, 40); lakeBed.scale.z = (LAKE.rz + .35) / (LAKE.rx + .35); lakeBed.castShadow = false;
    const water = cylinder(scene, 0x56aeb8, LAKE.x, .05, LAKE.z, LAKE.rx, .04, 40); water.scale.z = LAKE.rz / LAKE.rx; water.material.roughness = .22; water.castShadow = false;
    many(scene, new T.SphereGeometry(1, 10, 8), 0x939a8a, Array.from({ length: 26 }, (_, i) => { const a = i / 26 * Math.PI * 2; return { x: LAKE.x + (LAKE.rx + .3) * Math.cos(a), y: .18, z: LAKE.z + (LAKE.rz + .3) * Math.sin(a), sx: .45, sy: .28, sz: .36, ry: a }; }).filter(p => p.x > LAKE.x - LAKE.rx + .4 || Math.abs(p.z - LAKE.z) > 2.2));
    many(scene, new T.CylinderGeometry(.26, .26, .03, 12), 0x538958, [[15.2, -1.8], [17.6, 2.4], [18.6, -2], [14.6, 2], [16.2, 3.2]].map(([x, z]) => ({ x, y: .085, z })), { cast: false });
    cylinder(scene, 0x7b9d66, 17.6, .09, -.4, .9, .1, 20); cylinder(scene, 0x866444, 17.6, .6, -.4, .1, 1); ball(scene, 0x5a8c50, 17.6, 1.35, -.4, .55, .5, .5);
    box(scene, 0xa98257, 12.2, .06, .4, 1.6, .08, 4.2).castShadow = false;
    for (const z of [-1.6, 2.4]) for (const x of [11.5, 12.9]) cylinder(scene, 0x7d5c3d, x, .45, z, .06, .9);
    beam(scene, 0x9c7851, [12.9, .8, -1.6], [12.9, .8, 2.4], .04);

    // ── 정글 마을: 야자수·큰 잎 덤불·덩굴 아치 ──
    for (const [x, z] of PALMS) {
      const trunk = cylinder(scene, 0x8d6a45, x, 1, z, .14, 2, 10); trunk.rotation.z = .08;
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, leaf = ball(scene, i % 2 ? 0x3f8a4a : 0x4f9a52, x + Math.cos(a) * .6, 2, z + Math.sin(a) * .6, .7, .1, .24); leaf.rotation.y = -a; leaf.rotation.z = -.3; }
      ball(scene, 0x6b4a2c, x + .1, 1.85, z, .1);
    }
    many(scene, new T.SphereGeometry(1, 10, 8), 0x3f7f45, [[-17.6, 1], [-10, -4.2], [-15.6, 6.4], [-8.6, 5]].map(([x, z]) => ({ x, y: .45, z, sx: .9, sy: .6, sz: .8 })));
    for (const x of [-14.4, -11.6]) cylinder(scene, 0x6b5139, x, 1.3, -4.6, .12, 2.6);
    mesh(scene, new T.TorusGeometry(1.4, .09, 8, 20, Math.PI), 0x4f8a3f, -13, 2.6, -4.6);

    // ── 사바나 마을: 아카시아·개미탑·바위 언덕·마른 풀 ──
    for (const [x, z] of ACACIA) { cylinder(scene, 0x7a5a3a, x, .9, z, .12, 1.8); const crown = cylinder(scene, 0x6f8f3e, x, 1.9, z, 1.2, .25, 18); crown.scale.z = .75; }
    mesh(scene, new T.ConeGeometry(.6, 1.6, 10), 0xb5895a, 15.4, .8, 9.4);
    many(scene, new T.DodecahedronGeometry(1, 0), 0xa59a86, [[16.8, 10.4, .9], [17.5, 9.2, .7], [7.4, 7.6, .55]].map(([x, z, s]) => ({ x, y: s * .5, z, s, ry: x })));

    // ── 카페·매점: 줄무늬 차양 매대·원탁·파라솔 ──
    box(scene, 0xe9dcc2, CAFE.x, .55, 13.3, 2.8, 1.1, .9);
    for (let i = 0; i < 6; i++) box(scene, i % 2 ? 0xf2efe8 : 0x3c8781, CAFE.x - 1.25 + i * .5, 2.05, 13.05, .5, .12, 1.3);
    for (const x of [-1.3, 1.3]) cylinder(scene, 0x8a6a48, CAFE.x + x, 1, 13.6, .06, 2);
    cylinder(scene, 0xd4b07c, CAFE.x, .8, CAFE.z, .9, .1, 24); cylinder(scene, 0x916d47, CAFE.x, .4, CAFE.z, .1, .8);
    cylinder(scene, 0x8a8a8a, CAFE.x, 1.5, CAFE.z, .04, 1.5); mesh(scene, new T.ConeGeometry(1.4, .55, 12), 0xd65c4a, CAFE.x, 2.35, CAFE.z);

    // ── 피크닉 잔디밭: 돗자리·벤치·바구니·해먹 ──
    [[-11.6, 11.4, 0xd9534f], [-8, 12, 0x4f7cf7]].forEach(([x, z, c], i) => { const b = box(scene, c, x, .01, z, 1.8, .02, 1.4); b.rotation.y = .3 + i * .5; b.castShadow = false; });
    box(scene, 0xba9364, -9, .4, 9.2, 1.8, .15, .65); for (const x of [-9.6, -8.4]) box(scene, 0x916d47, x, .18, 9.2, .13, .35, .5);
    box(scene, 0xba9364, -12.6, .4, 8.4, 1.8, .15, .65); for (const x of [-13.2, -12]) box(scene, 0x916d47, x, .18, 8.4, .13, .35, .5);
    box(scene, 0xb07a3c, -11.2, .18, 11.6, .5, .35, .38);
    for (const x of [-15.4, -13]) cylinder(scene, 0x7d5c3d, x, .9, 13.4, .1, 1.8);
    const hammock = mesh(scene, new T.CylinderGeometry(.5, .5, 2.3, 14, 1, true, 0, Math.PI), 0xe6c35c, -14.2, 1.05, 13.4); hammock.rotation.z = Math.PI / 2; hammock.material.side = T.DoubleSide;

    // ── 숲 나무(InstancedMesh: 줄기 1 + 잎 3) ──
    const trunks = [], leafA = [], leafB = [], leafC = [];
    for (const [x, z, s] of TREES) {
      trunks.push({ x, y: 1.1 * s, z, sx: s, sy: s, sz: s });
      leafA.push({ x, y: 2.6 * s, z, sx: 1.05 * s, sy: 1.3 * s, sz: 1 * s });
      leafB.push({ x: x + .6 * s, y: 2.7 * s, z: z + .1 * s, s: .72 * s });
      leafC.push({ x: x - .55 * s, y: 2.5 * s, z: z + .3 * s, s: .8 * s });
    }
    many(scene, new T.CylinderGeometry(.16, .16, 2.2, 8), 0x866444, trunks);
    many(scene, new T.SphereGeometry(1, 14, 10), 0x4b8051, leafA); many(scene, new T.SphereGeometry(1, 12, 8), 0x6a9859, leafB); many(scene, new T.SphereGeometry(1, 12, 8), 0x5a8c50, leafC);
    // 꽃·풀 덤불(빈 땅에 흩어 심기)
    const bushes = [], flowers = [], rf = rng(23);
    for (let i = 0; bushes.length < 120 && i < 3000; i++) {
      const x = (rf() * 2 - 1) * (RX - .8), z = (rf() * 2 - 1) * (RZ - .8);
      if (!inIsland(x, z, .9) || nearZone(x, z, -.3) || onPath(x, z, .9) || nearDesk(x, z, .6)) continue;
      bushes.push({ x, y: .14, z, sx: .3 + rf() * .15, sy: .18, sz: .28 });
      if (i % 2) flowers.push({ x: x + .1, y: .34, z, s: .085, color: [0xe7ca85, 0xe58fa5, 0xf2f2f2, 0xb59ce0][i % 4] });
    }
    many(scene, new T.SphereGeometry(1, 8, 6), 0x689455, bushes, { cast: false }); many(scene, new T.SphereGeometry(1, 6, 5), 0xffffff, flowers, { cast: false });

    // ── 울타리(정문 자리는 비운다) ──
    const posts = [], rails = [], N = 72;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, b = (i + 1) / N * Math.PI * 2, gate = t => t > 1.43 && t < 1.71;
      const x = (RX - .4) * Math.cos(a), z = (RZ - .4) * Math.sin(a);
      if (gate(a)) continue;
      posts.push({ x, y: .48, z });
      if (gate(b)) continue;
      const x2 = (RX - .4) * Math.cos(b), z2 = (RZ - .4) * Math.sin(b), len = Math.hypot(x2 - x, z2 - z), ry = Math.atan2(x2 - x, z2 - z);
      for (const y of [.35, .7]) rails.push({ x: (x + x2) / 2, y, z: (z + z2) / 2, sx: 1, sy: 1, sz: len, ry });
    }
    many(scene, new T.CylinderGeometry(.095, .095, .95, 8), 0x9c7851, posts); many(scene, new T.BoxGeometry(.07, .07, 1), 0xc7aa7d, rails);

    // ── 표지판(나무 기둥 + 글자 판) ──
    const signs = [];
    for (const q of zones) {
      const [sx, sz] = SIGNS[q.id];
      if (q.id !== 'lobby') cylinder(scene, 0x7d5c3d, sx, .8, sz, .07, 1.6, 8);
      if (q.id !== 'lobby') cylinder(scene, 0x7d5c3d, sx, 1.9, sz, .07, 1.2, 8);
      signs.push(label(T, scene, q.sign, sx, q.id === 'lobby' ? 4.7 : 2.9, sz, q.id === 'lobby' ? 1.6 : 1.25));
    }

    // ── 밤 조명: 산책로 가로등(전구 밝기)·점광원 3개·반딧불 ──
    const bulbMat = new T.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc76a, emissiveIntensity: 0, roughness: .4 });
    const lampPts = PATHS.map(([ax, az, bx, bz]) => ({ x: ax + (bx - ax) * .62 + .95, z: az + (bz - az) * .62 })).filter(p => !nearDesk(p.x, p.z, .4));
    many(scene, new T.CylinderGeometry(.05, .06, 1.8, 8), 0x3b3f42, lampPts.map(p => ({ ...p, y: .9 })));
    const bulbs = new T.InstancedMesh(new T.SphereGeometry(.17, 12, 8), bulbMat, lampPts.length);
    { const o = new T.Object3D(); lampPts.forEach((p, i) => { o.position.set(p.x, 1.9, p.z); o.updateMatrix(); bulbs.setMatrixAt(i, o.matrix); }); scene.add(bulbs); }
    const lights = [{ x: 0, z: MEET_TABLE.z }, { x: CAFE.x, z: CAFE.z }, { x: 0, z: 13 }].map(p => { const l = new T.PointLight(0xffc98a, 0, 14, 2); l.position.set(p.x, 3, p.z); scene.add(l); return l; });
    const flyN = 90, flyPos = new Float32Array(flyN * 3), fr = rng(5);
    for (let i = 0; i < flyN; i++) { let x, z; do { x = (fr() * 2 - 1) * RX; z = (fr() * 2 - 1) * RZ; } while (!inIsland(x, z, 1)); flyPos.set([x, .6 + fr() * 1.8, z], i * 3); }
    const flyGeo = new T.BufferGeometry(); flyGeo.setAttribute('position', new T.BufferAttribute(flyPos, 3));
    const flies = new T.Points(flyGeo, new T.PointsMaterial({ color: 0xfff3a0, size: .14, transparent: true, opacity: 0, depthWrite: false }));
    flies.visible = false; scene.add(flies);
    night.set = n => {
      bulbMat.emissiveIntensity = n * 1.6; pendantMat.emissiveIntensity = n * 2; for (const l of lights) l.intensity = n * .9;
      flies.visible = n > .35; flies.material.opacity = Math.min(1, (n - .35) * 2);
    };

    // 물결·분수·반딧불(움직임 줄이기면 멈춘다)
    const still = () => document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || window.SpaceTheme?.reduce;
    ground.onBeforeRender = () => {
      if (still()) return;
      const t = performance.now() / 1000;
      water.position.y = .05 + Math.sin(t / 1.5) * .006; spray.scale.y = .3 + Math.sin(t * 3) * .04;
      if (flies.visible) { const p = flyGeo.attributes.position; for (let i = 0; i < flyN; i += 3) p.array[i * 3 + 1] += Math.sin(t * 2 + i) * .002; p.needsUpdate = true; }
    };
    night.set(0);
    return { strokes };
  }
  /** 캔버스 글자를 붙인 표지 스프라이트 */
  function label(T, scene, text, x, y, z, scale = 1) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff9e9'; ctx.strokeStyle = '#8a6a48'; ctx.lineWidth = 8;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(6, 6, 500, 116, 26); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(6, 6, 500, 116); }
    ctx.fillStyle = '#294632'; ctx.font = '600 50px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 68);
    const tx = new T.CanvasTexture(c); tx.encoding = T.sRGBEncoding; tx.anisotropy = 4;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tx, depthTest: true })); s.position.set(x, y, z); s.scale.set(2.7 * scale, .68 * scale, 1); s.renderOrder = 2;
    scene.add(s); return s;
  }
  const night = { set: () => {} };

  function deskSet(parent, opts) {
    const { T, box, cylinder } = kit(), { x, z, w, mats } = opts;
    for (const dx of [-w / 2 + .15, w / 2 - .15]) box(parent, 0x95744b, x + dx, .4, z, .13, .8, .65);
    box(parent, opts.exec ? 0xb98a55 : 0xc5a16c, x, .84, z, w, .14, .85);
    const screens = mats.map((material, i) => {
      const group = new T.Group(); group.position.set(x + (i ? .47 : -.47), .92, z - .23); parent.add(group);
      box(group, 0x344e45, 0, .32, 0, .85, .54, .06);
      const screen = new T.Mesh(new T.PlaneGeometry(.76, .45), material); screen.position.set(0, .32, .035); group.add(screen); return screen;
    });
    box(parent, 0xe7dcc7, x, .94, z + .2, .7, .035, .19);
    const mug = cylinder(parent, 0xf4e7cc, x + w / 2 - .2, 1, z + .18, .075, .16);
    cylinder(parent, 0xba9364, x, .18, z + 1.15, .34, .36);
    return { screen: screens[0], mug, dispose() {} }; // 사무실 deskSet 과 같은 모양(장면 정리는 app.js 가 한다)
  }
  const deskOf = d => ({ desk: { x: d.x, z: d.z, w: d.w, facing: 0 }, seat: { x: d.x, z: d.z + 1.15 } });
  function spots(n) { return desks.slice(0, Math.min(desks.length, n)).map((d, i) => ({ ...deskOf(d), meet: { ...meetings[i % meetings.length] }, coffee: { ...coffees[i % coffees.length] } })); }
  /** 팀원이 없는 마을 자리에도 빈 책상을 둔다(마을마다 작업석이 보이게) */
  function spareDesks(n) { return desks.slice(n).map(d => ({ x: d.x, z: d.z, w: d.w, cols: 1, col: 0, facing: 0 })); }
  function navRects() {
    return [
      R(LAKE.x, LAKE.z, LAKE.rx * 2 + .6, LAKE.rz * 2 + .6, 'lake'), ...wallSegments().map(seg => seg.axis === 'x' ? R((seg.a + seg.b) / 2, seg.at, seg.b - seg.a + .18, .2, 'wall') : R(seg.at, (seg.a + seg.b) / 2, .2, seg.b - seg.a + .18, 'wall')),
      R(MEET_TABLE.x, MEET_TABLE.z, MEET_TABLE.w, MEET_TABLE.d, 'meeting-table'), R(SCREEN.x, ROOM.z0 + .2, SCREEN.w + .2, .3, 'screen'), R(FOUNTAIN.x, FOUNTAIN.z, 2.5, 2.5, 'fountain'),
      R(-4.4, 14.5, 2, 1.5, 'ticket'), R(-2.4, 15.8, .5, .5, 'gate'), R(2.4, 15.8, .5, .5, 'gate'),
      R(TREEHOUSE.x, TREEHOUSE.z, 2.9, 2.6, 'treehouse'), R(-2.6, -12.2, .9, .9, 'stump-table'), R(2.8, -12.8, .4, .4, 'scope'),
      R(IGLOO.x, IGLOO.z + .3, 3.1, 3.4, 'igloo'), R(-14.6, -11.4, 2.3, 1.6, 'ice'),
      R(CAFE.x, 13.3, 3, 1, 'kiosk'), R(CAFE.x, CAFE.z, 1.8, 1.8, 'cafe-table'), R(15.4, 9.4, 1.2, 1.2, 'termite'),
      ...BAMBOO.map(([x, z]) => R(x, z, 2, 1.8, 'bamboo')), ...PALMS.map(([x, z]) => R(x, z, .6, .6, 'palm')), ...ACACIA.map(([x, z]) => R(x, z, .5, .5, 'acacia')),
      ...PINES.map(([x, z]) => R(x, z, .6, .6, 'pine')), ...TREES.map(([x, z]) => R(x, z, .55, .55, 'tree')),
      R(16.8, 10.4, 1.6, 1.6, 'rock'), R(17.5, 9.2, 1.2, 1.2, 'rock'), R(7.4, 7.6, .9, .9, 'rock'),
      ...desks.map(d => R(d.x, d.z, d.w, .85, 'desk')),
    ];
  }
  const rooms = {
    lobby: { x0: -5, x1: 5, z0: 10, z1: 17, label: '정문 광장' },
    work: { x0: -17, x1: 15, z0: -12, z1: 11, label: '서식지 마을' },
    meeting: { x0: ROOM.x0, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z1, label: '회의실' },
    exec: { x0: -4, x1: 4, z0: -16, z1: -8, label: '팀장 전망대' },
    pantry: { x0: 1.5, x1: 7.5, z0: 8, z1: 14, label: '카페' },
    lounge: { x0: -15, x1: -5, z0: 7, z1: 14.5, label: '피크닉 잔디밭' },
    balcony: { x0: 11, x1: 21, z0: -5, z1: 5.5, label: '호수 데크' },
  };
  for (const room of Object.values(rooms)) room.door = null;

  function activate() {
    if (!office) return;
    const nav = Object.assign({}, office.nav, { x0: -OW / 2, z0: -OD / 2, grid: null, rects: [] });
    nav.build = function (rects) {
      const c = this.cell, r = this.r; this.rects = rects.map(q => ({ ...q, ix0: q.x0 - r, ix1: q.x1 + r, iz0: q.z0 - r, iz1: q.z1 + r }));
      this.nx = Math.round(OW / c); this.nz = Math.round(OD / c); this.grid = new Uint8Array(this.nx * this.nz);
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const { x, z } = this.center(i, j);
        this.grid[j * this.nx + i] = inIsland(x, z, EDGE) && !this.rects.some(q => x >= q.ix0 && x <= q.ix1 && z >= q.iz0 && z <= q.iz1) ? 1 : 0;
      }
      return this;
    };
    window.Decor = { OW, OD, PART_H: 0, SEATS: desks.length, rooms, nav, sun: office.sun, spots, navRects, build, deskSet, spareDesks, walkable: (x, z) => nav.walkable(x, z),
      TABLE: { x: MEET_TABLE.x, z: MEET_TABLE.z }, PRESENT_SPOT: { x: SCREEN.x - SCREEN.w / 2 - .7, z: ROOM.z0 + 1.1 }, WHITEBOARD: { x: SCREEN.x, z: ROOM.z0 + 1.2 }, BOARD_FACE: { x: SCREEN.x, z: ROOM.z0 },
      COUNTER: { x: CAFE.x, z: 13.3 }, PANTRY_TABLE: { ...CAFE }, COFFEE: coffees,
      // 조연(life.js) 장소: 원장 그루터기 자리·발표 때 서서 듣는 회의실 뒤편·산책 지점·경리팀장 순찰 지점·회의실 문 앞·말투용 구역
      NPC: {
        headSeat: { x: -2.6, z: -13.2 }, headFace: { x: -2.6, z: -10 },
        back: [{ x: -4.4, z: 2.7 }, { x: 4.4, z: 2.7 }, { x: 4.4, z: -2.4 }],
        wander: [[0, -5.4], [-4.4, -5.4], [4.4, -5.4], [-6.6, -.7], [6.6, -.3], [4.4, 4.4], [2.1, 4.4], [-4, 4.4], [0, 6.6], [0, 9.2], [-11, -7.4], [11, -7], [-13.2, -3.2], [12, 5.8],
          [-10, 12.6], [4.4, 8.2], [11, 12.6], [-6.8, 13.4], [-16, 7.4], [16.8, -6.4], [-6, -12.6], [6.4, -10.8]].map(([x, z]) => ({ x, z })),
        duckSpots: [[CAFE.x - 2.4, CAFE.z - .8], [CAFE.x + 2.4, CAFE.z - .8], [0, 4.4], [-6.6, .3], [6.6, .3], [11.6, 1.4], [-9, 10.4], [0, 13.6]].map(([x, z]) => ({ x, z })),
        meetingDoor: { x: 0, z: 4.6 },
        zones,
      },
      ENTRANCE: { x: 0, z: 14.2 }, LOBBY_DOOR: { axis: 'x', x: 0, z: 15.2 }, REPORT_SPOT: { x: 1.8, z: -9.3 },
      LIFE: { walk: [{ x: -5.6, z: 6.2 }, { x: -7, z: -.6 }, { x: -6.3, z: -6 }], window: { x: 11.5, z: .9 }, windowFace: { x: LAKE.x, z: LAKE.z },
        sofaApproach: { x: -9, z: 10.2 }, sofa: { x: -9, z: 9.55 }, sofaFace: { x: -9, z: 12 }, chat: [{ x: 2.2, z: 10.4 }, { x: 6.8, z: 10.4 }] },
      theme(n) {
        n = Math.max(0, Math.min(1, +n || 0)); night.set(n);
        // 바깥 공간: 사무실용 하늘빛(실내 밝은 벽 기준)을 조금 줄이고 햇빛을 키워 그림자·색이 또렷하게
        try { hemi.intensity *= .5 + n * .3; hemi.groundColor.lerp(_cb.setHex(0x55703f), .5 * (1 - n)); sun.intensity *= 1.45 - n * .35; } catch { /* app.js 조명이 없을 때 */ }
      }, themed: {} };
  }

  /** 팀원 동물 고르기 창(app.js 의 openAppearancePicker 가 동물원에서 부른다) */
  function openPicker(n) {
    let label = n; try { label = memberDef(n).label; } catch { /* 이름 그대로 */ }
    const now = assign(), mine = now[String(n).toLowerCase()];
    const takenBy = kind => Object.entries(now).find(([k, v]) => v === kind && k !== String(n).toLowerCase())?.[0];
    openModal([
      sheetHead(`${label}의 동물`, '고르면 바로 바뀌고 이 브라우저에 저장됩니다. 같은 동물은 한 팀원만 고를 수 있어요.'),
      el('div', { class: 'sheet-body' },
        el('div', { class: 'appearance-grid zoo-grid', role: 'group', 'aria-label': `${label} 동물 선택` },
          ...species().map(sp => {
            const owner = takenBy(sp.id);
            return el('button', { type: 'button', class: 'appearance-option', 'aria-pressed': String(mine === sp.id), disabled: !!owner,
              onclick: () => {
                try { if (D.running) { toast('업무가 끝난 뒤 동물을 바꿀 수 있어요.', 'warn'); return; } } catch { /* 업무 상태 모름 */ }
                if (!setKind(n, sp.id)) { toast('다른 팀원이 고른 동물이에요.', 'warn'); return; }
                try { A(n).changeAppearance(sp.id); } catch (e) { console.warn(e); }
                try { buildMembers(); } catch { /* 팀원 목록이 없을 수 있다 */ }
                window.Dashboard?.schedule(); closeModal();
                toast(`${label}이(가) ${sp.label}(으)로 바뀌었어요.`);
              } },
            el('span', { class: 'appearance-portrait zoo-emoji', 'aria-hidden': 'true', text: sp.emoji }),
            el('span', { text: sp.label }), el('small', { text: owner ? (() => { try { return `${memberDef(owner).label} 사용 중`; } catch { return '사용 중'; } })() : mine === sp.id ? '지금 동물' : '고르기' }));
          }))),
    ]);
  }

  if (window.SpaceTheme?.isZoo) activate();
  return { buildAnimal, faces, icon, isExtra, PATHS, FOUNTAIN, CAFE, STAGE, ROOM, kindOf, setKind, assign, species, openPicker, spots, navRects, desks, meetings, zones, LAKE, RX, RZ,
    get icons() { const o = {}; for (const n of teamNames()) o[n] = icon(n); return o; } };
})();
