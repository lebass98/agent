"use strict";
/* zoo-life.js — 동물원에서만: 에이전트가 아닌 동물원 식구와 배경 동물.
   - 원장 코끼리(본부장): 전망대 그루터기 자리 · 회의실 · 카페 · 팀원 옆을 오가며 응원·위로·명언. 팀장이 발표하면 회의실 뒤편에서 듣는다.
   - 공작새(디자인팀장): 산책로와 마을을 쉬지 않고 돌아다닌다(가끔 혼잣말).
   - 오리(경리팀장): 가장 말이 많다. 곳곳을 돌며 투덜거리고 지적한다(간식·영수증·법인카드·전기세·업무 비용). 팀원에게 가서 지적하고, 원장님께 결재를 독촉한다.
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
    stage: ["회의실이 조용하네요. 다음 회의엔 좋은 아이디어가 쏟아지겠죠.", "이 화면에 다음 계획이 가득 찼으면 좋겠네요 📈", "좋은 회의는 짧고 굵게! 기억해 둡시다."],
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
  const BACK = [P(-4.4, 2.7), P(4.4, 2.7), P(4.4, -2.4)];        // 회의실 안 뒤편(의자 뒤 구석)
  const WANDER = [P(0, -5.4), P(-4.4, -5.4), P(4.4, -5.4), P(-6.6, -.7), P(6.6, -.3), P(4.4, 4.4), P(2.1, 4.4), P(-4, 4.4), P(0, 6.6), P(0, 9.2),
    P(-11, -7.4), P(11, -7), P(-13.2, -3.2), P(12, 5.8), P(-10, 12.6), P(4.4, 8.2), P(11, 12.6), P(-6.8, 13.4), P(-16, 7.4), P(16.8, -6.4), P(-6, -12.6), P(6.4, -10.8)];
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
    { key: "duck", kind: "duck", start: P(4.4, 8.2), speed: 2.3,
      def: { label: "경리팀장", initial: "🦆", color: "#e08a2a", hair: "#2c2c3a", role: "오리 · 경리팀", model: "", provider: "", leader: false },
      lines: [], script: duckScript },
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
    tag.addEventListener("click", () => a.say(n.key === "duck" ? duckLine(a.group.position) : pick(n.lines), 4200));
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

  /* ───────── 경리팀장 오리: 동물원 곳곳을 돌며 쉬지 않고 투덜거리고 지적한다(가장 말이 많다) ─────────
     말은 묶음(투덜·장소·간식·팀원 지적·업무 비용·혼잣말)에서 고르고, 앞말·끝말·품목·금액을 섞어 매번 다르게 만든다.
     최근 40마디는 다시 쓰지 않는다. */
  const D_ = {
    open: ["아니, ", "하… ", "저기요, ", "잠깐만요, ", "제가 말 안 하려고 했는데, ", "솔직히 말해서, ", "또 저만 신경 쓰죠? ", "어휴, ", "다들 들어 보세요, ", "", "", ""],
    close: ["", "", " 정말이에요.", " 기억하세요.", " 진짜로요.", " 🙄", " 💸", " 📋", " 메모해 둡니다.", " 이번 달만 벌써 세 번째예요.", " 다음엔 없어요."],
    grumble: ["이게 다 돈이에요, 돈.", "요즘 다들 너무 편하게 쓰는 것 같아요.", "예산은 한정돼 있다고 몇 번을 말해요.", "정산하다 하루가 다 가겠네.",
      "결재 올리기 전에 숫자 좀 맞춰 주세요.", "이번 달 마감이 코앞인데 다들 왜 이렇게 여유로워요?", "영수증은 받는 즉시! 사진 찍어서 올리기!", "법인카드는 개인 카드가 아니에요.",
      "비품 신청서는 양식대로 써 주세요. 칸 비우지 말고요.", "제가 잔소리하는 게 아니라 규정이 그래요.", "적자 나면 다 같이 대나무 먹는 거예요.", "엑셀이 또 안 맞아요. 1원이 어디 갔지…",
      "다들 저 보면 도망가는 거 다 알아요.", "제가 없으면 이 동물원 벌써 문 닫았어요.", "결재판 들고 다니는 이유가 다 있어요.", "카드 승인 문자 오면 심장이 철렁해요.",
      "가계부… 아니 장부 다시 맞춰야겠네.", "오늘도 계산기가 제일 친한 친구예요.", "부가세 신고 기간인 거 다들 아시죠?", "출장비 정산 서류 오늘까지예요, 오늘!"],
    snack: ["탕비실 과자가 왜 하루 만에 다 없어져요?", "초코파이 한 상자가 어제 들어왔는데 지금 두 개 남았어요. 두 개!", "간식은 1인 1개! 이거 써 붙여 놔야 하나…",
      "누가 새우깡 봉지를 뜯어 놓고 그냥 갔어요? 눅눅해지잖아요!", "젤리는 비품 목록에 없어요. 근데 왜 젤리 영수증이 있어요?", "아이스크림 냉동고 전기세는 누가 내요? 제가 내요, 제가.",
      "커피믹스 박스가 또 비었네… 하루에 몇 잔씩 마시는 거예요?", "바나나는 원숭이 팀 몫이에요. 다들 손대지 마세요.", "대나무 간식 주문량이 지난달보다 두 배예요. 판다님?",
      "생선 간식 냄새 때문에 민원 들어왔어요. 수달님…", "유자차 티백은 고급이라 아껴 드세요. 한 번에 두 개 넣는 사람 누구예요?", "과자 부스러기 키보드에 떨어지면 수리비 나와요.",
      "간식비 예산이 벌써 85% 썼어요. 이제 15일 남았는데요?", "주말에 간식 사 오는 건 좋은데 영수증은 꼭 주세요.", "회의 다과는 회의한 사람만 드세요. 지나가다 집어 가지 말고요!",
      "편의점 2+1은 좋은데, 1개 더 산 건 누가 먹었어요?", "탕비실 컵라면 개수 세어 놨어요. 저 다 알아요.", "떡볶이 배달은 야근 식대로 안 돼요. 저녁 7시 이후만이에요.",
      "마카롱 한 개에 3,500원이요? 그걸 열 개나요?!", "견과류는 건강에 좋죠. 근데 비싸요. 한 줌씩만!", "간식 사진 단톡방에 올리지 마세요. 다른 팀이 부러워해요… 아니 예산이 새요.",
      "빵 남은 거 버리지 말고 내일 아침에 드세요. 아깝잖아요.", "누가 제 책상 사탕 가져갔어요? 그거 제 사비예요!", "간식 투표하자고요? 투표해도 예산은 그대로예요.",
      "탕비실 냉장고에 이름 안 쓴 요구르트, 오늘 오후 6시에 폐기합니다.", "과자 큰 봉지 사면 싸긴 한데 다들 하루 만에 먹어서 결국 똑같아요.", "단백질 바 박스째로 주문한 사람… 그거 운동용 아니죠?"],
    snackItems: ["초코파이", "새우깡", "젤리", "아이스크림", "커피믹스", "바나나 우유", "마카롱", "컵라면", "떡볶이", "견과류 믹스", "유자차", "도넛", "꿀꽈배기", "감자칩", "요구르트", "약과", "단백질 바"],
    items: ["택시비", "회의 다과", "볼펜 한 다스", "포스트잇", "프린터 토너", "야근 식대", "무선 키보드", "마우스", "화분", "모니터 받침대", "대나무 묶음", "생선 간식", "바나나 한 송이", "유자 열 개", "케이블 정리함"],
    member: [n => `${n}님, ${pick(D_.items)} 영수증 아직 안 냈죠?`, n => `${n}님 이번 달 ${pick(D_.items)} ${won()}… 이거 꼭 필요했어요?`,
      n => `${n}님, 법인카드로 ${pick(D_.snackItems)}은(는) 안 돼요!`, n => `${n}님, 책상 위 ${pick(D_.snackItems)} 그거 비품 아니죠?`,
      n => `${n}님 모니터 두 대 다 켜 놓으면 전기세가… 아시죠?`, n => `${n}님, 지난번 ${pick(D_.snackItems)} ${won()} 영수증만 있고 사진이 없어요.`,
      n => `${n}님 출장비 정산 서류 오늘까지예요.`, n => `${n}님, ${pick(D_.snackItems)} 한 상자 혼자 다 드신 거 아니죠? 장부에 다 나와요.`,
      n => `${n}님 자리 조명 안 끄고 퇴근했더라고요. 어제요.`, n => `${n}님, 회의 다과 ${won()} 나왔어요. 다과가 회의보다 길었어요.`],
    reply: ["아… 내일 낼게요 😅", "그거 업무용이었어요!", "네네, 알겠습니다…", "앗, 깜빡했어요!", "그거 제가 산 거 아닌데요…?", "오늘 안으로 꼭 낼게요!", "다음엔 아껴 쓸게요 🙏"],
    after: ["내일은 꼭이에요. 메모해 둡니다. 📋", "말로만 하지 말고요.", "제가 다 기억하고 있어요.", "좋아요. 믿어 볼게요. 이번 한 번만.", "흠… 일단 넘어가죠."],
    busy: ["AI 호출 한 번에 얼마인지 아세요? 저는 알아요.", "토큰 올라가는 거 보여요? 저는 보여요… 숫자가 춤춰요.", "구독료 본전은 뽑아야죠. 맞아요. 맞는데…",
      "업무 끝나면 사용량 꼭 확인할 거예요.", "이 작업 꼭 오늘 다 해야 돼요? 비용이…", "다들 열심히 하니 보기 좋네요. 근데 야근 식대는 7시 이후만이에요."],
    meeting: ["회의 길어지면 다과비 추가예요.", "회의실 불은 나갈 때 꼭 끄세요.", "발표 자료 출력은 양면으로! 종이값 아끼세요.", "회의는 짧고 굵게! 시간이 다 돈이에요."],
    mutter: ["흠.", "하아…", "이건 좀…", "어디 보자…", "메모, 메모…", "계산이 안 맞는데?", "또야, 또.", "1원… 1원 어디 갔어…", "뭐지 이 영수증은?", "탕비실 다시 가 봐야겠다."],
    toHead: ["원장님, 이번 분기 예산안 결재 좀 해 주세요. 간식비 항목 보시면 놀라실 거예요.", "원장님, 아이스크림 냉동고 한 대 더 사자는 건 반대예요.", "원장님도 법인카드로 커피 드셨죠? 영수증이요."],
    headReply: ["하하, 경리팀장 덕분에 우리 동물원이 굴러가요. 고마워요! 🐘", "알겠어요, 오늘 안으로 볼게요.", "간식은 조금만 봐줘요. 다들 힘내라고…"],
    place: {
      cafe: ["카페 매출보다 우리 팀 커피값이 더 나오겠네.", "음료는 한 사람당 한 잔! 기록할 거예요.", "시럽 추가 500원, 이게 쌓이면 얼마인 줄 알아요?", "매점 재고 조사 또 해야겠네. 젤리가 또 비어요."],
      lake: ["오리배 대여료 정산 안 된 거 누구예요? …저 말고요.", "호수 관리비 청구서 봤어요? 물이 비싸요, 물이.", "연잎 정리 업체 견적이 이게 맞아요?"],
      meeting: ["회의실 에어컨 켜 놓고 나간 사람 누구예요?", "테이블 위 다과 접시, 누가 치울 거예요?", "화면 켜 둔 채로 나가면 전기세가…"],
      lobby: ["입장권 판매 내역 맞춰 봐야 하는데…", "분수 물값이 지난달보다 올랐어요. 분수 줄일까요?", "매표소 거스름돈 통 확인했어요?"],
      picnic: ["돗자리 새로 산 거 영수증 어디 갔어요?", "피크닉 간식은 각자 싸 오기! 회사 돈 아니에요.", "해먹은 비품이에요. 개인 낮잠용 아니에요."],
      polar: ["이글루 냉방비가 왜 이렇게 나와요?!", "얼음 연못 관리비… 펭귄님 이거 아시죠?", "눈 치우는 삽 또 샀어요? 지난달에 샀잖아요."],
      bamboo: ["판다 간식 대나무 주문이 또 늘었네…", "대나무 숲 가지치기 비용 견적서 다시 받아야겠어요.", "대나무는 간식이에요, 주식이에요? 정리해 주세요."],
      jungle: ["야자수 가지치기 견적이 이게 맞아요?", "정글 마을 습도 조절기 전기세가 엄청나요.", "바나나 간식은 일주일에 한 송이! 원숭이님 들으세요."],
      savanna: ["개미탑 보수 공사? 그런 예산 없어요.", "사바나 마을 햇빛 가리개 또 주문하셨어요?", "기린님 목도리 새로 산 거, 그거 피복비로 안 돼요."],
      exec: ["팀장 전망대 망원경 수리비 청구서 봤어요?", "나무집 지붕 보수비… 이게 다 팀장님 거예요.", "전망대에서 보면 다 보여요. 누가 간식 들고 다니는지도요."],
    },
  };
  const recent = [];
  const won = () => `${(Math.round((3000 + Math.random() * 177000) / 100) * 100).toLocaleString("ko-KR")}원`;
  /** 같은 말을 연달아 하지 않게 최근 40마디를 피해서 고른다 */
  function fresh(make, tries = 8) {
    let s = "";
    for (let i = 0; i < tries; i++) { s = make(); if (!recent.includes(s)) break; }
    recent.push(s); if (recent.length > 40) recent.shift();
    return s;
  }
  const wrap = body => `${pick(D_.open)}${body}${pick(D_.close)}`.replace(/\s+$/, "");
  const nearZone = p => { let best = null, d = 1e9; for (const z of Z.zones || []) { const e = Math.hypot(p.x - z.x, p.z - z.z) - z.r; if (e < d) { d = e; best = z.id; } } return d < 2 ? best : null; };
  const placeKey = id => ({ cafe: "cafe", lake: "lake", meeting: "meeting", lobby: "lobby", picnic: "picnic", polar: "polar", bamboo: "bamboo", jungle: "jungle", savanna: "savanna", exec: "exec" })[id];
  /** 지금 상황에 맞는 한마디: 간식 이야기가 가장 잦다 */
  function duckLine(at) {
    const key = placeKey(nearZone(at)), r = Math.random();
    if (D.running && r < .22) return fresh(() => wrap(pick(D_.busy)));
    if (key && r < .4) return fresh(() => wrap(pick(D_.place[key])));
    if (r < .85) return fresh(() => Math.random() < .3 ? wrap(`${pick(D_.snackItems)} 이번 주에만 ${won()}어치 나갔어요.`) : wrap(pick(D_.snack)));
    return fresh(() => wrap(pick(D_.grumble)));
  }
  const CAFE_SPOT = Z.CAFE || P(4.5, 10.4);
  const DUCK_SPOTS = [...WANDER, P(CAFE_SPOT.x - 2.4, CAFE_SPOT.z - .8), P(CAFE_SPOT.x + 2.4, CAFE_SPOT.z - .8), P(0, 4.4), P(-6.6, .3), P(6.6, .3), P(11.6, 1.4), P(-9, 10.4), P(0, 13.6)];
  async function duckScript(n, a, g) {
    let prev = null, last = "", talk = 0;
    const say = (text, ms = 3600) => { if (alive(n, g)) a.say(text, ms); };
    // 걷는 동안에도 투덜투덜(혼잣말)
    const chatter = setInterval(() => {
      if (!alive(n, g)) return clearInterval(chatter);
      if (document.hidden || reduce() || a.mode !== "walk" || Math.random() > .8) return;
      if (Math.random() < .3) say(fresh(() => pick(D_.mutter)), 2200); else say(duckLine(a.group.position), 3400);
    }, 3300);
    while (alive(n, g)) {
      if (document.hidden) { await sleepRaw(1500); continue; }
      if (reduce()) { if (a.mode === "walk") a.finishWalk(); say(duckLine(a.group.position), 4200); await sleepRaw(7000); continue; }
      if (presenting() && Math.random() < .6) { // 회의 중: 회의실 문 앞에서 비용 잔소리
        if (await walk(n, a, g, P(0, 4.6), 25000)) { a.mode = "stand"; a.face(TABLE); say(fresh(() => wrap(pick(D_.meeting))), 4200); }
        await rest(n, g, 6500); continue;
      }
      const roll = Math.random();
      const pool = D.names.map(A).filter(m => m && !m.ghost && !m.hidden && m.name !== last);
      const head = list.find(o => o.key === "elephant")?.agent;
      if (roll < .38 && pool.length) {                       // 팀원에게 가서 지적
        const m = pick(pool); last = m.name;
        if (!(await walk(n, a, g, besideSpot(m, a.group.position), 30000))) { await sleepRaw(600); continue; }
        a.face(m.group.position); a.mode = "talk";
        say(fresh(() => wrap(pick(D_.member)(m.def.label))), 4800);
        await rest(n, g, 4200);
        if (Math.random() < .7 && A(m.name) === m) { m.say(pick(D_.reply), 2600); await rest(n, g, 2600); say(pick(D_.after), 3000); await rest(n, g, 2800); }
        a.mode = "stand";
      } else if (roll < .46 && head && !head.ghost) {        // 원장님께 결재 독촉
        if (!(await walk(n, a, g, besideSpot(head, a.group.position), 30000))) { await sleepRaw(600); continue; }
        a.face(head.group.position); a.mode = "talk"; say(pick(D_.toHead), 5000); await rest(n, g, 4600);
        head.say(pick(D_.headReply), 3800); await rest(n, g, 3600); say(pick(D_.after), 3000); await rest(n, g, 2600);
        a.mode = "stand";
      } else {                                              // 여기저기 둘러보며 투덜
        const choices = DUCK_SPOTS.filter(p => p !== prev && free(p) && !(D.running && inStage(p)));
        const p = pick(choices.length ? choices : WANDER); prev = p;
        if (!(await walk(n, a, g, p))) { await sleepRaw(700); continue; }
        a.mode = "stand"; a.face({ x: p.x + rnd(-3, 3), z: p.z + rnd(-3, 3) });
        say(duckLine(p), 4200);
        if (++talk % 2 === 0) { await rest(n, g, 3600); say(duckLine(p), 4000); }
        await rest(n, g, rnd(2200, 4200));
      }
    }
    clearInterval(chatter);
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
