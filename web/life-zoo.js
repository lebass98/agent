"use strict";
/* life-zoo.js — 동물원 테마의 조연 '내용'(움직임·대화 방식은 공통 엔진 life.js). theme-kit.js 규격의 조연 3·손님 3·배경 생물을 동물 모양으로 채운다.
   - 조연: 판다(디자인팀장) · 코끼리(본부장 — 동물원 원장) · 오리(경리팀장). 모양은 zoo-animals.js 의 extras
   - 손님: 치이카와 친구 3종(zoo-friends.js). 팀원이 같은 친구를 고르면 남는 친구로 바뀐다
   - 말투: '원장님'·'동물원', 구역(Decor.NPC.zones)별 경리팀장 잔소리, 동물원 잡담
   - 배경 생물: 호수 오리·하늘을 도는 새·미어캣·펭귄·나비 */
(function () {
  const kit = window.ThemeKit;

  /* 아기 펭귄 '이든'(4살 남자아이, 말 많고 말을 아주 잘한다)의 말. 말풍선은 이름표(chickTag) 위. talk 는 life.js 의 대화 도구(TALK_KIT) */
  const EDEN = {
    mom: [["엄마! 엄마! 이거 봐봐!", "show"], ["엄마, 나 배고파… 물고기 먹고 싶어 🐟", "hungry"], ["엄마 왜 하늘은 파래?", "why"], ["엄마 나 업어 줘~", "hug"],
      ["엄마 이거 무슨 색이야?", "why"], ["엄마 나 이만큼 컸어! 🙌", "show"], ["엄마, 오리 아저씨가 또 화났어", "tell"], ["엄마 사랑해! 💙", "love"],
      ["엄마 나 쉬 마려…", "potty"], ["엄마 저기 코끼리 할아버지 있다!", "tell"], ["엄마 나도 그림 그릴래! 🖍️", "show"], ["엄마 언제 집에 가?", "why"],
      ["엄마 나 졸려…", "sleepy"], ["엄마 이거 내가 찾았다! 조개껍데기!", "show"], ["엄마 왜? 왜애?", "why"], ["엄마 나 혼자 걸을 수 있어!", "show"],
      ["엄마 뽀뽀! 😚", "love"], ["엄마, 내가 엄마 도와줄게!", "love"], ["엄마 나 네 살이지? 손가락 네 개! ✋", "show"], ["엄마 다리 아파… 안아 줘", "hug"],
      ["엄마, 수달 삼촌은 왜 물에서 살아?", "why"], ["엄마 나 오늘 착했지?", "love"], ["엄마! 새가 날아가! 🐦", "tell"], ["엄마 아이스크림 사 줘 🍦", "hungry"],
      ["엄마, 내가 생각해 봤는데… 펭귄은 날개가 있는데 왜 못 날아? 혹시 너무 귀여워서 그래?", "why"],
      ["엄마 있잖아, 아까 수달 삼촌이 조개를 돌로 깼거든? 그거 진짜 대단한 기술이야!", "tell"],
      ["엄마, 나 커서 뭐 될지 정했어. 디자인과장 할 거야! 엄마처럼! 근데 과장이 뭐야?", "love"],
      ["엄마 엄마, 공룡이랑 펭귄이랑 친척이래! 그러니까 나도 공룡이야. 크앙! 🦖", "show"],
      ["엄마, 오늘 내가 걸은 거 다 합치면 백 걸음, 아니 천 걸음은 될걸?", "show"],
      ["엄마, 나 형아 되면 동생한테 물고기 잡는 법 알려 줄 거야. 내가 제일 잘 가르쳐!", "love"],
      ["엄마, 비밀인데… 오리 아저씨 사실 착한 것 같아. 아까 나 보고 웃었어!", "tell"],
      ["엄마, 하늘에 구름이 왜 움직이는지 알아? 바람이 밀어서야! 내가 알아냈어!", "show"],
      ["엄마, 나 오늘 하나도 안 울었다? 넘어졌는데도 안 울었어. 나 남자니까!", "show"],
      ["엄마, 물고기는 물속에서 어떻게 숨 쉬어? 빨대 있어?", "why"],
      ["엄마 이거 봐, 내가 날개로 박수 칠 수 있어! 짝짝짝! 👏", "show"],
      ["엄마, 나 배고픈 거 아닌데… 그냥 물고기가 보고 싶어서 그래. 진짜야. 🐟", "hungry"]],
    solo: ["하나, 둘, 셋, 넷! 나 네 살! ✋", "뒤뚱뒤뚱~ 펭귄 걸음 연습 중!", "나는 세상에서 제일 빠른 펭귄이다! 슝~", "어? 저기 나비다! 나비야 기다려!",
      "오늘은 기분이 좋아서 노래를 부를 거야. 펭귄은 뒤뚱~ 이든이는 씩씩~ 🎵", "이 돌멩이는 내 보물 1호야. 아무도 못 줘!", "내가 크면 바다 끝까지 수영해서 갈 거야!",
      "음… 지금 몇 시지? 간식 시간인 것 같은데?", "나는 용감한 펭귄 기사 이든! 엄마를 지킨다! ⚔️", "공룡은 몇 살까지 살아? 백 살? 나는 네 살!"],
    momBusy: ["엄마 아직 일해?", "엄마 언제 끝나…?", "엄마 나 조용히 있을게… 쉿 🤫", "엄마 화이팅! 💪", "엄마 그거 내가 색칠해 줄까?", "엄마… 심심해…"],
    momRe: {
      show: ["우와, 우리 이든이 최고! 👏", "어머, 진짜 잘했네!", "그랬어? 엄마한테 더 보여 줘~"],
      hungry: ["이따 맛있는 물고기 먹자 🐟", "조금만 참자~ 엄마 일 끝나면 간식!", "배고팠구나. 엄마가 금방 챙겨 줄게."],
      why: ["음… 그건 같이 찾아보자!", "우리 이든이는 궁금한 게 많네 ㅎㅎ", "그건 말이지… 이따 그림책 보면서 알려 줄게."],
      hug: ["이리 와, 엄마가 안아 줄게 🤗", "조금만 더 걸어 보자. 이든이 씩씩하잖아!"],
      tell: ["그래? 엄마한테 알려 줘서 고마워~", "어머, 그랬구나!", "오리 아저씨는 원래 그래. 무서운 분 아니야 ㅎㅎ"],
      love: ["엄마도 이든이 사랑해 💙", "우리 이든이 제일 착해!", "고마워, 우리 아기 😚"],
      potty: ["어머, 얼른 화장실 가자! 🚻", "조금만 참아! 엄마랑 같이 가자."],
      sleepy: ["엄마 옆에서 조금 쉬자~", "졸리구나. 엄마 품에서 코~ 자자."],
      busy: ["엄마 지금 일하는 중이야. 조금만 기다려 줄래?", "착하다 우리 이든이. 금방 끝낼게!", "이든아, 엄마 옆에서 그림 그리고 있을래?"],
      hush: ["이든아, 어른들 얘기할 땐 기다려야지~", "ㅎㅎ 우리 이든이 끼고 싶구나?"],
    },
    to: {
      team: ["{n}! 나랑 놀자!", "{n}, 안녕! 👋 나 이든이야!", "{n}은 뭐 하는 사람이야?", "{n}, 꼬리 만져 봐도 돼?", "{n}! 이거 봐, 나 뛸 수 있어!", "{n}, 우리 엄마 알아? 디자인과장이야!"],
      duck: ["{n}! 왜 맨날 화나 있어?", "{n}, 과자 하나만~ 🍪", "{n} 안경 멋지다!", "{n}, 그 종이에 뭐 써 있어?"],
      head: ["{n}! 코로 물 뿌려 줘!", "{n} 키 진짜 크다!", "{n}, 나 업어 줄 수 있어?"],
      design: ["{n}! 그림 그려 줘!", "{n}, 나 색칠 잘해!", "{n}, 이 색 예뻐? 🖍️"],
    },
    re: {
      team: ["이든이 안녕~ 😊", "우와, 이든이 많이 컸네!", "이든아, 엄마 옆에 있어야지~", "하이파이브! ✋", "이든이 귀엽다 ㅎㅎ", "그래, 이따 같이 놀자!", "오, 진짜 잘 뛰는데?"],
      teamBusy: ["이든아, 지금 일하는 중이야. 이따 놀자!", "조금만 기다려 줘~ 금방 끝나!"],
      duck: ["…이든이니? 과자는 하나만이야.", "아저씨 화 안 났어. 원래 이런 얼굴이야.", "이든아 뛰지 마. 넘어지면 병원비 나와.", "흠… 착하네. 사탕 하나 줄게. 비밀이야. 🍬", "이건 장부야. 어른 되면 알려 줄게."],
      head: ["허허, 우리 이든이 왔구나!", "할아버지가 나중에 물 뿌려 줄게~", "이든이가 우리 동물원 막내지요. 허허", "그래그래, 씩씩하게 크렴."],
      design: ["이든아, 이모가 그림 그려 줄게 🎨", "와, 이든이 색칠 솜씨 좋은데?", "이든이 오늘 귀여움 200%!", "그 색 예쁘다~ 엄마 닮았네!"],
    },
    after: ["헤헤 😆", "약속이야! 🤙 손가락 걸고 도장도 찍어!", "응! 그럼 나 기다릴게!", "와아~! 역시 그럴 줄 알았어!", "진짜? 진짜? 거짓말 아니지?", "좋아좋아! 그럼 그다음엔 뭐 해?",
      "그치? 내 말이 맞지? 😎", "알겠어! 근데 하나만 더 물어봐도 돼?"],
    hear: {
      snack: ["나도! 나도 간식 줘! 🍪", "엄마 나도 그거 먹을래!", "과자? 과자 어딨어?"], money: ["돈이 뭐야? 먹는 거야?", "영수증이 뭐야?"],
      cheer: ["나도 화이팅! 💪", "이든이도 잘했어?"], quote: ["무슨 말이야? 어려워…", "나도 그거 알아! …근데 뭐야?"],
      design: ["나도 그림 그릴 수 있어! 🖍️", "그 색 나도 좋아!"], work: ["일 말고 놀자~", "다들 일만 해… 심심해."],
      weather: ["밖에 나가서 놀자!", "구름이 토끼 모양이다!"], greet: ["안녕하세요! 👋 나 이든이야!", "안녕! 안녕!"],
      any: ["왜? 왜애? 그건 왜 그런 거야?", "그게 뭐야? 나도 알려 줘!", "나도! 나도! 나도 끼워 줘!", "헤헤, 재밌다! 또 해 줘!", "아~ 나 그거 알아. 그러니까 그게… 음… 뭐였더라?"],
    },
  };
  const ANIMAL_KO = { fox: "여우", panda: "판다", otter: "수달", penguin: "펭귄", elephant: "코끼리", duck: "오리", peacock: "공작", rabbit: "토끼", bear: "곰",
    cat: "고양이", dog: "강아지", lion: "사자", tiger: "호랑이", koala: "코알라", monkey: "원숭이", giraffe: "기린", meerkat: "미어캣", owl: "부엉이", raccoon: "너구리", hamster: "햄스터" };
  /** 이든이의 말 걸기·대답·끼어들기. 말풍선은 tag 의 .bubble 에 띄운다 */
  function chickEden(chick, tag, talk, me) {
    const bubble = tag.querySelector(".bubble"), pick = a => a[Math.floor(Math.random() * a.length)];
    const SP = () => Math.max(1, typeof SPEED === "number" ? SPEED : 1);
    const used = [];
    const fresh = arr => { let x = pick(arr); for (let i = 0; i < 6 && used.includes(x); i++) x = pick(arr); used.push(x); if (used.length > 16) used.shift(); return x; };
    let bt = 0, lastSay = 0, z = 50;
    const say = (text, ms = 3200) => {
      ms = Math.max(ms, 1200 + text.length * 85); // 긴 말은 오래 보인다
      bubble.textContent = text; bubble.style.translate = ""; bubble.classList.add("show"); tag.style.zIndex = String(9000 + (++z % 500)); lastSay = performance.now(); if (me) me.lastSay = lastSay;
      clearTimeout(bt); bt = setTimeout(() => { bubble.classList.remove("show", "covered"); bubble.style.translate = ""; }, ms / SP());
    };
    const later = (ms, f) => setTimeout(f, ms / SP());
    const mom = () => { try { const m = A("gpt"); return m && !m.ghost && !m.hidden && m.rig?.group.userData.kind === "penguin" ? m : null; } catch { return null; } };
    const pos = () => chick.group.position;
    const gapTo = a => Math.hypot(a.group.position.x - pos().x, a.group.position.z - pos().z);
    const kindOf = a => a.rig?.group.userData.kind || a.def?.kind || a.name;
    const callName = a => {
      const who = talk.persona(a), ko = ANIMAL_KO[kindOf(a)];
      if (!ko) return talk.label(a);
      if (who === "head") return `${ko} 할아버지`;
      if (who === "duck") return `${ko} 아저씨`;
      return `${ko} ${[...a.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 2 ? "이모" : "삼촌"}`;
    };
    const momSay = (m, text) => { if (["stand", "talk", "coffee"].includes(m.mode)) m.face(pos()); talk.hush(() => m.say(text, 3200)); };
    const ready = () => chick.group.visible && !talk.busy();
    const others = () => (talk.talkersNear ? talk.talkersNear(pos()) - (bubble.classList.contains("show") ? 1 : 0) : 0); // 이든 말고 근처에서 말하는 수
    const roomy = () => !talk.crowdAt || talk.crowdAt(pos(), mom(), 3.2) <= 2; // 엄마 빼고 둘 넘게 모여 있으면 조용히
    // 엄마에게 말 걸기 → 엄마 대답 → 가끔 이든이 한마디 더
    function toMom() {
      const m = mom(); if (!m) return false;
      const busy = talk.working(m);
      if (busy) { say(fresh(EDEN.momBusy)); if (Math.random() < .6) later(1600, () => ready() && momSay(m, fresh(EDEN.momRe.busy))); return true; }
      const [line, kind] = fresh(EDEN.mom); say(line);
      talk.hold(m, 5200);
      later(1500 + Math.random() * 600, () => {
        if (!ready()) return;
        momSay(m, fresh(EDEN.momRe[kind] || EDEN.momRe.show));
        if (Math.random() < .7) later(1900, () => ready() && say(fresh(EDEN.after), 2400));
      });
      return true;
    }
    // 근처 팀원·조연에게 말 걸기 → 그 캐릭터 말투로 대답
    function toOthers() {
      const m = mom();
      const near = talk.everyone().filter(a => a !== m && gapTo(a) < 4.5 && !talk.engaged(a) && !a.presenting);
      if (!near.length) return false;
      const to = pick(near), who = talk.persona(to), busy = talk.working(to);
      say(fresh(EDEN.to[who] || EDEN.to.team).replace("{n}", callName(to)));
      talk.hold(to, 5000);
      later(1500 + Math.random() * 700, () => {
        if (!ready() || !to.group || to.ghost) return;
        if (["stand", "talk", "coffee"].includes(to.mode)) to.face(pos());
        talk.hush(() => to.say(fresh(busy ? EDEN.re.teamBusy : EDEN.re[who] || EDEN.re.team), 3200));
        if (Math.random() < .7) later(1900, () => ready() && say(fresh(EDEN.after), 2400));
      });
      return true;
    }
    // 평소: 말이 많다 — 5~9초마다 말을 건다(엄마 6 : 다른 이 3 : 혼잣말 1)
    let next = performance.now() + 3000;
    setInterval(() => {
      const now = performance.now();
      if (now < next || !ready() || !mom()) return;
      if (others() > 0 || !roomy()) { next = now + 2500; return; } // 옆에서 누가 말하는 중이거나 붐비면 조금 뒤에
      next = now + (5000 + Math.random() * 4000) / SP();
      const r = Math.random();
      if (r < .1) { say(fresh(EDEN.solo), 3400); return; }
      if (r < .4 && toOthers()) return;
      toMom();
    }, 1000);
    // 근처에서 누가 말하면 가끔 끼어든다(엄마가 가끔 타이른다)
    talk.ear((sp, text) => {
      if (!ready() || sp === undefined || performance.now() - lastSay < 3000 || talk.skipLine(text) || gapTo(sp) > 6 || Math.random() > .55 || others() > 1 || !roomy()) return;
      later(1300 + Math.random() * 700, () => {
        if (!ready() || others() > 1) return;
        say(fresh(EDEN.hear[talk.topic(text)] || EDEN.hear.any), 2800);
        const m = mom();
        if (m && m !== sp && !talk.working(m) && gapTo(m) < 4 && Math.random() < .4) later(1700, () => ready() && momSay(m, fresh(EDEN.momRe.hush)));
      });
    });
    return { say };
  }
  if (!kit) return;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const won = () => `${(Math.round((3000 + Math.random() * 177000) / 100) * 100).toLocaleString("ko-KR")}원`;
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
    design: ["음… 저 연못 곡선, 레이아웃에 쓰고 싶다.", "이 노을 색감, 좋다 👀", "흑백 대비에서 영감이 오네요 🐼", "다음 시안은 이 초록 톤으로 가 볼까?",
      "걷다 보면 레이아웃이 떠오르더라고요.", "표지판 글꼴, 조금만 더 둥글면 좋겠는데.", "한 바퀴만 더 돌고 갈게요."],
  };

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
  const RE = {
    snack: { team: [s => `${s}님, 그거 저도 하나만요! 🍪`, "간식 얘기 나오니까 배고파지네요.", "탕비실 초코파이 아직 남았나요?", "커피 한 잔 같이 하실래요? ☕", "그 과자 맛있죠! 저도 좋아해요.", "오늘 간식 당번 누구예요?"],
      duck: ["간식이요? 지금 간식이라고 했어요?", "그 간식, 영수증은 있죠?", "하나만 드세요. 하나만.", "간식비 예산 얘기 또 해야 해요?", "아니 그걸 또 사 오셨어요?"],
      head: ["간식은 내가 쏠게요! 경리팀장한텐 비밀이에요 🤫", "맛있게 먹고 힘내요. 그게 남는 거예요.", "허허, 나도 하나 줘 봐요."],
      design: ["포장 디자인이 예쁘네요, 그 과자.", "간식 색감 조합이 좋은데요? 🎨", "그 젤리 색 시안에 써먹어야겠다."] },
    money: { team: ["앗, 영수증… 오늘 꼭 낼게요 😅", "네네, 아껴 쓸게요!", "그거 업무용이었어요, 진짜로요!", "경리팀장님 무섭다… 🙈", "정산 서류 지금 바로 할게요."],
      duck: ["그러니까요. 다들 숫자 좀 보세요.", "제 말이 그 말이에요!", "드디어 말이 통하네요. 메모해 둡니다. 📋"],
      head: ["허허, 경리팀장 덕분에 우리가 굴러가요.", "알뜰하게 쓰는 건 좋은 습관이죠.", "그래도 너무 아끼다 사기 떨어지면 안 돼요~"],
      design: ["좋은 디자인엔 돈이 좀 들어요… 아시죠?", "예산 얘기는 무섭네요. 전 이만…"] },
    cheer: { team: ["감사합니다! 힘이 나요 💪", "덕분에 오늘도 잘 버텨요!", s => `${s}님도 화이팅이에요!`, "좋은 말씀 고마워요 😊"],
      duck: ["응원은 공짜라서 좋네요.", "힘내는 건 좋은데 야근 식대는 7시 이후만이에요.", "흠, 칭찬은 예산이 안 들죠."],
      head: ["그럼요! 우리 팀 최고예요 👍", "다 같이 하니까 되는 거예요.", "허허, 나까지 힘이 나네."],
      design: ["오늘 분위기 좋네요 ✨", "그 말 들으니 아이디어가 막 떠올라요."] },
    quote: { team: ["오… 그 말 메모해 둘게요.", "명언 들으니 마음이 정리돼요.", "원장님 명언 모음집 내셔도 되겠어요!"],
      duck: ["명언도 좋지만 정산이 먼저예요.", "그 명언, 혹시 책값 법인카드로 사셨어요?"],
      head: ["좋은 말은 나눌수록 좋지요.", "허허, 내가 하려던 말이에요."],
      design: ["그 문장, 타이포로 만들면 예쁘겠다."] },
    design: { team: ["오, 새 시안 기대돼요!", "저도 그 색 좋아요.", "디자인팀장님 감각은 역시…"],
      duck: ["디자인 좋죠. 근데 인쇄비 견적 먼저 주세요.", "그 시안, 몇 번째 수정이에요?"],
      head: ["우리 디자인팀장 안목은 믿을 만하지요.", "예쁘게만 하지 말고 쓰기 편하게도요~"],
      design: ["그쵸? 저도 그 생각했어요!", "여백 하나만 더 주면 완벽해요."] },
    work: { team: ["저도 하던 거 마저 해야겠어요.", "마감 전에 꼭 끝낼게요!", "같이 보면 금방 끝나요.", "보고서는 제가 정리해 둘게요."],
      duck: ["업무는 좋은데 비용은 줄여 주세요.", "그 업무, 견적서 있어요?"],
      head: ["무리하지 말고 쉬엄쉬엄 해요.", "막히면 언제든 얘기해요."],
      design: ["업무 화면 레이아웃 제가 좀 다듬어 볼까요?"] },
    weather: { team: ["오늘 날씨 진짜 좋네요 ☀️", "호수 쪽 바람 시원하더라고요.", "이런 날은 피크닉 가고 싶어요."],
      duck: ["날씨 좋다고 냉방 세게 틀면 안 돼요.", "햇빛 좋네요. 전기세 아끼게 불 꺼요."],
      head: ["이런 날은 산책이 최고지요.", "날씨처럼 다들 맑은 하루 보내요."],
      design: ["노을 색감 보셨어요? 그대로 팔레트로 쓰고 싶어요."] },
    greet: { team: [s => `${s}님 안녕하세요! 😊`, "좋은 아침이에요!", "오늘도 잘 부탁드려요~"],
      duck: ["안녕하세요. 영수증 가져오셨죠?", "아, 마침 잘 만났네요."],
      head: ["어서 와요, 반가워요!", "다들 좋은 아침이에요 ☀️"],
      design: ["안녕하세요~ 오늘 옷 색 예쁘네요!"] },
    any: { team: ["그러게요 ㅎㅎ", "맞아요, 저도 그 생각했어요.", "오 진짜요?", "하하, 그렇네요.", "음… 일리 있네요.", "그거 재밌는데요?"],
      duck: ["흠, 그건 그렇고 영수증이요.", "네네, 알겠고요.", "그 얘기는 결재 받고 하세요.", "하… 다들 왜 이렇게 태평해요."],
      head: ["허허, 그렇지요.", "좋은 얘기네요.", "다들 오늘도 수고 많아요."],
      design: ["오, 그거 재밌다.", "흠… 영감이 오네요.", "그쵸~"] },
    ack: { team: ["ㅋㅋ 맞아요", "그쵸?", "알겠어요~", "좋아요!", "헤헤"], duck: ["흠.", "알면 됐어요.", "메모했어요. 📋", "다음엔 없어요."], head: ["허허", "그래요, 그래요.", "좋지요."], design: ["그쵸~", "좋다 좋다", "✨"] },
  };
  const TALKS = [
    ["오늘 점심 뭐 드셨어요?", "카페에서 샌드위치요. 맛있던데요?", "오, 저도 내일 먹어 봐야겠다.", "같이 가요!"],
    ["요즘 날씨 정말 좋지 않아요?", "그러게요. 호수 산책하기 딱이에요.", "이따 같이 한 바퀴 돌아요."],
    ["탕비실에 새 과자 들어왔대요!", "진짜요? 무슨 과자요?", "초코파이랑 젤리요. 빨리 가야 해요 🏃", "경리팀장님 오시기 전에요!"],
    ["주말에 뭐 하셨어요?", "숲에 캠핑 다녀왔어요. 모닥불이 최고였어요 🔥", "와, 부럽다…"],
    ["아까 회의 어땠어요?", "팀장님 발표 깔끔했어요.", "그쵸? 계획이 딱 정리되더라고요."],
    ["열기구 보셨어요? 숲 위로 떠다니던데요.", "봤어요! 언젠가 타 보고 싶어요 🎈", "동물원 단합 행사로 건의해 볼까요?"],
    ["커피 한 잔 하실래요? ☕", "좋죠! 아이스로요.", "가는 김에 간식도 하나…", "영수증은 꼭 챙겨요 ㅋㅋ"],
    ["요즘 일 많죠? 힘내요 💪", "고마워요. 덕분에 버텨요.", "끝나면 맛있는 거 먹으러 가요!"],
    ["어제 연못에 오리 가족 봤어요?", "봤어요! 너무 귀엽더라고요.", "경리팀장님 친척일까요? ㅋㅋ"],
    ["이번 작업 어디까지 했어요?", "거의 다 했어요. 검수만 남았어요.", "오, 빠르네요!"],
  ];
  const FRIENDS = ["usagi", "chiikawa", "hachiware"];
  (kit.life ||= {}).zoo = {
    words: { head: "원장님", org: "동물원" },
    npcs: [
      { key: "design", kind: "panda", speed: 2.1, def: { label: "디자인팀장", initial: "🐼", color: "#3c8781", hair: "#2c2c3a", role: "판다 · 디자인팀" } },
      { key: "head", kind: "elephant", speed: 1.8, def: { label: "본부장", initial: "🐘", color: "#8a8f99", hair: "#43302a", role: "코끼리 · 동물원 원장" } },
      { key: "duck", kind: "duck", speed: 2.3, def: { label: "경리팀장", initial: "🦆", color: "#e08a2a", hair: "#2c2c3a", role: "오리 · 경리팀" } },
    ],
    guests: FRIENDS.map(kind => ({ kind, alt: FRIENDS, scale: .85, speed: 1.05 })),
    lines: L,
    duck: { ...D_, place: D_.place },
    replies: RE,
    talks: TALKS,
    ambient(scene, T, talk) {
      const Z = window.ZooTheme;
      if (!Z) return null;
      const critters = new T.Group(); critters.name = "zoo-critters"; scene.add(critters);
      const mats = new Map(), M = c => mats.get(c) || (mats.set(c, new T.MeshStandardMaterial({ color: c, roughness: .8 })), mats.get(c));
      const sphere = new T.SphereGeometry(1, 12, 9), cone = new T.ConeGeometry(1, 1, 8);
      const part = (p, geo, c, x, y, z, sx, sy = sx, sz = sx) => { const m = new T.Mesh(geo, M(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; p.add(m); return m; };
      const L0 = Z.LAKE, K = Z.S || 1; // K: 동물원 땅 넓이 배율(zoo-theme.js)
      // 오리: 호수 위를 천천히 돈다
      const ducks = Array.from({ length: 4 }, (_, i) => {
        const g = new T.Group(); critters.add(g);
        part(g, sphere, i ? 0xf5f1e6 : 0x4f7a54, 0, .22, 0, .26, .18, .34); const head = part(g, sphere, i ? 0xf5f1e6 : 0x2f6b4c, 0, .45, .24, .14);
        part(g, cone, 0xf0a63a, 0, .44, .4, .05, .14, .05).rotation.x = Math.PI / 2; part(g, sphere, 0x1d1d1d, .07, .5, .33, .025); part(g, sphere, 0x1d1d1d, -.07, .5, .33, .025);
        if (!i) head.scale.setScalar(.15);
        return { g, r: (1.6 + i * .55) * K, a: i * 1.6, w: (.18 + i * .03) / K };
      });
      // 새: 하늘을 크게 돈다(날갯짓)
      const birds = Array.from({ length: 6 }, (_, i) => {
        const g = new T.Group(); critters.add(g);
        part(g, sphere, 0x3b4a5a, 0, 0, 0, .14, .1, .28);
        const wing = s => { const w = new T.Mesh(new T.PlaneGeometry(.55, .2), new T.MeshStandardMaterial({ color: 0x506273, side: T.DoubleSide })); w.position.set(s * .3, 0, 0); g.add(w); return w; };
        return { g, wings: [wing(1), wing(-1)], r: (9 + i * 2.2) * K, a: i * 1.1, y: 7 + (i % 3) * 1.2, w: .12 + (i % 2) * .05, dir: i % 2 ? 1 : -1 };
      });
      // 미어캣·펭귄·나비: 팀원 동물 모델을 작게 줄여 쓴다(zoo-animals.js 가 있을 때)
      const mini = (kind, x, z, s) => {
        if (!window.ZooAnimals?.build) return null;
        try { const rig = window.ZooAnimals.build(kind, `mini-${kind}`); rig.group.scale.setScalar(s); rig.group.position.set(x, 0, z); critters.add(rig.group); return rig; } catch { return null; }
      };
      const meerkats = [[14.6, 12.2], [15.4, 12.6], [16.2, 12.1], [14.9, 13]].map(([x, z]) => [x + 14.6 * (K - 1), z + 12.2 * (K - 1)]).map(([x, z], i) => ({ rig: mini("meerkat", x, z, .38), base: z, t: i * 1.7 })).filter(m => m.rig);
      const penguins = [[-15.2, -6.6], [-14.2, -6.2], [-7.2, -6.4]].map(([x, z], i) => [i === 2 ? x * K : x + -15.2 * (K - 1), z * K]).map(([x, z], i) => ({ rig: mini("penguin", x, z, .42), x0: x, z, t: i * 2.1, span: i === 2 ? .9 : 1.4 })).filter(p => p.rig);
      const flyers = Array.from({ length: 8 }, (_, i) => {
        const g = new T.Group(); critters.add(g);
        const c = [0xf2b84b, 0xe58fa5, 0xb59ce0, 0xffffff][i % 4];
        const w = s => { const m = new T.Mesh(new T.PlaneGeometry(.16, .12), new T.MeshStandardMaterial({ color: c, side: T.DoubleSide })); m.position.x = s * .08; g.add(m); return m; };
        return { g, wings: [w(1), w(-1)], cx: -11 * K + (i % 4) * 1.6, cz: 10 * K + Math.floor(i / 4) * 1.8, t: i * .9 };
      });
      // 팀원 ID를 매번 조회해 재배치·외형 교체 이후에도 같은 에이전트를 따라간다.
      const chick = mini("penguin", 0, 0, .32);
      let chickReady = false, chickRoute = [], replan = 0;
      if (chick) {
        chick.group.name = "gpt-penguin-chick";
        chick.group.visible = false;
        chick.head.scale.setScalar(1.18);
      }
      // 아기 펭귄 이름표 '이든'(팀원 이름표와 같은 모양, 작게). 클릭은 받지 않는다
      const chickTag = chick && document.getElementById?.("labels") ? Object.assign(document.createElement("div"), { className: "tagwrap chick-tag" }) : null;
      if (chickTag) {
        chickTag.innerHTML = '<div class="bubble"></div><span class="nametag"><i class="dot"></i><b>이든</b></span>';
        chickTag.style.setProperty("--c", "#7fb3d5"); chickTag.hidden = true;
        document.getElementById("labels").append(chickTag);
      }
      const v3 = new T.Vector3();
      function placeChickTag() {
        if (!chickTag) return;
        const cam = typeof camera !== "undefined" ? camera : null;
        if (!chick.group.visible || !cam) { chickTag.hidden = true; return; }
        v3.copy(chick.group.position); v3.y += 1.05; v3.project(cam);
        if (v3.z > 1) { chickTag.hidden = true; return; }
        chickTag.hidden = false;
        chickLabel.ax = (v3.x * .5 + .5) * innerWidth; chickLabel.ay = (-v3.y * .5 + .5) * innerHeight; chickLabel.az = v3.z; chickLabel.ly = 0;
        chickLabel.moveLabel();
      }
      // 겹침 정리(declutter)에 팀원 이름표처럼 끼워 넣을 모양: 이름표가 겹치면 위로 밀고, 말풍선끼리도 피한다
      const chickLabel = chickTag && {
        ghost: false, hidden: false, role: null, ly: 0, ax: 0, ay: 0, az: 1, lastSay: 0,
        tag: chickTag.querySelector(".nametag"), bubble: chickTag.querySelector(".bubble"),
        get x() { return chick.group.position.x; }, get z() { return chick.group.position.z; },
        shown: () => !chickTag.hidden, talking: () => !chickTag.hidden && chickTag.querySelector(".bubble").classList.contains("show"),
        moveLabel() { const x = this.ax - chickTag.offsetWidth / 2, y = this.ay - this.ly - chickTag.offsetHeight; chickTag.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`; },
      };
      if (chickLabel && talk?.addLabel) talk.addLabel(chickLabel);
      function followChick(t, dt) {
        if (!chick) return;
        const parent = typeof A === "function" ? A("gpt") : null;
        const active = parent && !parent.ghost && !parent.hidden && parent.rig?.group.userData.kind === "penguin";
        chick.group.visible = !!active;
        if (!active) { chickReady = false; chickRoute = []; return; }
        const target = parent.group.position, p = chick.group.position;
        const candidates = [1, -1, 2, -2, 0].map(i => ({x:target.x + Math.cos(parent.group.rotation.y + i) * 1.05, z:target.z - Math.sin(parent.group.rotation.y + i) * 1.05}));
        const end = candidates.find(q => Decor.walkable(q.x,q.z));
        if (!end) return;
        if (!chickReady) { p.set(end.x,0,end.z); chickReady = true; }
        replan -= dt;
        if (replan <= 0) {
          replan = .4;
          const route = Decor.nav.route(p,end); let prev=p;
          chickRoute = route.every(q=>{const ok=Decor.nav.los(prev,q);prev=q;return ok;}) ? route : [];
        }
        const q=chickRoute[0]; let moving=false;
        if(q) { const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*2.8);
          if(d>.08) {p.x+=dx/d*step;p.z+=dz/d*step;chick.group.rotation.y=Math.atan2(dx,dz);moving=true;}
          if(d<=step+.08)chickRoute.shift();
        }
        chick.group.rotation.z=moving?Math.sin(t*12)*.09:0;
        chick.legs.forEach((leg,i)=>leg.rotation.x=moving?Math.sin(t*12+i*Math.PI)*.45:0);
        chick.arms.forEach((arm,i)=>arm.rotation.z=(i?1:-1)*(.15+(moving?Math.sin(t*12)*.12:0)));
      }
      // ── 이든(4살): 디자인과장(gpt 펭귄)을 '엄마'라 부르며 계속 말을 걸고, 근처 팀원·조연과도 이야기한다 ──
      const eden = chickTag && talk ? chickEden(chick, chickTag, talk, chickLabel) : null;
      function animateCritters(t, dt) {
        followChick(t, dt); placeChickTag();
        for (const d of ducks) { d.a += d.w * dt; const x = L0.x + Math.cos(d.a) * d.r * .9, z = L0.z + Math.sin(d.a) * d.r; d.g.position.set(x, .05 + Math.sin(t * 2 + d.r) * .02, z); d.g.rotation.y = -d.a; }
        for (const b of birds) { b.a += b.w * dt * b.dir; b.g.position.set(Math.cos(b.a) * b.r, b.y + Math.sin(t + b.r) * .4, Math.sin(b.a) * b.r * .75); b.g.rotation.y = -b.a + (b.dir > 0 ? 0 : Math.PI); const f = Math.sin(t * 10 + b.r) * .7; b.wings[0].rotation.z = f; b.wings[1].rotation.z = -f; }
        for (const m of meerkats) { const up = Math.max(0, Math.sin(t * .8 + m.t)); m.rig.group.position.y = -1.1 * .38 * (1 - up); m.rig.group.rotation.y = Math.sin(t * .5 + m.t) * .8; }
        for (const p of penguins) { const k = Math.sin(t * .4 + p.t); p.rig.group.position.x = p.x0 + k * p.span; p.rig.group.rotation.y = Math.cos(t * .4 + p.t) > 0 ? Math.PI / 2 : -Math.PI / 2; p.rig.group.rotation.z = Math.sin(t * 6 + p.t) * .08; }
        for (const f of flyers) { const k = t * .7 + f.t; f.g.position.set(f.cx + Math.sin(k) * 1.2, .7 + Math.sin(k * 1.7) * .3, f.cz + Math.cos(k * .8) * 1); f.g.rotation.y = k; const w = Math.sin(t * 18 + f.t) * 1.1; f.wings[0].rotation.y = w; f.wings[1].rotation.y = -w; }
      }

      return animateCritters;
    },
  };
})();
