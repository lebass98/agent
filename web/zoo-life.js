"use strict";
/* zoo-life.js — 동물원에서만: 에이전트가 아닌 동물원 식구와 배경 동물.
   - 원장 코끼리(본부장): 전망대 그루터기 자리 · 원형극장 · 카페 · 팀원 옆을 오가며 응원·위로·명언. 팀장이 발표하면 객석 뒤에서 듣는다.
   - 공작새(디자인팀장): 산책로와 마을을 쉬지 않고 돌아다닌다(가끔 혼잣말).
   - 배경 동물(업무와 무관, 이름표 없음): 호수 오리·하늘을 도는 새·사바나 미어캣·극지 펭귄·피크닉 나비.
   팀원이 아니므로 D.names·D.agents 에 넣지 않는다(이름표 겹침 정리 때만 잠깐 끼워 넣는다 — npcs.js 와 같은 방식).
   3D 가 없거나 사무실이면 아무것도 하지 않는다. '움직임 줄이기'면 걷지 않고 제자리에 머문다. index.html 에서 app.js 다음에 읽는다. */
window.ZooLife = (() => {
  let ok = false;
  try { ok = !!(window.SpaceTheme?.isZoo && window.ZooTheme && HAS3D && typeof Agent === "function" && typeof declutter === "function" && D && scene && camera); } catch { ok = false; }
  if (!ok) return { list: [] };
  const Z = window.ZooTheme;

  /* ───────── 대사 ───────── */
  const L = {
    cheer: ["오, 집중하는 모습 보기 좋네요. 화이팅! 💪", "천천히 해도 괜찮아요. 방향만 맞으면 됩니다.", "이 속도면 오늘 안에 끝나겠는데요? 👍",
      "막히는 데 있으면 언제든 말해요. 같이 봅시다.", "역시 믿고 맡길 만하네요.", "좋아요, 그 기세 그대로 갑시다! 🔥", "결과물 기대할게요. 부담은 갖지 말고요.",
      "잘하고 있어요. 진짜로요.", "중간에 물 한 잔씩은 꼭 마셔요 💧", "완벽보다 완성! 일단 끝까지 가 봅시다.", "코끼리는 한 번 본 건 잊지 않아요. 오늘 이 집중력도요 🐘"],
    chat: ["요즘 많이 바빴죠? 오늘은 조금 쉬어 가요.", "점심은 맛있게 먹었어요? 🍃", "지난번 결과물, 다들 좋다고 하더라고요.", "실수해도 괜찮아요. 고치면서 배우는 거죠.",
      "힘든 일 있으면 편하게 얘기해요.", "잘 쉬는 친구가 일도 잘하더라고요.", "오늘 호수 물빛 봤어요? 정말 예쁘더라고요 ☀️", "우리 동물원은 서로 믿는 게 제일 큰 힘이에요.",
      "조급해하지 말아요. 다 때가 있어요.", "어제보다 오늘 한 걸음이면 충분해요.", "카페에서 시원한 거 한 잔 사 줄까요? 🧃"],
    quote: ["“천 리 길도 한 걸음부터.” 오늘의 한 걸음, 좋습니다.", "“시작이 반이다.” 벌써 반은 온 거예요!", "“혼자 가면 빨리 가고, 함께 가면 멀리 간다.” — 아프리카 속담",
      "“성공은 매일 반복한 작은 노력의 합이다.” — 로버트 콜리어", "“단순함은 궁극의 정교함이다.” — 레오나르도 다빈치", "“실패는 성공의 어머니.” 괜찮아요, 다시 하면 돼요.",
      "“낙숫물이 댓돌을 뚫는다.” 꾸준함이 이깁니다.", "“즐기는 사람을 이길 수 없다.” 즐겁게 합시다 😄", "“위대한 일은 작은 일들이 모여 이루어진다.” — 반 고흐",
      "“구슬이 서 말이라도 꿰어야 보배.” 마무리가 중요해요.", "“행동이 모든 성공의 기본 열쇠다.” — 피카소", "“할 수 있다고 믿든 없다고 믿든, 당신 말이 맞다.” — 헨리 포드"],
    stage: ["원형극장이 조용하네요. 다음 발표엔 좋은 아이디어가 쏟아지겠죠.", "이 보드에 다음 계획이 가득 찼으면 좋겠네요 📈", "좋은 회의는 짧고 굵게! 기억해 둡시다."],
    seat: ["흠, 오늘 동물원 분위기 좋은데요? 📊", "다들 잘하고 있으니 나는 응원만 하면 되겠네.", "전망대에서 보니 다들 열심이네요.", "오늘 저녁엔 다 같이 피크닉 한번 할까…"],
    coffee: ["카페 주스 한 잔의 여유… 🧃", "역시 오후엔 달콤한 거죠.", "매점 간식 채워 놔야겠네요."],
    listen: ["저는 뒤에서 듣기만 할게요 🙂", "편하게 진행해요. 구경만 할게요."],
    afterMeeting: ["좋은 계획이네요. 다들 화이팅! 💪", "깔끔한 발표였어요 👏", "이대로만 가면 되겠어요. 힘냅시다!"],
    reply: ["감사합니다, 원장님! 😊", "네, 힘낼게요!", "말씀만으로도 힘이 나요.", "좋은 말씀 감사합니다!"],
    design: ["음… 저 연못 곡선, 레이아웃에 쓰고 싶다.", "이 노을 색감, 좋다 👀", "깃털 색 조합에서 영감이 오네요 🦚", "다음 시안은 이 초록 톤으로 가 볼까?",
      "걷다 보면 레이아웃이 떠오르더라고요.", "표지판 글꼴, 조금만 더 둥글면 좋겠는데.", "한 바퀴만 더 돌고 갈게요."],
  };

  /* ───────── 장소 ───────── */
  const P = (x, z) => ({ x, z });
  const STAGE_ROOM = ROOMS.meeting;
  const inStage = p => p.x > STAGE_ROOM.x0 && p.x < STAGE_ROOM.x1 && p.z > STAGE_ROOM.z0 && p.z < STAGE_ROOM.z1;
  const HEAD_SEAT = P(-2.6, -13.2), HEAD_FACE = P(-2.6, -10);
  const BACK = [P(-5.6, .4), P(5.6, .4), P(0, 3.2)];            // 원형극장 객석 뒤
  const WANDER = [P(0, -4.6), P(-4.4, -4.6), P(4.4, -4.6), P(-5, -.7), P(5.6, -.3), P(4.4, 3.6), P(2.1, 4.2), P(-4, 4.2), P(0, 6.6), P(0, 9.2),
    P(-11, -7.4), P(11, -7), P(-13.2, -3.2), P(12, 5.8), P(-10, 12.6), P(4.4, 8.2), P(11, 12.6), P(-6.8, 13.4), P(-16, 7.4), P(16.8, -6.4), P(-6, -12.6), P(6.4, -12.4)];
  const FAR = P(9999, 9999);

  const sleepRaw = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduce = () => mqReduce.matches || document.body.classList.contains("reduce-motion");
  const free = p => { try { return walkable(p.x, p.z); } catch { return true; } };
  const leader = () => (D.leader ? A(D.leader) : null);
  const presenting = () => !!leader()?.presenting;
  const statusOf = a => a?.card?.st?.status || "대기";

  /* ───────── 동물원 식구(이름표 있음) ───────── */
  const DEFS = [
    { key: "peacock", kind: "peacock", start: WANDER[0], speed: 2.1,
      def: { label: "디자인팀장", initial: "🦚", color: "#2f8f9d", hair: "#2c2c3a", role: "공작새 · 디자인팀", model: "", provider: "", leader: false },
      lines: L.design, script: designScript },
    { key: "elephant", kind: "elephant", start: HEAD_SEAT, speed: 1.8, seat: HEAD_SEAT, monitorTarget: HEAD_FACE,
      def: { label: "본부장", initial: "🐘", color: "#8a8f99", hair: "#43302a", role: "코끼리 · 동물원 원장", model: "", provider: "", leader: false },
      lines: [...L.quote, ...L.chat], script: headScript },
  ];
  const list = DEFS.map(d => ({ ...d, agent: null, g: 0 }));
  function create(n) {
    const spot = { seat: n.seat || n.start, monitorTarget: n.monitorTarget || null, meet: FAR, coffee: FAR, screen: true, mug: null, tv: null, tv2: null };
    const a = n.agent = new Agent(n.kind, n.def, spot); // 이름 = 동물 종류(zoo-theme 가 extras 로 만든다)
    a.npc = n.key; a.speed = n.speed;
    a.label.classList.add("npc");
    const tag = a.tag.cloneNode(true);
    tag.setAttribute("aria-label", `${n.def.label} (에이전트 아님)`);
    tag.title = `${n.def.label} — 동물원 식구(업무를 맡지 않아요)`;
    tag.addEventListener("click", () => a.say(pick(n.lines), 4200));
    a.tag.replaceWith(tag); a.tag = tag; a.faceEl = tag.querySelector(".face");
    a.teleport(n.start, Math.PI);
    if (n.seat) a.sitDesk("sit"); else a.mode = "stand";
    const g = ++n.g;
    Promise.resolve().then(() => n.script(n, a, g)).catch(e => console.warn(`${n.def.label} 연출:`, e));
  }
  const alive = (n, g) => n.g === g;
  async function walk(n, a, g, p, cap = 30000) {
    if (!alive(n, g) || reduce()) return false;
    let poll = 0;
    const late = new Promise(res => { const t0 = performance.now(); poll = setInterval(() => { if (reduce() || !alive(n, g) || performance.now() - t0 > cap) res("late"); }, 300); });
    const r = await Promise.race([a.walkTo(p), late]);
    clearInterval(poll);
    if (r === "late") a.finishWalk();
    return alive(n, g) && r !== false;
  }
  async function rest(n, g, ms, stop) {
    let left = ms;
    while (left > 0 && alive(n, g)) {
      if ((stop && stop()) || reduce()) return false;
      await sleepRaw(400);
      if (!document.hidden) left -= 400 * Math.max(1, SPEED);
    }
    return alive(n, g);
  }

  async function designScript(n, a, g) {
    let prev = null, stops = 0;
    while (alive(n, g)) {
      if (document.hidden || reduce()) { if (a.mode === "walk") a.finishWalk(); await sleepRaw(1500); continue; }
      const pool = WANDER.filter(p => p !== prev && free(p) && !(D.running && inStage(p)));
      const p = pick(pool.length ? pool : WANDER); prev = p;
      if (!(await walk(n, a, g, p))) { await sleepRaw(800); continue; }
      a.mode = "stand"; a.face({ x: p.x + rnd(-3, 3), z: p.z + rnd(-3, 3) });
      if (++stops % 3 === 0 && Math.random() < .5) a.say(pick(L.design), 3600);
      await rest(n, g, rnd(1500, 4500));
    }
  }
  function visitable(m) {
    if (!m || m.ghost || m.hidden || m.lifePose || m.presenting) return false;
    if (!(m.mode === "sit" || m.mode === "type") || !m.atDesk()) return false;
    return !["회의", "보고", "검수 중", "휴식"].includes(statusOf(m));
  }
  function besideSpot(m, from) {
    const s = m.seat, c = [P(s.x + 1.2, s.z + .6), P(s.x - 1.2, s.z + .6), P(s.x + 1.2, s.z + 1), P(s.x - 1.2, s.z + 1), P(s.x, s.z + 1.5)]
      .filter(free).sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z));
    return c[0] || P(s.x, s.z + 1.5);
  }
  async function listenMeeting(n, a, g) {
    const spot = BACK.find(free) || BACK[0];
    if (!(await walk(n, a, g, spot, 25000))) return;
    a.mode = "stand"; a.face(TABLE);
    if (!presenting()) return;
    if (Math.random() < .5) a.say(pick(L.listen), 2600);
    while (alive(n, g) && presenting()) { a.face(TABLE); await sleepRaw(700); }
    if (!alive(n, g)) return;
    await rest(n, g, 1200); a.say(pick(L.afterMeeting), 3600); await rest(n, g, 3000);
  }
  async function visit(n, a, g, last) {
    const pool = D.names.map(A).filter(visitable), others = pool.filter(x => x.name !== last);
    const m = pick(others.length ? others : pool);
    if (!m) return null;
    const name = m.name, still = () => A(name) === m && visitable(m);
    if (!(await walk(n, a, g, besideSpot(m, a.group.position), 30000)) || !still()) return name;
    a.face(m.group.position); a.mode = "talk";
    const busy = BUSY.includes(statusOf(m)) || m.mode === "type";
    a.say(pick(busy ? L.cheer : L.chat), 4600);
    if (!(await rest(n, g, 5000, () => !still() || presenting()))) return name;
    if (Math.random() < .55) { a.face(m.group.position); a.say(pick(L.quote), 5600); if (!(await rest(n, g, 6000, () => !still() || presenting()))) return name; }
    if (!busy && !D.running && still() && Math.random() < .6) { m.say(pick(L.reply), 3000); await rest(n, g, 3200); }
    a.mode = "stand";
    return name;
  }
  async function headScript(n, a, g) {
    let prev = "", last = "";
    while (alive(n, g)) {
      if (document.hidden) { await sleepRaw(1500); continue; }
      if (reduce()) {
        if (a.mode === "walk") a.finishWalk();
        if (!a.atDesk()) a.teleport(n.seat);
        a.sitDesk("sit"); if (Math.random() < .15) a.say(pick(L.seat), 3600);
        await sleepRaw(6000); continue;
      }
      if (presenting()) { await listenMeeting(n, a, g); continue; }
      const kind = pick(["visit", "visit", "visit", "seat", "seat", "stage", "coffee"].filter(k => k !== prev || k === "visit")); prev = kind;
      if (kind === "visit") { const who = await visit(n, a, g, last); if (who) last = who; else prev = ""; }
      else if (kind === "seat") {
        if (!(await walk(n, a, g, n.seat))) { await sleepRaw(800); continue; }
        a.sitDesk("sit");
        await rest(n, g, rnd(5000, 9000), presenting);
        if (Math.random() < .6) a.say(pick(Math.random() < .5 ? L.seat : L.quote), 4600);
        await rest(n, g, rnd(10000, 20000), presenting);
      } else if (kind === "stage") {
        if (D.running) { prev = ""; await sleepRaw(300); continue; }
        if (!(await walk(n, a, g, pick(BACK.filter(free)) || BACK[0]))) continue;
        a.mode = "stand"; a.face(TABLE); a.say(pick(Math.random() < .6 ? L.stage : L.quote), 4600);
        await rest(n, g, rnd(7000, 11000), presenting);
      } else {
        if (!(await walk(n, a, g, COFFEE[COFFEE.length - 1]))) continue;
        a.mode = "coffee"; a.face(COUNTER); a.say(pick(L.coffee), 3800);
        await rest(n, g, rnd(7000, 10000), presenting);
      }
      if (alive(n, g) && a.mode === "talk") a.mode = "stand";
      await rest(n, g, rnd(1200, 2600));
    }
  }

  /* ───────── 배경 동물(이름표 없음, 업무와 무관) ───────── */
  const T = THREE, critters = new T.Group(); critters.name = "zoo-critters"; scene.add(critters);
  const mats = new Map(), M = c => mats.get(c) || (mats.set(c, new T.MeshStandardMaterial({ color: c, roughness: .8 })), mats.get(c));
  const sphere = new T.SphereGeometry(1, 12, 9), cone = new T.ConeGeometry(1, 1, 8);
  const part = (p, geo, c, x, y, z, sx, sy = sx, sz = sx) => { const m = new T.Mesh(geo, M(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; p.add(m); return m; };
  const L0 = Z.LAKE;
  // 오리: 호수 위를 천천히 돈다
  const ducks = Array.from({ length: 4 }, (_, i) => {
    const g = new T.Group(); critters.add(g);
    part(g, sphere, i ? 0xf5f1e6 : 0x4f7a54, 0, .22, 0, .26, .18, .34); const head = part(g, sphere, i ? 0xf5f1e6 : 0x2f6b4c, 0, .45, .24, .14);
    part(g, cone, 0xf0a63a, 0, .44, .4, .05, .14, .05).rotation.x = Math.PI / 2; part(g, sphere, 0x1d1d1d, .07, .5, .33, .025); part(g, sphere, 0x1d1d1d, -.07, .5, .33, .025);
    if (!i) head.scale.setScalar(.15);
    return { g, r: 1.6 + i * .55, a: i * 1.6, w: .18 + i * .03 };
  });
  // 새: 하늘을 크게 돈다(날갯짓)
  const birds = Array.from({ length: 6 }, (_, i) => {
    const g = new T.Group(); critters.add(g);
    part(g, sphere, 0x3b4a5a, 0, 0, 0, .14, .1, .28);
    const wing = s => { const w = new T.Mesh(new T.PlaneGeometry(.55, .2), new T.MeshStandardMaterial({ color: 0x506273, side: T.DoubleSide })); w.position.set(s * .3, 0, 0); g.add(w); return w; };
    return { g, wings: [wing(1), wing(-1)], r: 9 + i * 2.2, a: i * 1.1, y: 7 + (i % 3) * 1.2, w: .12 + (i % 2) * .05, dir: i % 2 ? 1 : -1 };
  });
  // 미어캣·펭귄·나비: 팀원 동물 모델을 작게 줄여 쓴다(zoo-animals.js 가 있을 때)
  const mini = (kind, x, z, s) => {
    if (!window.ZooAnimals?.build) return null;
    try { const rig = window.ZooAnimals.build(kind, `mini-${kind}`); rig.group.scale.setScalar(s); rig.group.position.set(x, 0, z); critters.add(rig.group); return rig; } catch { return null; }
  };
  const meerkats = [[14.6, 12.2], [15.4, 12.6], [16.2, 12.1], [14.9, 13]].map(([x, z], i) => ({ rig: mini("meerkat", x, z, .38), base: z, t: i * 1.7 })).filter(m => m.rig);
  const penguins = [[-15.2, -6.6], [-14.2, -6.2], [-7.2, -6.4]].map(([x, z], i) => ({ rig: mini("penguin", x, z, .42), x0: x, z, t: i * 2.1, span: i === 2 ? .9 : 1.4 })).filter(p => p.rig);
  const flyers = Array.from({ length: 8 }, (_, i) => {
    const g = new T.Group(); critters.add(g);
    const c = [0xf2b84b, 0xe58fa5, 0xb59ce0, 0xffffff][i % 4];
    const w = s => { const m = new T.Mesh(new T.PlaneGeometry(.16, .12), new T.MeshStandardMaterial({ color: c, side: T.DoubleSide })); m.position.x = s * .08; g.add(m); return m; };
    return { g, wings: [w(1), w(-1)], cx: -10 + (i % 4) * 1.6 - 1, cz: 10 + Math.floor(i / 4) * 1.8, t: i * .9 };
  });
  function animateCritters(t, dt) {
    for (const d of ducks) { d.a += d.w * dt; const x = L0.x + Math.cos(d.a) * d.r * .9, z = L0.z + Math.sin(d.a) * d.r; d.g.position.set(x, .05 + Math.sin(t * 2 + d.r) * .02, z); d.g.rotation.y = -d.a; }
    for (const b of birds) { b.a += b.w * dt * b.dir; b.g.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(t + b.r) * .4, Math.sin(b.a) * b.r * .75); b.g.rotation.y = -b.a + (b.dir > 0 ? 0 : Math.PI); const f = Math.sin(t * 10 + b.r) * .7; b.wings[0].rotation.z = f; b.wings[1].rotation.z = -f; }
    for (const m of meerkats) { const up = Math.max(0, Math.sin(t * .8 + m.t)); m.rig.group.position.y = -1.1 * .38 * (1 - up); m.rig.group.rotation.y = Math.sin(t * .5 + m.t) * .8; }
    for (const p of penguins) { const k = Math.sin(t * .4 + p.t); p.rig.group.position.x = p.x0 + k * p.span; p.rig.group.rotation.y = Math.cos(t * .4 + p.t) > 0 ? Math.PI / 2 : -Math.PI / 2; p.rig.group.rotation.z = Math.sin(t * 6 + p.t) * .08; }
    for (const f of flyers) { const k = t * .7 + f.t; f.g.position.set(f.cx + Math.sin(k) * 1.2, .7 + Math.sin(k * 1.7) * .3, f.cz + Math.cos(k * .8) * 1); f.g.rotation.y = k; const w = Math.sin(t * 18 + f.t) * 1.1; f.wings[0].rotation.y = w; f.wings[1].rotation.y = -w; }
  }

  /* ───────── 매 프레임: 렌더 루프의 declutter() 직전에 움직이고, 이름표 겹침 정리에 끼워 넣는다 ───────── */
  let last = performance.now();
  const base = declutter;
  window.declutter = function (mobile) {
    const now = performance.now(), raw = Math.min(.05, (now - last) / 1000), dt = raw * SPEED;
    last = now;
    if (!document.hidden && !reduce()) { try { animateCritters(now / 1000, raw); } catch (e) { console.warn("배경 동물:", e); } }
    const live = list.map(n => n.agent).filter(a => a && !a.ghost), w = innerWidth, h = innerHeight;
    for (const a of live) { try { a.update(dt); a.placeLabel(w, h); } catch (e) { console.warn("동물원 식구 갱신:", e); } }
    const names = D.names, agents = D.agents, keys = [];
    for (const a of live) { const k = `\u0000zoo:${a.npc}`; if (!Object.hasOwn(agents, k)) { agents[k] = a; keys.push(k); } }
    D.names = keys.length ? names.concat(keys) : names;
    try { return base.call(this, mobile); }
    finally { D.names = names; for (const k of keys) delete agents[k]; }
  };
  animateCritters(0, 0);
  for (const n of list) create(n);
  return { list, critters, ducks, birds, meerkats, penguins };
})();
