"use strict";
/* Agent Office 장식(decor): 평면도·방·가구·조명·길 찾기 격자.
   전역 스크립트. window.THREE 가 있어야 3D 를 만들고, 없으면 평면 데이터(rooms/spots/nav)만 쓸 수 있다(노드 검증용).
   app.js 는 typeof Decor !== "undefined" 로 감싸서 부르므로, 이 파일이 없어도 앱은 동작한다.
   좌표: x 왼쪽(−)·오른쪽(+), z 뒤(−)·앞(+), y 위. 카메라는 앞-오른쪽(+x,+z) 위에서 본다 → +x·+z 를 향한 면이 보인다. */
(function () {
  const T = typeof window !== "undefined" ? window.THREE : (typeof globalThis !== "undefined" ? globalThis.THREE : null);
  const OW = 40, OD = 40, WALL_H = 4, PART_H = 2.6, DOOR_W = 1.6;
  const X0 = -OW / 2, X1 = OW / 2, Z0 = -OD / 2, Z1 = OD / 2;

  /* ───────── 평면도 ─────────
     chip: 방 이름 칩(HTML)을 띄우는 바닥 좌표. 사람이 앉는 자리(팀장 책상·회의 상석) 머리 위와 겹치지 않는 곳에 둔다.
     off: true 면 칩을 만들되 기본으로 숨긴다(라운지는 명세의 5개 방 칩 목록에 없다). */
  const rooms = {
    lobby: { x0:-10,x1:8,z0:12,z1:20,label:"현관",door:{x:-7,z:20,axis:"x",w:2.4},chip:{x:-5,z:18} },
    pantry: { x0:-18,x1:-10,z0:12,z1:20,label:"탕비실",door:{x:-10,z:16,axis:"z",w:2.4},chip:{x:-14,z:18} },
    work: { x0:-19,x1:4,z0:-14,z1:12,label:"업무 공간",door:null,chip:{x:-7,z:7.5} },
    meeting: { x0:8,x1:19,z0:-15,z1:0,label:"회의실 1",door:{x:8,z:-3,axis:"z",w:2.4},chip:{x:15,z:-12} },
    exec: { x0:8,x1:19,z0:0,z1:11,label:"팀장실",door:{x:8,z:7,axis:"z",w:2.4},chip:{x:16.6,z:9.8} }, // 팀장 책상·본부장 소파(동물원 팀장 전망대와 같은 역할)
    lounge: { x0:8,x1:19,z0:11,z1:20,label:"라운지",door:null,chip:{x:14,z:18} },
    balcony: { x0:-19,x1:19,z0:-19.5,z1:-15,label:"베란다",door:{x:1,z:-15,axis:"x",w:2.4},chip:{x:0,z:-18} },
  };
  const ENTRANCE={x:-7,z:18.3}, LOBBY_DOOR={x:-7,z:20,w:2.4,axis:"x"};
  const TABLE={x:14,z:-7,w:4.8,d:2}, TV={x:8.1,z:-7,w:2.4,h:1.35,y:1.85};
  const WHITEBOARD={x:9.2,z:-7}, BOARD_FACE={x:8.1,z:-7};
  const COUNTER={x:-16.6,z:14.4}, PANTRY_TABLE={x:-12.6,z:15.4,w:1.9,d:1.15};
  // 공간 테마 규격(theme-kit.js): 커피 자리 12 · 회의 의자 12 · 작업석 12(0번 = 팀장실 팀장 책상)
  const COFFEE=[{x:-15.5,z:14.6},{x:-10.5,z:15.4},{x:-14.6,z:17.7},{x:-15.5,z:13.4},{x:-13.6,z:17.9},{x:-10.6,z:13.2},{x:-15.5,z:15.8},{x:-14.6,z:13},{x:-10.6,z:17.6},{x:-12.6,z:13.6},{x:-11.8,z:17},{x:-13.2,z:19}];
  const EXEC_DESK={x:14.5,z:5,w:3},EXEC_SEAT={x:14.5,z:5.95},REPORT_SPOT={x:16.6,z:6.5};
  const MEET_SEATS=[...[-8.8,-5.2].flatMap(z=>[11,12.5,14,15.5,17].map(x=>({x,z}))),{x:17.6,z:-7},{x:14,z:-3.8}];
  const PRESENT_SPOT={x:8.9,z:-9.1}; // 회의실 1 TV 옆: 팀장이 여기서 테이블을 보고 발표한다
  const SEATS=12, ROWS=[-11.5,-10,-3.5,-2], DESK_W=2.6,SEAT_DZ=.95;
  // 구조만 새로 배치한다. 책상·의자·Apple 장비 등 기존 제작 에셋은 그대로 사용한다.
  // 0번: 팀장실 팀장 책상(동물원 팀장 전망대와 같은 역할). 1~11번: 업무 공간 마주 보는 4줄×3열에서 뒤쪽 오른쪽 1석을 뺀 11석
  function allSlots(){return [{x:EXEC_DESK.x,z:EXEC_DESK.z,w:EXEC_DESK.w,row:-1,col:0,cols:1,facing:0,exec:true},
    ...[3,2,1,0].flatMap(row=>[-15,-8,-1].flatMap((x,col)=>row===0&&col===2?[]:[{x,z:ROWS[row],w:DESK_W,row,col,cols:3,facing:row%2===0?Math.PI:0}]))];}
  function slots(n){return allSlots().slice(0,Math.max(0,Math.min(SEATS,n|0)));}
  function spots(n){return slots(n).map((desk,i)=>({desk:{...desk,w:i===0?EXEC_DESK.w:DESK_W},seat:{x:desk.x,z:desk.z+(desk.facing===0?SEAT_DZ:-SEAT_DZ)},meet:{...MEET_SEATS[i]},coffee:{...COFFEE[i%COFFEE.length]}}));}

  /* 벽·칸막이(길 찾기·기하 공통). t: 두께. 문은 gap 으로 비운다. */
  const WT = .1;
  const wallDefs = [
    {axis:"x",at:-20,a:-20,b:20,outer:true,ghost:true},
    {axis:"z",at:-20,a:-20,b:20,outer:true},
    {axis:"z",at:20,a:-20,b:20,outer:true,ghost:true},
    {axis:"x",at:20,a:-20,b:20,outer:true,ghost:true,gap:[-8.2,-5.8]},
    {axis:"x",at:-15,a:-19,b:19,gap:[-.2,2.2]},
    {axis:"z",at:8,a:-15,b:0,gap:[-4.2,-1.8]},
    {axis:"z",at:8,a:0,b:11,gap:[5.8,8.2]},
    {axis:"x",at:0,a:8,b:19},
    {axis:"x",at:11,a:8,b:19},
    {axis:"z",at:19,a:-15,b:11,ghost:true},
    {axis:"x",at:12,a:-18,b:-10,opaque:true},
    {axis:"z",at:-18,a:12,b:20,opaque:true},
    {axis:"z",at:-10,a:12,b:20,gap:[14.8,17.2],opaque:true},
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
  const furniture=[R(TABLE.x,TABLE.z,TABLE.w,TABLE.d,"table"),R(11,3.6,.9,.5,"coffee-table"),R(17.7,2.42,2,.45,"bookshelf"),R(-16.62,14.32,.76,4.25,"counter"),R(-16.55,17.1,.8,.8,"fridge"),R(PANTRY_TABLE.x,PANTRY_TABLE.z,1.9,1.15,"table"),R(14,16,2.2,.9,"sofa")];
  function spareDesks(n){return allSlots().slice(n);}
  function navRects(n){const out=[...wallRects(),...furniture];allSlots().forEach((d,i)=>{out.push(R(d.x,d.z,d.w+.3,1.5,"desk"));if(i>=n)out.push(R(d.x,d.z+(d.facing===0?SEAT_DZ:-SEAT_DZ),.55,.55,"chair"));});return out;}

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

  /* ───────── 해: 일출·일몰과 사무실 '밤 정도' ─────────
     태양 적위·시간각으로 해의 고도·방위와 일출·일몰 시각을 구한다(SunCalc·NOAA 와 같은 천문 근사, 오차 1~2분).
     사무실은 해 고도 +5° 부터 어두워지기 시작해 -5° 에서 완전히 밤이 된다(일몰 앞뒤 약 40~50분 동안 하늘·램프가 서서히 바뀐다).
     위치는 app.js 가 정한다(설정에서 맞춘 좌표 > 기기 시간대의 대표 도시 zone()). */
  const SUN = (() => {
    const rad = Math.PI / 180, DAY = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = rad * 23.4397, J0 = .0009;
    const days = d => d.valueOf() / DAY - .5 + J1970 - J2000;
    const fromJ = j => new Date((j + .5 - J1970) * DAY);
    const anomaly = d => rad * (357.5291 + .98560028 * d);
    const ecliptic = M => M + rad * (1.9148 * Math.sin(M) + .02 * Math.sin(2 * M) + .0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const decl = L => Math.asin(Math.sin(OBL) * Math.sin(L));
    /** 해의 고도·방위(라디안). 방위는 남쪽 0, 서쪽이 + */
    function position(when, lat, lng) {
      const lw = -lng * rad, phi = lat * rad, d = days(when), L = ecliptic(anomaly(d)), dec = decl(L);
      const H = rad * (280.16 + 360.9856235 * d) - lw - Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
      return {
        altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
        azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
      };
    }
    /** 그날의 일출·일몰(해 윗가장자리가 지평선에 걸리는 고도 -0.833°). 백야·극야면 null */
    function times(when, lat, lng) {
      const lw = -lng * rad, phi = lat * rad, n = Math.round(days(when) - J0 - lw / (2 * Math.PI));
      const ds = J0 + lw / (2 * Math.PI) + n, M = anomaly(ds), L = ecliptic(M), dec = decl(L);
      const transit = a => J2000 + a + .0053 * Math.sin(M) - .0069 * Math.sin(2 * L);
      const c = (Math.sin(-.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (c < -1 || c > 1) return null;
      const noon = transit(ds), set = transit(J0 + (Math.acos(c) + lw) / (2 * Math.PI) + n);
      return { sunrise: fromJ(noon - (set - noon)), sunset: fromJ(set) };
    }
    /** 사무실 밤 정도 0(낮)~1(밤): 해 고도 +5° → -5° 를 부드럽게(smoothstep) 잇는다 */
    function night(when, lat, lng) {
      const t = Math.min(1, Math.max(0, (5 - position(when, lat, lng).altitude / rad) / 10));
      return t * t * (3 - 2 * t);
    }
    // 기기 시간대 → 대표 도시 [위도, 경도, 이름]. 목록에 없으면 시간대 오프셋으로 경도를 어림한다
    const ZONES = {
      "Asia/Seoul": [37.5665, 126.978, "서울"], "Asia/Tokyo": [35.6762, 139.6503, "도쿄"], "Asia/Shanghai": [31.2304, 121.4737, "상하이"],
      "Asia/Hong_Kong": [22.3193, 114.1694, "홍콩"], "Asia/Taipei": [25.033, 121.5654, "타이베이"], "Asia/Singapore": [1.3521, 103.8198, "싱가포르"],
      "Asia/Bangkok": [13.7563, 100.5018, "방콕"], "Asia/Ho_Chi_Minh": [10.8231, 106.6297, "호찌민"], "Asia/Kolkata": [28.6139, 77.209, "뉴델리"],
      "Australia/Sydney": [-33.8688, 151.2093, "시드니"], "Europe/London": [51.5074, -.1278, "런던"], "Europe/Paris": [48.8566, 2.3522, "파리"],
      "Europe/Berlin": [52.52, 13.405, "베를린"], "America/New_York": [40.7128, -74.006, "뉴욕"], "America/Chicago": [41.8781, -87.6298, "시카고"],
      "America/Denver": [39.7392, -104.9903, "덴버"], "America/Los_Angeles": [34.0522, -118.2437, "로스앤젤레스"],
      "America/Toronto": [43.6532, -79.3832, "토론토"], "America/Vancouver": [49.2827, -123.1207, "밴쿠버"],
    };
    function zone() {
      let tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* Intl 없음 */ }
      if (Object.hasOwn(ZONES, tz)) { const [lat, lng, label] = ZONES[tz]; return { lat, lng, label }; }
      return { lat: 37.5, lng: -new Date().getTimezoneOffset() / 4, label: "기기 시간대" };
    }
    return { position, times, night, zone };
  })();

  const Decor = {
    sun: SUN,
    LIFE:{walk:[{x:4.5,z:12},{x:6,z:5},{x:4.5,z:-6}],window:{x:1,z:-17},windowFace:{x:1,z:-21},sofaApproach:{x:14,z:16.75},sofa:{x:14,z:16},sofaFace:{x:14,z:19},chat:[{x:-13.95,z:15.4},{x:-11.25,z:15.4}]},
    OW, OD, WALL_H, PART_H, SEATS, rooms, walls: wallDefs, wallRects, obstacles: furniture, navRects, slots, spots, spareDesks, nav,
    ENTRANCE, TABLE, WHITEBOARD, BOARD_FACE, COUNTER, COFFEE, EXEC_DESK, EXEC_SEAT, REPORT_SPOT, PRESENT_SPOT, MEET_SEATS, PANTRY_TABLE, LOBBY_DOOR, TV,
    // 조연(life.js) 장소: 본부장 자리(팀장실 소파)·발표 때 서서 듣는 회의실 뒤편·산책 지점·경리팀장 순찰 지점·회의실 문 앞
    NPC: {
      headSeat: { x: 9.95, z: 3.6 }, headFace: { x: 12.5, z: 3.6 },
      back: [{ x: 16.5, z: -12.4 }, { x: 12, z: -12.4 }, { x: 18, z: -10.5 }],
      wander: [{x:-11.5,z:-6.5},{x:-4.5,z:-6.5},{x:-4.5,z:4.5},{x:-11.5,z:4.5},{x:2.5,z:-7},{x:2.5,z:5},{x:-17.5,z:6.5},{x:-4.5,z:-12.8},{x:-3,z:16},{x:3,z:15},
        {x:-13,z:13.2},{x:11,z:14},{x:16.5,z:13},{x:-6,z:-17.5},{x:8,z:-17.5},{x:1,z:-14},{x:12,z:9.4},{x:17.6,z:9.5},{x:-12,z:9.5},{x:-2,z:9.5},{x:4.5,z:12},{x:6,z:5},{x:10.5,z:-12},{x:17.5,z:-2}],
      duckSpots: [{x:-12.6,z:13.6},{x:-11.8,z:17},{x:-5,z:18},{x:3,z:-17.5},{x:6.2,z:-3},{x:13.6,z:8.6}],
      meetingDoor: { x: 6.6, z: -3 },
    },
    walkable: (x, z) => nav.walkable(x, z), segHits,
  };
  if (typeof window !== "undefined") window.Decor = Decor; else if (typeof module !== "undefined") module.exports = Decor;
  if (!T) return; // 3D 없음: 평면 데이터만

  /* ───────── 3D 도구 ───────── */
  let small = false, scene = null, agentsFn = () => [];
  const rnd = (() => { let s = 20261014; return () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646; })();
  const VMAT = () => new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 });
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  /** 여러 상자·원기둥을 정점 색으로 칠해 메시 하나로 합친다(드로우콜 절약).
      색마다 정점 구간(runs: [라이트 색, 시작, 개수])을 기억해 두었다가 다크 테마에서 DARK 표대로 다시 칠한다(paint). */
  class MB {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.n = 0; this.runs = []; }
    add(geo, color, x, y, z, o) {
      o = o || {};
      const g = geo.index ? geo.toNonIndexed() : geo;
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || "XYZ"); _q.setFromEuler(_e); _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1); _p.set(x, y, z);
      _m.compose(_p, _q, _s); g.applyMatrix4(_m);
      const p = g.attributes.position.array, c = new T.Color(color), k = p.length / 3, ca = new Float32Array(k * 3);
      for (let i = 0; i < k; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
      const hex = c.getHex(), last = this.runs[this.runs.length - 1];
      if (last && last[0] === hex && last[1] + last[2] === this.n) last[2] += k; else this.runs.push([hex, this.n, k]);
      this.pos.push(p); this.nor.push(g.attributes.normal.array); this.uv.push(g.attributes.uv.array); this.col.push(ca); this.n += k;
      if (g !== geo) g.dispose();
      geo.dispose();
      return this;
    }
    box(w, h, d, color, x, y, z, o) { return this.add(window.ModelKit && Math.max(w,h,d)<4 ? ModelKit.roundedBox(w,h,d) : new T.BoxGeometry(w, h, d), color, x, y, z, o); }
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
      if (!material && window.ModelKit) {
        // 정점색은 보존하고 재질 4개로 모아 호출 수를 제한한다.
        const woods=new Set([C.wood,C.woodDark]),metals=new Set([C.alu,C.steel,C.legs,C.handle]),fabrics=new Set([C.cushion,C.chairBlack,C.leather,C.sofaGray,C.sofaBlue]);
        const classify=hex=>woods.has(hex)?1:metals.has(hex)?2:fabrics.has(hex)?3:0;
        const buckets=[[],[],[],[]];for(const run of this.runs)buckets[classify(run[0])].push(run);
        const reordered={};for(const k of ["position","normal","uv","color"])reordered[k]=new Float32Array(g.attributes[k].array.length);
        const runs=[];let cursor=0;
        for(let b=0;b<4;b++){
          const start=cursor;
          for(const [hex,offset,count] of buckets[b]){
            for(const k in reordered){const attr=g.attributes[k],size=attr.itemSize;reordered[k].set(attr.array.subarray(offset*size,(offset+count)*size),cursor*size);}
            runs.push([hex,cursor,count]);cursor+=count;
          }
          if(cursor>start)g.addGroup(start,cursor-start,b);
        }
        for(const k in reordered)g.attributes[k].array=reordered[k];this.runs=runs;
        material=[VMAT(),new T.MeshStandardMaterial({vertexColors:true,roughness:.67,bumpMap:ModelKit.surface("wood"),bumpScale:.0015}),new T.MeshStandardMaterial({vertexColors:true,metalness:.7,roughness:.36}),new T.MeshStandardMaterial({vertexColors:true,roughness:.94,bumpMap:ModelKit.surface("fabric"),bumpScale:.001})];
      }
      const m = new T.Mesh(g, material || VMAT());
      m.castShadow = m.receiveShadow = shadow;
      parent.add(m);
      m.userData.runs = this.runs;
      if (Array.isArray(m.material) ? m.material.some(x=>x.vertexColors) : m.material.vertexColors) tint(m);
      this.pos = []; this.nor = []; this.uv = []; this.col = []; this.n = 0; this.runs = [];
      return m;
    }
  }
  /** 정점 색 메시를 테마 다시 칠하기 목록에 올리고 지금 테마로 칠한다. */
  function tint(m) { themed.tinted.push(m); paint(m, themed.n); }
  const _c = new T.Color(), _c2 = new T.Color();
  /** n(0 = 낮 ~ 1 = 밤)만큼 라이트 색에서 DARK 표의 색으로 섞어 칠한다(표에 없는 색은 그대로) */
  function paint(m, n) {
    const attr = m.geometry.attributes.color, a = attr.array;
    for (const [hex, s, cnt] of m.userData.runs) {
      if (n <= 0 || !DARK.has(hex)) _c.setHex(hex);
      else if (n >= 1) _c.setHex(DARK.get(hex));
      else _c.setHex(hex).lerp(_c2.setHex(DARK.get(hex)), n);
      for (let i = s; i < s + cnt; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    }
    attr.needsUpdate = true;
  }
  const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
  const FONT = '"Pretendard GOV Variable", system-ui, sans-serif';
  const redraws = []; // 글꼴이 늦게 오면 다시 그릴 캔버스들
  function texture(cv) { const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.minFilter = T.LinearFilter; t.anisotropy = 4; return t; }
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
    blue: 0x9fb3d6, sofaBlue: 0x8aa0c8, sofaGray: 0xa3abb9, book: [0xd97757, 0x4f7cf7, 0x10a37f, 0xe8a317, 0x8e6cd1, 0xe05a8a, 0x1fa2b8],
    // 라이트에서는 비슷해 보이지만 다크에서 따로 칠하는 색(DARK 표의 열쇠라서 서로 달라야 한다)
    meetTop: 0xf4f5f8, counter: 0xcfd3dc, cabinet: 0xf4f5f6, key: 0xe8eaef, legs: 0xcfd3db, trimLight: 0xdfe2e8, micro: 0xd8dbe2, printerTop: 0xdadde5, handle: 0x9aa1b2 };
  /* 다크 테마 가구 색(라이트 색 → 다크 색). 참고 이미지(docs/ref/office-dark.png): 따뜻한 원목 상판, 검은 서랍·다리·프레임,
     크림색 칸막이, 짙은 회색 소파·회의 의자, 원목 카운터. 표에 없는 색(화분 잎·책·머그 등)은 그대로 둔다. */
  const dimHex = (h, k) => new T.Color(h).multiplyScalar(k).getHex();
  const DARK = new Map([
    [C.wood, 0x684327], [C.woodDark, 0x3d2718], [C.white, 0x25262b], [C.panel, 0x8b8070], [C.frame, 0x121316], [C.alu, 0x26272c],
    [C.chairBlack, 0x4a4c53], [C.cushion, 0x6a6c74], [C.gray, 0x2d2e34], [C.grayDark, 0x1c1d21], [C.leather, 0x211c19], [C.steel, 0x9da2aa],
    [C.pot, 0xcbc6be], [C.terra, 0x8f5c40], [C.sofaBlue, 0x3c3e46], [C.sofaGray, 0x4a4b52], [C.blue, 0x4c5a74],
    [C.meetTop, 0x4a2f1d], [C.counter, 0x8a5a35], [C.cabinet, 0x1f2024], [C.key, 0x2a2b30], [C.legs, 0x1d1e22], [C.trimLight, 0x2a2b30],
    [C.micro, 0x3a3c42], [C.printerTop, 0x3a3c42], [C.handle, 0x5d6068],
  ]);
  for (const [l, d] of [[C.sofaBlue, 0x3c3e46], [C.sofaGray, 0x4a4b52], [C.leather, 0x211c19]]) DARK.set(dimHex(l, .8), dimHex(d, .8)); // 소파 몸통(색 × .8)
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
  const themed = { mats: {}, lights: [], dyn: [], dark: false, chips: [], doors: [], skyline: null, skyTex: {}, glass: null, bulbs: null, shades: null, camera: null,
    n: 0,          // 지금 밤 정도(0 = 낮 ~ 1 = 밤). 해 질 녘에는 그 사이 값
    painted: null, // 가구 색을 마지막으로 칠한 밤 정도(조금씩 바뀔 때 매번 다시 칠하지 않게)
    skyDusk: null, skyNight: null, // 창밖 노을·야경 층(낮 하늘 위에 겹쳐 섞는다)
    tinted: [],    // 정점 색 메시(테마마다 DARK 표로 다시 칠한다)
    night: null,   // 다크 전용 연출(LED 띠·빛 웅덩이·벽 조명) 묶음
    nightDyn: [],  // 책상마다 붙는 다크 전용 연출(팀을 다시 놓으면 바뀐다)
  };
  const chairs = []; // 사람이 앉는 의자(책상·회의): { mesh, x, z } — 그림 캐릭터는 앉은 그림에 의자가 있어 그동안 이 의자를 숨긴다(chairNear)
  const TH = {
    light: { floor: 0xf1efea, slab: 0xd5d8e0, wall: 0xffffff, trim: 0xd9dee8, carpet: 0xdde4f3, execCarpet: 0xd9d2c8, rug: 0xe3dccf, glass: 0xdbeafe, glassOp: .18, bulb: 0, light: 0, sky: "day", rough: .9, metal: 0, band: .3, shade: 0xf1e8d8, shadeGlow: 0 },
    // 다크: 참고 이미지(docs/ref/office-dark.png)의 '밤의 라운지 오피스' — 짙은 회갈색 광택 바닥·숯색 벽, 따뜻한 램프·LED 띠(themed.night),
    // 원목·검은 가구(DARK 표). 바닥은 덜 거칠게 해서 점광원 반사가 보이게 한다
    dark: { floor: 0x1d1d23, slab: 0x15171c, wall: 0x26272c, trim: 0x131417, carpet: 0x2b2a2f, execCarpet: 0x3b2f27, rug: 0x3a3029, glass: 0xa9bed4, glassOp: .1, bulb: 1.1, light: .9, sky: "night", rough: .76, metal: .02, band: .05, shade: 0x3a332c, shadeGlow: .25 },
  };
  /** 도시 스카이라인 캔버스(day 낮 · dusk 노을 · night 밤). 뒷벽 창 밖에 겹쳐 둔다. */
  function skylineTex(kind) {
    const night = kind === "night", dusk = kind === "dusk", dark = night || dusk;
    const cv = canvas(2048, 256), c = cv.getContext("2d"), W = cv.width, H = cv.height;
    const sky = c.createLinearGradient(0, 0, 0, H);
    if (night) { sky.addColorStop(0, "#060a18"); sky.addColorStop(.6, "#121a36"); sky.addColorStop(1, "#2a2440"); }
    else if (dusk) { sky.addColorStop(0, "#1f2b58"); sky.addColorStop(.38, "#5a4677"); sky.addColorStop(.72, "#e07a58"); sky.addColorStop(1, "#ffc27a"); }
    else { sky.addColorStop(0, "#bfe0ff"); sky.addColorStop(1, "#eaf4ff"); }
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    if (night) {
      c.fillStyle = "rgba(255,255,255,.7)"; for (let i = 0; i < 90; i++) c.fillRect(rnd() * W, rnd() * H * .45, 1.5, 1.5);
      const haze = c.createLinearGradient(0, H * .45, 0, H); // 지평선의 따뜻한 도시 불빛
      haze.addColorStop(0, "rgba(255,150,80,0)"); haze.addColorStop(1, "rgba(255,150,80,.22)");
      c.fillStyle = haze; c.fillRect(0, H * .45, W, H * .55);
    } else if (dusk) { // 지평선에 걸린 해의 번짐
      const g = c.createRadialGradient(W * .78, H * .95, 0, W * .78, H * .95, H * 1.1);
      g.addColorStop(0, "rgba(255,226,160,.95)"); g.addColorStop(.25, "rgba(255,170,100,.55)"); g.addColorStop(1, "rgba(255,140,90,0)");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    } else { c.fillStyle = "rgba(255,255,255,.8)"; for (let i = 0; i < 7; i++) { const x = rnd() * W, y = 20 + rnd() * 60; c.beginPath(); c.ellipse(x, y, 60 + rnd() * 60, 14, 0, 0, 7); c.fill(); } }
    let s = 7;
    const r = () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646;
    const fills = night ? ["#141b33", "#0b1024"] : dusk ? ["#3b3150", "#272038"] : ["#c9d8ec", "#aebfd9"];
    for (const [layer, col, hmin, hmax] of [[0, fills[0], 60, 130], [1, fills[1], 90, 200]]) {
      for (let x = -20; x < W; ) {
        const w = 30 + r() * 70, h = hmin + r() * (hmax - hmin);
        c.fillStyle = col; c.fillRect(x, H - h, w, h);
        if (r() > .6) c.fillRect(x + w * .3, H - h - 18, w * .4, 18);
        const cols = Math.max(1, Math.floor(w / 9)), rows = Math.floor(h / 11);
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          const lit = r() < (night ? .5 + layer * .1 : dusk ? .22 + layer * .08 : .15);
          c.fillStyle = dark ? (lit ? (r() < .62 ? "#ffcf7d" : "#a9d4ff") : "rgba(255,255,255,.04)") : (lit ? "rgba(255,255,255,.65)" : "rgba(40,60,100,.12)");
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
  function lobbySign(c, w, h) { // 숯색 판 + 푸르게 빛나는 링 + 흰 글자(참고 이미지의 현관 로고 벽)
    c.fillStyle = "#1a1c22"; c.fillRect(0, 0, w, h);
    const cx = w * .05 + h * .27, cy = h * .5, r = h * .25;
    c.shadowColor = "#4f86ff"; c.shadowBlur = h * .18; c.strokeStyle = "#6f9bff"; c.lineWidth = h * .06;
    c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); c.stroke();
    c.shadowBlur = h * .06; c.shadowColor = "rgba(160,190,255,.6)";
    const label = "WordNCode Agent Office", x0 = w * .05 + h * .65, room = w * .95 - x0; // 간판 폭에 맞춰 글자 크기를 줄인다
    let fs = h * .4; c.font = `700 ${fs}px ${FONT}`;
    const tw = c.measureText(label).width; if (tw > room) { fs *= room / tw; c.font = `700 ${fs}px ${FONT}`; }
    c.fillStyle = "#ffffff"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(label, x0, h * .52);
  }

  /** 장면 전체를 만든다. helpers: {box, cyl, mat, small, agents()}. 돌려주는 값: { strokes } */
  /** 다크 테마용 따뜻한 점광원. 휴대폰은 2개(+책상 램프 2 = 4), 그 밖에는 5개(+2 = 7)까지만 만든다(셰이더 유니폼·성능). 나머지 빛은 가짜 빛(themed.night) */
  function addLight(x, y, z, dist = 10) {
    if (themed.lights.length >= (small ? 2 : 5)) return null;
    const l = new T.PointLight(0xffb86b, 0, dist, 2); l.position.set(x, y, z); scene.add(l); themed.lights.push(l); return l;
  }

  /* ───────── 다크 전용 연출(참고: docs/ref/office-dark.png) ─────────
     실제 광원은 비싸므로 대부분 '가짜 빛'으로 만든다: 조명을 받지 않는 밝은 LED 띠 + 빛을 더하는(가산 혼합) 그라데이션 판
     (바닥 빛 웅덩이·벽 조명·띠 아래 번짐). 판은 재질별로 한 메시로 합친다. 모두 themed.night 에 넣어 라이트 테마에서는 숨긴다. */
  const WARM = 0xffb064, LED = 0xffd7a1, BLUE = 0x4f86ff;
  const GLOW_TEX = {};
  /** radial: 가운데가 밝은 원 / fade: 위(이미지 위쪽)가 밝고 아래로 사라지는 띠 */
  function glowTex(kind) {
    if (GLOW_TEX[kind]) return GLOW_TEX[kind];
    const cv = kind === "radial" ? canvas(128, 128) : canvas(4, 128), c = cv.getContext("2d");
    const g = kind === "radial" ? c.createRadialGradient(64, 64, 0, 64, 64, 64) : c.createLinearGradient(0, 0, 0, 128);
    const stops = kind === "radial" ? [[0, 1], [.22, .62], [.5, .22], [.75, .06], [1, 0]] : [[0, 1], [.18, .62], [.5, .2], [1, 0]];
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
    const t = new T.CanvasTexture(cv); t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    return (GLOW_TEX[kind] = t);
  }
  const glowMat = kind => new T.MeshBasicMaterial({ map: glowTex(kind), vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
  /** 가짜 빛 도구 묶음. k 는 밝기(색에 곱한다 — 가산 혼합이라 그대로 세기가 된다). 다 그린 뒤 done(parent) 로 메시를 만든다 */
  function glowKit() {
    const pools = new MB(), fades = new MB(), leds = new MB();
    const kit = {
      /** 바닥(또는 y 높이 수평면) 위 둥근 빛 웅덩이 */
      pool(x, z, r, color = WARM, k = .3, y = .024) { pools.add(new T.PlaneGeometry(r * 2, r * 2), dimHex(color, k * .24), x, y, z, { rx: -Math.PI / 2 }); return kit; },
      /** 세로 둥근 빛(벽·화면 뒤 후광). (nx,nz) 는 판이 바라보는 쪽 */
      halo(x, y, z, w, h, nx, nz, color = WARM, k = .3) { pools.add(new T.PlaneGeometry(w, h), dimHex(color, k), x, y, z, { ry: Math.atan2(nx, nz) }); return kit; },
      /** 바닥 번짐 띠: 길이 len, 폭 depth. (dx,dz) 는 벽에서 멀어지는 쪽 — 벽 쪽이 밝다. alongX: 띠가 x 축을 따라 놓임 */
      band(cx, cz, len, depth, dx, dz, color = WARM, k = .22) {
        fades.add(new T.PlaneGeometry(len, depth), dimHex(color, k * .4), cx + dx * depth / 2, .02, cz + dz * depth / 2, { rx: -Math.PI / 2, ry: Math.atan2(dx, dz), order: "YXZ" });
        return kit;
      },
      /** 벽 조명: 세로 판. top 이면 위가 밝고(천장 쪽 띠에서 아래로), 아니면 아래가 밝다(바닥 띠에서 위로). (nx,nz) 는 벽에서 나오는 쪽 */
      wash(cx, cy, cz, w, h, nx, nz, top = true, color = WARM, k = .3) {
        fades.add(new T.PlaneGeometry(w, h), dimHex(color, k), cx, cy, cz, { ry: Math.atan2(nx, nz), rz: top ? 0 : Math.PI, order: "YXZ" });
        return kit;
      },
      /** 발광 LED 막대(조명을 받지 않는다) */
      led(w, h, d, x, y, z, color = LED, o) { leds.box(w, h, d, color, x, y, z, o); return kit; },
      done(parent) {
        const out = [];
        for (const [mb, kind] of [[pools, "radial"], [fades, "fade"]]) {
          const m = mb.mesh(parent, glowMat(kind), false);
          if (m) { m.renderOrder = 4; out.push(m); }
        }
        const l = leds.mesh(parent, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }), false);
        if (l) { l.renderOrder = 4; out.push(l); }
        return out;
      },
    };
    return kit;
  }
  /** 사무실 고정 연출: 칸막이 위·아래 LED 와 바닥 번짐, 창가·왼쪽 벽 간접 조명, 펜던트·램프·다운라이트 빛 웅덩이,
      탕비실 선반·팀장실 책장 뒷조명, 회의실 TV·현관 간판·키오스크의 푸른 후광. */
  /** 책상 하나의 다크 연출: 칸막이 위 LED, 책상 위 램프 빛, 책상 앞 바닥 빛. 만든 메시 배열을 돌려준다(dispose 때 nightDyn 에서 뺀다). */
  function deskNight(group, { x, z, w, exec, topY, lampAt }) {
    const kit = glowKit();
    if (!exec) kit.led(w + .2, .02, .02, x, 1.345, z - .64);
    if (lampAt) kit.pool(lampAt.x, lampAt.z + .2, .75, WARM, .5, topY + .006);
    kit.pool(x, z + .9, 1.5, WARM, .13);
    const out = kit.done(group);
    for (const m of out) { glow(m, themed.n); themed.nightDyn.push(m); }
    return out;
  }
  /** 책상 세트(팀원·대표). group 에 넣고 { screen, mug, bulb, mesh, dispose } 를 돌려준다(두 화면 재질은 mats[0..1]).
      dispose() 는 팀을 다시 만들 때 group 에서 메시를 떼기 전에 부른다: 명패 캔버스를 redraws 에서, 책상 램프 점광원을 themed.dyn 에서 뺀다(누수 방지). */
  function legacyDeskSet(group, { x, z, w = DESK_W, mats, exec = false, color = 0x4f7cf7, label = "", lamp = true, light = false, cols = 1, col = 0 }) {
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
      if (col < cols - 1) { mb.box(.05, 1.25, 1.4, C.panel, x + w / 2 + .1, .625, z - .05); mb.box(.08, .04, 1.4, C.alu, x + w / 2 + .1, 1.27, z - .05); }
    }
    const s = exec ? 1 : Math.min(1, (w - .25) / 2.75);
    const apple = window.AppleAssets?.desktop(group, { x, y: topY, z, mats });
    const screens = apple ? apple.screens : [[-.68, .2], [.68, -.2]].map(([dx, r], i) => {
      monitor(mb, x + dx * s, topY, z - .34, r, s);
      const scr = new T.Mesh(new T.PlaneGeometry(1.26 * s, .76 * s), mats[i]);
      scr.position.set(x + dx * s, topY + .665 * s, z - .34); scr.rotation.y = r; scr.translateZ(.027 * s); group.add(scr);
      return scr;
    });
    if (!apple) { mb.box(.62, .03, .2, exec ? 0x2a2d35 : C.key, x - .05, topY + .015, z + .14); mb.box(.1, .03, .15, exec ? 0x2a2d35 : C.key, x + .42, topY + .015, z + .16); }
    plantParts(mb, x - w / 2 + .25, z - .3, exec ? 1.1 : .9, "small", null, topY);
    let bulb = null;
    if (lamp) {
      const b = lampParts(mb, x + w / 2 - .45, z - .35, "desk", topY);
      mb.cyl(.07, .1, .1, C.alu, b.x, b.y, b.z, 12, { rz: -.6 });
      bulb = new T.Mesh(new T.SphereGeometry(.04, 10, 6), themed.mats.bulb || new T.MeshStandardMaterial({ color: 0xfff1d6 }));
      bulb.position.set(b.x + .02, b.y - .03, b.z); group.add(bulb);
      if (light) { // 다크 테마용 따뜻한 점광원(책상 램프). 전체 4개 한도는 theme() 에서 센다
        const pl = new T.PointLight(0xffb86b, TH.dark.light * themed.n, 8, 2); pl.position.set(b.x, b.y + .1, b.z + .2); group.add(pl); themed.dyn.push(pl); owned.lights.push(pl);
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
    const seatZ = z + (exec ? .95 : SEAT_DZ); // 의자는 spots() 의 seat 와 같은 자리
    const chair = { mesh: officeChair(group, x, seatZ, Math.PI, null, exec ? "exec" : "task"), x, z: seatZ };
    chairs.push(chair);
    const night = deskNight(group, { x, z, w, exec, topY, lampAt: lamp ? { x: x + w / 2 - .45, z: z - .35 } : null });
    const dispose = () => {
      for (const s of owned.signs) s.userData.release?.();
      themed.dyn = themed.dyn.filter(l => !owned.lights.includes(l));
      themed.nightDyn = themed.nightDyn.filter(o => !night.includes(o));
      const mine = new Set([mesh, chair.mesh, ...night]); // 다시 칠하기 목록에서도 뺀다(팀을 여러 번 다시 놓아도 쌓이지 않게)
      themed.tinted = themed.tinted.filter(m => !mine.has(m));
      const i = chairs.indexOf(chair); if (i >= 0) chairs.splice(i, 1);
      owned.signs = []; owned.lights = [];
    };
    return { screen: screens[0], mug, bulb, mesh, dispose };
  }

  /** 기존 책상 세트를 통째로 회전한다. 가구 크기와 장비는 변경하지 않는다. */
  function deskSet(parent, options){
    const group=new T.Group();group.position.set(options.x,0,options.z);group.rotation.y=options.facing||0;parent.add(group);
    const start=chairs.length,result=legacyDeskSet(group,{...options,x:0,z:0});
    for(const chair of chairs.slice(start)){const p=group.localToWorld(new T.Vector3(chair.x,0,chair.z));chair.x=p.x;chair.z=p.z;}
    return result;
  }

  /* ───────── 테마: n = 0(낮) ~ 1(밤). 해 질 녘처럼 중간값이면 낮과 밤을 섞는다(true/false 도 받는다) ───────── */
  const _a = new T.Color(), _b = new T.Color();
  const mixHex = (a, b, t) => _a.setHex(a).lerp(_b.setHex(b), t).getHex();
  function theme(dark) {
    const n = typeof dark === "number" ? Math.min(1, Math.max(0, dark)) : dark ? 1 : 0;
    const L = TH.light, K = TH.dark, M = themed.mats;
    if (!M.floor) return;
    const num = k => L[k] + (K[k] - L[k]) * n;
    for (const k of ["floor", "slab", "wall", "trim", "carpet", "execCarpet", "rug", "glass", "shade"]) M[k].color.setHex(mixHex(L[k], K[k], n));
    M.glass.opacity = num("glassOp"); M.bulb.emissiveIntensity = num("bulb"); M.shade.emissiveIntensity = num("shadeGlow");
    if(themed.blinds){themed.blinds.material.color.copy(M.shade.color);themed.blinds.material.emissiveIntensity=M.shade.emissiveIntensity;}
    M.floor.roughness = num("rough"); M.floor.metalness = num("metal"); M.band.opacity = num("band");
    themed.n = n; themed.dark = n >= .5;
    // 밤 연출(LED 띠·빛 웅덩이·벽 조명)은 가산 혼합이라 색 밝기를 n 배로 하면 서서히 켜진다
    themed.nightDyn = themed.nightDyn.filter(o => o.parent); // 책상이 다시 놓이며 사라진 연출은 버린다
    for (const o of [themed.night, ...themed.nightDyn]) if (o) glow(o, n);
    // 가구 색은 정점마다 다시 칠하므로 2% 넘게 바뀌었을 때만(해 질 녘 천천히 바뀌는 동안 매번 칠하지 않게)
    themed.tinted = themed.tinted.filter(m => m.parent);
    if (themed.painted == null || Math.abs(themed.painted - n) >= .02 || ((n === 0 || n === 1) && themed.painted !== n)) {
      for (const m of themed.tinted) paint(m, n);
      themed.painted = n;
    }
    themed.dyn = themed.dyn.filter(l => l.parent); // 책상이 다시 놓이며 사라진 램프는 버린다
    let i = 0;
    for (const l of [...themed.lights, ...themed.dyn]) l.intensity = i++ < (small ? 4 : 7) ? K.light * n : 0; // 점광원 개수 한도(셰이더 유니폼·성능)
    // 창밖: 낮 하늘 위에 노을(해 질 녘 한가운데서 가장 짙다)과 야경을 겹쳐 섞는다
    const dusk = Math.max(0, 1 - Math.abs(2 * n - 1) * 1.15) * .95;
    for (const [m, op] of [[themed.skyDusk, dusk], [themed.skyNight, n]]) if (m) { m.material.opacity = op; m.visible = op > .01; }
  }
  /** 밤 연출 묶음(Group 또는 Mesh)의 밝기: 0 이면 숨긴다 */
  function glow(o, n) {
    o.visible = n > .005;
    o.traverse(m => { if (m.material?.color) m.material.color.setScalar(n); });
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
    if(themed.blinds&&cam){const target=cam.zoom>1.8||(cam.right-cam.left)/cam.zoom<24?.08:1;themed.blinds.material.opacity+=(target-themed.blinds.material.opacity)*Math.min(1,dt*8);}
    if (!cam || !themed.chips.length) return;
    const hide = innerWidth < 760 && cam.zoom < 1.5;
    const W = innerWidth, H = innerHeight;
    let tags = null; // 보이는 이름표 사각형(이름표가 우선: 칩이 이름표를 가리거나 그 뒤에 숨지 않게, 겹치면 칩을 숨긴다)
    for (const c of themed.chips) {
      if (hide || c.el.hidden) { c.el.style.display = "none"; continue; }
      c.el.style.display = "";
      _v.set(c.x, 3.2, c.z).project(cam);
      const cx = (_v.x * .5 + .5) * W, cy = (-_v.y * .5 + .5) * H;
      if (!c.w || (c.n = (c.n || 0) + 1) % 60 === 0) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; } // 크기는 1초에 한 번만 잰다
      const d = devicePixelRatio || 1, px = v => Math.round(v * d) / d; // 픽셀 격자에 맞춰야 글자가 또렷하다
      c.el.style.transform = `translate3d(${px(cx - c.w / 2)}px, ${px(cy - c.h / 2)}px, 0)`;
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
  /** (x,z) 에서 r 안에 있는 가장 가까운 '앉는 의자'. 없으면 null. */
  function chairNear(x, z, r = .5) {
    let best = null, bd = r * r;
    for (const c of chairs) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd && c.mesh?.parent) { bd = d; best = c; }
    }
    return best;
  }

  /** 가구는 기존 제작 코드를 재사용하며 위치만 옮긴다. 크기·재질·소품은 유지한다. */
  function reusedFurniture(kind,parent){
    const scene=parent,st=new MB(),frames=new MB(),shadeGeo=new MB(),bulbGeo=new MB();
    const PANTRY_TABLE={x:-11.6,z:-7.6,w:1.9,d:1.15};
    if(kind==="pantry"){
    st.box(.62, .88, 4.15, C.cabinet, -15.65, .44, -8.68); st.box(.72, .05, 4.25, C.counter, -15.62, .905, -8.68);
    for (let i = 0; i < 4; i++) st.box(.02, .7, .02, C.handle, -15.36, .45, -10.5 + i * 1.2);
    st.box(.42, .5, .38, 0x2a2d35, -15.6, 1.18, -8.6); st.box(.12, .08, .3, C.steel, -15.52, .97, -8.6); st.box(.3, .06, .3, C.steel, -15.6, 1.46, -8.6);
    st.cyl(.09, .11, .22, C.steel, -15.6, 1.04, -9.6, 12); st.cyl(.02, .02, .14, 0x222, -15.6, 1.22, -9.6, 5);
    st.box(.5, .32, .38, C.micro, -15.6, 1.09, -7.3); st.box(.32, .22, .02, 0x1b1e26, -15.4, 1.09, -7.3);
    st.box(.8, 1.9, .78, C.steel, -15.55, .95, -5.9); st.box(.02, .7, .03, 0x333, -15.14, 1.3, -5.6); st.box(.02, .4, .03, 0x333, -15.14, .5, -5.6);
    for (const y of [1.85, 2.35]) { st.box(.26, .03, 3.6, C.wood, -15.86, y, -8.7); st.box(.04, .06, 3.6, C.trimLight, -15.98, y + .04, -8.7); }
    for (let i = 0; i < 7; i++) st.cyl(.06, .055, .1, [0xffffff, 0xd97757, 0x4f7cf7, 0x10a37f, 0xffffff, 0xe8a317, 0xffffff][i], -15.86, 1.92, -10.3 + i * .48, 10);
    plantParts(st, -15.86, -7.1, 1, "small", null, 2.365); plantParts(st, -15.86, -9.9, .9, "small", C.terra, 2.365); plantParts(st, -15.86, -8.4, .8, "small", null, 2.365);
    st.add(new T.CylinderGeometry(.5, .5, .06, 32), C.wood, PANTRY_TABLE.x, .76, PANTRY_TABLE.z, { sx: PANTRY_TABLE.w, sz: PANTRY_TABLE.d });
    st.cyl(.08, .22, .73, C.alu, PANTRY_TABLE.x, .365, PANTRY_TABLE.z, 14);
    chairParts(st, -12.95, -7.6, Math.PI / 2, "pantry"); chairParts(st, -10.25, -7.6, -Math.PI / 2, "pantry");
    chairParts(st, -11.6, -8.8, 0, "pantry"); chairParts(st, -11.6, -6.4, Math.PI, "pantry");
    st.box(.38, 1, .38, C.white, -9.05, .5, -10.5); st.box(.3, .15, .3, 0x2a2d35, -9.05, 1.07, -10.5);
    st.add(new T.CylinderGeometry(.14, .14, .4, 12), 0x8fc8f0, -9.05, 1.35, -10.5, {}); st.box(.03, .04, .03, 0x3b7bd1, -8.85, .78, -10.5);
    shadeGeo.cyl(.06, .3, .22, 0xffffff, PANTRY_TABLE.x, 2.45, PANTRY_TABLE.z, 14); lampParts(st, PANTRY_TABLE.x, PANTRY_TABLE.z, "pendant", 3.85); bulbGeo.sphere(.06, 0xffffff, PANTRY_TABLE.x, 2.4, PANTRY_TABLE.z);


    }else if(kind==="lounge"){
    sofaParts(st, 12.5, 8.6, 0, 2.2, C.sofaGray, 3);
    st.box(1, .05, .5, C.wood, 12.5, .42, 10.1); for (const [lx, lz] of [[-.45, -.2], [.45, -.2], [-.45, .2], [.45, .2]]) st.box(.04, .4, .04, C.alu, 12.5 + lx, .2, 10.1 + lz);
    sofaParts(st, 9.6, 9.3, Math.PI / 2, .8, C.sofaBlue, 1);
    st.cyl(.3, .3, .04, C.wood, 14.4, .5, 8.6, 16); st.cyl(.03, .03, .5, C.alu, 14.4, .25, 8.6, 8);
    { const b = lampParts(st, 14.9, 9.7, "floor"); shadeGeo.cyl(.2, .26, .34, 0xffffff, b.x, b.y, b.z, 16); bulbGeo.sphere(.05, 0xffffff, b.x, b.y, b.z); }
    st.box(1.1, .75, .6, C.white, 6.3, .375, 10);
    if (window.AppleAssets) {
      const place=(name,x,y,z,ry=0)=>{const a=AppleAssets.build(name);a.group.position.set(x,y,z);a.group.rotation.y=ry;scene.add(a.group);return a.group;};
      place("MacBook",6.25,.75,10,Math.PI);
      place("HomePod mini",6.7,.75,10);
      const ipad=place("iPad",6,.88,10.1,Math.PI);ipad.rotation.x=-.25;
      st.box(.26,.025,.18,C.alu,6,.77,10.1);



    }
    plantParts(st, 15.4, 5.2, 1.05, "monstera"); plantParts(st, 6, 5.3, .85, "bush");


    }else if(kind==="meeting2"){
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
    { const b = lampParts(st, 15.3, -6.6, "floor"); shadeGeo.cyl(.2, .26, .34, 0xffffff, b.x, b.y, b.z, 16); bulbGeo.sphere(.05, 0xffffff, b.x, b.y, b.z);  }

    }else if(kind==="lobby"){
    sofaParts(st, -15.1, 4.9, Math.PI / 2, 1.6, C.sofaBlue, 2);
    st.cyl(.34, .34, .04, C.wood, -13.5, .4, 4.9, 20); st.cyl(.03, .03, .4, C.alu, -13.5, .2, 4.9, 8); st.cyl(.18, .18, .03, C.alu, -13.5, .015, 4.9, 12);
    st.box(.36, .06, .36, C.alu, -13.8, .03, 9.3); st.box(.06, 1.1, .06, C.alu, -13.8, .58, 9.3);
    if (window.AppleAssets) {
      const ipad=AppleAssets.build("iPad").group;ipad.name="Lobby iPad check-in";ipad.position.set(-13.8,1.25,9.3);ipad.rotation.set(-.35,Math.PI/4,0);scene.add(ipad);
    } else st.box(.34, .46, .04, 0x1f2430, -13.8, 1.35, 9.3, { rx: -.35, ry: Math.PI / 4 });
    plantParts(st, -15.3, 6.1, 1.05, "fiddle"); plantParts(st, -15.3, 8.9, 1, "monstera");

    }
    st.mesh(scene);frames.mesh(scene);shadeGeo.mesh(scene,themed.mats.shade);bulbGeo.mesh(scene,themed.mats.bulb);
  }
  /** 넓어진 공간의 밤: 기존 가구 위의 따뜻한 빛과 파란 유리 프레임 조명. */
  function buildPhotoNight(){
    const g=new T.Group();scene.add(g);const kit=glowKit();
    kit.led(38,.035,.035,0,PART_H+.03,-15,0x6f9cff);
    kit.led(.035,.035,26,8,PART_H+.08,-2,0x528cff);
    kit.led(.025,.025,26,8,.08,-2,0x3768c9);
    kit.led(8,.025,.025,-14,PART_H+.05,12,0xffc88d);
    kit.led(.025,.025,8,-10,PART_H+.05,16,0xffc88d);
    kit.led(38,.025,.025,0,.14,-19.5,0x4d79d2);
    for(const z of [-10.75,-2.75,9.25])for(const x of [-15,-8,-1])kit.pool(x,z,2.5,0x8aabef,.16);
    kit.pool(-12.6,15.4,3,0xffbb79,.35);kit.pool(14,-7,4,0xffca98,.24);kit.pool(14,5,4,0xffca98,.24);kit.pool(14,16,3.2,0xffb779,.23);
    kit.done(g);themed.night=g;glow(g,themed.n);
  }

  /** 사진에서 확인한 구조를 넓은 평면에 적용한다. 기존 가구·장비 제작기는 재사용한다. */
  function buildPhotoOffice(sc,helpers={}){
    scene=sc;small=!!helpers.small;agentsFn=helpers.agents||agentsFn;
    const st=new MB(),frames=new MB(),glassGeo=new MB(),bandGeo=new MB(),blinds=new MB();
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


    const floor=new T.Mesh(new T.PlaneGeometry(OW,OD),M.floor);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
    floor.onBeforeRender=(r,s,cam)=>{themed.camera=cam;tick();};
    const slab=new T.Mesh(new T.BoxGeometry(OW+.2,.3,OD+.2),M.slab);slab.position.y=-.16;scene.add(slab);
    const wallGeo=new MB();wallGeo.box(.3,WALL_H,40,0xffffff,-20,2,0);wallGeo.mesh(scene,M.wall);
    // 파란 프레임 유리 복도와 회의실 두 개, 오른쪽에 문이 있는 왼쪽 모서리 탕비실.
    for(const w of wallDefs){
      if(w.outer||w.ghost)continue;
      const alongX=w.axis==='x';
      const put=(mb,len,mid,wd,h,y,col)=>alongX?mb.box(len,h,wd,col,mid,y,w.at):mb.box(wd,h,len,col,w.at,y,mid);
      for(const [a,b] of w.gap?[[w.a,w.gap[0]],[w.gap[1],w.b]]:[[w.a,w.b]]){
        const len=b-a,mid=(a+b)/2;if(len<=0)continue;
        put(w.opaque?st:glassGeo,len,mid,w.opaque?.14:.04,PART_H,PART_H/2,w.opaque?C.white:0xffffff);
        put(frames,len,mid,.09,.09,PART_H+.04,w.opaque?C.white:0x24539c);
        put(frames,len,mid,.09,.1,.05,w.opaque?C.white:0x24539c);
        if(!w.opaque){put(bandGeo,len,mid,.055,.9,1.1,0xffffff);const count=Math.ceil(len/2.6);for(let i=0;i<=count;i++)put(frames,.09,a+len*i/count,.09,PART_H,PART_H/2,0x24539c);}
      }
      if(w.gap){const [a,b]=w.gap,gc=(a+b)/2,px=alongX?gc:w.at+.06,pz=alongX?w.at+.06:gc;
        const leaf=doorLeaf(b-a-.04,PART_H-.18,px,pz,alongX?'x':'z');
        themed.doors.push({g:leaf,axis:alongX?'x':'z',dir:-1,open:0,px,pz,hx:alongX?gc:w.at,hz:alongX?w.at:gc,slide:b-a-.1});
      }
    }
    // 앞쪽 현관은 탕비실 오른쪽 통로와 연결한다.
    const entry=doorLeaf(2.35,2.45,LOBBY_DOOR.x,20,'x');
    themed.doors.push({g:entry,axis:'x',dir:1,open:0,px:LOBBY_DOOR.x,pz:20,hx:LOBBY_DOOR.x,hz:20,slide:2.25});
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


    // 기존 창과 블라인드 재질을 사용한 긴 베란다 경계와 난간.
    st.box(38,.1,4.5,C.steel,0,-.04,-17.25);
    for(let x=-19;x<=19;x+=2){frames.box(.1,1.15,.1,C.alu,x,.575,-19.5);glassGeo.box(1.9,1,.04,0xffffff,x+.95,.55,-19.5);}
    frames.box(38,.07,.1,C.alu,0,1.15,-19.5);
    for(const x of [-19,19]){frames.box(.08,1.15,.08,C.alu,x,.575,-15);frames.box(.08,.07,4.5,C.alu,x,1.15,-17.25);}
    for(let x=-18;x<19;x+=2.5){for(let y=2.85;y<3.65;y+=.12)blinds.box(2.4,.04,.08,C.trimLight,x+.9,y,-14.95);}
    themed.skyTex.day=skylineTex('day');
    const sky=themed.skyline=new T.Mesh(new T.PlaneGeometry(42,4.4),new T.MeshBasicMaterial({map:themed.skyTex.day}));sky.position.set(0,2,-20.5);scene.add(sky);
    for(const kind of ['dusk','night']){const m=new T.Mesh(new T.PlaneGeometry(42,4.4),new T.MeshBasicMaterial({map:themed.skyTex[kind]=skylineTex(kind),transparent:true,opacity:0,depthWrite:false}));m.position.set(0,2,-20.49+(kind==='night'?.002:0));m.visible=false;scene.add(m);themed[kind==='night'?'skyNight':'skyDusk']=m;}
    // 기존 소파·커피 머신·냉장고·선반·서적·Apple 장비는 크기와 모양을 유지하고 구역만 이동한다.
    for(const [kind,x,z] of [['pantry',-1,23],['lounge',1.5,7.4],['meeting2',3.5,13.2],['lobby',8.7,8.5]]){const g=new T.Group();g.position.set(x,0,z);scene.add(g);reusedFurniture(kind,g);}
    for(const table of [TABLE]){
      st.box(table.w,.07,table.d,C.meetTop,table.x,.78,table.z);
      for(const side of [-1,1])st.box(.08,.76,table.d-.4,C.legs,table.x+side*(table.w/2-.3),.38,table.z);
      if(window.AppleAssets)for(const dx of [-1.3,0,1.3]){const a=AppleAssets.build('MacBook');a.group.position.set(table.x+dx,.815,table.z);a.group.rotation.y=Math.PI;scene.add(a.group);}
    }
    MEET_SEATS.forEach(m=>{const mb=new MB();chairParts(mb,m.x,m.z,Math.atan2(TABLE.x-m.x,TABLE.z-m.z),'meet');chairs.push({mesh:mb.mesh(scene),x:m.x,z:m.z});});
    st.box(.08,TV.h+.12,TV.w+.12,C.frame,TV.x+.1,TV.y,TV.z);
    sign(scene,TV.w,TV.h,512,tvChart,TV.x+.145,TV.y,TV.z,{ry:Math.PI/2});
    if(window.AppleAssets){const a=AppleAssets.build('Apple TV');a.group.position.set(TV.x+.3,1.02,TV.z);a.group.rotation.y=Math.PI/2;scene.add(a.group);}
    sign(scene,2.2,.55,512,lobbySign,-9.9,2.55,18.4,{ry:Math.PI/2});
    // 기존 그림·화이트보드·화분도 유지한다.
    sign(scene,3.2,1.6,512,chartBoard,-19.8,1.95,0,{ry:Math.PI/2});
    sign(scene,1,.8,256,abstractArt,-19.8,2.2,6,{ry:Math.PI/2});
    plantParts(st,-18,-13,1.2,'fiddle');plantParts(st,3,-13,1,'monstera');plantParts(st,3,11,1.1,'fiddle');plantParts(st,-17,-17.2,1,'bush');plantParts(st,17,-17.2,1,'bush');
    for(const z of [-6,2]){lampParts(st,-8,z,'pendant',4.3);addLight(-8,2.6,z,13);}addLight(TABLE.x,2.5,TABLE.z,13);addLight(PANTRY_TABLE.x,2.2,PANTRY_TABLE.z,10);
    st.mesh(scene);frames.mesh(scene,new T.MeshStandardMaterial({vertexColors:true,roughness:.5,metalness:.4}));
    themed.blinds=blinds.mesh(scene,M.shade.clone(),false);themed.blinds.material.transparent=true;themed.blinds.material.depthWrite=false;
    themed.glass=glassGeo.mesh(scene,M.glass,false);if(themed.glass)themed.glass.renderOrder=2;
    const band=bandGeo.mesh(scene,M.band,false);if(band)band.renderOrder=3;
    const strokes=[0,1,2,3,4].map(i=>{const line=helpers.box(.012,.06,.8,0x6b7489,TV.x+.17,2.2-i*.2,TV.z);line.visible=false;line.castShadow=false;return line;});
    buildPhotoNight();makeChips();return{strokes};
  }
  Object.assign(Decor, { build: buildPhotoOffice, deskSet, officeChair, plant, theme, tick, chairNear, setCamera: cam => (themed.camera = cam), themed, MB, VMAT, C });
})();
