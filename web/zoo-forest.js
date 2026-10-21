"use strict";
/* zoo-forest.js — 동물원 바깥 풍경(사무실의 '동네'에 해당): 동물원 섬을 둘러싼 진짜 같은 숲.
   - 지형: 완만한 언덕(나무가 언덕 높이를 따라 선다) · 숲 바닥 색 얼룩 · 꽃 핀 빈터
   - 숲: 나무 6종(소나무·참나무·자작나무·단풍나무·측백·덤불)이 노이즈로 모인 숲과 빈터를 이룬다(크기·기울기·색이 나무마다 다르다)
   - 볼거리: 굽이치는 강과 다리 · 언덕에서 떨어지는 폭포와 연못 · 굴뚝 연기 나는 통나무집 · 모닥불 캠핑장 · 전망대 · 숲속 연못 · 먼 산
   - 움직임: 빈터의 사슴 가족 · 깡충 토끼 · 강을 따라 흘러가는 나룻배 · 가끔 뛰어오르는 물고기 · 하늘의 열기구 · 새 떼
   - 밤: 통나무집 창·모닥불·전망대 등이 켜진다(점광원은 모닥불 하나).
   - 성능: 나무·바위·버섯·꽃은 종류별 InstancedMesh(약 20개 그리기 호출), 그림자는 끈다. '움직임 줄이기'면 멈춘다.
   - 동물원을 확대해 보는 동안은 숨기고, 축소할수록 솟아오른다(outside.js 와 같은 Z_HIDE·Z_FULL). 카메라 도구의 '숲' 버튼.
   동물원에서만 동작한다. index.html 에서 app.js 다음에 읽는다. */
window.ZooForest = (() => {
  let ok = false;
  try { ok = !!(window.SpaceTheme?.isZoo && window.ZooTheme && HAS3D && scene && camera && controls); } catch { ok = false; }
  if (!ok) return null;
  const T = THREE, Z = window.ZooTheme, RX = Z.RX + 1.2, RZ = Z.RZ + 1.2;
  const K = Z.S || 1;                                      // 동물원 땅 넓이 배율(zoo-theme.js): 숲 배치도 같이 넓힌다(나무·소품 크기는 그대로)
  const R = Math.round(150 * K), VIEW_R = 62 * K, Y0 = -.9; // 숲 땅 반지름, '숲' 버튼으로 볼 반지름, 숲 바닥 높이
  const Z_HIDE = .72, Z_FULL = .4;
  const S = { k: -1, shown: false, saved: null };
  const group = new T.Group(), tall = new T.Group(); group.name = "zoo-forest"; group.add(tall); scene.add(group);
  const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(17);
  const mat = (color, extra) => new T.MeshStandardMaterial({ color, roughness: .9, ...(extra || {}) });
  const ellipse = (x, z) => Math.sqrt((x / RX) ** 2 + (z / RZ) ** 2);
  const add = (m, p = tall) => { p.add(m); return m; };
  const box = (c, w, h, d) => new T.Mesh(new T.BoxGeometry(w, h, d), mat(c));
  // 부드러운 노이즈(숲 밀도·나무 종류 분포)
  const noise = (x, z) => .5 + .22 * Math.sin(x * .061 + 1.3) * Math.cos(z * .073 - .4) + .17 * Math.sin((x - z) * .113 + 2) + .11 * Math.cos(x * .19 + z * .07);

  /* ── 지형: 언덕(나무·소품이 언덕 높이를 따른다) ── */
  const HILLS = [[60, -20, 22, 16, 9], [-62, -58, 26, 20, 7], [26, -70, 30, 18, 6], [-90, 30, 24, 22, 6], [80, 60, 26, 20, 5], [-20, 80, 30, 18, 4]].map(([x, z, rx, rz, h]) => [x * K, z * K, rx * K, rz * K, h]);
  const height = (x, z) => { let h = 0; for (const [hx, hz, rx, rz, hh] of HILLS) { const d = 1 - ((x - hx) / rx) ** 2 - ((z - hz) / rz) ** 2; if (d > 0) h = Math.max(h, hh * Math.sqrt(d)); } return h; };
  const ground = add(new T.Mesh(new T.CircleGeometry(R, 96), mat(0x6f9758)), group); ground.rotation.x = -Math.PI / 2; ground.position.y = Y0;
  for (const [x, z, rx, rz, h] of HILLS) { const m = add(new T.Mesh(new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x6c9454))); m.scale.set(rx, h, rz); m.position.set(x, Y0, z); }
  const meadow = add(new T.Mesh(new T.CircleGeometry(1, 72), mat(0x86ad69)), group); meadow.rotation.x = -Math.PI / 2; meadow.scale.set(RX + 7, RZ + 7, 1); meadow.position.y = Y0 + .02;
  // 숲 바닥 얼룩(어두운 숲 그늘·밝은 빈터)
  { const g = new T.CircleGeometry(1, 20), dark = mat(0x5e844b), light = mat(0x93b872);
    for (let i = 0; i < 46; i++) { const a = rng() * 6.28, r = (32 + rng() * 105) * K, x = Math.cos(a) * r, z = Math.sin(a) * r; if (height(x, z) > .2) continue;
      const m = add(new T.Mesh(g, noise(x, z) > .55 ? dark : light), group); m.rotation.x = -Math.PI / 2; m.scale.set(6 + rng() * 10, 4 + rng() * 8, 1); m.position.set(x, Y0 + .015, z); m.rotation.z = rng() * 3; } }

  /* ── 강: 북서쪽에서 내려와 동물원 서쪽·남쪽을 돌아 남동쪽으로 ── */
  const curve = new T.CatmullRomCurve3([[-150, -70], [-95, -48], [-52, -34], [-36, -6], [-34, 22], [-12, 36], [18, 38], [52, 46], [95, 70], [150, 96]].map(([x, z]) => new T.Vector3(x * K, 0, z * K)));
  const SAMPLES = 260, pts = curve.getSpacedPoints(SAMPLES);
  function ribbon(width, y) {
    const pos = [], uv = [], idx = [];
    let len = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const p = pts[i], q = pts[Math.min(SAMPLES, i + 1)], o = pts[Math.max(0, i - 1)];
      const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, w = width * (1 + .18 * Math.sin(i * .21));
      if (i) len += p.distanceTo(pts[i - 1]);
      pos.push(p.x + nx * w / 2, y, p.z + nz * w / 2, p.x - nx * w / 2, y, p.z - nz * w / 2); uv.push(0, len / 8, 1, len / 8);
      if (i < SAMPLES) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function stripes(base) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 256;
    const x = c.getContext("2d"); x.fillStyle = base; x.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 26; i++) { x.fillStyle = `rgba(255,255,255,${.06 + rng() * .14})`; x.fillRect(rng() * 56, rng() * 256, 4 + rng() * 10, 10 + rng() * 26); }
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; return t;
  }
  add(new T.Mesh(ribbon(13, Y0 + .04), mat(0xb39c72)), group);
  const flowTex = stripes("#4e9fb3"), waterMat = mat(0xffffff, { map: flowTex, roughness: .25, metalness: .05 });
  add(new T.Mesh(ribbon(9.5, Y0 + .06), waterMat), group);
  const nearRiver = (x, z, pad) => { for (let i = 0; i <= SAMPLES; i += 2) if (Math.hypot(pts[i].x - x, pts[i].z - z) < pad) return true; return false; };
  // 정문에서 남쪽으로 난 오솔길과 다리
  const roadLen = 22, road = add(new T.Mesh(new T.PlaneGeometry(3, roadLen), mat(0xcdb28a)), group); road.rotation.x = -Math.PI / 2; road.position.set(0, Y0 + .03, RZ + roadLen / 2 - .5);
  const crossing = (() => { let best = pts[0], d = 1e9; for (const p of pts) { const e = Math.abs(p.x) + (p.z < RZ ? 1e9 : 0); if (e < d) { d = e; best = p; } } return best; })();
  { const b = new T.Group(); b.position.set(crossing.x, Y0 + .3, crossing.z); b.rotation.y = .05; add(b, group);
    b.add(box(0x9c7851, 3.6, .3, 15)); for (const x of [-1.7, 1.7]) { const r = box(0x7d5c3d, .12, .7, 15); r.position.set(x, .45, 0); b.add(r); } }

  /* ── 볼거리 자리(나무를 비워 두는 빈터) ── */
  const SPOTS = Object.fromEntries(Object.entries({ falls: [60, -6, 12], cabin: [38, -42, 9], camp: [-56, 16, 9], tower: [-30, -52, 7], deer: [44, 20, 11], pond2: [-74, -16, 7] }).map(([k, [x, z, r]]) => [k, [x * K, z * K, r]]));
  const inSpot = (x, z, pad = 0) => Object.values(SPOTS).some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r + pad);
  const on = (x, z) => Y0 + height(x, z);

  // 폭포: 언덕(60,-20)에서 남쪽 연못으로
  const fallTex = stripes("#7cc3d3"); fallTex.repeat.set(1, 2);
  const fall = add(new T.Mesh(new T.PlaneGeometry(3.2, 8.2), mat(0xffffff, { map: fallTex, roughness: .2, transparent: true, opacity: .92 })));
  fall.position.set(60 * K, Y0 + 4.2, -10.4 * K); fall.rotation.x = -.18;
  const pond = add(new T.Mesh(new T.CircleGeometry(6.5, 32), mat(0x5aa9b8, { roughness: .2 }))); pond.rotation.x = -Math.PI / 2; pond.position.set(60 * K, Y0 + .05, -4 * K);
  const foam = add(new T.Mesh(new T.CircleGeometry(1.6, 16), mat(0xe8f6f8, { transparent: true, opacity: .8 }))); foam.rotation.x = -Math.PI / 2; foam.position.set(60 * K, Y0 + .08, -8.6 * K);
  // 통나무집(굴뚝 연기·밤에 창 불빛)
  const glowMat = new T.MeshStandardMaterial({ color: 0x40362a, emissive: 0xffb456, emissiveIntensity: 0 });
  { const [x, z] = SPOTS.cabin, c = new T.Group(); c.position.set(x, on(x, z), z); c.rotation.y = .5; add(c);
    for (let i = 0; i < 6; i++) { const log = new T.Mesh(new T.CylinderGeometry(.28, .28, 6, 10), mat(i % 2 ? 0x8a5f3a : 0x7a5232)); log.rotation.z = Math.PI / 2; log.position.y = .3 + i * .52; c.add(log); }
    const roof = new T.Mesh(new T.ConeGeometry(4.6, 2.6, 4), mat(0x8b3a2f)); roof.position.y = 4.4; roof.rotation.y = Math.PI / 4; roof.scale.z = .75; c.add(roof);
    const chim = box(0x7b7b7b, .8, 2.2, .8); chim.position.set(1.6, 4.8, .4); c.add(chim);
    for (const x2 of [-1.4, 1.4]) { const w = new T.Mesh(new T.PlaneGeometry(1, .8), glowMat); w.position.set(x2, 1.7, 2.3); c.add(w); }
    const door = box(0x5c3d24, 1, 1.8, .1); door.position.set(0, .9, 2.32); c.add(door); }
  const smoke = Array.from({ length: 6 }, (_, i) => { const m = add(new T.Mesh(new T.SphereGeometry(.5, 8, 6), mat(0xdedede, { transparent: true, opacity: .55 }))); m.userData.t = i / 6; return m; });
  const chimney = (() => { const [x, z] = SPOTS.cabin, a = .5; return new T.Vector3(x + Math.cos(a) * 1.6 + Math.sin(a) * .4, on(x, z) + 6, z - Math.sin(a) * 1.6 + Math.cos(a) * .4); })();
  // 캠핑장: 텐트 2·모닥불(밤에 불빛)·통나무 의자
  const fireMat = new T.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff7a1a, emissiveIntensity: .8, transparent: true, opacity: .9 });
  const fireLight = new T.PointLight(0xff9a4a, 0, 22, 2);
  const flames = [];
  { const [x, z] = SPOTS.camp, y = on(x, z);
    [[-3.6, -2, 0xe0794f, .4], [3.4, -2.6, 0x4f86c6, -.3]].forEach(([dx, dz, c, ry]) => { const t = add(new T.Mesh(new T.ConeGeometry(2, 2.6, 4), mat(c))); t.position.set(x + dx, y + 1.3, z + dz); t.rotation.y = ry + Math.PI / 4; });
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28, s = add(new T.Mesh(new T.DodecahedronGeometry(.35, 0), mat(0x8a8a86))); s.position.set(x + Math.cos(a) * .9, y + .15, z + 2 + Math.sin(a) * .9); }
    for (let i = 0; i < 3; i++) { const f = add(new T.Mesh(new T.ConeGeometry(.35 - i * .08, 1 - i * .2, 7), fireMat)); f.position.set(x + (i - 1) * .22, y + .5, z + 2); flames.push(f); }
    [[-2.4, 3.6, .2], [2.4, 3.8, -.3], [0, 4.6, 1.5]].forEach(([dx, dz, ry]) => { const l = add(new T.Mesh(new T.CylinderGeometry(.3, .3, 2.2, 8), mat(0x7a5232))); l.rotation.set(0, ry, Math.PI / 2); l.position.set(x + dx, y + .3, z + dz); });
    fireLight.position.set(x, y + 2, z + 2); add(fireLight); }
  // 전망대(밤에 등불)
  const lampMat = new T.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc76a, emissiveIntensity: 0 });
  { const [x, z] = SPOTS.tower, y = on(x, z);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) { const p = add(new T.Mesh(new T.CylinderGeometry(.15, .2, 9, 8), mat(0x7d5c3d))); p.position.set(x + dx, y + 4.5, z + dz); }
    const deck = add(box(0x9c7851, 3.6, .3, 3.6)); deck.position.set(x, y + 9, z);
    const roof = add(new T.Mesh(new T.ConeGeometry(3, 1.8, 4), mat(0x6b4a2c))); roof.position.set(x, y + 11.2, z); roof.rotation.y = Math.PI / 4;
    for (const s of [-1, 1]) { const r = add(box(0x7d5c3d, 3.6, .7, .1)); r.position.set(x, y + 9.5, z + s * 1.75); }
    const lamp = add(new T.Mesh(new T.SphereGeometry(.3, 10, 8), lampMat)); lamp.position.set(x, y + 10.1, z); }
  // 숲속 연못(연잎·나무 선착장)
  { const [x, z] = SPOTS.pond2, p = add(new T.Mesh(new T.CircleGeometry(5.5, 28), mat(0x5aa9b8, { roughness: .2 }))); p.rotation.x = -Math.PI / 2; p.position.set(x, Y0 + .05, z);
    for (let i = 0; i < 6; i++) { const l = add(new T.Mesh(new T.CircleGeometry(.5, 10), mat(0x4f8a46))); l.rotation.x = -Math.PI / 2; l.position.set(x + Math.cos(i) * 3, Y0 + .08, z + Math.sin(i * 1.7) * 3); }
    const dock = add(box(0x9c7851, 1.4, .2, 4)); dock.position.set(x + 5, Y0 + .3, z); }
  // 먼 산
  [[-110, -105, 34, 26, 0x6f8f86], [-55, -125, 26, 20, 0x7c9a8e], [20, -132, 38, 30, 0x6a8a80], [85, -110, 30, 22, 0x7b958c], [-138, -40, 24, 18, 0x7c9a8e]].map(([x, z, ...o]) => [x * K, z * K, ...o]).forEach(([x, z, r, h, c]) => {
    const m = add(new T.Mesh(new T.ConeGeometry(r, h, 9), mat(c))); m.position.set(x, h / 2 + Y0, z);
    const cap = add(new T.Mesh(new T.ConeGeometry(r * .3, h * .3, 9), mat(0xeef2f0))); cap.position.set(x, h - h * .15 + Y0, z);
  });

  /* ── 숲: 노이즈로 모인 숲·빈터, 나무 6종(InstancedMesh, 나무마다 크기·기울기·색이 다르다) ── */
  const kinds = { pine: [], oak: [], birch: [], maple: [], cypress: [], shrub: [] };
  for (let i = 0, n = 0; i < 22000 && n < 1900; i++) {
    const a = rng() * Math.PI * 2, r = 20 * K + Math.sqrt(rng()) * (R - 24 * K), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const e = ellipse(x, z), front = x > 0 && z > 0, dens = noise(x, z);
    if (e < (front ? 1.75 : 1.32) || nearRiver(x, z, 7.5) || inSpot(x, z) || (Math.abs(x) < 4 && z > RZ - 1 && z < RZ + roadLen + 2)) continue;
    if (rng() > (dens - .38) * 2.2) continue;                        // 빈터: 밀도가 낮은 곳은 비운다
    const it = { x, z, y: on(x, z), s: .7 + rng() * .8, ry: rng() * 6.28, lean: (rng() - .5) * .12, c: rng() };
    const north = z < -45 || height(x, z) > 2, reg = noise(x * 1.7 + 40, z * 1.7 - 20), p = rng();
    const kind = p < .18 ? "shrub" : north ? (p < .75 ? "pine" : "cypress") : reg > .62 ? (p < .6 ? "maple" : "birch") : reg < .4 ? (p < .5 ? "birch" : "pine") : (p < .7 ? "oak" : "cypress");
    kinds[kind].push(it); n++;
  }
  const O = new T.Object3D(), C = new T.Color();
  function inst(geo, material, items, place, color) {
    if (!items.length) return null;
    const m = new T.InstancedMesh(geo, material, items.length);
    items.forEach((it, i) => { place(O, it); O.updateMatrix(); m.setMatrixAt(i, O.matrix); if (color) m.setColorAt(i, C.setHex(color(it))); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return add(m);
  }
  const at = (o, it, y, sx, sy, sz, dx = 0, dz = 0) => { o.position.set(it.x + dx * it.s, it.y + y * it.s, it.z + dz * it.s); o.rotation.set(it.lean, it.ry, it.lean * .6); o.scale.set(sx * it.s, sy * it.s, sz * it.s); };
  const white = mat(0xffffff), shade = arr => it => arr[Math.floor(it.c * arr.length)];
  const trunkGeo = new T.CylinderGeometry(.2, .3, 1, 6);
  inst(trunkGeo, white, [...kinds.pine, ...kinds.oak, ...kinds.maple, ...kinds.cypress], (o, it) => at(o, it, .9, 1, 1.8, 1), () => 0x6e5236);
  inst(trunkGeo, white, kinds.birch, (o, it) => at(o, it, 1.6, .8, 3.2, .8), () => 0xeeeae2);
  // 소나무: 3단 원뿔
  const cone = new T.ConeGeometry(1, 1, 7);
  [[2.7, 1.9, 2.4], [4.3, 1.5, 2], [5.7, 1, 1.6]].forEach(([y, w, h], k) => inst(cone, white, kinds.pine, (o, it) => at(o, it, y, w, h, w), shade([[0x2f5e40, 0x3d6b4a, 0x35644a], [0x3d6b4a, 0x467654, 0x3f704d], [0x4a7a50, 0x528558, 0x4e8054]][k])));
  inst(cone, white, kinds.cypress, (o, it) => at(o, it, 3.6, .9, 5.6, .9), shade([0x3b6b45, 0x2f5f3e, 0x46754d]));
  // 참나무: 큰 뭉치 + 작은 뭉치 두 개
  const blob = new T.SphereGeometry(1, 9, 7);
  inst(blob, white, kinds.oak, (o, it) => at(o, it, 3.1, 1.9, 1.6, 1.8), shade([0x5f9150, 0x56884a, 0x6c9d58]));
  inst(blob, white, kinds.oak, (o, it) => at(o, it, 3.5, 1.1, 1, 1.1, 1.1, .4), shade([0x6c9d58, 0x78a85e, 0x649552]));
  inst(blob, white, kinds.oak, (o, it) => at(o, it, 2.8, 1.2, 1, 1.1, -1, .6), shade([0x56884a, 0x4f8045, 0x5f9150]));
  // 자작나무: 연둣빛·노란 잎, 단풍나무: 주황·빨강
  inst(blob, white, kinds.birch, (o, it) => at(o, it, 3.6, 1.2, 1.7, 1.2), shade([0xb6c96a, 0x9fbf5f, 0xd9c45a, 0xa9c463]));
  inst(blob, white, kinds.maple, (o, it) => at(o, it, 3, 1.8, 1.5, 1.7), shade([0xd9772f, 0xc9502f, 0xe39a35, 0xb8432e, 0xdb8a3a]));
  inst(blob, white, kinds.maple, (o, it) => at(o, it, 3.5, 1, .9, 1, .9, -.5), shade([0xe5a53c, 0xd36a2e, 0xc94a33]));
  inst(blob, white, kinds.shrub, (o, it) => at(o, it, .35, 1.3, .8, 1.1), shade([0x557f45, 0x618c4c, 0x6f9a55, 0x4c7740]));

  /* ── 숲 바닥 소품: 바위·쓰러진 통나무·버섯·고사리·꽃(빈터) ── */
  const props = { rock: [], log: [], mush: [], fern: [], flower: [] };
  for (let i = 0; i < 5000; i++) {
    const a = rng() * 6.28, r = 24 * K + Math.sqrt(rng()) * (R - 28 * K), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (ellipse(x, z) < 1.3 || nearRiver(x, z, 6) || inSpot(x, z, -2)) continue;
    const d = noise(x, z), it = { x, z, y: on(x, z), s: .6 + rng() * .9, ry: rng() * 6.28, lean: 0, c: rng() }, roll = rng();
    if (d < .45 && roll < .5) props.flower.push(it); else if (roll < .12) props.rock.push(it); else if (roll < .17) props.log.push(it); else if (d > .5 && roll < .32) props.mush.push(it); else if (d > .5 && roll < .5) props.fern.push(it);
  }
  inst(new T.DodecahedronGeometry(1, 0), white, props.rock.slice(0, 160), (o, it) => at(o, it, .3, 1.1, .7, .9), shade([0x8f9488, 0x9a9e92, 0x7d8279]));
  inst(new T.CylinderGeometry(.35, .35, 3.4, 8), white, props.log.slice(0, 50), (o, it) => { at(o, it, .35, 1, 1, 1); o.rotation.set(0, it.ry, Math.PI / 2); }, () => 0x7a5232);
  inst(new T.CylinderGeometry(.06, .08, .4, 6), white, props.mush.slice(0, 140), (o, it) => at(o, it, .2, 1, 1, 1), () => 0xf1eadb);
  inst(new T.SphereGeometry(.22, 8, 5, 0, 6.29, 0, 1.6), white, props.mush.slice(0, 140), (o, it) => at(o, it, .4, 1, .8, 1), shade([0xd23a2f, 0xd23a2f, 0xc8955a]));
  inst(new T.ConeGeometry(.5, .8, 5), white, props.fern.slice(0, 220), (o, it) => at(o, it, .3, 1, 1, 1), shade([0x4f8a46, 0x5d9a4f, 0x467d3e]));
  inst(new T.SphereGeometry(.12, 6, 4), white, props.flower.slice(0, 420), (o, it) => at(o, it, .15, 1, 1, 1), shade([0xf2d45c, 0xf08fb0, 0xffffff, 0xb59ce0, 0xf2a65a]));

  /* ── 움직이는 것들 ── */
  const live = new T.Group(); add(live);
  // 사슴 가족(빈터에서 풀을 뜯다 고개를 든다)
  const deer = [[0, 0, 1], [2.6, 1.2, .8], [-1.8, 2.2, .6]].map(([dx, dz, s], i) => {
    const [x, z] = SPOTS.deer, g = new T.Group(); g.position.set(x + dx, on(x, z), z + dz); g.scale.setScalar(s * 1.5); g.rotation.y = i * 1.3; live.add(g);
    const coat = mat(0xa8713f), body = new T.Mesh(new T.SphereGeometry(.7, 10, 8), coat); body.scale.set(.8, .7, 1.5); body.position.y = 1.4; g.add(body);
    for (const [lx, lz] of [[-.3, -.6], [.3, -.6], [-.3, .6], [.3, .6]]) { const l = new T.Mesh(new T.CylinderGeometry(.07, .06, 1.1, 6), coat); l.position.set(lx, .55, lz); g.add(l); }
    const neck = new T.Group(); neck.position.set(0, 1.6, .9); g.add(neck);
    const head = new T.Mesh(new T.SphereGeometry(.3, 10, 8), coat); head.scale.set(.8, .9, 1.3); head.position.set(0, .55, .2); neck.add(head);
    if (i === 0) for (const s2 of [-1, 1]) { const an = new T.Mesh(new T.CylinderGeometry(.03, .04, .6, 5), mat(0xd8c7a0)); an.position.set(s2 * .15, 1, .1); an.rotation.z = s2 * .4; neck.add(an); }
    const tail = new T.Mesh(new T.SphereGeometry(.15, 6, 5), mat(0xf4ece0)); tail.position.set(0, 1.5, -1); g.add(tail);
    return { neck, t: i * 2.3 };
  });
  // 토끼(동물원 둘레 풀밭에서 깡충)
  const rabbits = [[30, 12], [-30, -26], [26, -22], [-24, 24]].map(([x, z]) => [x * K, z * K]).map(([x, z], i) => {
    const g = new T.Group(); live.add(g); const fur = mat(i % 2 ? 0xf2efe8 : 0xb89b7a);
    const b = new T.Mesh(new T.SphereGeometry(.45, 10, 8), fur); b.scale.set(.8, .8, 1.1); b.position.y = .45; g.add(b);
    const h = new T.Mesh(new T.SphereGeometry(.3, 10, 8), fur); h.position.set(0, .85, .35); g.add(h);
    for (const s2 of [-1, 1]) { const e = new T.Mesh(new T.CylinderGeometry(.06, .08, .6, 6), fur); e.position.set(s2 * .1, 1.25, .3); g.add(e); }
    return { g, x, z, t: i * 1.9 };
  });
  // 나룻배(강을 따라 천천히 흘러간다)
  const boat = new T.Group(); live.add(boat);
  { const hull = box(0x8a5f3a, 1.4, .5, 3.4); hull.position.y = .25; boat.add(hull);
    const man = new T.Mesh(new T.CylinderGeometry(.25, .3, .9, 8), mat(0x3c6fb0)); man.position.set(0, .9, -.6); boat.add(man);
    const hat = new T.Mesh(new T.ConeGeometry(.45, .35, 10), mat(0xe8c86a)); hat.position.set(0, 1.55, -.6); boat.add(hat);
    const oar = box(0xc9a46c, 2.4, .06, .14); oar.position.set(0, .8, -.4); boat.add(oar); }
  // 물고기(가끔 강에서 뛰어오른다)
  const fish = new T.Mesh(new T.SphereGeometry(.3, 8, 6), mat(0xe0a25a)); fish.scale.set(.5, .6, 1.4); fish.visible = false; live.add(fish);
  const jump = { t0: -9, p: null };
  // 열기구
  const balloon = new T.Group(); live.add(balloon);
  { const env = new T.Mesh(new T.SphereGeometry(3.4, 16, 12), mat(0xe7553f)); env.scale.y = 1.15; env.position.y = 6; balloon.add(env);
    for (let i = 0; i < 6; i++) { const st = new T.Mesh(new T.SphereGeometry(3.45, 16, 12, i / 6 * 6.28, .35, 0, Math.PI), mat(0xf2d45c)); st.scale.y = 1.15; st.position.y = 6; balloon.add(st); }
    balloon.add(box(0x8a5f3a, 1.4, 1, 1.4));
    for (const [dx, dz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) { const r = new T.Mesh(new T.CylinderGeometry(.03, .03, 3, 4), mat(0x3d3d3d)); r.position.set(dx, 2, dz); balloon.add(r); } }
  // 새 떼
  const birdMat = mat(0x34414d), wingMat = new T.MeshStandardMaterial({ color: 0x4b5b69, side: T.DoubleSide, roughness: .8 });
  const flocks = [[0, 0, 58, 22, .05], [-40, -30, 32, 18, -.07], [35, 25, 40, 26, .06]].map(([cx, cz, r, y, w]) => [cx * K, cz * K, r * K, y, w / K]).map(([cx, cz, r, y, w], f) => ({ cx, cz, r, y, w, a: f * 2, birds: Array.from({ length: 7 }, (_, i) => {
    const g = new T.Group(), body = new T.Mesh(new T.SphereGeometry(.35, 8, 6), birdMat); body.scale.set(1, .7, 1.9); g.add(body);
    const wings = [1, -1].map(s => { const m = new T.Mesh(new T.PlaneGeometry(1.5, .5), wingMat); m.position.x = s * .8; g.add(m); return m; });
    live.add(g); return { g, wings, off: { a: (i % 2 ? -1 : 1) * Math.ceil(i / 2) * .045, r: Math.ceil(i / 2) * 1.4, y: (i % 3) * .6 }, ph: i * .7 };
  }) }));
  const tmpP = new T.Vector3(), tmpT = new T.Vector3();
  function animate(t, dt) {
    flowTex.offset.y -= dt * .35; fallTex.offset.y -= dt * 1.6;
    foam.scale.setScalar(1 + Math.sin(t * 6) * .06);
    for (const m of smoke) { const k = (t * .12 + m.userData.t) % 1; m.position.set(chimney.x + Math.sin(k * 6 + m.userData.t * 9) * .6, chimney.y + k * 7, chimney.z - k * 2); m.scale.setScalar(.5 + k * 1.8); m.material.opacity = .55 * (1 - k); }
    flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * 12 + i * 2) * .25; f.rotation.y = t * 2 + i; });
    for (const d of deer) d.neck.rotation.x = Math.max(0, Math.sin(t * .5 + d.t)) * 1.1;
    for (const r of rabbits) { const k = (t * .45 + r.t) % 1, hop = Math.abs(Math.sin(k * Math.PI * 6)) * .8, a = r.t + Math.floor(t * .45 + r.t) * 2.2;
      r.g.position.set(r.x + Math.cos(a) * k * 3, Y0 + hop, r.z + Math.sin(a) * k * 3); r.g.rotation.y = Math.PI / 2 - a; }
    const u = (t * .006) % 1; curve.getPointAt(u, tmpP); curve.getPointAt(Math.min(1, u + .002), tmpT);
    boat.position.set(tmpP.x, Y0 + .1 + Math.sin(t * 2) * .05, tmpP.z); boat.rotation.y = Math.atan2(tmpT.x - tmpP.x, tmpT.z - tmpP.z); boat.rotation.z = Math.sin(t * 1.6) * .05;
    if (t - jump.t0 > 4) { jump.t0 = t + rng() * 3; jump.p = pts[40 + Math.floor(rng() * 180)]; }
    const jt = t - jump.t0;
    fish.visible = jt > 0 && jt < 1 && !!jump.p;
    if (fish.visible) { fish.position.set(jump.p.x + jt * 2, Y0 + Math.sin(jt * Math.PI) * 2.2, jump.p.z); fish.rotation.x = -Math.cos(jt * Math.PI) * 1.2; }
    const ba = t * .015; balloon.position.set(Math.cos(ba) * 55 * K, 28 + Math.sin(t * .2) * 2, (Math.sin(ba) * 42 - 10) * K); balloon.rotation.y = t * .05;
    for (const f of flocks) {
      f.a += f.w * dt;
      for (const b of f.birds) {
        const a = f.a - b.off.a * Math.sign(f.w) - Math.abs(b.off.a) * .4, r = f.r + b.off.r;
        b.g.position.set(f.cx + Math.cos(a) * r, f.y + b.off.y + Math.sin(t + b.ph) * .5, f.cz + Math.sin(a) * r * .8);
        b.g.rotation.y = -a + (f.w > 0 ? Math.PI : 0);
        const flap = Math.sin(t * 7 + b.ph) * .65; b.wings[0].rotation.z = flap; b.wings[1].rotation.z = -flap;
      }
    }
  }

  /* ── 나타남(줌)·하늘빛(낮·노을·밤)·밤 불빛 ── */
  const SKY = [new T.Color(0xd7e7e3), new T.Color(0x9a8ea6), new T.Color(0x0e141c)], bg = new T.Color(), ui = new T.Color();
  renderer.getClearColor(ui);
  function reveal(k) {
    S.k = k;
    const vis = k > .002;
    group.visible = vis; tall.visible = k > .02; tall.scale.y = Math.max(.02, k);
    if (vis !== S.shown) {
      S.shown = vis;
      if (!vis) { try { setOfficeLight(OFFICE.n ?? 0); } catch { renderer.setClearColor(ui); } }
      else renderer.getClearColor(ui);
    }
  }
  function sky(n, k) {
    if (n < .5) bg.copy(SKY[0]).lerp(SKY[1], n * 2); else bg.copy(SKY[1]).lerp(SKY[2], n * 2 - 1);
    bg.lerp(ui, 1 - k); renderer.setClearColor(bg);
    waterMat.color.setHex(0xffffff).lerp(C.setHex(0x223344), n * .7);
    glowMat.emissiveIntensity = n * 1.8; lampMat.emissiveIntensity = n * 2; fireLight.intensity = n * 2.2; fireMat.emissiveIntensity = .8 + n * 1.2;
  }
  function widen() {
    if (S.saved) return;
    S.saved = { far: camera.far, len: CAM_OFF.length(), minZoom: controls.minZoom };
    camera.far = 3000; camera.updateProjectionMatrix();
    const len = 900, dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6 || !Number.isFinite(dir.x)) dir.copy(CAM_OFF);   // 아직 자리를 잡기 전이면 기본 방향
    CAM_OFF.setLength(len);
    camera.position.copy(controls.target).add(dir.setLength(len));
    controls.minZoom = Math.min(S.saved.minZoom, .12);
  }
  function toggleZoom() {
    const far = Math.max(controls.minZoom, cam.view / (VIEW_R * 2)); // 화면 높이에 숲 지름(VIEW_R×2)이 들어오는 줌
    if (camera.zoom > far * 1.4) setView(cam.view, new T.Vector3(0, 0, 0), true, far); else resetView();
  }
  function addButton() {
    const tools = document.querySelector("#officeFrame .office-tools");
    if (!tools || tools.querySelector(".zoo-forest-zoom")) return;
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use");
    svg.setAttribute("class", "ic"); svg.setAttribute("aria-hidden", "true"); use.setAttribute("href", "#i-map"); svg.append(use);
    const btn = el("button", { type: "button", class: "outside-zoom zoo-forest-zoom", "aria-label": "숲 보기", title: "동물원 바깥 숲 보기 / 동물원으로 돌아가기", onclick: toggleZoom }, svg, el("span", { text: "숲" }));
    tools.prepend(el("span", { class: "tool-group" }, btn));
  }

  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const raw = Math.min(.05, (now - last) / 1000); last = now;
    if (document.hidden) return;
    widen(); // 첫 프레임(카메라 자리를 잡은 뒤)에 한 번
    const t = Math.min(1, Math.max(0, (Z_HIDE - camera.zoom) / (Z_HIDE - Z_FULL))), k = t * t * (3 - 2 * t);
    if (Math.abs(k - S.k) > .001) reveal(k);
    if (!S.shown) return;
    sky(OFFICE.n ?? 0, k);
    if (!mqReduce.matches && k > .3) animate(now / 1000, raw);
  }
  addButton(); reveal(0); animate(0, 0);
  requestAnimationFrame(tick);
  return { group, flocks, kinds, props, toggleZoom, get shown() { return S.shown; } };
})();
