"use strict";
/* 바깥 풍경: 사무실 주소 주변의 실제 건물·도로·공원·철길(OpenStreetMap)을 사무실 둘레에 세운다.
   - 데이터: 서버 /api/outside/map(server/outside.py)이 사무실 기준 미터로 다듬어 준다. 사무실 가운데가 원점, x 오른쪽·z 앞쪽이고
     실제 방위는 data.rot 만큼 돌아가 있다(그래서 햇빛 방향도 같은 만큼 돌린다).
     { r, rot, office:{w,d}, site:{p,h,lv}|null, buildings:[{h,b?,k,s,p,i?}], roads:[{k,w,o,c,l,y,p,j?}],
       areas:[{k,p,i?}], rails:[{k,p}], trees:[x,z,…], crossings:[[x,z,걷는 방향,길이]] } — p 는 [x0,z0,x1,z1,…]
   - 위치: 설정 '사무실 위치'(주소 검색). 이 브라우저(agentOffice.place)와 서버(cache/outside/place.json)에 함께 둔다.
     app.js 의 일출·일몰 계산(sunPlace)도 같은 agentOffice.place 를 읽으므로 해도 이 주소를 따른다.
   - 낮↔밤: OFFICE.n(0 낮 ~ 1 밤)을 따라 창문·가로등·자동차·전철 불빛이 켜진다. 지도 가장자리는 3D 배경색으로 녹아든다.
   - app.js 는 고치지 않는다(다른 에이전트가 함께 고치는 파일). 전역 이름(scene·camera·controls·renderer·sun·CAM_OFF·OFFICE·
     VIEWS·VIEW·NET·api·store·toast·el·icon·applyTheme·setView·cam·resetView·scheduleView)으로 붙고, setOfficeLight 와
     VIEWS.settings 를 감싼다. 하나라도 없으면 아무것도 하지 않는다. index.html 에서 app.js 다음에 읽는다. 스타일은 outside.css. */
(function () {
  const T = window.THREE;
  let ok = false;
  try { ok = !!(T && HAS3D && scene && camera && controls && renderer && sun && CAM_OFF && OFFICE && VIEWS && typeof api === "function"); } catch { ok = false; }
  if (!ok) return;

  const LOCAL = "agentOffice.place";
  const SLAB = .32;                                // 사무실 바닥판 아래로 지도를 둔다(decor.js 바닥판 두께 .3)
  const BAY = 3.4, STOREY = 3.3, CELLS = 8;        // 창 무늬: 기둥 간격·층 높이(m), 텍스처 한 장의 칸 수
  const R_DEF = SMALL ? 260 : 350;                 // 지도 반경(m). 휴대폰은 조금 좁게
  const MAX = SMALL ? { trees: 700, lights: 150, cars: 26 } : { trees: 2200, lights: 420, cars: 70 };
  const S = {
    place: null, seen: "", synced: false,          // 사무실 위치·마지막으로 본 저장값·서버와 맞췄나
    group: null, data: null, key: "", floor: 0, rot: 0, n: -1,
    loading: false, pending: false, nextTry: 0, tries: 0, status: "", error: "",
    q: "", results: null, searching: false,
    lit: [], glow: [], glowMeshes: [], tint: [], traffic: null, trains: null, saved: null, credit: null, btn: null,
    tall: null, k: -1, shown: null, ui: new T.Color(),  // 솟는 묶음 · 드러난 정도(0 숨김 ~ 1) · 지금 보이나 · 화면 테마 배경색
  };

  /* ───────── 작은 도구 ───────── */
  const clampInt = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const col = h => new T.Color(h);
  const pick = (list, s) => list[s % list.length];
  function area(p) { let a = 0; for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + n - 1) % n; a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1]; } return a / 2; }
  function inside(x, z, p) {
    let hit = false;
    for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
      if ((zi > z) !== (zj > z) && x < xj + (z - zj) * (xi - xj) / (zi - zj)) hit = !hit;
    }
    return hit;
  }
  function bbox(p) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return { x0, z0, x1, z1 }; }
  /** 선(p)의 호 길이 표와 s 위치의 점·진행 방향 */
  function track(p) {
    const n = p.length / 2, cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]));
    return { p, n, cum, len: cum[n - 1] };
  }
  function at(t, s, out, hint = 0) {
    const { p, cum, n } = t;
    s = Math.min(t.len, Math.max(0, s));
    let i = Math.min(Math.max(0, hint), n - 2);
    while (i > 0 && cum[i] > s) i--;
    while (i < n - 2 && cum[i + 1] < s) i++;
    const L = cum[i + 1] - cum[i] || 1, k = (s - cum[i]) / L;
    out.x = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * k; out.z = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * k;
    out.dx = (p[i * 2 + 2] - p[i * 2]) / L; out.dz = (p[i * 2 + 3] - p[i * 2 + 1]) / L; out.i = i;
    return out;
  }

  /* ───────── 가장자리 녹이기: 사무실에서 멀어질수록 배경색(가산 혼합 재질은 검정)으로 ───────── */
  const FADE = { uFadeColor: { value: new T.Color() }, uFadeR: { value: new T.Vector2(200, 340) } };
  function fadeable(mat, additive) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, FADE);
      sh.vertexShader = "varying float vOutR;\n" + sh.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
          wp = modelMatrix * wp; vOutR = length(wp.xz); }`);
      sh.fragmentShader = "uniform vec3 uFadeColor;\nuniform vec2 uFadeR;\nvarying float vOutR;\n" + sh.fragmentShader.replace("#include <dithering_fragment>", `#include <dithering_fragment>
        { float f = smoothstep(uFadeR.x, uFadeR.y, vOutR); ${additive ? "gl_FragColor.rgb *= 1.0 - f;" : "gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, f);"} }`);
    };
    mat.customProgramCacheKey = () => additive ? "outside-add" : "outside";
    return mat;
  }

  /* ───────── 텍스처(한 번 만들어 계속 쓴다) ───────── */
  const TEX = {};
  /** 창 무늬 8×8 칸. kind: plain(벽에 뚫린 창) | glass(유리 커튼월). lit 이면 밤에 켜진 창(검은 바탕) */
  function winTex(kind, lit) {
    const key = kind + (lit ? "-lit" : "");
    if (TEX[key]) return TEX[key];
    const N = 256, c = N / CELLS, cv = Object.assign(document.createElement("canvas"), { width: N, height: N }), g = cv.getContext("2d");
    const rnd = mulberry(kind === "glass" ? 11 : 5);
    const warm = () => pick(["#ffd9a0", "#ffe7c4", "#fff2dc", "#ffcf8f", "#ffe0b0", "#d9e7ff"], Math.floor(rnd() * 6));
    g.fillStyle = lit ? "#000" : "#fff"; g.fillRect(0, 0, N, N);
    for (let row = 0; row < CELLS; row++) {
      const busy = rnd() ** 1.6; // 층마다 불 켜진 정도가 다르다(대부분 드문드문)
      for (let k = 0; k < CELLS; k++) {
        const x = k * c, y = row * c;
        if (kind === "glass") {
          if (!lit) { g.fillStyle = "#7c90a5"; g.fillRect(x + 1, y, c - 1, c - 7); g.fillStyle = "#cfd7df"; g.fillRect(x, y + c - 7, c, 7); g.fillRect(x, y, 1, c); }
          else if (rnd() < .05 + busy * .38) { g.fillStyle = warm(); g.globalAlpha = .55 + rnd() * .45; g.fillRect(x + 1, y + 1, c - 2, c - 9); g.globalAlpha = 1; }
        } else if (!lit) { g.fillStyle = "#6b7887"; g.fillRect(x + 7, y + 8, c - 14, c - 15); g.fillStyle = "#909cab"; g.fillRect(x + 7, y + 8, c - 14, 3); }
        else if (rnd() < .06 + busy * .34) { g.fillStyle = warm(); g.globalAlpha = .6 + rnd() * .4; g.fillRect(x + 8, y + 9, c - 16, c - 17); g.globalAlpha = 1; }
      }
    }
    const t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; t.encoding = T.sRGBEncoding;
    return (TEX[key] = t);
  }
  /** 둥근 빛(가운데 흰색 → 가장자리 투명): 가로등 빛 웅덩이 */
  function glowTex() {
    if (TEX.glow) return TEX.glow;
    const N = 128, cv = Object.assign(document.createElement("canvas"), { width: N, height: N }), g = cv.getContext("2d");
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.35, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding;
    return (TEX.glow = t);
  }

  /* ───────── 기하 묶음: 삼각형을 모아 한 메시로(그리기 호출을 줄인다) ───────── */
  class Geo {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; }
    v(x, y, z, nx, ny, nz, c, u = 0, w = 0) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b); this.u.push(u, w); }
    /** 위를 보는 삼각형(감기 방향을 맞춰 준다) */
    up(ax, az, bx, bz, cx, cz, y, c) {
      if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) { let t = bx; bx = cx; cx = t; t = bz; bz = cz; cz = t; }
      this.v(ax, y, az, 0, 1, 0, c); this.v(bx, y, bz, 0, 1, 0, c); this.v(cx, y, cz, 0, 1, 0, c);
    }
    /** 세로 사각형(바깥 법선 nx,nz): p0 아래·위, p1 위·아래 */
    wall(x0, z0, x1, z1, y0, y1, nx, nz, c0, c1, u0 = 0, u1 = 0) {
      const v0 = y0 / (STOREY * CELLS), v1 = y1 / (STOREY * CELLS);
      this.v(x0, y0, z0, nx, 0, nz, c0, u0, v0); this.v(x0, y1, z0, nx, 0, nz, c1, u0, v1); this.v(x1, y1, z1, nx, 0, nz, c1, u1, v1);
      this.v(x0, y0, z0, nx, 0, nz, c0, u0, v0); this.v(x1, y1, z1, nx, 0, nz, c1, u1, v1); this.v(x1, y0, z1, nx, 0, nz, c0, u1, v0);
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute("normal", new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(this.c, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(this.u, 2));
      g.computeBoundingSphere();
      return g;
    }
    mesh(mat, name) {
      if (!this.p.length) return null;
      const m = new T.Mesh(this.geometry(), mat); m.name = name; m.matrixAutoUpdate = false;
      return m;
    }
  }
  const V2 = p => { const a = []; for (let i = 0; i < p.length; i += 2) a.push(new T.Vector2(p[i], p[i + 1])); return a; };
  /** 평평한 다각형(구멍 포함)을 높이 y 에 채운다 */
  function fill(geo, outer, holes, y, c) {
    const o = V2(outer), hs = (holes || []).map(V2);
    let faces;
    try { faces = T.ShapeUtils.triangulateShape(o, hs); } catch { return; }
    const all = o.concat(...hs);
    for (const [a, b, d] of faces) if (all[a] && all[b] && all[d]) geo.up(all[a].x, all[a].y, all[b].x, all[b].y, all[d].x, all[d].y, y, c);
  }
  /** 고리 p 의 벽(y0~y1). 아래 2.6m 는 어둡게(땅에 닿는 그늘). 창 무늬는 seed 로 건물마다 어긋나게 */
  const _lo = new T.Color();
  function walls(geo, p, y0, y1, c, seed = 0) {
    const n = p.length / 2, mid = Math.min(y1, y0 + 2.6), lo = _lo.copy(c).multiplyScalar(.7);
    let s = (seed % 17) * BAY;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
      if (L < .05) continue;
      const nx = dz / L, nz = -dx / L, u0 = s / (BAY * CELLS), u1 = (s + L) / (BAY * CELLS);
      geo.wall(x0, z0, x1, z1, y0, mid, nx, nz, lo, c, u0, u1);
      if (mid < y1) geo.wall(x0, z0, x1, z1, mid, y1, nx, nz, c, c, u0, u1);
      s += L;
    }
  }
  /** 상자(옥상 설비·가로등 기둥 등): 가운데 (x,z), 가로 w·세로 d, y0 부터 높이 h, ry 만큼 돈 */
  function box(geo, x, z, w, d, y0, h, c, ry = 0, top = c) {
    const cs = Math.cos(ry), sn = Math.sin(ry), p = [];
    for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) p.push(x + a * cs + b * sn, z - a * sn + b * cs); // 넓이 양수(바깥 법선)
    walls(geo, p, y0, y0 + h, c);
    fill(geo, p, null, y0 + h, top);
  }
  /** 길 띠: 꺾인 곳은 폭을 유지하도록 이음(너무 뾰족하면 자른다) */
  function ribbon(geo, p, w, y, c) {
    const n = p.length / 2, hw = w / 2;
    if (n < 2) return;
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      let ax = 0, az = 0, bx = 0, bz = 0;
      if (i > 0) { ax = x - p[i * 2 - 2]; az = z - p[i * 2 - 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
      if (i < n - 1) { bx = p[i * 2 + 2] - x; bz = p[i * 2 + 3] - z; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
      if (i === 0) { ax = bx; az = bz; }
      if (i === n - 1) { bx = ax; bz = az; }
      let mx = -(az + bz), mz = ax + bx;                       // 오른쪽 법선(-dz, dx)의 평균
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) { mx = -bz; mz = bx; } else { mx /= ml; mz /= ml; }
      const k = Math.min(2.2, 1 / Math.max(.4, mx * -bz + mz * bx));
      L.push(x - mx * hw * k, z - mz * hw * k); R.push(x + mx * hw * k, z + mz * hw * k);
    }
    for (let i = 0; i < n - 1; i++) {
      geo.up(L[i * 2], L[i * 2 + 1], R[i * 2], R[i * 2 + 1], R[i * 2 + 2], R[i * 2 + 3], y, c);
      geo.up(L[i * 2], L[i * 2 + 1], R[i * 2 + 2], R[i * 2 + 3], L[i * 2 + 2], L[i * 2 + 3], y, c);
    }
  }
  function disc(geo, x, z, r, y, c, seg = 12) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      geo.up(x, z, x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r, y, c);
    }
  }
  /** 길의 둥근 이음: 끝점·교차점·크게 꺾인 점 */
  function joints(geo, rd, r, y, c) {
    const p = rd.p, n = p.length / 2, idx = new Set([0, n - 1, ...(rd.j || []).map(j => j[0])]);
    for (let i = 1; i < n - 1; i++) {
      const ax = p[i * 2] - p[i * 2 - 2], az = p[i * 2 + 1] - p[i * 2 - 1], bx = p[i * 2 + 2] - p[i * 2], bz = p[i * 2 + 3] - p[i * 2 + 1];
      const cos = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
      if (cos < .82) idx.add(i);
    }
    for (const i of idx) disc(geo, p[i * 2], p[i * 2 + 1], r, y, c, r > 4 ? 16 : 10);
  }

  /* ───────── 색 ───────── */
  const PAL = {
    g: [0xeeebe5, 0xe4e0d7, 0xd9d4cb, 0xe8e0d2, 0xd7cdc1, 0xcec7bd, 0xe1d3c3, 0xcbb9a7],
    r: [0xf0ece5, 0xe7dfd1, 0xddd2c2, 0xd8c6b1, 0xe5dccf, 0xcab9a5],
    c: [0xe3e7ed, 0xd6dce4, 0xcad2dc, 0xebeef1, 0xdee2e7],
    p: [0xe8e1d5, 0xdcd1bf, 0xd5ccbe],
    i: [0xd8d9dc, 0xced1d5, 0xc4c8ce, 0xdbd7ce],
  };
  const GLASS = [0xa7bacc, 0x9cb0c4, 0xb2c1d0, 0x91a6ba, 0xb8c6d3, 0xa0b6c4];
  const ROOF = [0x8fae94, 0x99b79b, 0xb8bbbe, 0xc6c7c5, 0xa8a39a, 0x86a68d]; // 녹색 방수 페인트가 많은 서울 옥상
  const AREA = { farm: [0xc6d39f, .02], wood: [0x8fb788, .022], park: [0xa6c899, .024], sand: [0xe4d6b0, .026], water: [0x8fbad8, .03],
    parking: [0xb6b8bb, .04], plaza: [0xd5cdc1, .045], pitch: [0x98c78b, .05], track: [0xc57d62, .055] };
  const ROAD = { motorway: [0x5f646c, .16], trunk: [0x62676f, .15], primary: [0x666b73, .14], secondary: [0x6b7077, .13], tertiary: [0x70757c, .12],
    link: [0x6e737a, .12], minor: [0x7b7f86, .11], living: [0x878a8f, .1], service: [0x8c8f93, .1],
    ped: [0xc9c1b5, .09], cycle: [0xb98576, .09], walk: [0xc4bdb1, .08], foot: [0xc2baad, .08], steps: [0xb9b1a5, .08], track: [0xae9b80, .07] };
  const SIDEWALK = { trunk: 3, primary: 3, secondary: 2.6, tertiary: 2.2 };
  const GROUND = 0xc9c5bb, WALK = 0xbdb6aa, YELLOW = 0xe9b73a, WHITE = 0xf2f2ee, POLE = 0x4b4f56, WARM = 0xffc78a;

  /* ───────── 장면 만들기 ───────── */
  function materials() {
    const lam = o => fadeable(new T.MeshLambertMaterial(o));
    const add = o => fadeable(new T.MeshBasicMaterial({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, ...o }), true);
    return {
      flat: lam({ vertexColors: true }),
      plain: lam({ vertexColors: true, map: winTex("plain"), emissive: 0xffffff, emissiveMap: winTex("plain", true), emissiveIntensity: 0 }),
      glass: lam({ vertexColors: true, map: winTex("glass"), emissive: 0xffffff, emissiveMap: winTex("glass", true), emissiveIntensity: 0 }),
      pool: add({ map: glowTex(), vertexColors: true }),
      lights: add({ vertexColors: true, side: T.DoubleSide }),
      car: lam({ vertexColors: true }),             // 차(차마다 색: instanceColor). 전철과 같이 쓰면 r128 이 셰이더를 못 바꿔 깨진다
      train: lam({ vertexColors: true }),
      crown: lam({ color: 0xffffff }),
      trunk: lam({ color: 0x7a5c46 }),
    };
  }
  /** 나무·가로등을 건물·사무실 안에 두지 않게: 20m 격자에 건물 윤곽을 나눠 담는다 */
  function blocker(data, hx, hz) {
    const cell = 20, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
    const add = p => {
      const b = bbox(p), rec = { p, ...b };
      for (let i = Math.floor(b.x0 / cell); i <= Math.floor(b.x1 / cell); i++) for (let j = Math.floor(b.z0 / cell); j <= Math.floor(b.z1 / cell); j++) {
        const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(rec);
      }
    };
    for (const b of data.buildings) add(b.p);
    if (data.site) add(data.site.p);
    return (x, z, pad = 0) => {
      if (Math.abs(x) < hx + 2 + pad && Math.abs(z) < hz + 2 + pad) return true;
      for (const r of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) || [])
        if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad && inside(x, z, r.p)) return true;
      return false;
    };
  }

  function build(data, place) {
    clear();
    const rnd = mulberry(Math.round(Math.abs(data.lat * 1e5 + data.lng * 3e5)) || 1);
    const M = materials();
    const g = new T.Group(), tall = new T.Group(); // tall: 땅에서 솟는 것(건물·나무·가로등·차). 축소할수록 높이가 자란다
    g.name = "바깥 풍경"; tall.name = "바깥 풍경: 솟는 것"; g.add(tall);
    const hx = (data.office?.w || OW) / 2, hz = (data.office?.d || OD) / 2, R = data.r || R_DEF;
    const floorH = data.site ? Math.min(6, Math.max(3, data.site.h / Math.max(1, data.site.lv || 1))) : 3.6;
    const podium = (place.floor - 1) * floorH;
    g.position.y = -(SLAB + podium);
    const blocked = blocker(data, hx, hz);
    const flat = new Geo(), roofs = new Geo(), W = { plain: new Geo(), glass: new Geo() }, low = { plain: new Geo(), glass: new Geo() };

    // 땅·면(공원·물·주차장…)
    disc(flat, 0, 0, R * 1.05, 0, col(GROUND), 72);
    for (const a of data.areas || []) { const st = AREA[a.k]; if (st) fill(flat, a.p, a.i, st[1], col(st[0])); }

    // 건물: 벽(창 무늬)·옥상(녹색 방수 페인트·설비)
    const glassy = b => b.k !== "r" && (b.h >= 36 || (b.k === "c" && b.h >= 22));
    for (const b of data.buildings || []) {
      const gl = glassy(b), c = col(pick(gl ? GLASS : PAL[b.k] || PAL.g, b.s)), base = b.b || 0;
      walls(gl ? W.glass : W.plain, b.p, base, b.h, c, b.s);
      for (const h of b.i || []) walls(gl ? W.glass : W.plain, h, base, b.h, c, b.s);
      fill(roofs, b.p, b.i, b.h, col(gl ? 0x9ca5af : pick(ROOF, b.s >> 2)));
      if (!SMALL && b.h >= 8 && b.h < 150 && Math.abs(area(b.p)) > 120) {
        const bb = bbox(b.p);
        for (let k = 0, want = 1 + b.s % 3, tries = 0; k < want && tries < 12; tries++) {
          const x = bb.x0 + (bb.x1 - bb.x0) * rnd(), z = bb.z0 + (bb.z1 - bb.z0) * rnd(), w = 1.6 + rnd() * 1.8, d = 1.4 + rnd() * 1.8;
          if (!inside(x - w, z - d, b.p) || !inside(x + w, z + d, b.p) || !inside(x - w, z + d, b.p) || !inside(x + w, z - d, b.p)) continue;
          box(roofs, x, z, w, d, b.h, .9 + rnd() * 1.3, col(rnd() < .5 ? 0xd8dadd : 0xbfc4ca), rnd() * Math.PI);
          k++;
        }
      }
    }

    // 사무실이 든 건물: 2층 이상이면 아래층(사무실은 그 위 바닥판에), 1층이면 건물 자리를 포장. 솟지 않는다(사무실을 받친다)
    const site = data.site?.p || (podium > 0 ? [-hx - .1, -hz - .1, hx + .1, -hz - .1, hx + .1, hz + .1, -hx - .1, hz + .1] : null);
    if (site && podium > 0) {
      const gl = (data.site?.h || 0) >= 22;
      walls(gl ? low.glass : low.plain, site, 0, podium, col(gl ? 0xa9bccf : 0xe2ded6), 3);
      fill(flat, site, null, podium, col(0xbcb9b2));
    } else if (site) fill(flat, site, null, .05, col(0xd2cbc0));

    // 길: 보도 → 차도 → 차선 → 횡단보도 → 철길
    for (const rd of data.roads || []) {
      const sw = rd.c && (SIDEWALK[rd.k] || (rd.k === "minor" && rd.w >= 8 ? 1.6 : 0));
      if (sw) { ribbon(flat, rd.p, rd.w + sw * 2, .06, col(WALK)); joints(flat, rd, rd.w / 2 + sw, .06, col(WALK)); }
    }
    for (const rd of data.roads || []) {
      const st = ROAD[rd.k] || ROAD.minor, y = st[1] + Math.max(0, rd.y || 0) * .03, c = col(st[0]);
      ribbon(flat, rd.p, rd.w, y, c);
      joints(flat, rd, rd.w / 2, y, c);
      markings(flat, rd, y + .02);
    }
    for (const [x, z, a, L] of data.crossings || []) zebra(flat, x, z, a, L);
    for (const rl of data.rails || []) {
      ribbon(flat, rl.p, 3.4, .065, col(0x9d968c));
      for (const o of [-.72, .72]) ribbon(flat, offset(rl.p, o), .12, .075, col(0x63676e));
    }

    // 가로등(기둥 + 밤의 빛 웅덩이) · 가로수 · 공원 나무
    const poles = new Geo(), pools = new Geo(), heads = new Geo(), lightsAt = [];
    const _p = {};
    for (const rd of data.roads || []) {
      if (!rd.c || rd.w < 6 || rd.k === "service" || lightsAt.length >= MAX.lights) continue;
      const t = track(rd.p);
      for (let s = 9, side = 1; s < t.len - 4 && lightsAt.length < MAX.lights; s += 27, side = -side) {
        at(t, s, _p);
        const rx = -_p.dz * side, rz = _p.dx * side, off = rd.w / 2 + .8, x = _p.x + rx * off, z = _p.z + rz * off;
        if (blocked(x, z, .5)) continue;
        lightsAt.push(x, z);
        const hx2 = x - rx * 1.5, hz2 = z - rz * 1.5, ry = Math.atan2(-rz, -rx);
        box(poles, x, z, .16, .16, 0, 6.8, col(POLE));
        box(poles, (x + hx2) / 2, (z + hz2) / 2, 1.6, .12, 6.62, .1, col(POLE), -ry);
        box(poles, hx2, hz2, .55, .28, 6.5, .14, col(0x2f3238), -ry);
        quad(pools, hx2, hz2, 16, .21, col(0x9c7a55));
        quad(heads, hx2, hz2, .9, 6.7, col(0xffe6c2));
      }
    }
    const treeAt = [];
    for (let i = 0; i + 1 < (data.trees || []).length; i += 2) if (!blocked(data.trees[i], data.trees[i + 1])) treeAt.push(data.trees[i], data.trees[i + 1]);
    for (const rd of data.roads || []) {
      if (!rd.c || !(SIDEWALK[rd.k] || (rd.k === "minor" && rd.w >= 8))) continue;
      const t = track(rd.p), js = (rd.j || []).map(([i]) => t.cum[i]);
      for (let s = 4; s < t.len - 2; s += 9) {
        if (js.some(c => Math.abs(c - s) < rd.w / 2 + 6)) continue;
        at(t, s, _p);
        for (const side of [-1, 1]) {
          const off = rd.w / 2 + (SIDEWALK[rd.k] || 1.6) * .55, x = _p.x - _p.dz * side * off, z = _p.z + _p.dx * side * off;
          if (!blocked(x, z, .8)) treeAt.push(x, z);
        }
      }
    }
    for (const a of data.areas || []) {
      if (a.k !== "park" && a.k !== "wood") continue;
      const A = Math.abs(area(a.p)), bb = bbox(a.p), want = Math.min(500, A / (a.k === "wood" ? 38 : 95));
      for (let k = 0, tries = 0; k < want && tries < want * 4; tries++) {
        const x = bb.x0 + (bb.x1 - bb.x0) * rnd(), z = bb.z0 + (bb.z1 - bb.z0) * rnd();
        if (!inside(x, z, a.p) || (a.i || []).some(h => inside(x, z, h)) || blocked(x, z, 1)) continue;
        treeAt.push(x, z); k++;
      }
    }
    for (const m of [flat.mesh(M.flat, "땅·길"), low.plain.mesh(M.plain, "사무실 건물 아래층"), low.glass.mesh(M.glass, "사무실 건물 아래층")]) if (m) g.add(m);
    for (const m of [roofs.mesh(M.flat, "옥상"), poles.mesh(M.flat, "가로등"), W.plain.mesh(M.plain, "건물"), W.glass.mesh(M.glass, "유리 건물")]) if (m) tall.add(m);
    const pm = pools.mesh(M.pool, "가로등 빛"), hm = heads.mesh(M.pool, "가로등 머리");
    if (pm) { pm.renderOrder = 3; g.add(pm); S.glowMeshes.push(pm); }
    if (hm) { hm.renderOrder = 3; tall.add(hm); S.glowMeshes.push(hm); }
    trees(tall, M, treeAt, rnd);

    S.traffic = traffic(tall, M, data, rnd);
    S.trains = trains(tall, M, data, rnd);
    S.lit = [M.plain, M.glass];
    S.glow = [M.pool, M.lights];
    S.tint = [M.flat, M.plain, M.glass, M.car, M.train, M.crown, M.trunk];
    for (const m of S.tint) m.userData.base = m.color.clone();
    S.mats = M;
    scene.add(g);
    S.group = g; S.tall = tall; S.data = data; S.rot = data.rot || 0; S.n = -1; S.k = -1; S.shown = null;
    widen(true); credit(true);
  }

  /** 바닥에 눕힌 정사각형(빛 웅덩이·가로등 머리) */
  function quad(geo, x, z, size, y, c) {
    const h = size / 2;
    geo.v(x - h, y, z - h, 0, 1, 0, c, 0, 1); geo.v(x - h, y, z + h, 0, 1, 0, c, 0, 0); geo.v(x + h, y, z + h, 0, 1, 0, c, 1, 0);
    geo.v(x - h, y, z - h, 0, 1, 0, c, 0, 1); geo.v(x + h, y, z + h, 0, 1, 0, c, 1, 0); geo.v(x + h, y, z - h, 0, 1, 0, c, 1, 1);
  }
  /** 선을 옆으로 off 만큼 민 선(오른쪽 +) */
  function offset(p, off) {
    const n = p.length / 2, out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
      out.push(p[i * 2] - dz / l * off, p[i * 2 + 1] + dx / l * off);
    }
    return out;
  }
  /** 차선: 양방향 길은 가운데 노란 겹선, 차로 사이는 흰 점선. 교차로 안은 비운다 */
  function markings(geo, rd, y0) {
    if (!rd.c || rd.w < 6.5 || rd.k === "service" || rd.k === "living") return;
    const t = track(rd.p), gap = Math.max(5, rd.w * .5 + 3), cuts = (rd.j || []).map(([i]) => t.cum[i]).sort((a, b) => a - b);
    const free = [];
    let a = 0;
    for (const c of cuts) { if (c - gap > a + 1) free.push([a, c - gap]); a = Math.max(a, c + gap); }
    if (t.len - a > 1) free.push([a, t.len]);
    const line = (off, w, c, dash) => {
      for (const [s0, s1] of free) {
        if (!dash) { strip(geo, t, s0, s1, off, w, c, y0); continue; }
        for (let s = s0; s < s1; s += dash[0] + dash[1]) strip(geo, t, s, Math.min(s1, s + dash[0]), off, w, c, y0);
      }
    };
    const y = col(YELLOW), wt = col(WHITE);
    if (!rd.o) {
      line(-.17, .14, y); line(.17, .14, y);
      const per = Math.max(1, Math.round(rd.w / 2 / 3.3));
      for (let k = 1; k < per; k++) { const o = k * rd.w / 2 / per; line(o, .13, wt, [3, 5]); line(-o, .13, wt, [3, 5]); }
    } else {
      const lanes = Math.max(1, Math.round(rd.w / 3.3));
      for (let k = 1; k < lanes; k++) line(-rd.w / 2 + k * rd.w / lanes, .13, wt, [3, 5]);
    }
  }
  const _a = {}, _b = {};
  function strip(geo, t, s0, s1, off, w, c, y) {
    if (s1 - s0 < .3) return;
    const pts = [];
    at(t, s0, _a); pts.push(_a.x - _a.dz * off, _a.z + _a.dx * off);
    for (let i = 1; i < t.n - 1; i++) if (t.cum[i] > s0 && t.cum[i] < s1) {
      at(t, t.cum[i] - .01, _a); at(t, t.cum[i] + .01, _b);
      const nx = -(_a.dz + _b.dz) / 2, nz = (_a.dx + _b.dx) / 2;
      pts.push(t.p[i * 2] + nx * off, t.p[i * 2 + 1] + nz * off);
    }
    at(t, s1, _a); pts.push(_a.x - _a.dz * off, _a.z + _a.dx * off);
    ribbon(geo, pts, w, y, c);
  }
  /** 횡단보도: 걷는 방향(a)을 따라 1m 간격 흰 막대(길이 L) */
  function zebra(geo, x, z, a, L) {
    const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux, c = col(WHITE);
    for (let s = -L / 2 + .5; s <= L / 2 - .3; s += 1) {
      const cx = x + ux * s, cz = z + uz * s, p = [];
      for (const [i, j] of [[-.25, -1.6], [.25, -1.6], [.25, 1.6], [-.25, 1.6]]) p.push(cx + ux * i + vx * j, cz + uz * i + vz * j);
      geo.up(p[0], p[1], p[2], p[3], p[4], p[5], .19, c); geo.up(p[0], p[1], p[4], p[5], p[6], p[7], .19, c);
    }
  }
  /** 나무: 줄기·잎(낮은 다면체) 인스턴스 두 묶음 */
  function trees(g, M, at2, rnd) {
    let n = at2.length / 2;
    const idx = [...Array(n).keys()];
    if (n > MAX.trees) { for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } n = MAX.trees; }
    if (!n) return;
    const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), M.crown, n), trunk = new T.InstancedMesh(new T.CylinderGeometry(.14, .2, 3.2, 5), M.trunk, n);
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3(), c = new T.Color();
    const greens = [0x6f9c5e, 0x7aa766, 0x86b06d, 0x5f8f55, 0x93b878];
    for (let k = 0; k < n; k++) {
      const i = idx[k], x = at2[i * 2], z = at2[i * 2 + 1], s = .8 + rnd() * .5;
      q.setFromEuler(e.set(0, rnd() * 6.28, 0));
      trunk.setMatrixAt(k, m.compose(v.set(x, 1.6 * s, z), q, sc.set(s, s, s)));
      crown.setMatrixAt(k, m.compose(v.set(x, 4.4 * s, z), q, sc.set(2.3 * s, 2.7 * s, 2.3 * s)));
      crown.setColorAt(k, c.setHex(pick(greens, Math.floor(rnd() * 5))));
    }
    for (const o of [crown, trunk]) { o.frustumCulled = false; o.name = "나무"; g.add(o); }
  }

  /* ───────── 자동차: 차 길을 따라 달리고, 교차점에서 이어진 길로 갈아탄다(우측 통행) ───────── */
  function carGeometry() {
    const geo = new Geo(), white = col(0xffffff), glass = col(0x2b323c), dark = col(0x34373d);
    box(geo, 0, 0, 4.3, 1.8, .32, .72, white);
    box(geo, -.25, 0, 2.3, 1.62, 1.04, .5, glass, 0, white);
    box(geo, 0, 0, 4.0, 1.7, .12, .2, dark);
    return geo.geometry();
  }
  function carLightGeometry() {
    const geo = new Geo(), F = col(0xfff0d0), R = col(0xff2a12), O = col(0);
    // 전조등 빛: 앞 바닥으로 퍼지는 사다리꼴(앞으로 갈수록 어두워진다)
    const beam = (x0, x1, w0, w1, c0, c1) => {
      geo.v(x0, .06, -w0, 0, 1, 0, c0); geo.v(x0, .06, w0, 0, 1, 0, c0); geo.v(x1, .06, w1, 0, 1, 0, c1);
      geo.v(x0, .06, -w0, 0, 1, 0, c0); geo.v(x1, .06, w1, 0, 1, 0, c1); geo.v(x1, .06, -w1, 0, 1, 0, c1);
    };
    beam(2.2, 11, .8, 2.8, col(0x6b6250), O);
    beam(-2.2, -4.4, .85, 1.1, col(0x4a0a04), O);
    // 등: 앞(흰색)·뒤(빨강) 작은 판
    for (const s of [-1, 1]) {
      for (const [x, c] of [[2.16, F], [-2.16, R]]) {
        const z0 = s * .55, z1 = s * .82;
        geo.v(x, .62, z0, 1, 0, 0, c); geo.v(x, .86, z0, 1, 0, 0, c); geo.v(x, .86, z1, 1, 0, 0, c);
        geo.v(x, .62, z0, 1, 0, 0, c); geo.v(x, .86, z1, 1, 0, 0, c); geo.v(x, .62, z1, 1, 0, 0, c);
      }
    }
    return geo.geometry();
  }
  function traffic(g, M, data, rnd) {
    const roads = (data.roads || []).filter(r => r.c && r.p.length >= 4 && r.w >= 3.5).map(r => {
      const t = track(r.p);
      return { ...t, w: r.w, o: r.o || 0, lanes: Math.max(1, Math.round(r.w / (r.o ? 3.3 : 6.6))), slow: ["minor", "living", "service"].includes(r.k), j: new Map((r.j || []).map(([i, id]) => [i, id])) };
    }).filter(r => r.len > 8);
    if (!roads.length) return null;
    const J = new Map();
    for (const r of roads) for (const [i, id] of r.j) { if (!J.has(id)) J.set(id, []); J.get(id).push({ r, i }); }
    const total = roads.reduce((a, r) => a + r.len, 0), N = Math.max(4, Math.min(MAX.cars, Math.round(total / 38)));
    const body = new T.InstancedMesh(carGeometry(), M.car, N), lights = new T.InstancedMesh(carLightGeometry(), M.lights, N);
    body.frustumCulled = lights.frustumCulled = false; body.name = "자동차"; lights.name = "자동차 불빛";
    const paint = [0xf4f4f2, 0xf4f4f2, 0xf4f4f2, 0x1d1f23, 0x1d1f23, 0xa9adb3, 0x6d737b, 0x2f4a7a, 0x9a2b2b, 0x3c5a48];
    const c = new T.Color();
    const R = data.r || R_DEF;
    const cars = [];
    const spawn = car => {
      let x = rnd() * total, r = roads[0];
      for (const rr of roads) { if (x <= rr.len) { r = rr; break; } x -= rr.len; }
      car.r = r; car.s = rnd() * r.len; car.dir = r.o || (rnd() < .5 ? 1 : -1);
      car.v = (r.slow ? 4.5 : 8) + rnd() * 3.5; car.lane = Math.floor(rnd() * r.lanes); car.seg = 0; car.yaw = null;
    };
    for (let i = 0; i < N; i++) { const car = {}; spawn(car); cars.push(car); body.setColorAt(i, c.setHex(pick(paint, Math.floor(rnd() * paint.length)))); }
    g.add(body, lights);
    S.glowMeshes.push(lights);
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), one = new T.Vector3(1, 1, 1), p = {};
    function next(car) { // 길 끝: 이어진 길(교차점)로 갈아타거나, 막힌 길이면 돌아서고, 지도 끝이면 다른 곳에서 다시 나온다
      const r = car.r, end = car.dir > 0 ? r.n - 1 : 0, id = r.j.get(end), opts = [];
      for (const { r: r2, i } of J.get(id) || []) {
        if (r2 === r && i === end) continue;
        if (i < r2.n - 1 && r2.o !== -1) opts.push([r2, i, 1]);
        if (i > 0 && r2.o !== 1) opts.push([r2, i, -1]);
      }
      if (opts.length) { const [r2, i, d] = opts[Math.floor(rnd() * opts.length)]; car.r = r2; car.s = r2.cum[i]; car.dir = d; car.lane = Math.min(car.lane, r2.lanes - 1); return; }
      const ex = r.p[end * 2], ez = r.p[end * 2 + 1];
      if (!r.o && Math.hypot(ex, ez) < R * .9) { car.dir = -car.dir; return; }
      spawn(car);
    }
    return {
      update(dt) {
        for (let i = 0; i < N; i++) {
          const car = cars[i];
          car.s += car.dir * car.v * dt;
          if (car.s < 0 || car.s > car.r.len) { car.s = Math.min(car.r.len, Math.max(0, car.s)); next(car); }
          const r = car.r;
          at(r, car.s, p, car.seg); car.seg = p.i;
          const dx = p.dx * car.dir, dz = p.dz * car.dir;
          const off = r.o ? (car.lane - (r.lanes - 1) / 2) * 3.2 : (car.lane + .5) * Math.min(3.2, r.w / 2 / r.lanes);
          const ox = r.o ? -p.dz : -dz, oz = r.o ? p.dx : dx;          // 우측 통행: 진행 방향의 오른쪽 차로
          const yaw = Math.atan2(-dz, dx);
          if (car.yaw == null) car.yaw = yaw;
          let d = yaw - car.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); car.yaw += d * Math.min(1, dt * 7);
          m.compose(v.set(p.x + ox * off, 0, p.z + oz * off), q.setFromEuler(e.set(0, car.yaw, 0)), one);
          body.setMatrixAt(i, m); lights.setMatrixAt(i, m);
        }
        body.instanceMatrix.needsUpdate = lights.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ───────── 전철: 지상 철길을 이어 가장 긴 두 선로에 번갈아 지나간다 ───────── */
  function trains(g, M, data, rnd) {
    const pieces = (data.rails || []).map(r => r.p.slice());
    const same = (a, b, i, j) => Math.abs(a[i] - b[j]) < .6 && Math.abs(a[i + 1] - b[j + 1]) < .6;
    const rev = p => { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
    for (let joined = true; joined;) { // 끝점이 맞닿은 조각끼리 잇는다
      joined = false;
      outer: for (let a = 0; a < pieces.length; a++) for (let b = 0; b < pieces.length; b++) {
        if (a === b) continue;
        const A = pieces[a], B = pieces[b];
        let m = null;
        if (same(A, B, A.length - 2, 0)) m = A.concat(B.slice(2));
        else if (same(A, B, A.length - 2, B.length - 2)) m = A.concat(rev(B).slice(2));
        else if (same(A, B, 0, 0)) m = rev(A).concat(B.slice(2));
        if (m) { pieces[a] = m; pieces.splice(b, 1); joined = true; break outer; }
      }
    }
    const lines = pieces.map(track).filter(t => t.len > 120).sort((a, b) => b.len - a.len).slice(0, 2);
    if (!lines.length) return null;
    const CARS = 8, LEN = 19.5, GAP = 20.4;
    const geo = new Geo(), steel = col(0xdfe3e8), blue = col(0x2d63ae), glass = col(0x27303a), roof = col(0xc4c9cf), dark = col(0x3a3d43);
    box(geo, 0, 0, LEN, 3.1, .75, 2.55, steel, 0, roof);
    box(geo, 0, 0, LEN + .02, 3.12, 1.05, .32, blue);
    box(geo, 0, 0, LEN - 1.2, 3.13, 2.0, .78, glass);
    box(geo, 0, 0, LEN - 2, 2.6, .25, .5, dark);
    const lit = new Geo(); box(lit, 0, 0, LEN - 1.2, 3.15, 2.0, .78, col(0xffe2b0));
    const body = new T.InstancedMesh(geo.geometry(), M.train, CARS), glow = new T.InstancedMesh(lit.geometry(), M.lights, CARS);
    body.frustumCulled = glow.frustumCulled = false; body.name = "전철"; glow.name = "전철 창 불빛";
    g.add(body, glow); S.glowMeshes.push(glow);
    const st = { line: 0, dir: 1, s: -1, wait: 3 + rnd() * 8 };
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), one = new T.Vector3(1, 1, 1), zero = new T.Vector3(0, 0, 0), p = {};
    const hide = () => { for (let k = 0; k < CARS; k++) { m.compose(v.set(0, -50, 0), q, zero); body.setMatrixAt(k, m); glow.setMatrixAt(k, m); } };
    hide();
    return {
      update(dt) {
        const t = lines[st.line];
        if (st.wait > 0) { st.wait -= dt; if (st.wait <= 0) st.s = 0; else return; }
        st.s += 15 * dt;
        const span = t.len + CARS * GAP;
        if (st.s > span) { hide(); body.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true; st.line = (st.line + 1) % lines.length; st.dir = -st.dir; st.wait = 18 + rnd() * 30; return; }
        for (let k = 0; k < CARS; k++) {
          const s = st.s - k * GAP;
          if (s < 0 || s > t.len) { m.compose(v.set(0, -50, 0), q, zero); body.setMatrixAt(k, m); glow.setMatrixAt(k, m); continue; }
          at(t, st.dir > 0 ? s : t.len - s, p);
          const dx = p.dx * st.dir, dz = p.dz * st.dir;
          m.compose(v.set(p.x, .1, p.z), q.setFromEuler(e.set(0, Math.atan2(-dz, dx), 0)), one);
          body.setMatrixAt(k, m); glow.setMatrixAt(k, m);
        }
        body.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ───────── 낮↔밤 ───────── */
  const NIGHT = new T.Color(.34, .37, .48), _t = new T.Color();
  function night(n) {
    S.n = n;
    _t.setRGB(1, 1, 1).lerp(NIGHT, n);
    for (const m of S.tint) m.color.copy(m.userData.base).multiply(_t); // 밤에는 바깥 전체를 어둡게(창·가로등·차 불빛은 그대로)
    for (const m of S.lit) m.emissiveIntensity = n * .95;
    for (const m of S.glow) m.color.setScalar(n);
    for (const o of S.glowMeshes) o.visible = n > .005;
  }
  /* 사무실을 확대해 보는 동안(줌이 크면)은 바깥을 숨겨 예전 모습(창밖 그림)으로 두고,
     축소할수록 땅이 넓어지며 건물이 솟아오른다. 그동안 배경은 화면 테마 색 → 하늘빛(낮)·노을·밤하늘로 바뀐다 */
  const Z_HIDE = .72, Z_FULL = .4;
  function reveal(k) {
    S.k = k;
    const on = k > .002, R = S.data.r || R_DEF;
    S.group.visible = on;
    S.tall.visible = k > .02;
    S.tall.scale.y = Math.max(.02, k);
    FADE.uFadeR.value.set(R * (.16 + .42 * k), R * (.38 + .59 * k));
    if (S.credit) S.credit.hidden = !on;
    if (on !== S.shown) {
      S.shown = on;
      sky(!on);
      if (!on) { renderer.setClearColor(S.ui); if (HAS_DECOR) Decor.theme(OFFICE.n ?? 0); } // 창밖 노을·야경 층을 다시 맞춘다
    }
  }
  const HAZE = [new T.Color(0xdae1ea), new T.Color(0x8d879f), new T.Color(0x0e121b)], _bg = new T.Color();
  function background(n, k) {
    if (n < .5) _bg.copy(HAZE[0]).lerp(HAZE[1], n * 2); else _bg.copy(HAZE[1]).lerp(HAZE[2], n * 2 - 1);
    _bg.lerp(S.ui, 1 - k);
    renderer.setClearColor(_bg);
    FADE.uFadeColor.value.copy(_bg);
  }
  /** 사무실 창밖 그림(decor.js 스카이라인)은 진짜 바깥이 보일 때 숨긴다 */
  function sky(show) {
    const th = HAS_DECOR ? Decor.themed : null;
    if (!th) return;
    if (th.skyline) th.skyline.visible = show;
    if (!show) for (const k of ["skyDusk", "skyNight"]) if (th[k]) th[k].visible = false;
  }
  /** 바깥이 보이면 카메라를 멀리(정사영이라 화면은 그대로, 지도가 잘리지 않게) 두고 더 축소할 수 있게 */
  function widen(on) {
    if (on && !S.saved) {
      S.saved = { far: camera.far, len: CAM_OFF.length(), minZoom: controls.minZoom };
      camera.far = 5000; camera.updateProjectionMatrix();
      const len = 1500;
      CAM_OFF.setLength(len);
      const off = camera.position.clone().sub(controls.target).setLength(len); // 보는 방향은 그대로, 거리만
      camera.position.copy(controls.target).add(off);
      controls.minZoom = Math.min(S.saved.minZoom, .05);
    } else if (!on && S.saved) {
      camera.far = S.saved.far; camera.updateProjectionMatrix();
      CAM_OFF.setLength(S.saved.len);
      const off = camera.position.clone().sub(controls.target).setLength(S.saved.len);
      camera.position.copy(controls.target).add(off);
      controls.minZoom = S.saved.minZoom;
      if (camera.zoom < controls.minZoom) { camera.zoom = controls.minZoom; camera.updateProjectionMatrix(); }
      S.saved = null;
    }
  }
  /** 지도 출처(ODbL 필수)와 '동네 보기' 버튼 */
  function credit(on) {
    const host = document.getElementById("officeFrame") || document.getElementById("stage");
    if (on && !S.credit && host) {
      S.credit = el("div", { class: "outside-credit", hidden: true }, "지도 ",
        el("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener", text: "© OpenStreetMap 기여자" }));
      host.append(S.credit);
      const tools = host.querySelector(".office-tools");
      if (tools) {
        S.btn = el("button", { type: "button", class: "outside-zoom", "aria-label": "동네 보기", title: "동네 보기 / 사무실로 돌아가기", onclick: toggleZoom }, "동네");
        tools.prepend(S.btn);
      }
    } else if (!on) { S.credit?.remove(); S.btn?.remove(); S.credit = S.btn = null; }
  }
  function toggleZoom() {
    if (!S.group) return;
    const far = cam.view / ((S.data?.r || R_DEF) * 1.35);
    if (camera.zoom > far * 1.6) setView(cam.view, new T.Vector3(0, 0, 0), true, far);
    else resetView();
  }
  function clear() {
    if (S.group) {
      scene.remove(S.group);
      S.group.traverse(o => { o.geometry?.dispose(); });
      for (const m of Object.values(S.mats || {})) m.dispose();
    }
    const was = S.shown;
    S.group = S.tall = S.data = S.traffic = S.trains = null; S.mats = null; S.lit = []; S.glow = []; S.glowMeshes = []; S.tint = [];
    S.key = ""; S.rot = 0; S.k = -1; S.shown = null;
    widen(false); sky(true); credit(false);
    if (was) { renderer.setClearColor(S.ui); if (HAS_DECOR) Decor.theme(OFFICE.n ?? 0); }
  }

  /* ───────── 사무실 위치 ───────── */
  function norm(p) {
    if (!p || !Number.isFinite(+p.lat) || !Number.isFinite(+p.lng)) return null;
    return { lat: +p.lat, lng: +p.lng, label: String(p.label || "").slice(0, 200), floor: clampInt(p.floor, 1, 200, 1),
      show: p.show === true, turn: clampInt(p.turn, 0, 3, 0), r: clampInt(p.r, 100, 600, R_DEF) }; // show 가 없는 값(예: '현재 위치로 맞추기')은 해에만 쓴다
  }
  function readLocal() { try { return norm(JSON.parse(store.get(LOCAL) || "null")); } catch { return null; } }
  function rerender() { try { if (VIEW.name === "settings") scheduleView(); } catch { /* 설정 화면 없음 */ } }
  function push() {
    if (NET.mode !== "live") return;
    (S.place ? api("/api/outside/place", { method: "PUT", body: JSON.stringify(S.place) }) : api("/api/outside/place", { method: "DELETE" })).catch(() => {});
  }
  /** 위치를 바꾼다: 이 브라우저·서버에 저장하고, 해(일출·일몰)와 지도를 다시 맞춘다 */
  function setPlace(p, sync = true) {
    S.place = norm(p);
    S.seen = S.place ? JSON.stringify(S.place) : "";
    store.set(LOCAL, S.seen);
    if (sync) push();
    S.tries = 0; S.nextTry = 0; S.error = "";
    applyTheme(true);
    refresh();
    rerender();
  }
  /** 서버에 저장된 위치를 한 번 받아 온다(다른 기기에서 정한 주소). 서버에 없고 이 브라우저에만 있으면 올린다 */
  async function syncPlace() {
    S.synced = true;
    try {
      const r = await api("/api/outside/place");
      if (!r.ok) return;
      const sp = norm((await r.json()).place);
      if (sp && JSON.stringify(sp) !== S.seen) setPlace(sp, false);
      else if (!sp && S.place) push();
    } catch { /* 연결이 끊긴 사이 */ }
  }
  /** 지금 위치에 맞는 지도를 세운다(같으면 그대로). 서버가 바쁘면 30초·2분·5분 뒤 다시 */
  async function refresh() {
    const p = S.place;
    if (!p || !p.show) { if (S.group) { clear(); applyTheme(true); } return; }
    const key = [p.lat, p.lng, p.r, p.turn, OW, OD].join(",");
    if (S.group && key === S.key) {
      if (S.floor !== p.floor) { S.floor = p.floor; build(S.data, p); S.key = key; applyTheme(true); }
      return;
    }
    if (S.loading) { S.pending = true; return; }
    if (NET.mode !== "live") return;                   // 서버가 있어야 지도를 받는다(연결되면 tick 이 다시 부른다)
    S.loading = true; S.status = "loading"; rerender();
    const slow = setTimeout(() => toast("동네 지도를 받는 중이에요. 처음 한 번은 1~2분 걸릴 수 있어요.", "info", 6000), 2500);
    try {
      const qs = new URLSearchParams({ lat: p.lat, lng: p.lng, r: p.r, w: OW, d: OD, turn: p.turn });
      const res = await api(`/api/outside/map?${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `지도를 받지 못했어요 (${res.status})`);
      if (S.place === p) {
        S.floor = p.floor; build(body, p); S.key = key;
        S.status = "ok"; S.tries = 0; S.error = "";
        applyTheme(true);
      }
    } catch (e) {
      S.status = "error"; S.error = e.message || String(e);
      S.nextTry = Date.now() + [30, 120, 300][Math.min(2, S.tries++)] * 1000;
      toast(`${S.error} 잠시 뒤 다시 시도할게요.`, "warn", 6500);
    } finally {
      clearTimeout(slow);
      S.loading = false; rerender();
      if (S.pending) { S.pending = false; refresh(); }
    }
  }

  /* ───────── 설정 화면: '사무실 조명' 다음에 '사무실 위치 · 바깥 풍경' 행 ───────── */
  async function search() {
    const q = S.q.trim();
    if (!q) { document.getElementById("outsideQ")?.focus(); return; }
    if (NET.mode !== "live") { toast("서버에 연결되어 있어야 주소를 찾을 수 있어요.", "warn"); return; }
    S.searching = true; rerender();
    try {
      const r = await api(`/api/outside/geocode?q=${encodeURIComponent(q)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || `주소를 찾지 못했어요 (${r.status})`);
      S.results = body.results || [];
      if (!S.results.length) toast("주소를 찾지 못했어요. 시·구·도로명·건물 번호까지 넣어 보세요. (예: 서울 중구 세종대로 110)", "warn", 6500);
      else if (S.results.length === 1) choose(S.results[0]);
    } catch (e) { toast(e.message || String(e), "error"); }
    finally { S.searching = false; rerender(); }
  }
  function choose(hit) {
    const prev = S.place;
    S.results = null; S.q = "";
    setPlace({ lat: hit.lat, lng: hit.lng, label: hit.label, floor: prev?.floor || 1, show: true, turn: 0, r: prev?.r || R_DEF });
    toast(`${hit.label} 주변을 불러올게요.`);
  }
  const patch = o => setPlace({ ...S.place, ...o });
  function note() {
    const p = S.place;
    if (!p) return "주소를 넣으면 실제 지도(OpenStreetMap)로 주변 건물·도로·공원을 사무실 둘레에 세워요. 일출·일몰 시각도 이 위치로 계산해요.";
    const state = !p.show ? "바깥 풍경은 숨겨 두었어요."
      : S.status === "loading" ? "주변 지도를 불러오는 중…"
      : S.status === "error" ? `지도를 받지 못했어요: ${S.error}`
      : NET.mode !== "live" && !S.group ? "서버에 연결되면 주변 지도를 불러와요."
      : "주변 건물·도로가 보여요. 휠·핀치로 축소하거나 사무실 화면의 '동네' 버튼으로 동네 전체를 볼 수 있어요.";
    return `${p.label || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}${p.floor > 1 ? ` · ${p.floor}층` : ""} — ${state}`;
  }
  function row() {
    const p = S.place;
    const input = el("input", { id: "outsideQ", type: "search", value: S.q, autocomplete: "street-address", enterkeyhint: "search",
      placeholder: "도로명 주소·건물 이름 (예: 서울 중구 세종대로 110)", "aria-label": "사무실 주소",
      oninput: e => { S.q = e.target.value; }, onkeydown: e => { if (e.key === "Enter") { e.preventDefault(); search(); } } });
    return el("div", { class: "set-row outside-row" },
      el("div", { class: "lbl" }, "사무실 위치 · 바깥 풍경", el("small", { text: note() })),
      el("div", { class: "outside-ctl" },
        el("div", { class: "outside-search" },
          el("label", { class: "search-input", for: "outsideQ" }, icon("search"), input),
          el("button", { class: "tbtn", type: "button", disabled: S.searching, onclick: search }, S.searching ? "찾는 중…" : p ? "주소 바꾸기" : "찾기")),
        S.results?.length ? el("div", { class: "outside-hits", role: "group", "aria-label": "주소 후보" },
          ...S.results.map(h => el("button", { class: "outside-hit", type: "button", onclick: () => choose(h) },
            el("span", { text: h.label }), h.exact ? null : el("small", { text: "넓은 범위(도로·지역)" })))) : null,
        p ? el("div", { class: "outside-opts" },
          el("div", { class: "seg", role: "group", "aria-label": "바깥 풍경" },
            ...[[true, "보이기"], [false, "숨기기"]].map(([v, label]) => el("button", { type: "button", "aria-pressed": String(p.show === v), onclick: () => patch({ show: v }) }, label))),
          el("label", { class: "outside-floor" },
            el("input", { type: "number", min: "1", max: "200", value: String(p.floor), inputmode: "numeric", "aria-label": "사무실 층",
              onchange: e => patch({ floor: clampInt(e.target.value, 1, 200, p.floor) }) }), "층"),
          el("button", { class: "tbtn", type: "button", title: "사무실이 건물 안에서 놓인 방향을 90°씩 돌려요", onclick: () => patch({ turn: (p.turn + 1) % 4 }) }, "방향 돌리기"),
          el("button", { class: "tbtn", type: "button", onclick: () => { S.results = null; setPlace(null); } }, "위치 지우기")) : null));
  }

  /* ───────── 앱에 붙이기 ───────── */
  const baseLight = window.setOfficeLight;
  if (typeof baseLight === "function") {
    window.setOfficeLight = function (n) {
      baseLight(n);
      renderer.getClearColor(S.ui);                     // app.js 가 정한 화면 테마 배경색
      if (!S.group) return;
      if (S.rot) { // 해 위치는 실제 방위(x 동쪽·z 남쪽)로 계산되어 오므로 지도와 같은 만큼 돌린다
        const c = Math.cos(S.rot), s = Math.sin(S.rot), x = sun.position.x, z = sun.position.z;
        sun.position.x = x * c + z * s; sun.position.z = -x * s + z * c;
      }
      if (S.shown) { sky(false); background(n, S.k); }
    };
  }
  if (typeof VIEWS.settings === "function") {
    const baseSettings = VIEWS.settings;
    VIEWS.settings = function () {
      const rows = [].concat(baseSettings());
      const i = rows.findIndex(r => r?.classList?.contains("set-row") && r.textContent.startsWith("사무실 조명"));
      rows.splice(i >= 0 ? i + 1 : Math.min(1, rows.length), 0, row());
      return rows;
    };
  }

  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!S.group || document.hidden) return;
    const t = Math.min(1, Math.max(0, (Z_HIDE - camera.zoom) / (Z_HIDE - Z_FULL))), k = t * t * (3 - 2 * t);
    if (Math.abs(k - S.k) > .001) reveal(k);
    if (!S.shown) return;
    const n = OFFICE.n ?? 0;
    if (Math.abs(n - S.n) > .004) night(n);
    background(n, k);
    if (!mqReduce.matches && k > .5) { S.traffic?.update(dt); S.trains?.update(dt); }
  }
  requestAnimationFrame(tick);
  setInterval(() => {
    const s = store.get(LOCAL) || "";
    if (s !== S.seen) { S.seen = s; S.place = readLocal(); push(); S.tries = 0; S.nextTry = 0; refresh(); rerender(); } // '현재 위치로 맞추기'·'시간대 기준으로'
    if (!S.synced && NET.mode === "live") syncPlace();
    if (S.place?.show && !S.group && !S.loading && NET.mode === "live" && Date.now() >= S.nextTry) refresh();
  }, 1000);
  renderer.getClearColor(S.ui);
  S.seen = store.get(LOCAL) || "";
  S.place = readLocal();
  window.Outside = { get place() { return S.place; }, get data() { return S.data; }, get status() { return S.error ? `${S.status}: ${S.error}` : S.status; }, refresh, setPlace, clear };
})();
