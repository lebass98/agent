"use strict";
/* npcs.js — 에이전트가 아닌 사무실 사람(NPC) 두 명: 디자인팀장·본부장.
   - team.toml 팀원이 아니다: D.names·D.agents 에 넣지 않으므로 업무 배정·업무 보드·팀 활동·에이전트 설정·서버 호출과 무관하다.
   - app.js 는 고치지 않는다(다른 에이전트가 함께 고치는 파일). 전역 Agent 클래스로 캐릭터를 만들고,
     렌더 루프가 매 프레임 부르는 전역 declutter() 를 감싸 그 직전에 NPC 를 움직이고(update·placeLabel)
     이름표 겹침 정리에도 잠깐 끼워 넣는다(동기 호출 동안만 D.names·D.agents 에 더했다가 바로 뺀다).
   - 디자인팀장: 사무실 이곳저곳을 계속 걸어 다닌다(가끔 짧게 혼잣말).
   - 본부장: 회의실 1 → 자기 자리(회의실 2 테이블 상석) → 팀원 옆에 가서 격려·위로·명언 … 을 돌아가며 한다.
     팀장이 회의실에서 발표하는 동안에는 회의실 뒤편에 서서 조용히 듣는다.
   - 3D 가 없으면(목록 모드) 아무것도 하지 않는다. '움직임 줄이기'(mqReduce)면 걷지 않고 제자리에 머문다. */
window.NPCs = (() => {
  let ok = false;
  try { ok = !!(HAS3D && typeof Agent === "function" && typeof declutter === "function" && D && scene && camera); } catch { ok = false; }
  if (!ok) return { list: [] };

  /* ───────── 대사 ───────── */
  const L = {
    // 일하는 팀원 응원
    cheer: [
      "오, 집중하는 모습 보기 좋네요. 화이팅! 💪", "천천히 해도 괜찮아요. 방향만 맞으면 됩니다.", "이 속도면 오늘 안에 끝나겠는데요? 👍",
      "막히는 데 있으면 언제든 말해요. 같이 봅시다.", "역시 믿고 맡길 만하네요.", "좋아요, 그 기세 그대로 갑시다! 🔥",
      "결과물 기대할게요. 부담은 갖지 말고요.", "한 줄 한 줄이 다 실력이 되는 거예요.", "잘하고 있어요. 진짜로요.",
      "중간에 물 한 잔씩은 꼭 마셔요 💧", "어려운 건 원래 시간이 걸려요. 그게 정상이에요.", "오늘도 덕분에 든든합니다.",
      "완벽보다 완성! 일단 끝까지 가 봅시다.", "이런 집중력, 아무나 못 내요.",
    ],
    // 쉬는 팀원에게 말 걸기·위로
    chat: [
      "요즘 많이 바빴죠? 오늘은 조금 쉬어 가요.", "점심은 맛있게 먹었어요? 🍚", "지난번 결과물, 다들 좋다고 하더라고요.",
      "실수해도 괜찮아요. 고치면서 배우는 거죠.", "힘든 일 있으면 편하게 얘기해요. 문은 늘 열려 있어요.", "주말엔 푹 쉬어야 해요. 그것도 일이에요 😊",
      "요즘 표정이 밝아서 좋네요.", "잘 쉬는 사람이 일도 잘하더라고요.", "오늘 하늘 봤어요? 날씨 좋더라고요 ☀️",
      "우리 팀은 서로 믿는 게 제일 큰 힘이에요.", "조급해하지 말아요. 다 때가 있어요.", "어제보다 오늘 한 걸음이면 충분해요.",
      "커피 한 잔 사 줄까요? ☕", "당신 덕분에 팀 분위기가 좋아졌어요.",
    ],
    // 명언
    quote: [
      "“천 리 길도 한 걸음부터.” 오늘의 한 걸음, 좋습니다.", "“시작이 반이다.” 벌써 반은 온 거예요!", "“고생 끝에 낙이 온다.” 조금만 더 힘내요.",
      "“가장 큰 영광은 넘어지지 않는 게 아니라, 넘어질 때마다 일어서는 것이다.” — 공자", "“성공은 매일 반복한 작은 노력의 합이다.” — 로버트 콜리어",
      "“할 수 있다고 믿든 없다고 믿든, 당신 말이 맞다.” — 헨리 포드", "“단순함은 궁극의 정교함이다.” — 레오나르도 다빈치",
      "“천재는 1%의 영감과 99%의 노력으로 이루어진다.” — 에디슨", "“혼자 가면 빨리 가고, 함께 가면 멀리 간다.” — 아프리카 속담",
      "“행동이 모든 성공의 기본 열쇠다.” — 피카소", "“어제와 똑같이 살면서 다른 내일을 기대하는 건 어리석다.” — 아인슈타인",
      "“배움에는 끝이 없다.” 오늘도 하나 배웠죠?", "“실패는 성공의 어머니.” 괜찮아요, 다시 하면 돼요.", "“낙숫물이 댓돌을 뚫는다.” 꾸준함이 이깁니다.",
      "“지금 이 순간이 가장 젊은 날이다.” 하고 싶은 건 해 봐요.", "“즐기는 사람을 이길 수 없다.” 즐겁게 합시다 😄",
      "“완벽함이란 더할 것이 없을 때가 아니라 뺄 것이 없을 때 이루어진다.” — 생텍쥐페리", "“위대한 일은 작은 일들이 모여 이루어진다.” — 반 고흐",
      "“오늘 할 수 있는 일을 내일로 미루지 마라.” — 벤저민 프랭클린", "“구슬이 서 말이라도 꿰어야 보배.” 마무리가 중요해요.",
    ],
    // 회의실 1 에서
    meeting: [
      "회의실이 조용하네요. 다음 회의 땐 좋은 아이디어가 쏟아지겠죠.", "이 화면에 다음 분기 계획이 가득 찼으면 좋겠네요 📈",
      "좋은 회의는 짧고 굵게! 기억해 둡시다.", "여기서 나온 아이디어들이 다 실력이 됐죠.", "의자 정리 잘 돼 있네요. 다들 고마워요.",
    ],
    // 자기 자리에서 혼잣말
    seat: [
      "흠, 이번 주 지표 괜찮은데요? 📊", "다들 잘하고 있으니 나는 응원만 하면 되겠네.", "결재할 건… 다 했고. 좋아요.",
      "오늘 저녁엔 팀 회식 한번 잡아 볼까…", "보고서 잘 읽었어요. 깔끔하네.", "창밖 풍경이 오늘따라 좋네.",
    ],
    coffee: ["커피 한 잔의 여유… 이게 행복이죠 ☕", "역시 오후엔 커피죠.", "탕비실 간식 채워 놔야겠네요."],
    listen: ["저는 뒤에서 듣기만 할게요 🙂", "편하게 진행해요. 구경만 할게요."],
    afterMeeting: ["좋은 계획이네요. 다들 화이팅! 💪", "깔끔한 발표였어요 👏", "이대로만 가면 되겠어요. 힘냅시다!"],
    // 팀원이 쉬고 있을 때 돌아오는 대답
    reply: ["감사합니다, 본부장님! 😊", "네, 힘낼게요!", "말씀만으로도 힘이 나요.", "본부장님 덕분이에요.", "좋은 말씀 감사합니다!", "오늘도 열심히 해 볼게요 💪"],
    // 디자인팀장 혼잣말(가끔만)
    design: [
      "음… 여기 여백이 조금만 더 있으면 좋겠는데.", "이 조명 색감, 좋다 👀", "다음 시안은 이 톤으로 가 볼까?", "폰트 하나만 바꿔 보면 어떨까…",
      "걷다 보면 레이아웃이 떠오르더라고요.", "저 화분 색 조합 예쁘네요 🌿", "그리드부터 다시 잡아 봐야지.", "한 바퀴만 더 돌고 갈게요.",
    ],
  };

  /* ───────── 장소 ───────── */
  const P = (x, z) => ({ x, z });
  const MEET_ROOM = ROOMS.meeting || { x0: 8, x1: 19, z0: -15, z1: 0 };
  const inMeetRoom = p => p.x > MEET_ROOM.x0 && p.x < MEET_ROOM.x1 && p.z > MEET_ROOM.z0 && p.z < MEET_ROOM.z1;
  // 본부장 자리: 회의실 2(대표실 쪽) 테이블 상석 의자. 팀원 책상·회의실 1 좌석과 겹치지 않는다(이 의자는 길 찾기 장애물에도 없다)
  const HEAD_SEAT = HAS_DECOR ? P(14, 6.7) : P(11, 4);
  const HEAD_FACE = HAS_DECOR ? P(14, 5) : P(11, 2);
  // 회의실 1 뒤편(창가 쪽) — 발표 중에는 여기서 듣는다
  const MEET_BACK = HAS_DECOR ? [P(16.5, -12.4), P(12, -12.4), P(18, -10.5)] : [P(TABLE.x + 2, TABLE.z - 3)];
  // 디자인팀장 산책 지점(평면에 맞춰 고른 통로·방). 걸을 수 없는 점은 그때그때 거른다
  const WANDER = HAS_DECOR ? [
    P(-11.5, -6.5), P(-4.5, -6.5), P(-4.5, 4.5), P(-11.5, 4.5), P(2.5, -7), P(2.5, 5), P(-17.5, 6.5), P(-4.5, -12.8),
    P(-3, 16), P(3, 15), P(-13, 13.2), P(11, 14), P(16.5, 13), P(-6, -17.5), P(8, -17.5), P(1, -14), P(10.5, 2), P(17, 9.5),
    ...(Decor.LIFE?.walk || []).map(p => P(p.x, p.z)),
  ] : [P(1.8, 7), P(3.2, 4), P(1.8, 1), P(-6, 3), P(-8, 8)];
  const MEET_WANDER = HAS_DECOR ? [P(10.5, -12), P(17.5, -2)] : []; // 회의실 1 은 업무 중이 아닐 때만 들른다
  const FAR = P(9999, 9999); // 회의 자리·커피 자리 없음(atMeet 이 늘 거짓)

  const sleepRaw = ms => new Promise(r => setTimeout(r, ms));
  const nap = ms => sleepRaw(ms / Math.max(1, SPEED));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduce = () => mqReduce.matches;
  const free = p => { try { return walkable(p.x, p.z); } catch { return true; } };
  const teamLooks = () => new Set(D.names.map(n => { try { return appearanceOf(n); } catch { return n; } }));
  const leader = () => (D.leader ? A(D.leader) : null);
  const presenting = () => !!leader()?.presenting; // 팀장이 회의실에서 발표 중
  const statusOf = a => a?.card?.st?.status || "대기";

  /* ───────── NPC 정의 ───────── */
  const DEFS = [
    { key: "design", looks: ["jiyu", "sora", "hana", "min", "doyoon"], start: WANDER[0], speed: 2.1,
      def: { label: "디자인팀장", initial: "디", color: "#e05a8a", hair: "#2c2c3a", role: "디자인팀", model: "", provider: "", leader: false },
      lines: L.design, script: designScript },
    { key: "head", looks: ["taeho", "sungwoo", "seojin", "hyunwoo"], start: HEAD_SEAT, speed: 1.9, seat: HEAD_SEAT, monitorTarget: HEAD_FACE,
      def: { label: "본부장", initial: "본", color: "#b8862e", hair: "#43302a", role: "사업본부", model: "", provider: "", leader: false },
      lines: [...L.quote, ...L.chat], script: headScript },
  ];
  const list = DEFS.map(d => ({ ...d, look: "", agent: null, g: 0 }));

  function pickLook(n) {
    const used = teamLooks(), taken = new Set(list.filter(o => o !== n && o.look).map(o => o.look));
    const all = [...n.looks, ...(window.CharacterLooks?.list || []).map(l => l.id)];
    return all.find(id => !used.has(id) && !taken.has(id) && window.SpriteChars?.has?.(id)) || n.looks[0];
  }
  /** NPC 캐릭터를 (다시) 만든다. 이름은 외형 id 를 그대로 쓴다(Agent 가 그 이름으로 그림 캐릭터를 고른다). */
  function create(n, at) {
    const prev = n.agent, pos = at || (prev ? { x: prev.group.position.x, z: prev.group.position.z } : n.start);
    if (prev) { n.g++; prev.dispose(); }
    n.look = pickLook(n);
    const spot = { seat: n.seat || pos, monitorTarget: n.monitorTarget || null, meet: FAR, coffee: FAR, screen: true, mug: null, tv: null, tv2: null };
    const a = n.agent = new Agent(n.look, n.def, spot);
    a.npc = n.key; a.speed = n.speed;
    a.label.classList.add("npc");
    // 이름표를 누르면 대화창(에이전트 채팅) 대신 그 사람이 한마디 한다
    const tag = a.tag.cloneNode(true);
    tag.setAttribute("aria-label", `${n.def.label} (에이전트 아님)`);
    tag.title = `${n.def.label} — 사무실 사람(업무를 맡지 않아요)`;
    tag.addEventListener("click", () => a.say(pick(n.lines), 4200));
    a.tag.replaceWith(tag); a.tag = tag; a.faceEl = tag.querySelector(".face");
    a.teleport(pos, Math.PI);
    if (n.seat && Math.hypot(pos.x - n.seat.x, pos.z - n.seat.z) < .3) a.sitDesk("sit"); else a.mode = "stand";
    const g = ++n.g;
    Promise.resolve().then(() => n.script(n, a, g)).catch(e => console.warn(`${n.def.label} 연출:`, e));
  }
  const alive = (n, g) => n.g === g;

  /** 걸어서 이동(최대 cap ms). 도착하면 true. 연출이 바뀌었으면(다시 만들기) false */
  async function walk(n, a, g, p, cap = 30000) {
    if (!alive(n, g)) return false;
    if (reduce()) return false;
    // 시간 초과(cap)이거나 걷는 도중 '움직임 줄이기'가 켜지면 목적지로 바로 옮긴다
    let poll = 0;
    const late = new Promise(res => { const t0 = performance.now(); poll = setInterval(() => { if (reduce() || !alive(n, g) || performance.now() - t0 > cap) res("late"); }, 300); });
    const r = await Promise.race([a.walkTo(p), late]);
    clearInterval(poll);
    if (r === "late") a.finishWalk();
    return alive(n, g) && r !== false;
  }
  /** ms 동안 기다린다. stop() 이 참이 되면 일찍 끝낸다. 탭이 숨겨진 동안은 시간을 세지 않는다 */
  async function rest(n, g, ms, stop) {
    let left = ms;
    while (left > 0 && alive(n, g)) {
      if ((stop && stop()) || reduce()) return false;
      await sleepRaw(400);
      if (!document.hidden) left -= 400 * Math.max(1, SPEED);
    }
    return alive(n, g);
  }

  /* ───────── 디자인팀장: 계속 걸어 다닌다 ───────── */
  async function designScript(n, a, g) {
    let prev = null, stops = 0;
    while (alive(n, g)) {
      if (document.hidden || reduce()) { if (a.mode === "walk") a.finishWalk(); await sleepRaw(1500); continue; }
      const pool = [...WANDER, ...(D.running ? [] : MEET_WANDER)].filter(p => p !== prev && free(p) && !(D.running && inMeetRoom(p)));
      const p = pick(pool.length ? pool : WANDER);
      prev = p;
      if (!(await walk(n, a, g, p))) { await sleepRaw(800); continue; }
      a.mode = "stand";
      a.face({ x: p.x + rnd(-3, 3), z: p.z + rnd(-3, 3) });
      if (++stops % 3 === 0 && Math.random() < .5) a.say(pick(L.design), 3600);
      await rest(n, g, rnd(1500, 4500));
    }
  }

  /* ───────── 본부장 ───────── */
  /** 본부장이 찾아갈 수 있는 팀원: 자기 책상에 앉아 있고, 회의·보고·검수·휴식 연출 중이 아닌 사람 */
  function visitable(m) {
    if (!m || m.ghost || m.hidden || m.lifePose || m.presenting) return false;
    if (!(m.mode === "sit" || m.mode === "type") || !m.atDesk()) return false;
    return !["회의", "보고", "검수 중", "휴식"].includes(statusOf(m));
  }
  /** 팀원 자리 옆에 설 곳(책상 반대쪽으로 조금 물러난 옆자리) */
  function besideSpot(m, from) {
    const s = m.seat, mt = m.monitorTarget || { x: s.x, z: s.z - 1 }, dir = Math.sign(s.z - mt.z) || 1;
    const c = [P(s.x + 1.05, s.z + dir * .6), P(s.x - 1.05, s.z + dir * .6), P(s.x + 1.05, s.z + dir * .95), P(s.x - 1.05, s.z + dir * .95), P(s.x, s.z + dir * 1.35)]
      .filter(free).sort((p, q) => Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z));
    return c[0] || P(s.x, s.z + dir * 1.35);
  }
  async function toSeat(n, a, g) {
    if (!(await walk(n, a, g, n.seat))) return false;
    a.sitDesk("sit");
    return true;
  }
  /** 팀장 발표를 회의실 뒤편에서 듣는다 */
  async function listenMeeting(n, a, g) {
    const spot = MEET_BACK.find(free) || MEET_BACK[0];
    if (!(await walk(n, a, g, spot, 20000))) return;
    a.mode = "stand"; a.face(TABLE);
    if (!presenting()) return; // 늦게 도착해 발표가 이미 끝났으면 조용히 다음 행동으로
    if (Math.random() < .5) a.say(pick(L.listen), 2600);
    while (alive(n, g) && presenting()) { a.face(TABLE); await sleepRaw(700); }
    if (!alive(n, g)) return;
    await rest(n, g, 1200);
    a.say(pick(L.afterMeeting), 3600);
    await rest(n, g, 3000);
  }
  async function visit(n, a, g, last) {
    const pool = D.names.map(A).filter(visitable);
    const m = pick(pool.filter(x => x.name !== last).length ? pool.filter(x => x.name !== last) : pool);
    if (!m) return null;
    const name = m.name, still = () => A(name) === m && visitable(m);
    if (!(await walk(n, a, g, besideSpot(m, a.group.position), 25000)) || !still()) return name;
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
      if (reduce()) { // 움직임 줄이기: 걷지 않고 자리에 앉아 있다(가끔 한마디)
        if (a.mode === "walk") a.finishWalk();
        if (!a.atDesk()) a.teleport(n.seat);
        a.sitDesk("sit");
        if (Math.random() < .15) a.say(pick(L.seat), 3600);
        await sleepRaw(6000); continue;
      }
      if (presenting()) { await listenMeeting(n, a, g); continue; }
      const kinds = ["visit", "visit", "visit", "seat", "seat", "meeting", "coffee"].filter(k => k !== prev || k === "visit");
      const kind = pick(kinds); prev = kind;
      if (kind === "visit") {
        const who = await visit(n, a, g, last);
        if (who) last = who; else prev = "";
      } else if (kind === "seat") {
        if (!(await toSeat(n, a, g))) { await sleepRaw(800); continue; }
        await rest(n, g, rnd(5000, 9000), presenting);
        if (Math.random() < .6) a.say(pick(Math.random() < .5 ? L.seat : L.quote), 4600);
        await rest(n, g, rnd(10000, 20000), presenting);
      } else if (kind === "meeting") {
        if (D.running) { prev = ""; await sleepRaw(300); continue; } // 업무 중에는 회의실을 비워 둔다(발표 때만 뒤에서 듣는다)
        const spot = pick(MEET_BACK.filter(free)) || MEET_BACK[0];
        if (!(await walk(n, a, g, spot))) continue;
        a.mode = "stand"; a.face(TABLE);
        a.say(pick(Math.random() < .6 ? L.meeting : L.quote), 4600);
        await rest(n, g, rnd(7000, 11000), presenting);
      } else {
        const cof = HAS_DECOR ? COFFEE[COFFEE.length - 1] : COFFEE[0];
        if (!(await walk(n, a, g, cof))) continue;
        a.mode = "coffee"; a.face(COUNTER);
        a.say(pick(L.coffee), 3800);
        await rest(n, g, rnd(7000, 10000), presenting);
      }
      if (alive(n, g) && a.mode === "talk") a.mode = "stand";
      await rest(n, g, rnd(1200, 2600));
    }
  }

  /* ───────── 매 프레임: 렌더 루프의 declutter() 직전에 움직이고, 이름표 겹침 정리에 끼워 넣는다 ───────── */
  let last = performance.now();
  const base = declutter;
  window.declutter = function (mobile) {
    const now = performance.now(), dt = Math.min(.05, (now - last) / 1000) * SPEED;
    last = now;
    const live = list.map(n => n.agent).filter(a => a && !a.ghost);
    const w = innerWidth, h = innerHeight;
    for (const a of live) { try { a.update(dt); a.placeLabel(w, h); } catch (e) { console.warn("NPC 갱신:", e); } }
    const names = D.names, agents = D.agents, keys = [];
    for (const a of live) { const k = `\u0000npc:${a.npc}`; if (!Object.hasOwn(agents, k)) { agents[k] = a; keys.push(k); } }
    D.names = keys.length ? names.concat(keys) : names;
    try { return base.call(this, mobile); }
    finally { D.names = names; for (const k of keys) delete agents[k]; }
  };

  // 팀원 외형과 겹치면(팀이 바뀌거나 외형을 고른 경우) 다른 사람으로 바꾼다
  setInterval(() => {
    const used = teamLooks();
    for (const n of list) if (n.agent && used.has(n.look)) create(n);
  }, 2000);

  for (const n of list) create(n);
  return { list, create };
})();
