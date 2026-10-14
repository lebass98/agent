"use strict";
/* Agent Office 장식(decor): 평면도·방·가구·조명·길 찾기 격자.
   전역 스크립트. window.THREE 가 있어야 3D 를 만들고, 없으면 평면 데이터(rooms/spots/nav)만 쓸 수 있다(노드 검증용).
   app.js 는 typeof Decor !== "undefined" 로 감싸서 부르므로, 이 파일이 없어도 앱은 동작한다.
   좌표: x 왼쪽(−)·오른쪽(+), z 뒤(−)·앞(+), y 위. 카메라는 앞-오른쪽(+x,+z) 위에서 본다 → +x·+z 를 향한 면이 보인다. */
(function () {
  const T = typeof window !== "undefined" ? window.THREE : (typeof globalThis !== "undefined" ? globalThis.THREE : null);
  const OW = 32, OD = 22, WALL_H = 4, PART_H = 2.6, DOOR_W = 1.6;
  const X0 = -OW / 2, X1 = OW / 2, Z0 = -OD / 2, Z1 = OD / 2;

  /* ───────── 평면도 ─────────
     chip: 방 이름 칩(HTML)을 띄우는 바닥 좌표. 사람이 앉는 자리(팀장 책상·회의 상석) 머리 위와 겹치지 않는 곳에 둔다.
     off: true 면 칩을 만들되 기본으로 숨긴다(라운지는 명세의 5개 방 칩 목록에 없다). */
  const rooms = {
    lobby: { x0: X0, x1: -9.5, z0: 4, z1: Z1, label: "현관", door: { x: -9.5, z: 7.5, axis: "z", w: DOOR_W }, chip: { x: -12.5, z: 9.3 } },
    pantry: { x0: X0, x1: -8.5, z0: Z0, z1: -4, label: "탕비실", door: { x: -10, z: -4, axis: "x", w: DOOR_W }, chip: { x: -12.3, z: -5.2 } },
    work: { x0: -8.5, x1: 5, z0: Z0, z1: Z1, label: "업무 공간", door: null, chip: { x: -1.75, z: -9.2 } },
    exec: { x0: 5, x1: X1, z0: Z0, z1: -3.5, label: "대표님실", door: { x: 5, z: -4.5, axis: "z", w: DOOR_W }, door2: { x: 13, z: -3.5, axis: "x", w: DOOR_W }, chip: { x: 6.8, z: -5.5 } },
    meeting: { x0: 5, x1: X1, z0: -3.5, z1: 4.5, label: "회의실", door: { x: 5, z: 3.5, axis: "z", w: DOOR_W }, chip: { x: 8, z: 3.2 } },
    lounge: { x0: 5, x1: X1, z0: 4.5, z1: Z1, label: "라운지", door: null, chip: { x: 11, z: 9.8, off: true } },
  };
  const ENTRANCE = { x: -14.3, z: 7.5 };                     // 현관 유리문 바로 안
  const LOBBY_DOOR = { x: X0, z: 7.5, w: 2 };                // 바깥 유리 양문(왼쪽 외벽)
  const TABLE = { x: 11, z: .5, w: 3.6, d: 1.3 };            // 회의실 긴 테이블
  const TV = { x: 5, z: .3, w: 2.4, h: 1.35, y: 1.85 };       // 회의실 TV(x=5 칸막이 +x 면)
  const WHITEBOARD = { x: 6.2, z: .3 }, BOARD_FACE = { x: 5, z: .3 };
  const COUNTER = { x: -15.6, z: -8.6 };                     // 탕비실 커피 머신
  const PANTRY_TABLE = { x: -11.6, z: -7.6, w: 1.9, d: 1.15 };
  // 탕비실 대기 자리: 카운터 앞(x≈-14.5, 커피 머신을 본다)과 타원 테이블 둘레(테이블을 본다)를 번갈아 채워 한 줄로 서지 않게 한다
  const COFFEE = [{ x: -14.5, z: -8.4 }, { x: -9.5, z: -7.6 }, { x: -13.6, z: -5.3 }, { x: -14.5, z: -9.6 }, { x: -12.6, z: -5.1 },
    { x: -9.6, z: -9.8 }, { x: -14.5, z: -7.2 }, { x: -13.6, z: -10 }, { x: -9.6, z: -5.4 }];
  const EXEC_DESK = { x: 11, z: -8.8, w: 3 };
  const EXEC_SEAT = { x: 11, z: -7.5 };
  const REPORT_SPOT = { x: 12.9, z: -7.2 };                  // 검수 보고 자리: 대표 책상 오른쪽 모서리(12.5,-8.2)에서 0.4 떨어진 앞쪽
  // 회의 의자 9개(3D 최대 인원과 같다): 카메라에 얼굴이 보이는 쪽(z=-.7)·양 끝부터 채우고, 9번째는 뒤쪽 모서리
  const MEET_SEATS = [{ x: 11, z: -.7 }, { x: 9.6, z: -.7 }, { x: 12.4, z: -.7 }, { x: 8.5, z: .5 }, { x: 13.5, z: .5 },
    { x: 11, z: 1.7 }, { x: 9.6, z: 1.7 }, { x: 12.4, z: 1.7 }, { x: 8.3, z: -.7 }];
  const ROWS = [-1.5, -7.5, 4.5], ROW_CAP = 3, PITCH = 3.2, ROW_CX = -2.35, DESK_W = 2.6, SEAT_DZ = 1.15;
  /** 팀원(팀장 제외) n 명의 책상 자리: 가운데 줄 → 뒷줄 → 앞줄 순으로 한 줄에 3개까지. */
  function slots(n) {
    n = Math.max(0, Math.min(ROWS.length * ROW_CAP, n | 0));
    const rows = ROWS.map(() => 0);
    for (let i = 0; i < n; i++) rows[Math.min(ROWS.length - 1, Math.floor(i / ROW_CAP))]++;
    if (n === 4) rows[0] = rows[1] = 2;
    if (n === 5) { rows[0] = 3; rows[1] = 2; rows[2] = 0; }
    const out = [];
    rows.forEach((k, r) => { for (let i = 0; i < k; i++) out.push({ x: ROW_CX + (i - (k - 1) / 2) * PITCH, z: ROWS[r], w: DESK_W, row: r, col: i, cols: k }); });
    return out;
  }
  /** 팀 n 명(0 번이 팀장)의 자리: seat(책상 앞, −z 를 본다)·meet(회의 의자)·coffee(탕비실). */
  function spots(n) {
    const sl = slots(n - 1);
    return Array.from({ length: n }, (_, i) => {
      const seat = i === 0 ? { ...EXEC_SEAT } : { x: sl[i - 1].x, z: sl[i - 1].z + SEAT_DZ };
      return { seat, meet: { ...MEET_SEATS[i % MEET_SEATS.length] }, coffee: { ...COFFEE[i % COFFEE.length] }, desk: i === 0 ? { ...EXEC_DESK } : { ...sl[i - 1] } };
    });
  }

  /* 벽·칸막이(길 찾기·기하 공통). t: 두께. 문은 gap 으로 비운다. */
  const WT = .1;
  const wallDefs = [
    { axis: "x", at: Z0, a: X0, b: X1, outer: true },                // 뒷벽(창)
    { axis: "z", at: X0, a: Z0, b: Z1, outer: true },                // 왼쪽 벽(현관문 자리는 장식만)
    { axis: "x", at: Z1, a: X0, b: X1, outer: true, ghost: true },   // 앞(보이지 않음, 못 나가게만)
    { axis: "z", at: X1, a: Z0, b: Z1, outer: true, ghost: true },   // 오른쪽(보이지 않음)
    { axis: "z", at: -9.5, a: 4, b: Z1, gap: [6.7, 8.3] },           // 현관 칸막이
    { axis: "x", at: -4, a: X0, b: -8.5, gap: [-10.8, -9.2] },       // 탕비실 앞(문)
    { axis: "z", at: -8.5, a: Z0, b: -4 },                           // 탕비실 옆
    { axis: "z", at: 5, a: Z0, b: -3.5, gap: [-5.3, -3.7] },         // 대표님실 옆(문)
    { axis: "x", at: -3.5, a: 5, b: X1, gap: [12.2, 13.8] },         // 대표님실/회의실 사이(연결문)
    { axis: "z", at: 5, a: -3.5, b: 4.5, gap: [2.7, 4.3], solid: [-1.3, 1.9] }, // 회의실 옆(문·TV 패널)
    { axis: "x", at: 4.5, a: 5, b: X1 },                             // 회의실/라운지 사이
  ];
  /** 벽 선분들(문 틈 제외)을 축 정렬 사각형으로. */
  function wallRects() {
    const out = [];
    for (const w of wallDefs) {
      const segs = w.gap ? [[w.a, w.gap[0]], [w.gap[1], w.b]] : [[w.a, w.b]];
      for (const [a, b] of segs) {
        if (b - a < .05) continue;
        out.push(w.axis === "x" ? { x0: a, x1: b, z0: w.at - WT / 2, z1: w.at + WT / 2, wall: true } : { x0: w.at - WT / 2, x1: w.at + WT / 2, z0: a, z1: b, wall: true });
      }
    }
    return out;
  }
  const R = (cx, cz, w, d, tag) => ({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, tag });
  /* 고정 가구 발자국(길 찾기용). 사람이 앉는 회의 의자는 뺀다(layout 때 빈 의자만 더한다). */
  const furniture = [
    // 현관
    R(-15.1, 4.9, .85, 1.6, "sofa"), R(-13.5, 4.9, .7, .7, "table"), R(-13.8, 9.3, .4, .4, "kiosk"), R(-15.3, 6.1, .7, .7, "plant"), R(-15.3, 8.9, .7, .7, "plant"),
    // 탕비실
    R(-15.62, -8.68, .76, 4.25, "counter"), R(-15.55, -5.9, .8, .8, "fridge"), R(PANTRY_TABLE.x, PANTRY_TABLE.z, PANTRY_TABLE.w, PANTRY_TABLE.d, "table"),
    R(-12.95, -7.6, .45, .45, "chair"), R(-10.25, -7.6, .45, .45, "chair"), R(-11.6, -8.8, .45, .45, "chair"), R(-11.6, -6.4, .45, .45, "chair"),
    R(-9.05, -10.5, .45, .45, "cooler"),
    // 업무 공간 화분
    R(-8, 10.3, .8, .8, "plant"), R(4.4, -10.4, .8, .8, "plant"), R(-7.9, -10.4, .8, .8, "plant"), R(4.4, 10.3, .8, .8, "plant"),
    // 대표님실
    R(EXEC_DESK.x, EXEC_DESK.z, EXEC_DESK.w, 1.2, "desk"), R(10.2, -9.9, .5, .5, "chair"), R(11.8, -9.9, .5, .5, "chair"),
    R(6.1, -9.6, .85, 1.7, "sofa"), R(7.5, -9.6, .9, .5, "table"), R(14.2, -10.6, 2, .4, "shelf"), R(15.4, -4.1, .7, .7, "plant"), R(8.4, -10.5, .6, .6, "plant"),
    R(15.3, -6.6, .4, .4, "lamp"),
    // 회의실
    R(TABLE.x, TABLE.z, TABLE.w, TABLE.d, "table"), R(15.4, -2.9, .7, .7, "plant"), R(15.4, 3.9, .7, .7, "plant"),
    // 라운지
    R(12.5, 8.6, 2.2, .9, "sofa"), R(12.5, 10.1, 1, .5, "table"), R(9.6, 9.3, .8, .8, "chair"), R(14.4, 8.6, .6, .6, "table"), R(14.9, 9.7, .4, .4, "lamp"),
    R(6.3, 10, 1.1, .6, "printer"), R(15.4, 5.2, .7, .7, "plant"), R(6, 5.3, .6, .6, "plant"),
  ];
  /** n 명 팀 기준 길 찾기용 사각형 전체: 벽 + 고정 가구 + 책상(칸막이 포함) + 빈 회의 의자. */
  function navRects(n) {
    const out = [...wallRects(), ...furniture];
    for (const s of slots(n - 1)) out.push({ x0: s.x - s.w / 2 - .15, x1: s.x + s.w / 2 + .15, z0: s.z - .72, z1: s.z + .6, tag: "desk" });
    MEET_SEATS.forEach((m, i) => { if (i >= n) out.push(R(m.x, m.z, .5, .5, "chair")); });
    return out;
  }

  /* ───────── 길 찾기: 격자 A* + 시야 단축 ───────── */
  const nav = {
    cell: .5, r: .35, rects: [], grid: null, nx: 0, nz: 0, x0: X0, z0: Z0,
    build(rects) {
      const c = this.cell, r = this.r;
      this.rects = rects.map(q => ({ ...q, ix0: q.x0 - r, ix1: q.x1 + r, iz0: q.z0 - r, iz1: q.z1 + r }));
      this.nx = Math.round(OW / c); this.nz = Math.round(OD / c);
      const g = this.grid = new Uint8Array(this.nx * this.nz);
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + (i + .5) * c, z = this.z0 + (j + .5) * c;
        let ok = 1; // 넓힌 사각형의 경계에 딱 걸친 칸도 막는다(경로가 가구를 스치지 않게)
        for (const q of this.rects) if (x > q.ix0 - 1e-6 && x < q.ix1 + 1e-6 && z > q.iz0 - 1e-6 && z < q.iz1 + 1e-6) { ok = 0; break; }
        g[j * this.nx + i] = ok;
      }
      return this;
    },
    cellOf(p) { return [Math.min(this.nx - 1, Math.max(0, Math.floor((p.x - this.x0) / this.cell))), Math.min(this.nz - 1, Math.max(0, Math.floor((p.z - this.z0) / this.cell)))]; },
    center(i, j) { return { x: this.x0 + (i + .5) * this.cell, z: this.z0 + (j + .5) * this.cell }; },
    free(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.grid[j * this.nx + i] === 1; },
    walkable(x, z) { if (!this.grid) return true; const [i, j] = this.cellOf({ x, z }); return this.free(i, j); },
    /** 가장 가까운 걸을 수 있는 칸(원형 탐색). */
    nearest(p) {
      const [ci, cj] = this.cellOf(p);
      if (this.free(ci, cj)) return [ci, cj];
      let best = null, bd = Infinity;
      for (let ring = 1; ring < 12 && !best; ring++) {
        for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring || !this.free(ci + di, cj + dj)) continue;
          const q = this.center(ci + di, cj + dj), d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bd) { bd = d; best = [ci + di, cj + dj]; }
        }
      }
      return best;
    },
    /** 선분 a→b 가 사각형들을 지나는지. 끝점이 넓힌 영역 안에 있으면(자리에서 나오는 중) 원래 크기로만 본다. */
    los(a, b) {
      for (const q of this.rects) {
        const ina = a.x > q.ix0 && a.x < q.ix1 && a.z > q.iz0 && a.z < q.iz1, inb = b.x > q.ix0 && b.x < q.ix1 && b.z > q.iz0 && b.z < q.iz1;
        const x0 = ina || inb ? q.x0 : q.ix0, x1 = ina || inb ? q.x1 : q.ix1, z0 = ina || inb ? q.z0 : q.iz0, z1 = ina || inb ? q.z1 : q.iz1;
        if (segHits(a, b, x0, x1, z0, z1)) return false;
      }
      return true;
    },
    astar(s, e) {
      const nx = this.nx, nz = this.nz, g = this.grid, N = nx * nz;
      const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
      const si = s[1] * nx + s[0], ei = e[1] * nx + e[0];
      const h = i => { const dx = Math.abs(i % nx - e[0]), dz = Math.abs((i / nx | 0) - e[1]); return Math.max(dx, dz) + .4142 * Math.min(dx, dz); };
      const heap = [], push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
      gs[si] = 0; push(si, h(si));
      while (heap.length) {
        const [, cur] = pop();
        if (closed[cur]) continue;
        closed[cur] = 1;
        if (cur === ei) break;
        const ci = cur % nx, cj = cur / nx | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz || !g[nj * nx + ni]) continue;
          if (di && dj && (!g[cj * nx + ni] || !g[nj * nx + ci])) continue; // 모서리 끼어 지나기 금지
          const n = nj * nx + ni, ng = gs[cur] + (di && dj ? 1.4142 : 1);
          if (ng < gs[n]) { gs[n] = ng; from[n] = cur; push(n, ng + h(n)); }
        }
      }
      if (from[ei] < 0 && ei !== si) return null;
      const cells = [];
      for (let i = ei; i >= 0; i = from[i]) { cells.push([i % nx, i / nx | 0]); if (i === si) break; }
      return cells.reverse();
    },
    /** 출발점을 뺀 경로. 목적지는 정확히 마지막 점. 못 찾으면 직선. */
    route(from, to) {
      const a = { x: from.x, z: from.z }, b = { x: to.x, z: to.z };
      if (!this.grid) return [b];
      if (this.los(a, b)) return [b];
      const s = this.nearest(a), e = this.nearest(b);
      if (!s || !e) return [b];
      const cells = this.astar(s, e);
      if (!cells) return [b];
      const pts = [a, ...cells.map(([i, j]) => this.center(i, j)), b];
      // 시야 단축(string pulling): 보이는 가장 먼 점으로 건너뛴다
      const out = [];
      let k = 0;
      while (k < pts.length - 1) {
        let j = pts.length - 1;
        while (j > k + 1 && !this.los(pts[k], pts[j])) j--;
        out.push(pts[j]); k = j;
      }
      return out;
    },
  };
  function segHits(a, b, x0, x1, z0, z1) { // Liang–Barsky
    const dx = b.x - a.x, dz = b.z - a.z;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dz, a.z - z0], [dz, z1 - a.z]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return t0 < t1;
  }

  const Decor = {
    OW, OD, WALL_H, PART_H, rooms, walls: wallDefs, wallRects, obstacles: furniture, navRects, slots, spots, nav,
    ENTRANCE, TABLE, WHITEBOARD, BOARD_FACE, COUNTER, COFFEE, EXEC_DESK, EXEC_SEAT, REPORT_SPOT, MEET_SEATS, PANTRY_TABLE, LOBBY_DOOR, TV,
    walkable: (x, z) => nav.walkable(x, z), segHits,
  };
  if (typeof window !== "undefined") window.Decor = Decor; else if (typeof module !== "undefined") module.exports = Decor;
  if (!T) return; // 3D 없음: 평면 데이터만

  /* ───────── 3D 도구 ───────── */
  let small = false, scene = null, agentsFn = () => [];
  const rnd = (() => { let s = 20261014; return () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646; })();
  const VMAT = () => new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 });
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  /** 여러 상자·원기둥을 정점 색으로 칠해 메시 하나로 합친다(드로우콜 절약). */
  class MB {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.n = 0; }
    add(geo, color, x, y, z, o) {
      o = o || {};
      const g = geo.index ? geo.toNonIndexed() : geo;
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e); _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1); _p.set(x, y, z);
      _m.compose(_p, _q, _s); g.applyMatrix4(_m);
      const p = g.attributes.position.array, c = new T.Color(color), k = p.length / 3, ca = new Float32Array(k * 3);
      for (let i = 0; i < k; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
      this.pos.push(p); this.nor.push(g.attributes.normal.array); this.uv.push(g.attributes.uv.array); this.col.push(ca); this.n += k;
      if (g !== geo) g.dispose();
      geo.dispose();
      return this;
    }
    box(w, h, d, color, x, y, z, o) { return this.add(new T.BoxGeometry(w, h, d), color, x, y, z, o); }
    cyl(rt, rb, h, color, x, y, z, seg = 16, o) { return this.add(new T.CylinderGeometry(rt, rb, h, seg), color, x, y, z, o); }
    sphere(r, color, x, y, z, o, seg = 12) { return this.add(new T.SphereGeometry(r, seg, Math.max(6, seg >> 1)), color, x, y, z, o); }
    leaf(r, color, x, y, z, o) { return this.add(new T.IcosahedronGeometry(r, small ? 0 : 1), color, x, y, z, o); }
    mesh(parent, material, shadow = true) {
      if (!this.n) return null;
      const cat = (arrs, n) => { const out = new Float32Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(cat(this.pos, this.n * 3), 3));
      g.setAttribute("normal", new T.BufferAttribute(cat(this.nor, this.n * 3), 3));
      g.setAttribute("uv", new T.BufferAttribute(cat(this.uv, this.n * 2), 2));
      g.setAttribute("color", new T.BufferAttribute(cat(this.col, this.n * 3), 3));
      const m = new T.Mesh(g, material || VMAT());
      m.castShadow = m.receiveShadow = shadow;
      parent.add(m);
      this.pos = []; this.nor = []; this.uv = []; this.col = []; this.n = 0;
      return m;
    }
  }
  const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const FONT = '"Noto Sans KR", system-ui, sans-serif';
  const redraws = []; // 글꼴이 늦게 오면 다시 그릴 캔버스들
  function texture(cv) { const t = new T.CanvasTexture(cv); t.minFilter = T.LinearFilter; t.anisotropy = 4; return t; }
  /** 캔버스 표지판 평면. draw(ctx,w,h) 를 지금 그리고 글꼴 로드 뒤 한 번 더 그린다. 없앨 때는 m.userData.release() 로 redraws 에서도 뺀다. */
  function sign(parent, w, h, px, draw, x, y, z, o = {}) {
    const cv = canvas(px, Math.round(px * h / w)), c = cv.getContext("2d"), tex = texture(cv);
    const paint = () => { c.save(); draw(c, cv.width, cv.height); c.restore(); tex.needsUpdate = true; };
    paint(); redraws.push(paint);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: !!o.alpha }));
    m.position.set(x, y, z); m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0); parent.add(m);
    m.userData.release = () => { const i = redraws.indexOf(paint); if (i >= 0) redraws.splice(i, 1); };
    return m;
  }
  const plate = (text, bg = "#2b3245", fg = "#ffffff", size = 30) => (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = fg; c.font = `700 ${size}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, w / 2, h / 2 + 1);
  };

  /* ───────── 가구 ───────── */
  const C = { wood: 0xd8bd97, woodDark: 0x4b3627, white: 0xf4f5f7, panel: 0xe9ebf0, frame: 0x30343c, alu: 0x3b3f49, chairBlack: 0x24262c, cushion: 0x34373f,
    gray: 0x8d94a3, grayDark: 0x5c6270, leather: 0x1a1c21, steel: 0xb9bec7, pot: 0xd9cfc1, terra: 0xc98a64, soil: 0x4a3b2d, green: [0x3f8a4f, 0x4f9d5f, 0x5fae6e, 0x3b7d48, 0x6cb97a],
    blue: 0x9fb3d6, sofaBlue: 0x8aa0c8, sofaGray: 0xa3abb9, book: [0xd97757, 0x4f7cf7, 0x10a37f, 0xe8a317, 0x8e6cd1, 0xe05a8a, 0x1fa2b8] };
  const rot = (x, z, a) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  /** 사무용 의자(5발 캐스터·가스 실린더·좌판·등받이·팔걸이). rotY=0 이면 +z 를 보고 앉는다(등받이는 −z 쪽). */
  function chairParts(mb, x, z, ry, kind = "task", color) {
    const dark = kind === "meet" ? C.grayDark : kind === "exec" ? 0x121317 : C.chairBlack;
    const cush = color ?? (kind === "meet" ? C.gray : kind === "exec" ? C.leather : C.cushion);
    const P = (lx, ly, lz) => { const [rx, rz] = rot(lx, lz, ry); return [x + rx, ly, z + rz]; };
    const B = (w, h, d, col, lx, ly, lz, o = {}) => mb.box(w, h, d, col, ...P(lx, ly, lz), { ...o, ry: ry + (o.ry || 0) });
    if (kind === "guest" || kind === "pantry") {
      const leg = kind === "pantry" ? C.wood : 0x3a3e48, seat = kind === "pantry" ? C.wood : cush;
      for (const [lx, lz] of [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]]) B(.04, .45, .04, leg, lx, .225, lz);
      B(.48, .05, .48, seat, 0, .47, 0);
      B(.46, .45, .05, seat, 0, .74, -.22, { rx: -.08 });
      return;
    }
    for (let i = 0; i < 5; i++) {
      const a = ry + i * Math.PI * 2 / 5, [ox, oz] = [Math.sin(a) * .22, Math.cos(a) * .22];
      mb.box(.06, .035, .46, dark, x + ox, .07, z + oz, { ry: a });
      mb.sphere(.035, dark, x + Math.sin(a) * .44, .035, z + Math.cos(a) * .44, null, 6);
    }
    mb.cyl(.03, .03, .34, dark, x, .28, z, 8); mb.cyl(.055, .055, .05, dark, x, .11, z, 10);
    B(.3, .04, .3, dark, 0, .43, 0);
    B(.52, .09, .5, cush, 0, .49, 0);
    if (kind === "exec") { B(.52, .95, .09, cush, 0, 1.0, -.26, { rx: -.1 }); B(.3, .16, .08, cush, 0, 1.52, -.33, { rx: -.1 }); }
    else B(.48, .55, .07, cush, 0, .84, -.25, { rx: -.1 });
    for (const sx of [-.28, .28]) { B(.06, .03, .3, dark, sx, .7, -.02); B(.03, .18, .04, dark, sx, .6, .02); }
  }
  function officeChair(group, x, z, ry, color, kind = "task") {
    const mb = new MB(); chairParts(mb, x, z, ry, kind, color); return mb.mesh(group);
  }
  /** 화분: monstera(큰 잎 여러 장)·fiddle(키 큰 줄기 + 타원 잎)·bush(둥근 덤불)·small(책상·선반용). */
  function plantParts(mb, x, z, s = 1, kind = "monstera", potColor, y0 = 0) {
    const g = C.green, N = small ? .6 : 1;
    if (kind === "small") {
      mb.cyl(.09 * s, .07 * s, .12 * s, potColor ?? C.pot, x, y0 + .06 * s, z, 10);
      for (let i = 0; i < 4; i++) { const a = i * 1.6 + rnd(); mb.leaf(.07 * s, g[i % g.length], x + Math.cos(a) * .05 * s, y0 + (.16 + i * .03) * s, z + Math.sin(a) * .05 * s, { sy: .5, sx: 1.3 }); }
      return;
    }
    mb.cyl(.3 * s, .22 * s, .5 * s, potColor ?? (kind === "fiddle" ? C.terra : C.pot), x, y0 + .25 * s, z, 14);
    mb.cyl(.27 * s, .27 * s, .03 * s, C.soil, x, y0 + .5 * s, z, 12);
    if (kind === "bush") { mb.leaf(.5 * s, g[1], x, y0 + .95 * s, z, { sy: .85 }); mb.leaf(.3 * s, g[2], x + .25 * s, y0 + 1.1 * s, z, {}); return; }
    if (kind === "fiddle") {
      mb.cyl(.03 * s, .04 * s, 1.5 * s, 0x6b4a2b, x, y0 + 1.2 * s, z, 6);
      const n = Math.round(9 * N);
      for (let i = 0; i < n; i++) { const a = i * 2.4, h = (.75 + i * .14) * s, r = (.28 - i * .012) * s; mb.leaf(.2 * s, g[(i + 1) % 3], x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r, { ry: -a, sx: 1.4, sy: .35, sz: .9, rz: .3 }); }
      return;
    }
    const n = Math.round(6 * N);
    for (let i = 0; i < n; i++) {
      const a = i * 1.05 + .3, r = (.25 + (i % 2) * .15) * s, h = (.9 + (i % 3) * .2) * s;
      mb.cyl(.015 * s, .02 * s, h - .4 * s, 0x4e8a4a, x + Math.cos(a) * r * .5, y0 + .5 * s + (h - .4 * s) / 2, z + Math.sin(a) * r * .5, 5, { rz: -Math.cos(a) * .4, rx: Math.sin(a) * .4 });
      mb.leaf(.3 * s, g[i % g.length], x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r, { ry: -a, sx: 1.2, sy: .22, sz: .9, rz: .15 });
    }
  }
  function plant(group, x, z, s = 1, kind = "monstera") { const mb = new MB(); plantParts(mb, x, z, s, kind); return mb.mesh(group); }
  function sofaParts(mb, x, z, ry, w, color, seats = 2) {
    const P = (lx, ly, lz) => { const [rx, rz] = rot(lx, lz, ry); return [x + rx, ly, z + rz]; };
    const B = (bw, h, d, col, lx, ly, lz, o = {}) => mb.box(bw, h, d, col, ...P(lx, ly, lz), { ...o, ry });
    const dark = new T.Color(color).multiplyScalar(.8).getHex();
    B(w, .32, .85, dark, 0, .18, 0);
    for (let i = 0; i < seats; i++) B(w / seats - .08, .14, .7, color, -w / 2 + (i + .5) * w / seats, .4, .05);
    B(w, .5, .2, color, 0, .55, -.33);
    for (const sx of [-1, 1]) B(.14, .55, .85, dark, sx * (w / 2 - .07), .3, 0);
    for (const [lx, lz] of [[-w / 2 + .1, -.3], [w / 2 - .1, -.3], [-w / 2 + .1, .3], [w / 2 - .1, .3]]) B(.05, .06, .05, 0x222, lx, .03, lz);
  }
  /** 모니터(베젤·목·받침). y 는 책상 윗면 높이, 화면 중심은 y + .665·s. */
  function monitor(mb, x, y, z, ry, s = 1) {
    const P = (lx, ly, lz) => { const [rx, rz] = rot(lx * s, lz * s, ry); return [x + rx, y + ly * s, z + rz]; };
    mb.box(1.34 * s, .84 * s, .05 * s, 0x23262f, ...P(0, .665, 0), { ry });
    mb.box(.08 * s, .27 * s, .06 * s, 0x2b2f38, ...P(0, .14, -.03), { ry });
    mb.box(.38 * s, .02 * s, .22 * s, 0x2b2f38, ...P(0, .01, -.02), { ry });
  }
  function lampParts(mb, x, z, kind = "desk", baseY = 0) {
    if (kind === "floor") { mb.cyl(.2, .22, .03, C.alu, x, baseY + .015, z, 16); mb.cyl(.02, .02, 1.55, C.alu, x, baseY + .8, z, 8); return { x, y: baseY + 1.7, z, r: .24 }; }
    if (kind === "pendant") { mb.cyl(.008, .008, 1.3, 0x222, x, baseY - .65, z, 5); return { x, y: baseY - 1.3, z, r: .26 }; }
    mb.cyl(.09, .1, .025, C.alu, x, baseY + .012, z, 12);
    mb.cyl(.012, .012, .42, C.alu, x + .05, baseY + .2, z - .05, 6, { rz: -.35, rx: .35 });
    mb.cyl(.012, .012, .3, C.alu, x + .18, baseY + .42, z - .16, 6, { rz: .9, rx: -.1 });
    return { x: x + .3, y: baseY + .4, z: z - .17, r: .07 };
  }

  /* ───────── 장면 구성 ───────── */
  const themed = { mats: {}, lights: [], dyn: [], dark: false, chips: [], doors: [], skyline: null, skyTex: {}, glass: null, bulbs: null, shades: null, camera: null };
  const TH = {
    light: { floor: 0xf1efea, slab: 0xd5d8e0, wall: 0xffffff, trim: 0xd9dee8, carpet: 0xdde4f3, execCarpet: 0xd9d2c8, rug: 0xe3dccf, glass: 0xdbeafe, glassOp: .18, bulb: 0, light: 0, sky: "day" },
    // 다크: '따뜻한 램프 빛이 도는 네이비 사무실' — 바닥·벽을 너무 어둡지 않게, 램프(점광원·전구 발광)는 더 세게
    dark: { floor: 0x1c2546, slab: 0x0b1020, wall: 0x242f55, trim: 0x111733, carpet: 0x1c2748, execCarpet: 0x1f1b2e, rug: 0x272239, glass: 0x8fb3ff, glassOp: .1, bulb: 1.6, light: 2.0, sky: "night" },
  };
  /** 도시 스카이라인(낮/밤) 캔버스. 뒷벽 창 밖에 둔다. */
  function skylineTex(night) {
    const cv = canvas(2048, 256), c = cv.getContext("2d"), W = cv.width, H = cv.height;
    const sky = c.createLinearGradient(0, 0, 0, H);
    if (night) { sky.addColorStop(0, "#0a1030"); sky.addColorStop(1, "#243056"); } else { sky.addColorStop(0, "#bfe0ff"); sky.addColorStop(1, "#eaf4ff"); }
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    if (night) { c.fillStyle = "rgba(255,255,255,.7)"; for (let i = 0; i < 90; i++) c.fillRect(rnd() * W, rnd() * H * .5, 1.5, 1.5); }
    else { c.fillStyle = "rgba(255,255,255,.8)"; for (let i = 0; i < 7; i++) { const x = rnd() * W, y = 20 + rnd() * 60; c.beginPath(); c.ellipse(x, y, 60 + rnd() * 60, 14, 0, 0, 7); c.fill(); } }
    let s = 7;
    const r = () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646;
    for (const [layer, col, hmin, hmax] of [[0, night ? "#182246" : "#c9d8ec", 60, 130], [1, night ? "#101a3a" : "#aebfd9", 90, 200]]) {
      for (let x = -20; x < W; ) {
        const w = 30 + r() * 70, h = hmin + r() * (hmax - hmin);
        c.fillStyle = col; c.fillRect(x, H - h, w, h);
        if (r() > .6) c.fillRect(x + w * .3, H - h - 18, w * .4, 18);
        const cols = Math.max(1, Math.floor(w / 9)), rows = Math.floor(h / 11);
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          const lit = r() < (night ? .45 : .15);
          c.fillStyle = night ? (lit ? (r() < .5 ? "#ffd98a" : "#9fd1ff") : "rgba(255,255,255,.04)") : (lit ? "rgba(255,255,255,.65)" : "rgba(40,60,100,.12)");
          c.fillRect(x + 3 + i * 9, H - h + 4 + j * 11, 5, 6);
        }
        x += w + 3 + r() * 10;
      }
    }
    return texture(cv);
  }
  function tileTex() {
    const cv = canvas(512, 512), c = cv.getContext("2d");
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, 512, 512);
    c.strokeStyle = "rgba(90,100,130,.16)"; c.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, 512); c.moveTo(0, i * 128); c.lineTo(512, i * 128); c.stroke(); }
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(OW / 4, OD / 4); t.anisotropy = 8; return t;
  }
  function chartBoard(c, w, h) { // 화이트보드: 차트·포스트잇
    c.fillStyle = "#fbfbfd"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#2b3245"; c.font = `700 ${h * .09}px ${FONT}`; c.textAlign = "left"; c.fillText("Q4 로드맵", w * .05, h * .15);
    const bars = [.5, .8, .35, .9, .6, .7], cols = ["#4f7cf7", "#10a37f", "#d97757", "#4f7cf7", "#e8a317", "#8e6cd1"];
    bars.forEach((b, i) => { c.fillStyle = cols[i]; c.fillRect(w * (.06 + i * .07), h * .8 - h * .5 * b, w * .045, h * .5 * b); });
    c.strokeStyle = "#d97757"; c.lineWidth = 4; c.beginPath();
    for (let i = 0; i <= 10; i++) { const x = w * (.52 + i * .04), y = h * (.6 - .25 * Math.sin(i * .9) - i * .02); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    [["#fff3a3", .52, .68], ["#c9f2d9", .66, .7], ["#ffd6e0", .8, .66]].forEach(([f, x, y]) => { c.fillStyle = f; c.fillRect(w * x, h * y, w * .11, h * .17); });
    c.strokeStyle = "#9aa1b2"; c.lineWidth = 3; c.beginPath(); c.moveTo(w * .06, h * .8); c.lineTo(w * .48, h * .8); c.stroke();
  }
  function tvChart(c, w, h) { // 회의실 TV: 막대 그래프 대시보드
    c.fillStyle = "#121726"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#1c2338"; c.fillRect(0, 0, w, h * .12);
    c.fillStyle = "#e9edf7"; c.font = `600 ${h * .07}px ${FONT}`; c.textAlign = "left"; c.fillText("프로젝트 진행 현황", w * .03, h * .085);
    const v = [.55, .8, .45, .95, .65, .75, .5, .85], cols = ["#4f7cf7", "#10a37f", "#d97757", "#ffd166"];
    v.forEach((b, i) => { c.fillStyle = cols[i % 4]; c.fillRect(w * (.07 + i * .11), h * .88 - h * .62 * b, w * .07, h * .62 * b); });
    c.strokeStyle = "rgba(255,255,255,.15)"; c.lineWidth = 2;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(w * .05, h * (.3 + i * .2)); c.lineTo(w * .95, h * (.3 + i * .2)); c.stroke(); }
  }
  function abstractArt(c, w, h) {
    c.fillStyle = "#f6f1e7"; c.fillRect(0, 0, w, h);
    [["#f2c744", .3, .45, .22], ["#e8743b", .58, .4, .17], ["#4f7cf7", .72, .66, .14], ["#2b3245", .4, .7, .06]].forEach(([f, x, y, r]) => { c.fillStyle = f; c.beginPath(); c.arc(w * x, h * y, h * r, 0, 7); c.fill(); });
  }
  function lobbySign(c, w, h) {
    c.fillStyle = "#1e2538"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#4f7cf7"; c.fillRect(w * .05, h * .25, h * .5, h * .5);
    c.fillStyle = "#ffffff"; c.font = `700 ${h * .42}px ${FONT}`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("Agent Office", w * .05 + h * .65, h * .52);
  }

  /** 장면 전체를 만든다. helpers: {box, cyl, mat, small, agents()}. 돌려주는 값: { strokes } */
  function build(sc, helpers = {}) {
    scene = sc; small = !!helpers.small; agentsFn = helpers.agents || agentsFn;
    const st = new MB();                       // 고정 가구 전부(정점 색, 메시 1개)
    const frames = new MB();                   // 어두운 알루미늄 프레임(멀리언·칸막이)
    const glassGeo = new MB(), bandGeo = new MB(), shadeGeo = new MB(), bulbGeo = new MB();
    const M = themed.mats;
    M.floor = new T.MeshStandardMaterial({ color: TH.light.floor, roughness: .9, map: tileTex() });
    M.slab = new T.MeshStandardMaterial({ color: TH.light.slab, roughness: .9 });
    M.wall = new T.MeshStandardMaterial({ color: TH.light.wall, roughness: .95 });
    M.trim = new T.MeshStandardMaterial({ color: TH.light.trim, roughness: .9 });
    M.carpet = new T.MeshStandardMaterial({ color: TH.light.carpet, roughness: 1 });
    M.execCarpet = new T.MeshStandardMaterial({ color: TH.light.execCarpet, roughness: 1 });
    M.rug = new T.MeshStandardMaterial({ color: TH.light.rug, roughness: 1 });
    M.glass = new T.MeshStandardMaterial({ color: TH.light.glass, transparent: true, opacity: TH.light.glassOp, roughness: .05, metalness: .1, depthWrite: false });
    M.band = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .3, depthWrite: false });
    M.bulb = new T.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc98a, emissiveIntensity: 0, roughness: .4 });
    M.shade = new T.MeshStandardMaterial({ color: 0xf1e8d8, emissive: 0xffb466, emissiveIntensity: 0, roughness: .9, side: T.DoubleSide });

    // 바닥(타일) + 슬래브 + 방별 카펫
    const floor = new T.Mesh(new T.PlaneGeometry(OW, OD), M.floor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const slab = new T.Mesh(new T.BoxGeometry(OW + .2, .3, OD + .2), M.slab); slab.position.y = -.16; scene.add(slab);
    const carpet = (mat, x0, x1, z0, z1) => { const m = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, .012, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); };
    carpet(M.carpet, 5.1, X1, -3.4, 4.4);               // 회의실
    carpet(M.execCarpet, 5.1, X1, Z0 + .1, -3.6);       // 대표님실
    carpet(M.rug, 10.6, 14.6, 6.6, 10.8);               // 라운지 러그
    carpet(M.rug, -15.6, -12, 4.2, 10.6);               // 현관 러그
    floor.onBeforeRender = (r, s, cam) => { themed.camera = cam; tick(); }; // 매 프레임: 문·방 이름표

    // 뒷벽: 바닥부터 천장까지 유리창 + 멀리언 + 바깥 스카이라인
    themed.skyTex.day = skylineTex(false);
    const sky = themed.skyline = new T.Mesh(new T.PlaneGeometry(OW + 2, WALL_H + .4), new T.MeshBasicMaterial({ map: themed.skyTex.day }));
    sky.position.set(0, WALL_H / 2, Z0 - .45); scene.add(sky);
    glassGeo.box(OW, WALL_H, .04, 0xffffff, 0, WALL_H / 2, Z0 - .05);
    for (let x = X0; x <= X1 + .01; x += 2) frames.box(.12, WALL_H, .14, C.frame, x, WALL_H / 2, Z0 - .05);
    for (const y of [.06, 2.9, WALL_H - .05]) frames.box(OW + .12, .1, .14, C.frame, 0, y, Z0 - .05);
    st.box(OW + .3, .14, .3, C.frame, 0, .07, Z0 - .05);                                      // 걸레받이
    // 왼쪽 벽(현관 양문 자리를 비운다) — 테마 색
    const wallGeo = new MB();
    const dz = LOBBY_DOOR.w / 2 + .1;
    wallGeo.box(.3, WALL_H, (LOBBY_DOOR.z - dz) - Z0, 0xffffff, X0 - .15, WALL_H / 2, (Z0 + LOBBY_DOOR.z - dz) / 2);
    wallGeo.box(.3, WALL_H, Z1 - (LOBBY_DOOR.z + dz), 0xffffff, X0 - .15, WALL_H / 2, (LOBBY_DOOR.z + dz + Z1) / 2);
    wallGeo.box(.3, WALL_H - 2.45, dz * 2, 0xffffff, X0 - .15, (WALL_H + 2.45) / 2, LOBBY_DOOR.z);
    wallGeo.mesh(scene, M.wall);
    const trimGeo = new MB();
    trimGeo.box(.34, .14, (LOBBY_DOOR.z - dz) - Z0, 0xffffff, X0 - .13, .07, (Z0 + LOBBY_DOOR.z - dz) / 2);
    trimGeo.box(.34, .14, Z1 - (LOBBY_DOOR.z + dz), 0xffffff, X0 - .13, .07, (LOBBY_DOOR.z + dz + Z1) / 2);
    trimGeo.mesh(scene, M.trim);
    // 현관 유리 양문(왼쪽 외벽): 검은 프레임 + 미닫이 유리 2장
    frames.box(.16, 2.45, .1, C.frame, X0 - .15, 1.225, LOBBY_DOOR.z - dz + .05);
    frames.box(.16, 2.45, .1, C.frame, X0 - .15, 1.225, LOBBY_DOOR.z + dz - .05);
    frames.box(.16, .1, dz * 2, C.frame, X0 - .15, 2.4, LOBBY_DOOR.z);
    for (const side of [-1, 1]) {
      const leaf = doorLeaf(.98, 2.3, X0 - .12, LOBBY_DOOR.z + side * .5, "z");
      themed.doors.push({ g: leaf, axis: "z", dir: side, open: 0, px: X0 - .12, pz: LOBBY_DOOR.z + side * .5, hx: X0 + .6, hz: LOBBY_DOOR.z, slide: .95 });
    }

    // 유리 칸막이: 유리(투명)·프레임(기둥·상단·걸레받이)·눈높이 띠·문(미닫이)
    for (const w of wallDefs) {
      if (w.outer) continue;
      const segs = w.gap ? [[w.a, w.gap[0]], [w.gap[1], w.b]] : [[w.a, w.b]];
      const alongX = w.axis === "x";
      const put = (mb, len, mid, wd, h, y, col) => alongX ? mb.box(len, h, wd, col, mid, y, w.at) : mb.box(wd, h, len, col, w.at, y, mid);
      for (const [a, b] of segs) {
        if (b - a < .05) continue;
        const mid = (a + b) / 2, len = b - a;
        if (w.solid) { // 유리 대신 흰 패널(TV 벽)
          const [s0, s1] = w.solid;
          for (const [p, q] of [[a, s0], [s1, b]]) if (q - p > .05) put(glassGeo, q - p, (p + q) / 2, .04, PART_H, PART_H / 2, 0xffffff);
          put(st, s1 - s0, (s0 + s1) / 2, .12, PART_H, PART_H / 2, C.white);
          for (const p of [s0, s1]) put(frames, .08, p, .1, PART_H, PART_H / 2, C.alu);
        } else put(glassGeo, len, mid, .04, PART_H, PART_H / 2, 0xffffff);
        put(frames, len, mid, .08, .08, PART_H + .04, C.alu);
        put(frames, len, mid, .08, .1, .05, C.alu);
        put(bandGeo, len, mid, .05, .12, 1.1, 0xffffff);
        const np = Math.max(1, Math.ceil(len / 3.2));
        for (let i = 0; i <= np; i++) put(frames, .08, a + len * i / np, .08, PART_H, PART_H / 2, C.alu);
      }
      if (w.gap) { // 문: 상인방 + 미닫이 유리문 1장(사람이 가까이 오면 긴 벽 쪽으로 밀린다)
        const [g0, g1] = w.gap, gc = (g0 + g1) / 2;
        put(frames, g1 - g0 + .16, gc, .1, .08, PART_H + .04, C.alu);
        put(frames, g1 - g0 + .16, gc, .1, .12, PART_H - .08, C.alu);
        const px = alongX ? gc : w.at + .06, pz = alongX ? w.at + .06 : gc;
        const leaf = doorLeaf(g1 - g0 - .04, PART_H - .18, px, pz, alongX ? "x" : "z");
        themed.doors.push({ g: leaf, axis: alongX ? "x" : "z", dir: (g0 - w.a > w.b - g1) ? -1 : 1, open: 0, px, pz, hx: alongX ? gc : w.at, hz: alongX ? w.at : gc, slide: g1 - g0 - .1 });
      }
    }
    function doorLeaf(w, h, x, z, axis) {
      const g = new T.Group(); g.position.set(x, h / 2 + .08, z); scene.add(g);
      const alongX = axis === "x";
      const pane = new T.Mesh(new T.BoxGeometry(alongX ? w : .03, h, alongX ? .03 : w), M.glass); pane.renderOrder = 2; g.add(pane);
      const fb = new MB();
      for (const s of [-1, 1]) fb.box(alongX ? .05 : .06, h, alongX ? .06 : .05, C.frame, alongX ? s * (w / 2 - .025) : 0, 0, alongX ? 0 : s * (w / 2 - .025));
      for (const s of [-1, 1]) fb.box(alongX ? w : .06, .05, alongX ? .06 : w, C.frame, 0, s * (h / 2 - .025), 0);
      fb.cyl(.015, .015, .5, C.frame, alongX ? w / 2 - .14 : .05, 0, alongX ? .05 : w / 2 - .14, 6); // 손잡이
      fb.mesh(g, null, false);
      g.userData.w = w;
      return g;
    }

    // ── 현관: 소파·둥근 탁자·키오스크·화분·간판·그림
    sofaParts(st, -15.1, 4.9, Math.PI / 2, 1.6, C.sofaBlue, 2);
    st.cyl(.34, .34, .04, C.wood, -13.5, .4, 4.9, 20); st.cyl(.03, .03, .4, C.alu, -13.5, .2, 4.9, 8); st.cyl(.18, .18, .03, C.alu, -13.5, .015, 4.9, 12);
    st.box(.36, .06, .36, C.alu, -13.8, .03, 9.3); st.box(.06, 1.1, .06, C.alu, -13.8, .58, 9.3);
    st.box(.34, .46, .04, 0x1f2430, -13.8, 1.35, 9.3, { rx: -.35, ry: Math.PI / 4 });
    plantParts(st, -15.3, 6.1, 1.05, "fiddle"); plantParts(st, -15.3, 8.9, 1, "monstera");
    sign(scene, 2.2, .55, 512, lobbySign, X0 + .02, 2.55, 4.9, { ry: Math.PI / 2 });
    // 추상화 + 액자: 액자 상자(두께 .04)는 그림 평면(x=X0+.03) 뒤(앞면 X0+.015)에 두어야 그림이 묻히지 않는다
    sign(scene, 1, .8, 256, abstractArt, X0 + .03, 2.2, 9.9, { ry: Math.PI / 2 });
    st.box(.04, .9, 1.1, C.woodDark, X0 - .005, 2.2, 9.9);

    // ── 탕비실: 카운터·커피 머신·주전자·전자레인지·냉장고·선반(머그·화분)·타원 테이블 + 의자 4·정수기
    st.box(.62, .88, 4.15, C.white, -15.65, .44, -8.68); st.box(.72, .05, 4.25, 0xcfd3db, -15.62, .905, -8.68);
    for (let i = 0; i < 4; i++) st.box(.02, .7, .02, 0x9aa1b2, -15.36, .45, -10.5 + i * 1.2);
    st.box(.42, .5, .38, 0x2a2d35, -15.6, 1.18, -8.6); st.box(.12, .08, .3, C.steel, -15.52, .97, -8.6); st.box(.3, .06, .3, C.steel, -15.6, 1.46, -8.6);
    st.cyl(.09, .11, .22, C.steel, -15.6, 1.04, -9.6, 12); st.cyl(.02, .02, .14, 0x222, -15.6, 1.22, -9.6, 5);
    st.box(.5, .32, .38, 0xd8dbe2, -15.6, 1.09, -7.3); st.box(.32, .22, .02, 0x1b1e26, -15.4, 1.09, -7.3);
    st.box(.8, 1.9, .78, C.steel, -15.55, .95, -5.9); st.box(.02, .7, .03, 0x333, -15.14, 1.3, -5.6); st.box(.02, .4, .03, 0x333, -15.14, .5, -5.6);
    for (const y of [1.85, 2.35]) { st.box(.26, .03, 3.6, C.wood, -15.86, y, -8.7); st.box(.04, .06, 3.6, 0xdfe2e8, -15.98, y + .04, -8.7); }
    for (let i = 0; i < 7; i++) st.cyl(.06, .055, .1, [0xffffff, 0xd97757, 0x4f7cf7, 0x10a37f, 0xffffff, 0xe8a317, 0xffffff][i], -15.86, 1.92, -10.3 + i * .48, 10);
    plantParts(st, -15.86, -7.1, 1, "small", null, 2.365); plantParts(st, -15.86, -9.9, .9, "small", C.terra, 2.365); plantParts(st, -15.86, -8.4, .8, "small", null, 2.365);
    st.add(new T.CylinderGeometry(.5, .5, .06, 32), C.wood, PANTRY_TABLE.x, .76, PANTRY_TABLE.z, { sx: PANTRY_TABLE.w, sz: PANTRY_TABLE.d });
    st.cyl(.08, .22, .73, C.alu, PANTRY_TABLE.x, .365, PANTRY_TABLE.z, 14);
    chairParts(st, -12.95, -7.6, Math.PI / 2, "pantry"); chairParts(st, -10.25, -7.6, -Math.PI / 2, "pantry");
    chairParts(st, -11.6, -8.8, 0, "pantry"); chairParts(st, -11.6, -6.4, Math.PI, "pantry");
    st.box(.38, 1, .38, C.white, -9.05, .5, -10.5); st.box(.3, .15, .3, 0x2a2d35, -9.05, 1.07, -10.5);
    st.add(new T.CylinderGeometry(.14, .14, .4, 12), 0x8fc8f0, -9.05, 1.35, -10.5, {}); st.box(.03, .04, .03, 0x3b7bd1, -8.85, .78, -10.5);
    shadeGeo.cyl(.06, .3, .22, 0xffffff, PANTRY_TABLE.x, 2.45, PANTRY_TABLE.z, 14); lampParts(st, PANTRY_TABLE.x, PANTRY_TABLE.z, "pendant", 3.85); bulbGeo.sphere(.06, 0xffffff, PANTRY_TABLE.x, 2.4, PANTRY_TABLE.z);

    // ── 업무 공간: 왼쪽 벽 화이트보드·화분·펜던트
    sign(scene, 3.2, 1.6, 512, chartBoard, X0 + .06, 1.95, 0, { ry: Math.PI / 2 });
    frames.box(.06, 1.7, 3.3, C.alu, X0 + .03, 1.95, 0); st.box(.1, .04, 1.2, C.alu, X0 + .08, 1.12, 0);
    plantParts(st, -8, 10.3, 1.15, "monstera"); plantParts(st, 4.4, -10.4, 1.2, "fiddle"); plantParts(st, -7.9, -10.4, 1, "bush"); plantParts(st, 4.4, 10.3, 1, "fiddle");
    for (const z of [-4.5, 1.5]) { shadeGeo.cyl(.05, .32, .2, 0x2b3245, ROW_CX, 2.95, z, 16); lampParts(st, ROW_CX, z, "pendant", 4.3); bulbGeo.sphere(.06, 0xffffff, ROW_CX, 2.9, z); }

    // ── 대표님실: 손님 의자 2·소파·낮은 탁자·책장·화분·플로어 램프·문패
    chairParts(st, 10.2, -9.9, 0, "guest"); chairParts(st, 11.8, -9.9, 0, "guest");
    sofaParts(st, 6.1, -9.6, Math.PI / 2, 1.7, C.leather, 2);
    st.box(.9, .05, .5, C.woodDark, 7.5, .42, -9.6); for (const [lx, lz] of [[-.4, -.2], [.4, -.2], [-.4, .2], [.4, .2]]) st.box(.04, .4, .04, C.alu, 7.5 + lx, .2, -9.6 + lz);
    st.box(2, 2.2, .04, C.woodDark, 14.2, 1.1, -10.78); st.box(2, .04, .4, C.woodDark, 14.2, 2.18, -10.6);
    for (const sx of [-1, 1]) st.box(.04, 2.2, .4, C.woodDark, 14.2 + sx * .98, 1.1, -10.6);
    for (let s = 0; s < 3; s++) {
      st.box(1.92, .03, .38, C.woodDark, 14.2, .3 + s * .62, -10.6);
      for (let i = 0; i < 7; i++) { const h = .4 + (i % 3) * .05; st.box(.16, h, .26, C.book[(s * 3 + i) % C.book.length], 13.42 + i * .24, .315 + s * .62 + h / 2, -10.6); }
    }
    plantParts(st, 15.4, -4.1, 1.1, "monstera"); plantParts(st, 8.4, -10.5, .9, "fiddle");
    { const b = lampParts(st, 15.3, -6.6, "floor"); shadeGeo.cyl(.2, .26, .34, 0xffffff, b.x, b.y, b.z, 16); bulbGeo.sphere(.05, 0xffffff, b.x, b.y, b.z); addLight(b.x, b.y, b.z); }
    sign(scene, .9, .26, 256, plate("👑 대표님실", "#1e2538", "#ffffff", 30), 5.08, 1.75, -6.1, { ry: Math.PI / 2 });
    sign(scene, 1.4, .36, 256, plate("대표님실", "#2b3245"), 5.07, PART_H + .32, rooms.exec.door.z, { ry: Math.PI / 2 });

    // ── 회의실: 긴 테이블·의자 9(MEET_SEATS)·노트북·TV(막대 그래프)·화분·펜던트 2·표지판
    st.box(TABLE.w, .07, TABLE.d, C.white, TABLE.x, .78, TABLE.z);
    for (const sx of [-1, 1]) st.box(.08, .76, TABLE.d - .4, 0xcfd3db, TABLE.x + sx * (TABLE.w / 2 - .3), .38, TABLE.z);
    MEET_SEATS.forEach(m => chairParts(st, m.x, m.z, Math.atan2(TABLE.x - m.x, TABLE.z - m.z), "meet"));
    st.box(.42, .02, .3, C.steel, TABLE.x - .6, .83, TABLE.z + .1); st.box(.42, .28, .015, C.steel, TABLE.x - .6, .97, TABLE.z - .05, { rx: -.3 });
    st.box(.4, .26, .005, 0x1b2030, TABLE.x - .6, .97, TABLE.z - .04, { rx: -.3 });
    st.box(.08, TV.h + .12, TV.w + .12, C.frame, TV.x + .1, TV.y, TV.z);
    sign(scene, TV.w, TV.h, 512, tvChart, TV.x + .145, TV.y, TV.z, { ry: Math.PI / 2 });
    plantParts(st, 15.4, -2.9, 1, "fiddle"); plantParts(st, 15.4, 3.9, 1, "monstera");
    for (const x of [TABLE.x - 1, TABLE.x + 1]) { shadeGeo.cyl(.05, .3, .2, 0x2b3245, x, 2.7, TABLE.z, 16); lampParts(st, x, TABLE.z, "pendant", 3.95); bulbGeo.sphere(.06, 0xffffff, x, 2.66, TABLE.z); }
    addLight(TABLE.x, 2.5, TABLE.z);
    sign(scene, 1.4, .36, 256, plate("회의실", "#2b3245"), 5.07, PART_H + .32, rooms.meeting.door.z, { ry: Math.PI / 2 });
    sign(scene, 1.4, .36, 256, plate("탕비실", "#2b3245"), rooms.pantry.door.x, PART_H + .32, -4 + .07);
    sign(scene, 1.2, .36, 256, plate("현관", "#2b3245"), -9.5 + .07, PART_H + .32, rooms.lobby.door.z, { ry: Math.PI / 2 });

    // ── 라운지: 소파·탁자·안락의자·사이드 테이블·플로어 램프·프린터·화분
    sofaParts(st, 12.5, 8.6, 0, 2.2, C.sofaGray, 3);
    st.box(1, .05, .5, C.wood, 12.5, .42, 10.1); for (const [lx, lz] of [[-.45, -.2], [.45, -.2], [-.45, .2], [.45, .2]]) st.box(.04, .4, .04, C.alu, 12.5 + lx, .2, 10.1 + lz);
    sofaParts(st, 9.6, 9.3, Math.PI / 2, .8, C.sofaBlue, 1);
    st.cyl(.3, .3, .04, C.wood, 14.4, .5, 8.6, 16); st.cyl(.03, .03, .5, C.alu, 14.4, .25, 8.6, 8);
    { const b = lampParts(st, 14.9, 9.7, "floor"); shadeGeo.cyl(.2, .26, .34, 0xffffff, b.x, b.y, b.z, 16); bulbGeo.sphere(.05, 0xffffff, b.x, b.y, b.z); }
    st.box(1.1, .75, .6, C.white, 6.3, .375, 10); st.box(.62, .3, .5, 0xdadde5, 6.3, .9, 10); st.box(.5, .04, .3, 0x30343c, 6.3, 1.07, 10);
    plantParts(st, 15.4, 5.2, 1.05, "monstera"); plantParts(st, 6, 5.3, .85, "bush");

    // 메시로 내보내기
    st.mesh(scene);
    frames.mesh(scene, new T.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .4 }));
    themed.glass = glassGeo.mesh(scene, M.glass, false); if (themed.glass) themed.glass.renderOrder = 2;
    const band = bandGeo.mesh(scene, M.band, false); if (band) band.renderOrder = 3;
    themed.shades = shadeGeo.mesh(scene, M.shade, false);
    themed.bulbs = bulbGeo.mesh(scene, M.bulb, false);

    // 계획 필기 줄(TV 위에 겹쳐 보인다): app.js 가 보이기/색을 관리한다
    const strokes = [0, 1, 2, 3, 4].map(i => {
      const len = (.9 + ((i * 37) % 50) / 100) * TV.w * .5;
      const l = helpers.box ? helpers.box(.012, .06, .01, 0x6b7489, TV.x + .17, TV.y + TV.h * .32 - i * .2, TV.z - TV.w / 2 + .25 + len / 2)
        : (() => { const m = new T.Mesh(new T.BoxGeometry(.012, .06, .01), new T.MeshStandardMaterial({ color: 0x6b7489 })); m.position.set(TV.x + .17, TV.y + TV.h * .32 - i * .2, TV.z - TV.w / 2 + .25 + len / 2); scene.add(m); return m; })();
      l.scale.z = len / .01; l.castShadow = false; l.visible = false; return l;
    });
    // 방 이름표(HTML)
    makeChips();
    document.fonts?.ready.then(() => redraws.forEach(f => f()));
    return { strokes };
  }
  function addLight(x, y, z) {
    if (themed.lights.length >= 4) return null;
    const l = new T.PointLight(0xffb86b, 0, 11, 2); l.position.set(x, y, z); scene.add(l); themed.lights.push(l); return l;
  }
  /** 책상 세트(팀원·대표). group 에 넣고 { screen, mug, bulb, mesh, dispose } 를 돌려준다(두 화면 재질은 mats[0..1]).
      dispose() 는 팀을 다시 만들 때 group 에서 메시를 떼기 전에 부른다: 명패 캔버스를 redraws 에서, 책상 램프 점광원을 themed.dyn 에서 뺀다(누수 방지). */
  function deskSet(group, { x, z, w = DESK_W, mats, exec = false, color = 0x4f7cf7, label = "", lamp = true, light = false, cols = 1, col = 0 }) {
    const mb = new MB(), top = exec ? C.woodDark : C.wood, topY = exec ? .82 : .815;
    const owned = { signs: [], lights: [] };
    if (exec) {
      mb.box(w, .08, 1.2, top, x, .78, z);
      for (const sx of [-1, 1]) mb.box(.06, .76, 1.05, top, x + sx * (w / 2 - .1), .38, z - .05);
      mb.box(w - .3, .55, .05, top, x, .5, z - .5);
      mb.box(.9, .62, .9, top, x - w / 2 + .55, .4, z + .05); mb.box(.3, .02, .03, C.alu, x - w / 2 + .55, .55, z + .5); mb.box(.3, .02, .03, C.alu, x - w / 2 + .55, .3, z + .5);
    } else {
      mb.box(w, .07, 1.2, top, x, .78, z);
      for (const sx of [-1, 1]) { mb.box(.05, .74, .05, C.white, x + sx * (w / 2 - .08), .37, z - .5); mb.box(.05, .74, .05, C.white, x + sx * (w / 2 - .08), .37, z + .5); mb.box(.05, .04, 1.05, C.white, x + sx * (w / 2 - .08), .72, z); }
      mb.box(.44, .58, .55, C.white, x + w / 2 - .32, .3, z + .15); mb.box(.2, .02, .02, C.alu, x + w / 2 - .32, .45, z + .43); mb.box(.2, .02, .02, C.alu, x + w / 2 - .32, .2, z + .43);
      mb.box(w + .2, 1.3, .05, C.panel, x, .65, z - .68); mb.box(w + .2, .04, .08, C.alu, x, 1.32, z - .68);
      if (col < cols - 1) { mb.box(.05, 1.25, 1.4, C.panel, x + PITCH / 2, .625, z - .05); mb.box(.08, .04, 1.4, C.alu, x + PITCH / 2, 1.27, z - .05); }
    }
    const s = exec ? 1 : Math.min(1, (w - .25) / 2.75);
    const screens = [[-.68, .2], [.68, -.2]].map(([dx, r], i) => {
      monitor(mb, x + dx * s, topY, z - .34, r, s);
      const scr = new T.Mesh(new T.PlaneGeometry(1.26 * s, .76 * s), mats[i]);
      scr.position.set(x + dx * s, topY + .665 * s, z - .34); scr.rotation.y = r; scr.translateZ(.027 * s); group.add(scr);
      return scr;
    });
    mb.box(.62, .03, .2, exec ? 0x2a2d35 : 0xe8eaef, x - .05, topY + .015, z + .14); mb.box(.1, .03, .15, exec ? 0x2a2d35 : 0xe8eaef, x + .42, topY + .015, z + .16);
    plantParts(mb, x - w / 2 + .25, z - .3, exec ? 1.1 : .9, "small", null, topY);
    let bulb = null;
    if (lamp) {
      const b = lampParts(mb, x + w / 2 - .45, z - .35, "desk", topY);
      mb.cyl(.07, .1, .1, C.alu, b.x, b.y, b.z, 12, { rz: -.6 });
      bulb = new T.Mesh(new T.SphereGeometry(.04, 10, 6), themed.mats.bulb || new T.MeshStandardMaterial({ color: 0xfff1d6 }));
      bulb.position.set(b.x + .02, b.y - .03, b.z); group.add(bulb);
      if (light) { // 다크 테마용 따뜻한 점광원(책상 램프). 전체 4개 한도는 theme() 에서 센다
        const pl = new T.PointLight(0xffb86b, themed.dark ? TH.dark.light : 0, 8, 2); pl.position.set(b.x, b.y + .1, b.z + .2); group.add(pl); themed.dyn.push(pl); owned.lights.push(pl);
      }
    }
    if (exec && label) { // 명패(팀원 색 + 왕관)
      const col = "#" + new T.Color(color).getHexString();
      owned.signs.push(sign(group, .62, .16, 256, plate(`👑 ${label}`, col, "#ffffff", 30), x + w / 2 - .95, .92, z + .46));
      mb.box(.64, .04, .1, C.alu, x + w / 2 - .95, .83, z + .49);
    }
    const mesh = mb.mesh(group);
    const mug = new T.Mesh(new T.CylinderGeometry(.075, .065, .16, 14), new T.MeshStandardMaterial({ color: 0xffffff, roughness: .6 }));
    mug.position.set(x + w / 2 - .62, .9, z + .25); mug.castShadow = true; group.add(mug);
    officeChair(group, x, z + (exec ? 1.3 : SEAT_DZ), Math.PI, null, exec ? "exec" : "task"); // 의자는 spots() 의 seat 와 같은 자리
    const dispose = () => {
      for (const s of owned.signs) s.userData.release?.();
      themed.dyn = themed.dyn.filter(l => !owned.lights.includes(l));
      owned.signs = []; owned.lights = [];
    };
    return { screen: screens[0], mug, bulb, mesh, dispose };
  }

  /* ───────── 테마 ───────── */
  function theme(dark) {
    const t = TH[dark ? "dark" : "light"], M = themed.mats;
    if (!M.floor) return;
    M.floor.color.setHex(t.floor); M.slab.color.setHex(t.slab); M.wall.color.setHex(t.wall); M.trim.color.setHex(t.trim);
    M.carpet.color.setHex(t.carpet); M.execCarpet.color.setHex(t.execCarpet); M.rug.color.setHex(t.rug);
    M.glass.color.setHex(t.glass); M.glass.opacity = t.glassOp;
    M.bulb.emissiveIntensity = t.bulb; M.shade.emissiveIntensity = t.bulb * .6;
    themed.dark = !!dark;
    themed.dyn = themed.dyn.filter(l => l.parent); // 책상이 다시 놓이며 사라진 램프는 버린다
    let n = 0;
    for (const l of [...themed.lights, ...themed.dyn]) l.intensity = n++ < 4 ? t.light : 0; // 점광원은 최대 4개만 켠다
    if (themed.skyline) {
      if (!themed.skyTex[t.sky]) themed.skyTex[t.sky] = skylineTex(t.sky === "night");
      themed.skyline.material.map = themed.skyTex[t.sky]; themed.skyline.material.needsUpdate = true;
    }
  }

  /* ───────── 매 프레임: 미닫이문·방 이름표 ───────── */
  const _v = new T.Vector3();
  let lastT = 0;
  function tick() {
    const now = performance.now(), dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
    const agents = agentsFn() || [];
    for (const d of themed.doors) {
      let near = false;
      for (const p of agents) if (p && Math.abs(p.x - d.hx) < 1.6 && Math.abs(p.z - d.hz) < 1.6) { near = true; break; }
      const target = near ? 1 : 0;
      if (Math.abs(d.open - target) < .001) continue;
      d.open += (target - d.open) * Math.min(1, dt * 6);
      const off = d.open * d.slide * d.dir;
      if (d.axis === "x") d.g.position.x = d.px + off; else d.g.position.z = d.pz + off;
    }
    const cam = themed.camera;
    if (!cam || !themed.chips.length) return;
    const hide = innerWidth < 760 && cam.zoom < 1.5;
    const W = innerWidth, H = innerHeight;
    let tags = null; // 보이는 이름표 사각형(이름표가 우선: 칩이 이름표를 가리거나 그 뒤에 숨지 않게, 겹치면 칩을 숨긴다)
    for (const c of themed.chips) {
      if (hide || c.el.hidden) { c.el.style.display = "none"; continue; }
      c.el.style.display = "";
      _v.set(c.x, 3.2, c.z).project(cam);
      const cx = (_v.x * .5 + .5) * W, cy = (-_v.y * .5 + .5) * H;
      c.el.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      if (!c.w || (c.n = (c.n || 0) + 1) % 60 === 0) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; } // 크기는 1초에 한 번만 잰다
      if (!tags) tags = [...document.querySelectorAll("#labels .tagwrap .nametag, #labels .tagwrap .roletag")].map(n => n.getBoundingClientRect()).filter(r => r.width > 0);
      const x0 = cx - c.w / 2, x1 = cx + c.w / 2, y0 = cy - c.h / 2, y1 = cy + c.h / 2;
      const covered = tags.some(r => x0 < r.right && x1 > r.left && y0 < r.bottom && y1 > r.top);
      c.el.style.opacity = covered ? "0" : "";
    }
  }
  function makeChips() { // 스타일은 style.css 의 .room-chip(테마 토큰) — 설정의 '방 이름표' 가 body.no-roomtags 로 숨긴다
    const box = document.getElementById("labels") || document.body;
    for (const [k, r] of Object.entries(rooms)) {
      const el = document.createElement("div"); el.className = "room-chip"; el.textContent = r.label; el.dataset.room = k;
      if (r.chip?.off) el.hidden = true; // 기본 숨김(라운지)
      box.prepend(el);
      themed.chips.push({ el, x: r.chip ? r.chip.x : (r.x0 + r.x1) / 2, z: r.chip ? r.chip.z : (r.z0 + r.z1) / 2, w: 0, h: 0, n: 0 });
    }
  }
  Object.assign(Decor, { build, deskSet, officeChair, plant, theme, tick, setCamera: cam => (themed.camera = cam), themed, MB, VMAT, C });
})();
