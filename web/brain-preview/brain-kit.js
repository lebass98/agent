"use strict";
/* 브레인 모드 시안 공통: 가짜 데이터 + 화면 조각 그리기. 실제 연동(Gmail·Google/Notion/휴대폰 캘린더·Notion 회의록·Vercel)은 시안 확정 후.
   시안 A·B·C 는 같은 조각을 서로 다른 배치로 쓴다. 데이터는 모두 예시다. */
window.Brain = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = s => { const t = document.createElement("template"); t.innerHTML = s.trim(); return t.content.firstElementChild; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pad = n => String(n).padStart(2, "0");

  const I = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.6 3.6 5.2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z"/>',
    pin: '<path d="M12 17v5M5 17h14l-2-4V5H7v8z"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
    office: '<path d="M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',
  };
  const ic = (k, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

  /* ───────── 예시 데이터 ───────── */
  const SRC = { google: { label: "Google", c: "var(--google)" }, notion: { label: "Notion", c: "var(--notion)" }, phone: { label: "휴대폰", c: "var(--phone)" } };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayAt = (d, hh, mm = 0) => { const x = new Date(today); x.setDate(x.getDate() + d); x.setHours(hh, mm); return x; };
  const EVENTS = [
    { t: "개발팀 스탠드업", src: "notion", s: dayAt(0, 9), e: dayAt(0, 9, 30) },
    { t: "주간회의", src: "google", s: dayAt(0, 10), e: dayAt(0, 11), star: true, where: "회의실 1" },
    { t: "점심 · 거래처", src: "phone", s: dayAt(0, 12, 30), e: dayAt(0, 13, 30) },
    { t: "투자사 미팅", src: "google", s: dayAt(0, 14), e: dayAt(0, 15), star: true, where: "강남 · 대면" },
    { t: "디자인 리뷰", src: "notion", s: dayAt(0, 16), e: dayAt(0, 16, 45) },
    { t: "운동", src: "phone", s: dayAt(0, 18, 30), e: dayAt(0, 19, 30) },
    { t: "분기 보고", src: "phone", s: dayAt(1, 10), e: dayAt(1, 11), star: true },
    { t: "개발팀 스탠드업", src: "notion", s: dayAt(1, 9), e: dayAt(1, 9, 30) },
    { t: "디자인팀 미팅", src: "notion", s: dayAt(1, 16), e: dayAt(1, 17) },
    { t: "랜딩 페이지 오픈", src: "notion", s: dayAt(2, 9), e: dayAt(2, 9, 30), star: true },
    { t: "치과", src: "phone", s: dayAt(2, 17), e: dayAt(2, 18) },
    { t: "고객사 워크숍", src: "google", s: dayAt(3, 13), e: dayAt(3, 17) },
    { t: "주간 보고서 마감", src: "notion", s: dayAt(4, 17), e: dayAt(4, 17, 30) },
    { t: "가족 저녁", src: "phone", s: dayAt(5, 18), e: dayAt(5, 20) },
    { t: "1:1 미팅", src: "google", s: dayAt(-1, 15), e: dayAt(-1, 15, 30) },
  ];
  const FLOAT = [
    { when: "14:00", sub: "오늘", t: "투자사 미팅", info: "Google · 강남 · IR 자료 필요", c: "var(--err)", urgent: true },
    { when: "D-2", sub: "마감", t: "랜딩 페이지 오픈", info: "Notion · 배포 실패 1건 해결 필요", c: "var(--accent-btn)" },
    { when: "10:00", sub: "내일", t: "분기 보고", info: "휴대폰 캘린더 · 자료 80%", c: "var(--phone)" },
  ];
  const MAIL = [
    { who: "박지훈", org: "투자사", c: "#e0732e", time: "08:42", tag: ["reply", "답장 필요"], sum: "오늘 <b>14시 미팅 전</b>까지 IR 자료 최종본을 보내 달라는 요청. 지난 분기 매출 표를 같이 원함." },
    { who: "Vercel", org: "알림", c: "#111", time: "07:10", tag: ["hot", "중요"], sum: "<b>랜딩 페이지 배포 실패</b> — 빌드 단계 오류 1건(환경 변수 누락). 이전 배포는 그대로 동작 중." },
    { who: "김하늘", org: "디자인팀", c: "#7c5cf6", time: "어제", tag: ["info", "공유"], sum: "랜딩 시안 v3 공유. 첫 화면 문구 두 가지 중 고르면 오늘 안에 마무리 가능." },
    { who: "세무 사무소", org: "", c: "#0f7a43", time: "어제", tag: ["reply", "일정"], sum: "부가세 신고 자료 요청 · <b>11월 25일까지</b>. 카드 사용 내역만 보내면 된다고 함." },
    { who: "뉴스레터 4건", org: "묶음", c: "#98a2b8", time: "이번 주", tag: ["", "읽을거리"], sum: "AI 에이전트 도구 소식 2, 디자인 트렌드 1, 개발 도구 업데이트 1. <em>급한 내용 없음</em>." },
  ];
  const MEETINGS = [
    { t: "주간회의", when: "월 10:00", who: "6명", tag: ["info", "주간"], pts: ["랜딩 페이지 이번 주 오픈 확정", "Q4 목표: 신규 고객 30곳", "에이전트 오피스 휴대폰 앱 사내 배포"], acts: [["IR 자료 최종본 정리", false], ["랜딩 배포 오류 해결", false], ["분기 보고 자료 공유", true]] },
    { t: "디자인팀 미팅", when: "화 16:00", who: "4명", tag: ["", "디자인"], pts: ["시안 v3 첫 화면 문구 A/B 결정", "모션 라이브러리 적용 범위 정리"], acts: [["문구 A/B 골라 전달", false]] },
    { t: "개발팀 스탠드업", when: "매일 09:00", who: "3명", tag: ["ok", "매일"], pts: ["배포 자동 점검 루틴 추가", "브레인 모드 시안 검토"], acts: [["Vercel 환경 변수 확인", false]] },
  ];
  const APPS = [
    { n: "에이전트 오피스", a: "AO", c: "#5558e6", g: "linear-gradient(135deg,#7c5cf6,#3d6df2)", url: "agent-office.vercel.app" },
    { n: "Moxie 모션", a: "Mx", c: "#e0458b", g: "linear-gradient(135deg,#ff6aa2,#c2338a)", url: "moxie.vercel.app" },
    { n: "그룹웨어", a: "GW", c: "#0346ff", g: "linear-gradient(135deg,#2f6bff,#0b2fb8)", url: "groupware.vercel.app" },
    { n: "포트폴리오", a: "Pf", c: "#111", g: "linear-gradient(135deg,#3a3a3c,#0b0b0c)", url: "portfolio.vercel.app" },
    { n: "랜딩 페이지", a: "LP", c: "#ff7a1a", g: "linear-gradient(135deg,#ffb347,#ff6a1a)", url: "landing.vercel.app", warn: true },
    { n: "견적 계산기", a: "₩", c: "#10a37f", g: "linear-gradient(135deg,#34d399,#0f8a6a)", url: "quote.vercel.app" },
    { n: "블로그", a: "Bg", c: "#14b8a6", g: "linear-gradient(135deg,#2dd4bf,#0e8f84)", url: "blog.vercel.app" },
    { n: "대시보드", a: "Db", c: "#6c7794", g: "linear-gradient(135deg,#8a96b8,#4a5578)", url: "dash.vercel.app" },
  ];
  const SKILLS = [
    { ai: "claude", n: "wnc-motion", d: "모션 라이브러리로 적용 기획·시안 3종", u: 12 },
    { ai: "claude", n: "design:design-critique", d: "화면 디자인 피드백", u: 8 },
    { ai: "claude", n: "data:analyze", d: "데이터 질문 답·분석", u: 5 },
    { ai: "claude", n: "pdf-viewer:annotate", d: "PDF 함께 보며 표시", u: 3 },
    { ai: "gemini", n: "자료-요약", d: "긴 문서·메일 요약 (예시)", u: 21 },
    { ai: "gemini", n: "번역-정리", d: "영문 자료 번역·용어 통일 (예시)", u: 9 },
    { ai: "gpt", n: "이미지-시안", d: "배너·썸네일 시안 (예시)", u: 7 },
    { ai: "gpt", n: "카피-다듬기", d: "광고·랜딩 문구 정리 (예시)", u: 6 },
  ];
  const AI = { claude: { label: "Claude", c: "var(--claude)", a: "C" }, gemini: { label: "Gemini", c: "var(--gemini)", a: "Ge" }, gpt: { label: "GPT", c: "var(--gpt)", a: "G" } };
  const ROUTINES = [
    { n: "아침 메일 브리핑", when: "매일 08:30", by: "gemini", kind: "auto", on: true, last: "오늘 08:30 완료", ico: "mail", c: "var(--gemini)" },
    { n: "Vercel 배포 점검", when: "매일 09:00", by: "claude", kind: "auto", on: true, last: "오늘 실패 1건", ico: "bolt", c: "var(--err)", alert: true },
    { n: "주간회의록 → 노션 정리", when: "매주 월 11:30", by: "claude", kind: "auto", on: true, last: "다음: 월 11:30", ico: "note", c: "var(--claude)" },
    { n: "주간 보고서 초안", when: "매주 금 16:00", by: "claude", kind: "auto", on: false, last: "꺼짐", ico: "repeat", c: "var(--muted)" },
    { n: "오늘 회고 적기", when: "매일 18:00", kind: "check", done: false, last: "직접 확인", ico: "check", c: "var(--ok-dot)" },
    { n: "내일 일정 확인", when: "매일 22:00", kind: "check", done: false, last: "직접 확인", ico: "cal", c: "var(--accent)" },
  ];
  const TEAM = [
    { n: "Claude", r: "팀장", c: "var(--claude)", a: "C", busy: true, task: "주간 보고서 초안 작성", p: 62 },
    { n: "GPT", r: "디자이너", c: "var(--gpt)", a: "G", busy: true, task: "랜딩 배너 시안 2종", p: 30 },
    { n: "Gemini", r: "지원", c: "var(--gemini)", a: "Ge", busy: false, task: "대기 중", p: 0 },
  ];

  /* ───────── 조각 그리기 ───────── */
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const on = { google: true, notion: true, phone: true };
  const listeners = [];
  const visible = () => EVENTS.filter(e => on[e.src]);

  function sourceChips(el) {
    el.classList.add("chips");
    el.innerHTML = Object.entries(SRC).map(([k, s]) => `<button class="chipb" data-src="${k}" aria-pressed="true" style="--c:${s.c}"><i></i>${s.label}</button>`).join("");
    el.onclick = e => {
      const b = e.target.closest("[data-src]"); if (!b) return;
      on[b.dataset.src] = !on[b.dataset.src];
      $$(`[data-src="${b.dataset.src}"]`).forEach(x => x.setAttribute("aria-pressed", on[b.dataset.src]));
      listeners.forEach(f => f());
    };
  }
  function dayView(el, from = 8, to = 20) {
    const draw = () => {
      const evs = visible().filter(e => e.s.toDateString() === today.toDateString());
      const H = 44, now = new Date(), nowY = ((now.getHours() + now.getMinutes() / 60) - from) * H;
      el.className = "cal-day";
      el.innerHTML = Array.from({ length: to - from }, (_, i) => `<div class="hour"><span>${pad(from + i)}:00</span></div>`).join("") +
        evs.map(e => {
          const top = ((e.s.getHours() + e.s.getMinutes() / 60) - from) * H, ht = Math.max(26, (e.e - e.s) / 36e5 * H - 3);
          return `<div class="ev${e.star ? " star" : ""} rise" style="--c:${SRC[e.src].c};top:${top + 2}px;height:${ht}px"><b>${e.star ? "★ " : ""}${esc(e.t)}</b><small>${hm(e.s)}–${hm(e.e)} · ${SRC[e.src].label}${e.where ? ` · ${esc(e.where)}` : ""}</small></div>`;
        }).join("") + (nowY > 0 && nowY < (to - from) * H ? `<div class="now" style="top:${nowY}px"></div>` : "");
    };
    listeners.push(draw); draw();
  }
  function weekView(el) {
    const draw = () => {
      el.className = "week";
      el.innerHTML = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today); d.setDate(d.getDate() - ((today.getDay() + 6) % 7) + i);
        const evs = visible().filter(e => e.s.toDateString() === d.toDateString()).sort((a, b) => a.s - b.s);
        return `<div class="wday${d.getTime() === today.getTime() ? " today" : ""}"><h5>${"일월화수목금토"[d.getDay()]}<b>${d.getDate()}</b></h5>${evs.map(e => `<div class="wev" style="--c:${SRC[e.src].c}" title="${esc(e.t)}"><small>${hm(e.s)}</small>${e.star ? "★ " : ""}${esc(e.t)}</div>`).join("")}</div>`;
      }).join("");
    };
    listeners.push(draw); draw();
  }
  function agenda(el, days = 3) {
    const draw = () => {
      const end = new Date(today); end.setDate(end.getDate() + days);
      const evs = visible().filter(e => e.s >= today && e.s < end).sort((a, b) => a.s - b.s);
      el.className = "agenda";
      el.innerHTML = evs.map(e => {
        const dd = Math.round((new Date(e.s).setHours(0, 0, 0, 0) - today) / 864e5);
        return `<div class="arow rise" style="--c:${SRC[e.src].c}"><time>${hm(e.s)}<small>${["오늘", "내일", "모레"][dd] || `${e.s.getMonth() + 1}/${e.s.getDate()}`}</small></time><span class="bar"></span><div><b>${e.star ? "★ " : ""}${esc(e.t)}</b><span class="src" style="--c:${SRC[e.src].c}"><i></i>${SRC[e.src].label}${e.where ? ` · ${esc(e.where)}` : ""}</span></div><span class="muted">${Math.round((e.e - e.s) / 6e4)}분</span></div>`;
      }).join("") || '<p class="muted">일정이 없어요</p>';
    };
    listeners.push(draw); draw();
  }
  function miniMonth(el) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const has = new Set(EVENTS.map(e => e.s.toDateString()));
    el.className = "mini-month";
    el.innerHTML = "월화수목금토일".split("").map(c => `<span class="h">${c}</span>`).join("") + Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const cls = [d.getMonth() !== today.getMonth() && "o", d.getTime() === today.getTime() && "t", has.has(d.toDateString()) && "e"].filter(Boolean).join(" ");
      return `<span class="${cls}">${d.getDate()}</span>`;
    }).join("");
  }
  function floats(el, max = 3) {
    el.classList.add("float-strip");
    el.innerHTML = FLOAT.slice(0, max).map((f, i) => `<div class="fl${f.urgent ? " urgent" : ""}" style="--c:${f.c};animation-delay:${i * 80}ms"><span class="when">${f.when}<small>${f.sub}</small></span><div style="min-width:0"><b>${esc(f.t)}</b><span class="sub">${esc(f.info)}</span></div><button class="x" title="숨기기">${ic("x", 13)}</button></div>`).join("");
    el.onclick = e => { const x = e.target.closest(".x"); if (!x) return; const f = x.closest(".fl"); f.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-8px) scale(.96)" }], { duration: 220 }).onfinish = () => f.remove(); };
  }
  function mail(el, n = MAIL.length) {
    el.classList.add("mail");
    el.innerHTML = MAIL.slice(0, n).map((m, i) => `<div class="mrow rise" style="animation-delay:${i * 50}ms"><span class="av" style="--c:${m.c}">${esc(m.who[0])}</span><span class="who"><span>${esc(m.who)}</span>${m.org ? `<small class="muted">${esc(m.org)}</small>` : ""}${m.tag[1] ? `<span class="tag ${m.tag[0]}">${m.tag[1]}</span>` : ""}</span><time>${m.time}</time><p class="sum">${m.sum}</p></div>`).join("");
  }
  function meetings(el, n = MEETINGS.length) {
    el.innerHTML = MEETINGS.slice(0, n).map(m => `<div class="meet"><h4>${ic("note", 14)}${esc(m.t)}<span class="tag ${m.tag[0]}">${m.tag[1]}</span></h4><div class="meta">${m.when} · ${m.who} · Notion</div><ul>${m.pts.map(p => `<li>${esc(p)}</li>`).join("")}</ul><div class="acts">${m.acts.map(([a, d]) => `<label><input type="checkbox"${d ? " checked" : ""}>${esc(a)}</label>`).join("")}</div></div>`).join("");
  }
  function apps(el, mode = "grid", add = true) {
    el.classList.add(mode === "dock" ? "dock" : "apps");
    el.innerHTML = APPS.map(a => `<a class="app" href="#" title="${esc(a.n)} — ${a.url}" style="--c:${a.c};--g:${a.g}"><span class="tile">${esc(a.a)}</span><span>${esc(a.n)}</span></a>`).join("") + (add ? `<a class="app" href="#" title="Vercel 프로젝트 추가"><span class="tile add">+</span><span>추가</span></a>` : "");
    el.onclick = e => { if (e.target.closest(".app")) { e.preventDefault(); toast("시안: 실제 연결 후 새 탭으로 열려요"); } };
  }
  function skills(el, tabsEl) {
    let cur = "all";
    const draw = () => {
      el.classList.add("skills");
      el.innerHTML = SKILLS.filter(s => cur === "all" || s.ai === cur).map((s, i) => `<div class="sk rise" style="animation-delay:${i * 35}ms"><span class="ai" style="--c:${AI[s.ai].c}">${AI[s.ai].a}</span><b>${esc(s.n)}</b><small>${esc(s.d)}</small><span class="n"><b>${s.u}</b>회</span></div>`).join("");
    };
    if (tabsEl) {
      tabsEl.classList.add("seg");
      tabsEl.innerHTML = [["all", "전체"], ["claude", "Claude"], ["gemini", "Gemini"], ["gpt", "GPT"]].map(([k, t]) => `<button data-k="${k}" aria-selected="${k === "all"}">${t}</button>`).join("");
      tabsEl.onclick = e => { const b = e.target.closest("button"); if (!b) return; cur = b.dataset.k; $$("button", tabsEl).forEach(x => x.setAttribute("aria-selected", x === b)); draw(); };
    }
    draw();
  }
  function routines(el, n = ROUTINES.length) {
    el.innerHTML = ROUTINES.slice(0, n).map((r, i) => `<div class="rt${r.done ? " done" : ""}" data-i="${i}"><span class="ico" style="--c:${r.c}">${ic(r.ico, 17)}</span><b>${esc(r.n)}</b><span class="state">${r.kind === "check" ? `<button class="check" role="checkbox" aria-checked="${!!r.done}" title="확인">${ic("check", 14)}</button>` : `<button class="sw" role="switch" aria-checked="${r.on}" title="예약 실행"></button>`}</span><small>${r.when}${r.by ? ` · ${AI[r.by].label}` : ""} · <span style="${r.alert ? "color:var(--err);font-weight:600" : ""}">${r.last}</span></small></div>`).join("");
    el.onclick = e => {
      const b = e.target.closest(".check,.sw"); if (!b) return;
      const v = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", v);
      if (b.classList.contains("check")) b.closest(".rt").classList.toggle("done", v);
    };
  }
  function team(el, mode = "row") {
    el.classList.add("team-mini");
    el.innerHTML = TEAM.map(t => `<div class="tm${t.busy ? " busy" : ""}" title="${t.n} · ${t.r} · ${t.task}"><span class="face" style="--c:${t.c}">${t.a}</span>${mode === "faces" ? "" : `<div style="min-width:0;flex:1"><b>${t.n}</b> <small style="display:inline" class="muted">${t.r}</small><small>${esc(t.task)}</small>${mode === "bars" ? `<div class="prog" style="margin-top:4px"><i style="width:${t.p}%"></i></div>` : ""}</div>`}</div>`).join("");
  }

  /* ───────── 공통 틀 ───────── */
  function bar(cur, desc) {
    const L = [["a.html", "A · 커맨드 센터"], ["b.html", "B · 타임라인 포커스"], ["c.html", "C · 브리핑 피드"]];
    document.body.prepend(h(`<div class="demo-bar"><a href="index.html" style="color:var(--accent-text);font-weight:600">← 시안 목록</a><b>브레인 모드 시안</b><nav>${L.map(([f, n]) => `<a href="${f}"${f === cur ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav><span class="desc">${desc}</span><button class="tbtn" id="themeT">${ic("moon", 13)} 테마</button></div>`));
    $("#themeT").onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === "dark" ? "light" : "dark"; };
  }
  function rail(cur = "home") {
    const items = [["home", "홈", "home"], ["cal", "캘린더", "cal"], ["mail", "메일", "mail"], ["note", "회의록", "note"], ["repeat", "루틴", "repeat"], ["grid", "바로가기", "grid"], ["spark", "스킬", "spark"], ["team", "AI 팀", "team"]];
    return `<aside class="rail"><div class="logo">${ic("brain", 19)}</div>${items.map(([k, t, i]) => `<button${k === cur ? ' aria-current="page"' : ""}>${ic(i)}${t}</button>`).join("")}<button class="sp">${ic("gear")}설정</button></aside>`;
  }
  function topbar(extra = "") {
    const d = new Date();
    return `<header class="topbar"><div class="crumb"><small>워크스페이스 / 🧠 브레인</small><b>WordNCode Agent Office<span class="mode-pill">${ic("brain", 12)}브레인 모드</span></b></div><span class="grow"></span>${extra}<button class="search">${ic("search", 15)}<span>메일·일정·회의록·스킬 검색</span><kbd>⌘K</kbd></button><span class="conn"><i></i>연결됨 4</span><button class="iconbtn" title="알림">${ic("bell")}<span class="dot"></span></button><span class="muted" style="font-weight:600;font-variant-numeric:tabular-nums">${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})</span></header>`;
  }
  function command(ph = "브레인에게 물어보거나 팀에 업무를 지시하세요 — 예: 오늘 메일 중 답장할 것만 정리해 줘") {
    return `<form class="command" onsubmit="event.preventDefault();Brain.toast('시안: 실제 앱에서는 팀에 업무로 보내요')">${ic("spark", 17)}<input placeholder="${esc(ph)}"><span class="ctx">메일 5 · 일정 6 · 회의록 3 참고</span><button class="send">${ic("send", 16)}</button></form>`;
  }
  let tt = 0;
  function toast(msg) {
    let t = $("#btoast");
    if (!t) { t = h('<div id="btoast" style="position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:9px 14px;border-radius:10px;font-size:12.5px;z-index:99;box-shadow:var(--shadow-lg);transition:opacity .25s"></div>'); document.body.append(t); }
    t.textContent = msg; t.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => { t.style.opacity = 0; }, 2200);
  }
  if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";

  return { $, $$, h, ic, esc, bar, rail, topbar, command, toast, sourceChips, dayView, weekView, agenda, miniMonth, floats, mail, meetings, apps, skills, routines, team, data: { EVENTS, MAIL, MEETINGS, APPS, SKILLS, ROUTINES, TEAM } };
})();
