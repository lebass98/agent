"use strict";
/* 브레인 모드(기본 공간) — 승인된 Soft Glass 디자인. 기존 API·업무 DOM 계약은 유지한다.
   3D 사무실 자리에 업무 화면을 띄운다: 중요 일정 플로팅 · 오늘 브리핑 · 통합 캘린더 · 진행 중인 업무 · 루틴 · 메일 요약 · 회의록 · 바로가기 · 스킬.
   데이터는 /api/brain*(server/brain.py, docs/events.md '브레인 모드'). 설정은 서버 cache/brain.json 에 저장되어 휴대폰에서도 같다.
   app.js 가 3D 를 켜지 않고(테마 flat) 목록 모드로 돈다 — 업무 지시·팀 상태·로그는 그대로. 모션은 Moxie 기법(두 스프링 탭·카운트업·체크 그리기 등). */
window.Brain = (() => {
  if (!window.SpaceTheme?.isBrain) return null;
  document.body.classList.add("brain-mode");
  const reduce = () => !!PREF.reduce || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const h = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const ico = (n, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], DAY_KO = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
  const dayKey = d => DAYS[(d.getDay() + 6) % 7];
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const SRC = { google: ["Google", "#4285f4"], phone: ["휴대폰", "#ff6b4a"], notion: ["Notion", "var(--text-2)"], other: ["기타", "#8b5cf6"], manual: ["직접 입력", "var(--accent)"] };
  const AI = { claude: ["Claude", "#d97757", "C"], gpt: ["GPT", "#10a37f", "G"], gemini: ["Gemini", "#4f7cf6", "Ge"] };

  let CFG = { shortcuts: [], routines: [], pins: [], calendars: [], events: [] }, CAL = { events: [], status: [] }, SKILLS = null;
  let loaded = false, offline = false;
  let MAIL = null, mailT = 0, MEET = null, meetT = 0, meetOpen = -1; // /api/brain/mail 결과 {enabled, user, items, error, pending, at}
  let MCAL = null, mcalT = 0, mcalKnown = null; // 메일에서 찾은 일정 제안(/api/brain/mailcal) — 승인해야 캘린더에 들어간다
  let RUNS = [], runsT = 0, VERCEL = null; // Vercel CLI 연결 상태 // 스킬 실행 기록(/api/brain/skills/runs)
  const V = { mail: store.get("agentOffice.brain.mail") === "all" ? "all" : "key", cal: store.get("agentOffice.brain.cal") === "week" ? "week" : "day", src: new Set(), date: ymd(new Date()), month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), skAi: "all", skMine: "mine", skQ: "", edit: false };
  let hiddenFloats = new Set();
  try { hiddenFloats = new Set(JSON.parse(sessionStorage.getItem("agentOffice.brain.hide") || "[]")); } catch {}

  /* ───────── 틀 ───────── */
  const ui = h(`<section class="brain" id="brain" aria-label="브레인">
    <header class="bn-welcome"><div><p id="bnDate"></p><h1><span id="bnGreeting">나의 업무 공간</span><span class="bn-welcome-sub"> 당신의 하루를 가볍게.</span></h1></div><button type="button" class="bn-team-toggle" id="bnTeamToggle">${ico("users")}<span>팀 활동</span></button></header>
    <div class="bn-grid">
      <article class="bn-card bn-imp" id="bnImp" hidden><header><h3>${ico("star")}중요 일정</h3></header><div class="bn-floats" id="bnFloats" aria-label="중요 일정"></div></article>
      <article class="bn-card bn-brief" id="bnBrief"></article>
      <article class="bn-card bn-cal"><header><h3>${ico("calendar")}통합 캘린더</h3><small id="bnCalSub"></small>
        <span class="bn-seg" id="bnCalView"><button type="button" data-v="day">월간</button><button type="button" data-v="week">주간</button></span>
        <button type="button" class="bn-mini" data-act="event" title="일정 직접 넣기">${ico("plus")}</button><button type="button" class="bn-mini" data-act="cals" title="캘린더 연결">${ico("gear")}</button></header>
        <div class="bn-chips" id="bnSrc"></div><div class="bn-body" id="bnCal"></div><div class="bn-cal-footer"><button type="button" class="bn-btn" data-act="event">${ico("plus")} 일정 추가</button></div></article>
      <article class="bn-card bn-work"><header><h3>${ico("kanban")}진행 중인 업무</h3><small id="bnWorkSub"></small><button type="button" class="bn-mini" data-act="board" title="보드로 보기" aria-label="보드로 보기">${ico("kanban")}</button></header><div class="bn-body" id="bnWork"></div></article>
      <article class="bn-card bn-rt"><header><h3>${ico("repeat")}나의 루틴</h3><small id="bnRtSub"></small><button type="button" class="bn-mini" data-act="routines" title="루틴 추가·편집" aria-label="루틴 추가·편집">${ico("edit")}</button></header><div class="bn-body"><div id="bnRt"></div><div class="bn-streak" id="bnStreak"></div></div></article>
      <article class="bn-card bn-mail"><header><h3>${ico("mail")}이메일 브리핑</h3><small id="bnMailSub">Gmail</small>
        <span class="bn-seg" id="bnMailView"><button type="button" data-v="key">할 일·중요</button><button type="button" data-v="all">전체</button></span>
        <button type="button" class="bn-mini" id="bnMailRefresh" title="다시 불러오기 — 새 업무 메일만 더 가져와 쌓아요" aria-label="다시 불러오기">${ico("history")}</button></header><div class="bn-mcal" id="bnMcal" hidden aria-live="polite"></div><div class="bn-body" id="bnMail"></div></article>
      <article class="bn-card bn-meet"><header><h3>${ico("file")}회의 노트</h3><small id="bnMeetSub">Notion</small>
        <button type="button" class="bn-mini" data-act="meetings" title="회의 지정" aria-label="회의 지정">${ico("pin")}</button><button type="button" class="bn-mini" id="bnMeetRefresh" title="지금 새로 읽기">${ico("history")}</button></header><div class="bn-body" id="bnMeet"></div></article>
      <article class="bn-card bn-apps"><header><h3>${ico("grid")}내 서비스</h3><button type="button" class="bn-mini" id="bnAppsSub" data-act="vercel" title="Vercel 프로젝트를 바로가기로 가져오기" aria-label="Vercel 가져오기">${ico("vercel")}</button><button type="button" class="bn-mini" data-act="shortcuts" title="바로가기 편집" aria-label="바로가기 편집">${ico("edit")}</button></header><div class="bn-body"><div class="bn-tiles" id="bnApps"></div></div></article>
      <article class="bn-card bn-skills"><header><h3>${ico("sparkles")}스킬 라이브러리</h3><small id="bnSkSub"></small>
        <label class="bn-sksearch">${ico("search")}<input id="bnSkQ" placeholder="스킬 검색" aria-label="스킬 검색"></label></header>
        <div class="bn-body"><div class="bn-skpages" id="bnSkills"></div><div class="bn-dots" id="bnSkDots"></div></div></article>
    </div><footer class="bn-footer"><span>${ico("brain")}나의 업무가 모이는 공간</span><span>메일 · 일정 · 회의 · 스킬 · 루틴</span></footer>
    <nav class="bn-mobile-nav" aria-label="브레인 바로가기"><button type="button" data-focus="overview" aria-current="page">${ico("house")}홈</button><button type="button" data-focus="cal">${ico("calendar")}일정</button><button type="button" class="bn-mobile-add" data-act="event" aria-label="일정 추가">${ico("plus")}</button><button type="button" data-focus="meet">${ico("file")}회의</button><button type="button" data-focus="rt">${ico("repeat")}루틴</button></nav></section>`);
  document.body.append(ui);
  const $b = id => ui.querySelector("#" + id);
  // 승인한 세 열 배치. 원래 카드와 핸들러를 옮기므로 연결된 데이터·업무 흐름은 유지된다.
  const grid = ui.querySelector(".bn-grid");
  // 좌우 메뉴가 모두 접히고 가운데가 넉넉하면 4열, 아니면 승인한 3열(카드를 옮길 뿐이라 데이터·동작은 그대로)
  const COLS3 = [["brief", "mail", "apps"], ["imp", "cal", "meet"], ["work", "rt", "skills"]];
  const COLS4 = [["brief", "mail"], ["imp", "cal"], ["meet", "rt"], ["work", "skills", "apps"]];
  // 좁아지면(브레인 안쪽 너비 기준, brain-soft.css 의 @container 와 같은 경계) 2열·1열 순서로 다시 놓는다 — 진행 중인 업무가 늘 위에
  const COLS2 = [["work", "brief", "mail", "rt", "apps"], ["imp", "cal", "meet", "skills"]];
  const COLS1 = [["work", "brief", "imp", "cal", "mail", "meet", "rt", "skills", "apps"]];
  let colsNow = null;
  function arrange() {
    const cs = getComputedStyle(ui), inner = ui.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const four = document.body.classList.contains("bn-side-mini") && document.body.classList.contains("team-collapsed")
      && matchMedia("(min-width: 1001px)").matches && ui.clientWidth >= 1040;
    const want = !inner ? COLS3 : inner <= 590 ? COLS1 : inner <= 920 ? COLS2 : four ? COLS4 : COLS3;
    if (want === colsNow) return;
    colsNow = want;
    const cards = Object.fromEntries([...new Set(COLS3.flat())].map(n => [n, ui.querySelector(`.bn-${n}`)]));
    grid.querySelectorAll(":scope > .bn-column").forEach(c => c.remove());
    for (const names of want) {
      const col = h('<div class="bn-column"></div>');
      for (const name of names) if (cards[name]) col.append(cards[name]);
      grid.append(col);
    }
    ui.classList.toggle("bn-four", want === COLS4);
    ui.classList.toggle("bn-narrow", want === COLS2 || want === COLS1);
  }
  arrange();
  new MutationObserver(() => arrange()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", () => arrange());
  if (typeof ResizeObserver === "function") new ResizeObserver(() => arrange()).observe(ui);
  // 오늘의 브리핑은 독립 카드로 첫 열 맨 위(COLS3·COLS4 의 "brief")
  const bnNav = h(`<nav class="bn-workspace-nav" aria-label="브레인 업무 메뉴"><small>WORKSPACE</small>${[["overview", "house", "오버뷰"], ["cal", "calendar", "통합 캘린더"], ["mail", "mail", "이메일"], ["meet", "file", "회의 노트"], ["skills", "sparkles", "내 스킬"], ["rt", "repeat", "루틴 & 예약"]].map(([key, icon, label]) => `<button type="button" data-focus="${key}"${key === "overview" ? ' aria-current="page"' : ""}>${ico(icon)}<span>${label}</span></button>`).join("")}<small>AGENT OFFICE</small></nav>`);
  document.querySelector("#sidenav").before(bnNav);
  const focusPanel = key => {
    closeView(); setDrawer(false);
    const target = key === "overview" ? ui.querySelector(".bn-welcome") : ui.querySelector(`.bn-${key}`);
    document.querySelectorAll("[data-focus]").forEach(b => key === b.dataset.focus ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
    if (target) { ui.scrollTo({ top: key === "overview" ? 0 : Math.max(0, target.getBoundingClientRect().top - ui.getBoundingClientRect().top + ui.scrollTop - 16), behavior: reduce() ? "instant" : "smooth" }); }
  };
  for (const nav of [bnNav, ui.querySelector(".bn-mobile-nav")]) nav.addEventListener("click", e => { const b = e.target.closest("[data-focus]"); if (b) focusPanel(b.dataset.focus); });
  $b("bnTeamToggle").onclick = () => {
    if (matchMedia("(max-width: 760px)").matches) $("teamToggle").click();
    else $("activityCollapse").click();
  };
  const topBrand = document.querySelector(".workspace-brand .brand");
  if (topBrand) topBrand.firstChild.textContent = "brainmode";
  const homeNav = document.querySelector('#sidenav [data-view="office"] span');
  if (homeNav) homeNav.textContent = "오버뷰";

  // 3D 사무실·업무 선반 자리에 맞춰 놓는다(데스크톱·휴대폰 배치를 그대로 따른다)
  function place() {
    const f = $("officeFrame")?.getBoundingClientRect(), s = $("taskShelf")?.getBoundingClientRect();
    if (!f || !f.width) return;
    Object.assign(ui.style, { top: `${f.top}px`, left: `${f.left}px`, right: `${innerWidth - f.right}px`, bottom: `${Math.max(0, innerHeight - Math.max(f.bottom, s?.bottom || 0))}px` });
  }
  addEventListener("resize", place);
  if (typeof ResizeObserver === "function") { const ro = new ResizeObserver(place); for (const id of ["officeFrame", "taskShelf"]) if ($(id)) ro.observe($(id)); }

  // 왼쪽 메뉴 접기·펴기(Moxie repliegue): 넓은 메뉴 ↔ 아이콘만. 단추 · ⌘B/Ctrl+B · 이 브라우저에 기억. 좁은 화면(≤1000px)은 원래 규칙대로
  const sideBtn = h(`<button type="button" class="bn-sidetoggle" aria-controls="sidebar">${ico("chev-right")}</button>`);
  document.body.append(sideBtn);
  let sideAnim = 0;
  const setSide = (mini, save = true) => {
    if (save) { document.body.classList.add("bn-side-anim"); clearTimeout(sideAnim); sideAnim = setTimeout(() => document.body.classList.remove("bn-side-anim"), 600); }
    document.body.classList.toggle("bn-side-mini", mini);
    sideBtn.setAttribute("aria-expanded", String(!mini));
    sideBtn.title = sideBtn.ariaLabel = `${mini ? "메뉴 펴기" : "메뉴 접기"} (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}B)`;
    if (save) store.set("agentOffice.brain.sideMini", mini ? "1" : "0");
    setTimeout(() => { place(); arrange(); }, 450); // 너비가 바뀌는 애니메이션이 끝난 뒤 업무 화면 자리·열 수를 다시 맞춘다
  };
  setSide(store.get("agentOffice.brain.sideMini") === "1", false);
  sideBtn.onclick = () => setSide(!document.body.classList.contains("bn-side-mini"));
  addEventListener("keydown", e => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
    if (e.target.closest?.("input, textarea, [contenteditable='true']") || matchMedia("(max-width: 1000px)").matches) return;
    e.preventDefault(); sideBtn.click();
  });
  // 업무 보드 카드(기존 DOM·클릭 동작 그대로)를 '진행 중인 업무' 칸으로 옮긴다
  const pane = document.querySelector('[data-pane="board"]');
  if (pane) $b("bnWork").append(pane);
  // 현재 업무 카드(목표·단계·완료율·새 업무)는 모든 화면에서 업무 칸 안으로.
  const strip = document.querySelector(".run-strip"), mqDesk = matchMedia("(min-width: 761px)");
  // 휴대폰: 인사말 줄을 없애고 '팀 활동' 단추는 상단 바(서버 연결 왼쪽)로 — 업무 화면 공간을 아낀다
  const teamBtn = $b("bnTeamToggle"), welcome = ui.querySelector(".bn-welcome"), tbRight = document.querySelector(".tb-right");
  const placeTeam = () => {
    const phone = !mqDesk.matches && tbRight;
    if (phone && teamBtn.parentElement !== tbRight) tbRight.prepend(teamBtn);
    if (!phone && teamBtn.parentElement !== welcome) welcome.append(teamBtn);
    teamBtn.classList.toggle("bn-tb-team", !!phone);
  };
  const placeStrip = () => {
    placeTeam();
    if (!strip) return;
    $b("bnWork").prepend(strip);
    place();
  };
  mqDesk.addEventListener?.("change", placeStrip);
  placeStrip();

  /* ───────── 두 스프링 탭 (Moxie segmentos) ───────── */
  function seg(box, value, onpick) {
    let mark = box.querySelector(".bn-mark");
    if (!mark) { mark = h('<span class="bn-mark" aria-hidden="true"></span>'); box.prepend(mark); box.onclick = e => { const b = e.target.closest("button"); if (b) onpick(b.dataset.v); }; }
    const b = box.querySelector(`[data-v="${value}"]`);
    box.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (!b) return;
    const x = b.offsetLeft, back = x < +(mark.dataset.x ?? x);
    mark.classList.toggle("back", back);
    Object.assign(mark.style, { left: `${x}px`, right: `${box.clientWidth - x - b.offsetWidth}px` });
    mark.dataset.x = x;
  }

  /* ───────── 데이터 ───────── */
  let calT = 0;
  async function loadCal(refresh = false) {
    clearTimeout(calT);
    try { CAL = await getJSON(`/api/brain/calendar${refresh ? "?refresh=1" : ""}`); } catch { return; }
    drawCal(); drawFloats(); drawBrief();
    if (CAL.conn?.loading) calT = setTimeout(() => loadCal(), 10_000); // Google·Notion 일정을 받는 동안
  }
  let firstLoad = null; // 처음 불러오는 중이면 연결 신호(setConn)가 같은 요청을 한 번 더 보내지 않게
  async function load() {
    try {
      const [cfg, cal] = await Promise.all([getJSON("/api/brain"), getJSON("/api/brain/calendar")]);
      CFG = cfg; CAL = cal; offline = false;
      if (cal.conn?.loading) calT = setTimeout(() => loadCal(), 10_000);
    } catch { offline = true; }
    loaded = true;
    render();
    if (!SKILLS && !offline) { loadSkills(); loadRuns(); }
  }
  async function save(kind, items) {
    const r = await api(`/api/brain/${kind}`, { method: "PUT", body: JSON.stringify({ items }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `저장하지 못했어요 (${r.status})`);
    CFG = j;
    return j;
  }
  const events = () => (CAL.events || []).map(e => ({ ...e, s: new Date(e.start), e: new Date(e.end) }));

  /* ───────── 그리기 ───────── */
  function render() {
    place();
    drawFloats(); drawBrief(); drawCal(); drawRoutines(); drawApps(); drawMail(); drawMeet(); drawSkills(); drawWork();
  }
  const loadingNote = '<p class="bn-empty">불러오는 중…</p>';
  const offlineNote = what => `<p class="bn-empty">${ico("server")}서버에 연결되면 ${what}이(가) 보여요.</p>`;

  // 중요 일정 플로팅: 직접 고정한 일정 + 3시간 안에 시작하는 일정(급함) + 별표 일정
  function floatItems() {
    const now = new Date(), soon = new Date(now.getTime() + 3 * 3600e3), until = new Date(now.getTime() + 4 * 864e5), out = [];
    for (const p of CFG.pins) { const w = new Date(p.when); if (w > new Date(now.getTime() - 3600e3)) out.push({ key: `p:${p.id}`, title: p.title, when: w, note: p.note, pin: true }); }
    for (const e of events()) {
      if (e.allDay || e.e < now) continue;
      if (e.s <= soon || (e.star && e.s <= until)) out.push({ key: `e:${e.title}:${e.start}`, title: e.title, when: e.s, note: [SRC[e.src]?.[0], e.where].filter(Boolean).join(" · "), urgent: e.s <= soon, src: e.src });
    }
    for (const m of MAIL?.items || []) {
      if (m.tag !== "reply" || !m.due) continue;
      const w = new Date(`${m.due}T18:00`);
      if (w > now && w <= until) out.push({ key: `m:${m.id}`, title: `${m.from} · ${m.summary || m.subject}`, when: w, note: "메일 · 마감", src: "google" });
    }
    const seen = new Set();
    return out.filter(f => !hiddenFloats.has(f.key) && !seen.has(f.title + +f.when) && seen.add(f.title + +f.when)).sort((a, b) => a.when - b.when).slice(0, 4);
  }
  function whenLabel(d) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 864e5);
    return days === 0 ? [hm(d), "오늘"] : days === 1 ? [hm(d), "내일"] : [`D-${days}`, `${d.getMonth() + 1}/${d.getDate()}`];
  }
  function drawFloats() {
    const box = $b("bnFloats"), list = floatItems();
    $b("bnImp").hidden = !list.length;
    box.replaceChildren(...list.map((f, i) => {
      const [a, b] = whenLabel(f.when);
      const n = h(`<div class="bn-fl${f.urgent ? " urgent" : ""}" style="animation-delay:${i * 70}ms"><span class="bn-when"${f.src ? ` style="--c:${SRC[f.src]?.[1]}"` : ""}>${esc(a)}<small>${esc(b)}</small></span>
        <div class="bn-flt"><b>${f.pin ? ico("pin", "ic sm") : ""}${esc(f.title)}</b><span>${esc(f.note || "")}</span></div><button type="button" class="bn-x" aria-label="숨기기" title="숨기기">${ico("x")}</button></div>`);
      n.querySelector(".bn-x").onclick = () => {
        hiddenFloats.add(f.key);
        try { sessionStorage.setItem("agentOffice.brain.hide", JSON.stringify([...hiddenFloats])); } catch {}
        const before = new Map([...box.children].map(c => [c, c.getBoundingClientRect()]));
        n.remove();
        if (!reduce()) for (const c of box.children) { const r0 = before.get(c), r1 = c.getBoundingClientRect(); if (r0 && r0.left !== r1.left) c.animate([{ transform: `translateX(${r0.left - r1.left}px)` }, { transform: "none" }], { duration: 500, easing: "cubic-bezier(.34,1.56,.64,1)" }); }
        $b("bnImp").hidden = !box.children.length; place();
      };
      return n;
    }));
  }

  // 오늘 브리핑 (Moxie cavila·cifras): 지금 있는 정보로 요약. 메일이 연결되면 답장할 메일도 더한다
  let briefDone = false;
  function drawBrief() {
    const box = $b("bnBrief");
    const clock = new Date(), hourNow = clock.getHours();
    $b("bnDate").textContent = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(clock);
    $b("bnGreeting").textContent = hourNow < 11 ? "좋은 아침이에요" : hourNow < 18 ? "좋은 오후예요" : "오늘도 수고했어요";
    if (!loaded) { box.innerHTML = `<div class="bn-briefin"><h2>오늘의 브리핑</h2><p><span class="bn-think">일정·루틴·업무 정리하는 중…</span></p></div>`; return; }
    const now = new Date(), today = ymd(now), evs = events().filter(e => ymd(e.s) === today);
    const next = evs.filter(e => !e.allDay && e.s > now)[0], left = evs.filter(e => e.allDay || e.e > now).length;
    const due = CFG.routines.filter(r => r.on && r.kind === "check" && r.days.includes(dayKey(now)));
    const done = due.filter(r => r.checks?.[today]).length;
    const tasks = D.shown ? [...D.shown.tasks.values()] : [], fin = tasks.filter(isFin).length;
    const lines = [];
    let hero = "";
    if (offline) lines.push("서버에 연결되면 일정·루틴을 모아 보여 드려요.");
    else {
      lines.push(evs.length ? `오늘 일정 ${evs.length}개${next ? `, 다음은 <b>${hm(next.s)} ${esc(next.title)}</b>` : left ? "" : " — 모두 지났어요"}.` : CFG.calendars.length ? "오늘은 잡힌 일정이 없어요." : "캘린더를 연결하면 오늘 일정을 모아 보여 드려요.");
      if (due.length) lines.push(done === due.length ? "오늘 확인할 루틴을 모두 마쳤어요 👏" : `확인할 루틴 ${due.length - done}개가 남았어요.`);
      const reply = (MAIL?.items || []).filter(m => m.tag === "reply");
      hero = next ? `<em>${hm(next.s)}</em> ${esc(clip(next.title, 26))}` : reply.length ? `답장할 메일 <em>${reply.length}</em>통` : `오늘 일정 <em>${evs.length}</em>개`;
      if (reply.length) lines.push(`답장·할 일이 있는 메일 <b>${reply.length}통</b>${reply[0] ? ` (${esc(clip(reply[0].from, 12))} — ${esc(clip(reply[0].summary || reply[0].subject, 28))})` : ""}.`);
      const acts = (MEET?.items || []).flatMap(m => m.actions.filter(a => !a.done));
      if (acts.length) lines.push(`회의록에서 나온 할 일 <b>${acts.length}개</b>가 남았어요.`);
      if (D.running) lines.push(`AI 팀이 “${esc(clip(D.shown?.goal || "", 30))}” 업무를 진행 중이에요 (${esc(D.phaseText)}).`);
    }
    box.innerHTML = `<div class="bn-briefin"><span class="bn-orb" aria-hidden="true"></span><h2>${ico("sparkles")} 오늘의 업무 브리핑</h2>${hero ? `<strong class="bn-hero">${hero}</strong>` : ""}<p>${lines.join(" ")}</p>
      <div class="bn-kpis"><div><b data-n="${left}">${left}</b><span>남은 일정</span></div><div><b data-n="${done}" data-of="${due.length}">${done}/${due.length}</b><span>루틴 확인</span></div><div><b data-n="${fin}" data-of="${tasks.length}">${tasks.length ? `${fin}/${tasks.length}` : "—"}</b><span>업무</span></div></div></div>`;
    if (!briefDone && !reduce()) { // 처음 한 번만 숫자가 올라간다 (cifras)
      briefDone = true;
      for (const b of box.querySelectorAll("b[data-n]")) {
        const to = +b.dataset.n, of = b.dataset.of, t0 = performance.now();
        if (!to) continue;
        const step = t => { const k = Math.min(1, (t - t0) / 800), v = Math.round(to * (1 - (1 - k) ** 3)); b.textContent = of != null ? `${v}/${of}` : v; b.style.filter = `blur(${(1 - k) * 2}px)`; if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
    }
  }

  // 통합 캘린더: 월간 날짜 선택 + 선택일 목록 / 주간
  function drawCal() {
    seg($b("bnCalView"), V.cal, v => { V.cal = v; store.set("agentOffice.brain.cal", v); drawCal(); });
    const all = events(), srcs = [...new Set(all.map(e => e.src))];
    $b("bnSrc").replaceChildren(...srcs.map(s => {
      const on = !V.src.has(s);
      return h(`<button type="button" class="bn-chip" aria-pressed="${on}" style="--c:${SRC[s]?.[1]}" data-src="${s}"><i></i>${esc(SRC[s]?.[0] || s)}</button>`);
    }));
    $b("bnSrc").onclick = e => { const b = e.target.closest("[data-src]"); if (!b) return; V.src.has(b.dataset.src) ? V.src.delete(b.dataset.src) : V.src.add(b.dataset.src); drawCal(); };
    const bad = (CAL.status || []).filter(s => !s.ok);
    const conn = CAL.conn || {};
    const parts = [conn.enabled ? `Google·Notion${conn.loading ? " 가져오는 중…" : conn.error ? " 오류" : ""}` : "", CFG.calendars.length ? `iCal ${CFG.calendars.length}개${bad.length ? ` · ${bad.length}개 오류` : ""}` : ""].filter(Boolean);
    $b("bnCalSub").textContent = offline ? "" : parts.join(" · ") || "연결된 캘린더 없음";
    $b("bnCalSub").title = conn.error || (conn.at ? `Claude 의 Notion 캘린더 연결 · ${conn.at.slice(11)} 받음` : "");
    const box = $b("bnCal"), list = all.filter(e => !V.src.has(e.src));
    if (!loaded) { box.innerHTML = loadingNote; return; }
    if (offline) { box.innerHTML = offlineNote("일정"); return; }
    if (!CFG.calendars.length && !CFG.events.length && !conn.enabled) {
      box.innerHTML = `<div class="bn-setup">${ico("calendar")}<b>캘린더를 연결하세요</b><p>Google 캘린더·휴대폰(iCloud) 캘린더의 iCal 주소를 넣으면 한 화면에 모아 보여 줘요. 일정을 직접 넣을 수도 있어요.</p><div><button type="button" class="bn-btn pri" data-act="cals">캘린더 연결</button><button type="button" class="bn-btn" data-act="event">일정 직접 넣기</button></div></div>`;
      return;
    }
    const now = new Date();
    if (V.cal === "week") {
      const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - (mon.getDay() + 6) % 7);
      box.innerHTML = `<div class="bn-week">${Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon); d.setDate(mon.getDate() + i);
        const evs = list.filter(e => ymd(e.s) === ymd(d));
        return `<div class="bn-wd${ymd(d) === ymd(now) ? " today" : ""}"><h5>${"월화수목금토일"[i]}<b>${d.getDate()}</b></h5>${evs.map(e => `<div class="bn-wev" style="--c:${SRC[e.src]?.[1]}" title="${esc(e.title)}${e.where ? " · " + esc(e.where) : ""}">${e.allDay ? "" : `<small>${hm(e.s)}</small>`}${e.star ? "★ " : ""}${esc(e.title)}</div>`).join("")}</div>`;
      }).join("")}</div>`;
    } else {
      const selected = new Date(`${V.date}T12:00:00`), month = V.month;
      const first = new Date(month.getFullYear(), month.getMonth(), 1), last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
      const today = list.filter(e => e.allDay ? e.s < new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 1) && e.e > new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()) : ymd(e.s) === V.date);
      box.innerHTML = `<div class="bn-month-head"><b>${first.getFullYear()}년 ${first.getMonth() + 1}월</b><div><button type="button" class="bn-month-today">오늘</button><button type="button" class="bn-mini" data-month="-1" aria-label="이전 달">${ico("chev-right")}</button><button type="button" class="bn-mini" data-month="1" aria-label="다음 달">${ico("chev-right")}</button></div></div>
        <div class="bn-month" role="group" aria-label="월간 캘린더">${[..."일월화수목금토"].map(d => `<span class="bn-month-weekday">${d}</span>`).join("")}${Array.from({length: cells}, (_, i) => {
          const d = new Date(first.getFullYear(), first.getMonth(), i - first.getDay() + 1), key = ymd(d), outside = d.getMonth() !== first.getMonth();
          const has = list.some(e => e.allDay ? e.s < new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) && e.e > d : ymd(e.s) === key);
          return `<button type="button" class="bn-month-day${outside ? " outside" : ""}${key === V.date ? " selected" : ""}${has ? " has-events" : ""}" data-date="${key}" aria-label="${d.getMonth() + 1}월 ${d.getDate()}일${has ? " 일정 있음" : ""}" aria-pressed="${key === V.date}"${key === ymd(now) ? ' aria-current="date"' : ""}>${d.getDate()}</button>`;
        }).join("")}</div><h4 class="bn-agenda-date">${selected.getMonth() + 1}월 ${selected.getDate()}일 ${"일월화수목금토"[selected.getDay()]}요일</h4>
        <div class="bn-agenda">${today.length ? today.map(e => `<div class="bn-agenda-row"><time>${e.allDay ? "종일" : hm(e.s)}</time><div class="bn-agenda-event" style="--c:${SRC[e.src]?.[1] || "var(--accent)"}"><b>${esc(e.title)}</b><small>${[SRC[e.src]?.[0], e.where, !e.allDay && `${hm(e.s)}–${hm(e.e)}`].filter(Boolean).map(esc).join(" · ")}</small></div><button type="button" class="bn-agenda-pin" data-pin="${esc(e.title)}" data-when="${esc(e.start)}" aria-label="${esc(e.title)} 중요 일정으로 고정">${ico("pin")}</button></div>`).join("") : '<p class="bn-empty">불러온 일정에 이 날짜의 일정이 없어요.</p>'}</div>`;
      box.querySelectorAll("[data-month]").forEach(b => b.onclick = () => { V.month = new Date(month.getFullYear(), month.getMonth() + +b.dataset.month, 1); drawCal(); });
      box.querySelectorAll("[data-date]").forEach(b => b.onclick = () => { V.date = b.dataset.date; V.month = new Date(`${V.date.slice(0, 7)}-01T12:00:00`); drawCal(); });
      box.querySelector(".bn-month-today").onclick = () => { V.date = ymd(new Date()); V.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); drawCal(); };

    }
    for (const b of box.querySelectorAll("[data-pin]")) b.onclick = async () => {
      if (CFG.pins.some(p => p.title === b.dataset.pin && p.when === b.dataset.when)) return toast("이미 고정한 일정이에요");
      try { await save("pins", [...CFG.pins, { title: b.dataset.pin, when: b.dataset.when }]); drawFloats(); place(); toast("중요 일정으로 위에 고정했어요"); } catch (e) { toast(e.message, "error"); }
    };
  }

  // 루틴 (Moxie jornada·brinco·racha)
  function drawRoutines() {
    const box = $b("bnRt"), now = new Date(), today = ymd(now);
    if (!loaded) { box.innerHTML = loadingNote; return; }
    if (offline) { box.innerHTML = offlineNote("루틴"); $b("bnStreak").innerHTML = ""; return; }
    const list = CFG.routines;
    $b("bnRtSub").textContent = list.length ? `오늘 ${list.filter(r => r.days.includes(dayKey(now))).length}개` : "";
    if (!list.length) {
      box.innerHTML = `<div class="bn-setup">${ico("repeat")}<b>루틴을 등록하세요</b><p>매일·매주 확인할 일(회고, 일정 확인)이나, 정해진 시간에 AI 팀에게 맡길 업무(메일 정리, 주간 보고서)를 등록해요.</p><div><button type="button" class="bn-btn pri" data-act="routines">루틴 추가</button></div></div>`;
      $b("bnStreak").innerHTML = ""; return;
    }
    box.innerHTML = list.map(r => {
      const todayOn = r.days.includes(dayKey(now)), done = !!r.checks?.[today];
      const days = r.days.length === 7 ? "매일" : r.days.join() === "mon,tue,wed,thu,fri" ? "평일" : r.days.map(d => DAY_KO[d]).join("·");
      return `<div class="bn-rtrow${done ? " done" : ""}${todayOn ? "" : " off"}" data-id="${r.id}"><span class="bn-rtic${r.kind === "auto" ? " auto" : ""}">${ico(r.kind === "auto" ? "zap" : "check")}</span>
        <b>${esc(r.name)}</b><small>${days} ${r.at}${r.kind === "auto" ? ` · 자동 실행${r.on ? "" : " 꺼짐"} <em>(예약 실행은 다음 단계)</em>` : todayOn ? "" : " · 오늘 아님"}</small>
        ${r.kind === "auto" ? `<button type="button" class="bn-sw" role="switch" aria-checked="${r.on}" aria-label="${esc(r.name)} 켜기"></button>` : `<button type="button" class="bn-ck" role="checkbox" aria-checked="${done}" aria-label="${esc(r.name)} 오늘 확인"${todayOn ? "" : " disabled"}>${ico("check")}</button>`}</div>`;
    }).join("");
    box.onclick = async e => {
      const row = e.target.closest(".bn-rtrow"); if (!row) return;
      const r = CFG.routines.find(x => x.id === row.dataset.id), ck = e.target.closest(".bn-ck"), sw = e.target.closest(".bn-sw");
      if (!r || (!ck && !sw) || (ck && ck.disabled)) return;
      const b = ck || sw;
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      try {
        if (ck) {
          const done = ck.getAttribute("aria-checked") !== "true";
          ck.setAttribute("aria-checked", done); row.classList.toggle("done", done);
          const res = await api(`/api/brain/routines/${r.id}/check`, { method: "POST", body: JSON.stringify({ day: ymd(new Date()), done }) });
          if (!res.ok) throw new Error("저장하지 못했어요");
          CFG = await res.json();
        } else {
          sw.setAttribute("aria-checked", String(!r.on));
          await save("routines", CFG.routines.map(x => x.id === r.id ? { ...x, on: !x.on } : x));
        }
        drawBrief(); drawStreak(); setTimeout(drawRoutines, 450);
      } catch (err) { toast(err.message, "error"); drawRoutines(); }
    };
    drawStreak();
  }
  function drawStreak() {
    const checks = CFG.routines.filter(r => r.kind === "check");
    if (!checks.length) { $b("bnStreak").innerHTML = ""; return; }
    const cells = [], now = new Date();
    let streak = 0, counting = true;
    for (let i = 83; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const due = checks.filter(r => r.days.includes(dayKey(d))), done = due.filter(r => r.checks?.[ymd(d)]).length;
      cells.push(due.length ? done / due.length : -1);
    }
    for (let i = cells.length - 1; i >= 0 && counting; i--) { if (cells[i] === -1) continue; if (cells[i] >= 1) streak++; else if (i !== cells.length - 1) counting = false; }
    $b("bnStreak").innerHTML = `<small>최근 12주 루틴 확인 · 연속 <b>${streak}일</b></small><div>${cells.map((v, i) => `<i style="--v:${Math.max(0, v)}${v < 0 ? ";opacity:.35" : ""};animation-delay:${(i % 7 + Math.floor(i / 7)) * 12}ms"></i>`).join("")}</div>`;
  }

  // 바로가기 (Moxie iman: 자석 아이콘)
  function drawApps() {
    const box = $b("bnApps");
    if (!loaded) { box.innerHTML = loadingNote; return; }
    if (offline) { box.innerHTML = offlineNote("바로가기"); return; }
    $b("bnAppsSub").title = VERCEL ? (VERCEL.connected ? `Vercel ${VERCEL.via === "env" ? "토큰(.env)" : "CLI 로그인"}으로 연결됨${VERCEL.synced ? ` · ${VERCEL.synced.slice(11)} 동기화` : ""} — 새 프로젝트는 6시간마다 자동으로 더해요` : VERCEL.error) : "";
    box.innerHTML = CFG.shortcuts.map(s => `<a class="bn-app" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.name)} — ${esc(s.url)}" style="--c:${esc(s.color)}"><span class="bn-tile">${esc(s.abbr)}</span><span>${esc(s.name)}</span></a>`).join("") +
      `<button type="button" class="bn-app" data-act="shortcuts" title="바로가기 추가"><span class="bn-tile add">${ico("plus")}</span><span>추가</span></button>`;
    if (reduce()) return;
    for (const a of box.querySelectorAll("a.bn-app")) {
      const t = a.querySelector(".bn-tile");
      a.onpointermove = e => { const r = t.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; t.style.transition = "transform .1s"; t.style.transform = `translate(${dx * .22}px,${dy * .22}px) rotate(${dx * .12}deg) scale(1.08)`; };
      a.onpointerleave = () => { t.style.transition = "transform .55s cubic-bezier(.34,1.56,.64,1)"; t.style.transform = ""; };
    }
  }

  // 메일·회의록: 다음 단계에서 연결(무엇이 필요한지 안내)
  const TAG = { reply: ["답장·할 일", "reply"], important: ["중요", "imp"], info: ["참고", "info"], ad: ["광고·알림", "ad"] };
  let mailAsked = false; // '다시 불러오기'를 누른 뒤 끝나면 몇 통 더했는지 알린다
  async function loadMail(refresh = false) {
    clearTimeout(mailT);
    if (refresh) mailAsked = true;
    const wasLoading = MAIL?.loading;
    try { MAIL = await getJSON(`/api/brain/mail${refresh ? "?refresh=1" : ""}`); }
    catch { MAIL = MAIL || { enabled: false, offline: true }; }
    drawMail(); drawBrief(); drawFloats();
    if (MAIL?.pending || MAIL?.loading) { mailT = setTimeout(() => loadMail(), 10_000); return; } // 가져오기·요약이 끝날 때까지
    if (MAIL?.enabled) loadMcal();
    if (mailAsked && (wasLoading || refresh) && MAIL?.enabled) {
      mailAsked = false;
      toast(MAIL.error ? MAIL.error : MAIL.added ? `새 업무 메일 ${MAIL.added}통을 더했어요` : "새로 온 업무 메일이 없어요", MAIL.error ? "error" : "info", 3500);
    }
  }
  const ago = iso => { if (!iso) return ""; const d = new Date(iso), t = new Date(); return ymd(d) === ymd(t) ? hm(d) : `${d.getMonth() + 1}/${d.getDate()}`; };
  // 메일 모달: 정보 + 요약 + (Claude 가 그 스레드만 읽어 만든) 요점·할 일 + Gmail 에서 열기
  const gmailLink = m => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.thread || m.id)}`;
  function mailDialog(m) {
    if (!m) return;
    const t = TAG[m.tag], when = m.date ? `${m.date.slice(0, 10).replace(/-/g, ".")} ${m.date.slice(11)}` : "";
    const info = h(`<dl class="bn-minfo">
      <dt>보낸 사람</dt><dd><b>${esc(m.from)}</b>${m.addr ? ` <span>&lt;${esc(m.addr)}&gt;</span>` : ""}</dd>
      <dt>받은 시각</dt><dd>${esc(when) || "—"}${m.unread ? ' <em class="bn-tag info">안 읽음</em>' : ""}</dd>
      <dt>분류</dt><dd>${t ? `<em class="bn-tag ${t[1]}">${t[0]}</em>` : "—"}${m.due ? ` <em class="bn-tag due">마감 ${esc(m.due.replace(/-/g, "."))}</em>` : ""}</dd></dl>`);
    const detail = h(`<div class="bn-mdetail"><h3 class="sec">자세히</h3><p class="bn-empty"><span class="bn-think2">Claude 가 이 메일을 읽고 정리하는 중… (30초쯤)</span></p></div>`);
    openModal([sheetHead(m.subject, `${m.from}${when ? ` · ${when}` : ""}`), el("div", { class: "sheet-body bn-mailmodal" },
      info, h(`<div class="bn-msummary"><h3 class="sec">요약</h3><p>${esc(m.summary || m.snippet || "요약이 아직 없어요.")}</p></div>`), detail),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", text: "닫기", onclick: closeModal }),
        el("a", { class: "btn primary", href: gmailLink(m), target: "_blank", rel: "noopener noreferrer", text: "Gmail 에서 열기 ↗" }))]);
    let tries = 0;
    const poll = async () => {
      if (!detail.isConnected) return;
      let d;
      try { d = await getJSON(`/api/brain/mail/detail?id=${encodeURIComponent(m.id)}`); } catch (e) { d = { ready: true, error: e.message }; }
      if (!detail.isConnected) return;
      if (!d.ready && ++tries < 40) return setTimeout(poll, 3000);
      detail.innerHTML = `<h3 class="sec">자세히${d.messages > 1 ? ` <small>· 메일 ${d.messages}통 스레드</small>` : ""}</h3>` + (d.error && !d.points?.length ? `<p class="bn-empty bn-err">${ico("alert")}${esc(d.error || "정리하지 못했어요")}</p>` :
        `${d.people ? `<p class="bn-mpeople">${ico("users")}${esc(d.people)}</p>` : ""}<ul>${(d.points || []).map(p => `<li>${esc(p)}</li>`).join("")}</ul>` +
        (d.actions?.length ? `<h3 class="sec">할 일</h3><ul class="bn-macts">${d.actions.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""));
    };
    poll();
  }
  /* ───────── 메일 → 일정 제안(승인해야 등록) ───────── */
  const KIND = { meeting: "일정", deadline: "마감", period: "기간" };
  const mdLabel = x => {
    const s = new Date(x.start), e = new Date(x.end || x.start), wd = d => "일월화수목금토"[d.getDay()];
    const day = d => `${d.getMonth() + 1}/${d.getDate()}(${wd(d)})`;
    if (x.allDay) return ymd(s) === ymd(e) ? day(s) : `${day(s)}~${day(e)}`;
    return `${day(s)} ${hm(s)}${ymd(s) === ymd(e) ? `–${hm(e)}` : ` ~ ${day(e)} ${hm(e)}`}`;
  };
  async function loadMcal(refresh = false) {
    clearTimeout(mcalT);
    try { MCAL = await getJSON(`/api/brain/mailcal${refresh ? "?refresh=1" : ""}`); } catch { return; }
    const ids = new Set((MCAL.items || []).map(x => x.id));
    if (mcalKnown && !MCAL.loading) {   // 새로 찾은 제안이 있으면 알린다(처음 열 때는 조용히)
      const fresh = [...ids].filter(i => !mcalKnown.has(i)).length;
      if (fresh) toast(`메일에서 일정 ${fresh}건을 찾았어요 — 이메일 브리핑에서 등록하거나 취소하세요`, "info", 6000);
    }
    if (!MCAL.loading) mcalKnown = ids;
    drawMcal();
    if (MCAL.loading) mcalT = setTimeout(() => loadMcal(), 8000);
  }
  function drawMcal() {
    const box = $b("bnMcal"), items = MCAL?.items || [];
    box.hidden = !MCAL || (!items.length && !MCAL.loading);
    if (box.hidden) return;
    box.innerHTML = `<div class="bn-mcal-head">${ico("calendar")}<b>메일에서 찾은 일정</b>${items.length ? `<em>${items.length}</em>` : ""}<small>${MCAL.loading ? `<span class="bn-think2">메일 ${MCAL.looking}통에서 일정을 찾는 중…</span>` : "등록해야 캘린더에 들어가요"}</small></div>
      <div class="bn-mcal-list">${items.map(x => `<div class="bn-mcal-row" data-id="${esc(x.id)}">
        <span class="bn-mcal-when"><em class="bn-tag ${x.kind === "deadline" ? "due" : "info"}">${KIND[x.kind] || "일정"}</em>${esc(mdLabel(x))}</span>
        <button type="button" class="bn-mcal-title" data-mail="${esc(x.mail)}" title="원래 메일 보기">${esc(x.title)}<small>${esc([x.where, x.from].filter(Boolean).join(" · "))}</small></button>
        <span class="bn-mcal-acts"><button type="button" class="bn-btn pri" data-ok="${esc(x.id)}">등록</button><button type="button" class="bn-btn" data-no="${esc(x.id)}">취소</button></span></div>`).join("")}</div>`;
    box.onclick = async e => {
      const ok = e.target.closest("[data-ok]"), no = e.target.closest("[data-no]"), m = e.target.closest("[data-mail]");
      if (ok) return mcalDialog(items.find(x => x.id === ok.dataset.ok));
      if (m) return mailDialog((MAIL?.items || []).find(x => x.id === m.dataset.mail));
      if (no) {
        no.disabled = true;
        try { await decideMcal(no.dataset.no, { action: "dismiss" }); toast("이 일정은 등록하지 않았어요", "info", 2500); }
        catch (err) { toast(err.message, "error"); no.disabled = false; }
      }
    };
  }
  async function decideMcal(id, body) {
    const r = await api(`/api/brain/mailcal/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `처리하지 못했어요 (${r.status})`);
    if (MCAL) MCAL.items = (MCAL.items || []).filter(x => x.id !== id);
    if (mcalKnown) mcalKnown.delete(id);
    drawMcal();
    if (j.brain) { CFG = j.brain; loadCal(); }
    return j;
  }
  // [등록] → 고칠 수 있는 창(제목·종일·시작·끝·장소·중요). [이대로 등록]을 눌러야 캘린더에 들어간다
  function mcalDialog(x) {
    if (!x) return;
    const f = { title: el("input", { type: "text", value: x.title, maxlength: 80, required: true }),
      allDay: el("input", { type: "checkbox", checked: !!x.allDay }),
      sd: el("input", { type: "date", value: x.start.slice(0, 10) }), st: el("input", { type: "time", value: x.allDay ? "09:00" : x.start.slice(11, 16) }),
      ed: el("input", { type: "date", value: (x.end || x.start).slice(0, 10) }), et: el("input", { type: "time", value: x.allDay ? "10:00" : (x.end || x.start).slice(11, 16) }),
      where: el("input", { type: "text", value: x.where || "", placeholder: "장소(선택)" }), star: el("input", { type: "checkbox", checked: x.kind === "deadline" }) };
    const sync = () => { f.st.hidden = f.et.hidden = f.allDay.checked; };
    f.allDay.onchange = sync; sync();
    f.sd.onchange = () => { if (f.ed.value < f.sd.value) f.ed.value = f.sd.value; };
    const row = (label, ...kids) => el("label", { class: "bn-field" }, el("span", { text: label }), el("span", { class: "bn-mcal-pair" }, ...kids));
    const form = el("form", { class: "bn-form", autocomplete: "off" },
      row("제목", f.title), el("label", { class: "bn-field row" }, el("span", { text: "종일(시간 없이 날짜만)" }), f.allDay),
      row("시작", f.sd, f.st), row("끝", f.ed, f.et), row("장소", f.where),
      el("label", { class: "bn-field row" }, el("span", { text: "중요(위에 띄우기)" }), f.star));
    const why = h(`<div class="bn-msummary"><h3 class="sec">메일에서 찾은 내용</h3><p>${esc(x.why || x.subject)}</p><p class="muted small">${esc(x.from)} · ${esc(x.subject)}</p></div>`);
    const okBtn = el("button", { type: "button", class: "btn primary", text: "이대로 등록", onclick: () => form.requestSubmit() });
    form.onsubmit = async e => {
      e.preventDefault();
      const title = f.title.value.trim();
      if (!title || !f.sd.value) return toast("제목과 시작 날짜를 넣어 주세요", "warn");
      const all = f.allDay.checked, ed = f.ed.value || f.sd.value;
      const start = `${f.sd.value}T${all ? "00:00" : f.st.value || "09:00"}`, end = `${ed}T${all ? "00:00" : f.et.value || f.st.value || "10:00"}`;
      if (end < start) return toast("끝이 시작보다 빨라요", "warn");
      okBtn.disabled = true;
      try { await decideMcal(x.id, { action: "add", title, start, end, allDay: all, where: f.where.value.trim(), star: f.star.checked }); closeModal(); toast(`'${title}' 을(를) 캘린더에 등록했어요`, "info", 3000); }
      catch (err) { toast(err.message, "error"); okBtn.disabled = false; }
    };
    openModal([sheetHead("일정 등록", "메일에서 찾은 일정 — 고친 뒤 등록하세요"), el("div", { class: "sheet-body bn-editor" }, why, form),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", text: "닫기", onclick: closeModal }),
        el("button", { class: "btn", type: "button", text: "등록 안 함", onclick: async () => { try { await decideMcal(x.id, { action: "dismiss" }); closeModal(); toast("이 일정은 등록하지 않았어요", "info", 2500); } catch (err) { toast(err.message, "error"); } } }),
        okBtn)]);
    f.title.focus();
  }
  function drawMail() {
    const box = $b("bnMail");
    seg($b("bnMailView"), V.mail, v => { V.mail = v; store.set("agentOffice.brain.mail", v); drawMail(); });
    $b("bnMailView").hidden = $b("bnMailRefresh").hidden = !MAIL?.enabled;
    if (!MAIL) { box.innerHTML = loadingNote; return; }
    if (MAIL.offline) { box.innerHTML = offlineNote("메일"); return; }
    if (!MAIL.enabled) {
      $b("bnMailSub").textContent = "연결 안 됨";
      box.innerHTML = `<div class="bn-setup">${ico("mail")}<b>Gmail 을 연결하세요</b><p>두 가지 방법이 있어요. ① 서버 컴퓨터의 <code>claude</code> CLI 에 claude.ai Gmail 커넥터가 연결돼 있으면 자동으로 써요(앱 비밀번호 불필요). ② <code>.env</code> 에 Gmail 주소와 <b>앱 비밀번호</b>를 넣어요. 어느 쪽이든 메일함은 읽기만 해요.</p>
        <pre class="bn-code">GMAIL_USER=내주소@gmail.com\nGMAIL_APP_PASSWORD=abcd efgh ijkl mnop</pre><p class="bn-need">앱 비밀번호: Google 계정 → 보안 → 2단계 인증 켜기 → '앱 비밀번호'에서 만들기. 저장하면 서버를 다시 켜지 않아도 돼요.</p>
        <div><button type="button" class="bn-btn pri" id="bnMailRetry">연결 확인</button></div></div>`;
      box.querySelector("#bnMailRetry").onclick = () => { MAIL = null; drawMail(); loadMail(true); };
      return;
    }
    const items = MAIL.items || [], key = items.filter(m => m.tag === "reply" || m.tag === "important" || m.starred || (!m.tag && m.unread));
    $b("bnMailSub").textContent = `최근 ${MAIL.days || 30}일 · 업무 메일 ${MAIL.total ?? items.length}통${MAIL.loading ? " · 새 메일 확인 중…" : MAIL.pending ? ` · ${MAIL.pending}통 요약 중` : MAIL.at ? ` · ${MAIL.at.slice(5, 10).replace("-", "/")} ${MAIL.at.slice(11)}` : ""}`;
    $b("bnMailSub").title = `${MAIL.user} · 제목이 영어로만 된 메일·광고·뉴스레터·알림은 빼고 업무 메일만 쌓아요`;
    $b("bnMailRefresh").disabled = !!MAIL.loading;
    $b("bnMailRefresh").classList.toggle("spin", !!MAIL.loading);
    const note = MAIL.note ? `<p class="bn-note">${ico("info")}${esc(MAIL.note)}</p>` : "";
    if (MAIL.error && !items.length) { box.innerHTML = `${note}<p class="bn-empty bn-err">${ico("alert")}${esc(MAIL.error)}</p>`; return; }
    if (MAIL.loading && !items.length) { box.innerHTML = `${note}<p class="bn-empty"><span class="bn-think2">Claude 가 최근 ${MAIL?.days || 30}일 업무 메일을 읽고 요약하는 중… (1~3분)</span></p>`; return; }
    const list = V.mail === "key" ? key : items;
    if (!list.length) { box.innerHTML = `${note}<p class="bn-empty">${items.length ? "답장할 메일이나 중요한 메일이 없어요. '전체'에서 모두 볼 수 있어요." : `최근 ${MAIL.days || 30}일 안의 업무 메일이 없어요.`}</p>`; return; }
    box.innerHTML = `${note}<div class="bn-mails">${list.map((m, i) => {
      const t = TAG[m.tag];
      return `<button type="button" class="bn-mrow${m.unread ? " unread" : ""}" data-mail="${esc(m.id)}" style="animation-delay:${i * 40}ms" title="눌러서 요약 보기">
        <span class="bn-mav" style="--h:${[...m.from].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(m.from.slice(0, 1))}</span>
        <span class="bn-mwho"><b>${esc(m.from)}</b>${t ? `<em class="bn-tag ${t[1]}">${t[0]}</em>` : ""}${m.due ? `<em class="bn-tag due">~${esc(m.due.slice(5).replace("-", "/"))}</em>` : ""}</span><time>${esc(ago(m.date))}</time>
        <span class="bn-msub">${esc(m.subject)}</span>
        <span class="bn-msum">${m.summary ? esc(m.summary) : `<i class="${MAIL.pending ? "bn-think2" : ""}">${MAIL.pending ? "요약 중…" : esc(m.snippet)}</i>`}</span></button>`;
    }).join("")}</div>`;
    box.querySelector(".bn-mails").onclick = e => { const b = e.target.closest("[data-mail]"); if (b) mailDialog(items.find(m => m.id === b.dataset.mail)); };
  }
  async function loadMeet(refresh = false) {
    clearTimeout(meetT);
    try { MEET = await getJSON(`/api/brain/meetings${refresh ? "?refresh=1" : ""}`); }
    catch { MEET = MEET || { enabled: false, offline: true }; }
    drawMeet(); drawBrief();
    if (MEET?.loading) meetT = setTimeout(() => loadMeet(), 10_000);
  }
  // 회의록 (Moxie acordeon: 하나씩 펼치기 · jornada: 할 일 체크)
  // 노션 주소 → 컴퓨터에서는 노션 앱(notion://)으로 바로, 휴대폰·주소 없음은 웹 주소
  const notionApp = url => {
    const id = String(url || "").replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
    if (!id) return url || "https://www.notion.so/";
    return /Android|iPhone|iPad/i.test(navigator.userAgent) ? `https://www.notion.so/${id}` : `notion://www.notion.so/${id}`;
  };
  function drawMeet() {
    const box = $b("bnMeet");
    $b("bnMeetRefresh").hidden = !MEET?.enabled;
    if (!MEET) { box.innerHTML = loadingNote; return; }
    if (MEET.offline) { box.innerHTML = offlineNote("회의록"); return; }
    if (!MEET.enabled) { box.innerHTML = `<div class="bn-setup">${ico("file")}<b>Notion 회의록</b><p>서버 컴퓨터의 <code>claude</code> CLI 에 claude.ai Notion 커넥터가 연결돼 있으면 회의록을 가져와요.</p></div>`; return; }
    const items = MEET.items || [];
    $b("bnMeetSub").textContent = `Notion${MEET.at ? ` · ${MEET.at.slice(11)} 읽음` : ""}${MEET.loading ? " · 읽는 중…" : ""}`;
    const hint = "";
    // 출처별 묶음: 이름 · 최근 n건 · ✎ 쓰기(노션의 회의록 모음으로) — 각 회의록은 제목 + 한 줄 요약
    const groups = MEET.sources?.length ? MEET.sources : [...new Set(items.map(m => m.source))].map(name => ({ name, count: 0, write: "" }));
    const known = new Set(groups.map(g => g.name));
    const byGroup = groups.map(g => ({ ...g, list: items.filter(m => m.source === g.name).slice(0, g.count || 5) }));
    const rest = items.filter(m => !known.has(m.source));
    if (rest.length) byGroup.push({ name: "기타", count: 0, write: "", list: rest });
    const writeBtn = g => `<a class="bn-mini bn-mwrite" href="${esc(notionApp(g.write))}"${notionApp(g.write).startsWith("notion:") ? "" : ' target="_blank" rel="noopener noreferrer"'} title="${esc(g.name)} 쓰기 — 노션에서 새 회의록" aria-label="${esc(g.name)} 쓰기">${ico("edit")}<span>쓰기</span></a>`;
    if (MEET.error && !items.length) { box.innerHTML = `${hint}<p class="bn-empty bn-err">${ico("alert")}${esc(MEET.error)}</p>`; return; }
    if (!items.length && MEET.loading) { box.innerHTML = hint + `<p class="bn-empty"><span class="bn-think2">Claude 가 Notion 회의록을 읽고 정리하는 중… (1분쯤)</span></p>`; return; }
    let n = 0;
    box.innerHTML = hint + byGroup.map(g => `<div class="bn-mg"><div class="bn-mgh"><b>${esc(g.name)}</b><small>최근 ${g.list.length}건</small>${g.name !== "기타" ? writeBtn(g) : ""}</div>
      ${g.list.length ? `<div class="bn-meets">${g.list.map(m => { const i = n++; return `<section class="bn-mt${i === meetOpen ? " open" : ""}" data-i="${i}">
      <button type="button" class="bn-mth"><b>${esc(m.title)}</b><span>${[m.date && m.date.slice(5).replace("-", "/"), m.attendees].filter(Boolean).map(esc).join(" · ")}</span>
        ${m.summary ? `<i class="bn-mtsum">${esc(m.summary)}</i>` : ""}
        ${m.actions.length ? `<em>${m.actions.filter(a => !a.done).length}/${m.actions.length}</em>` : ""}</button>
      <div class="bn-mtb">${m.points.length ? `<ul>${m.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
        ${m.actions.map((a, j) => `<label class="bn-act${a.done ? " done" : ""}"><input type="checkbox" data-key="${m.id}:${j}"${a.done ? " checked" : ""}><span>${esc(a.text)}${a.owner ? ` <small>· ${esc(a.owner)}</small>` : ""}</span></label>`).join("")}
        <a class="bn-link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">노션에서 열기 ↗</a></div></section>`; }).join("")}</div>`
        : `<p class="bn-empty">최근 30일 안의 ${esc(g.name)} 회의록이 없어요.</p>`}</div>`).join("");
    meetOpen = Math.min(meetOpen, n - 1); // -1 = 모두 접음
    for (const sec of box.querySelectorAll(".bn-mt")) sec.querySelector(".bn-mth").onclick = () => { // 하나만 펼친다
      const open = !sec.classList.contains("open");
      for (const x of box.querySelectorAll(".bn-mt")) x.classList.toggle("open", open && x === sec);
      meetOpen = open ? +sec.dataset.i : -1;
    };
    for (const c of box.querySelectorAll("[data-key]")) c.onchange = async () => {
      c.closest(".bn-act").classList.toggle("done", c.checked);
      try { const r = await api("/api/brain/meetings/check", { method: "POST", body: JSON.stringify({ key: c.dataset.key, done: c.checked }) }); if (!r.ok) throw 0; }
      catch { toast("저장하지 못했어요", "error"); c.checked = !c.checked; c.closest(".bn-act").classList.toggle("done", c.checked); }
    };
  }

  // 스킬 (Moxie hallazgo 찾기 · puntos 페이지 점): 2×2 카드, ▶ 실행(입력이 필요하면 입력 창), 카드를 누르면 편집
  const skKey = sk => `${sk.ai}:${sk.name}`;
  const lastRun = sk => RUNS.find(r => r.ai === sk.ai && r.name === sk.name);
  const shortDesc = sk => sk.label || (sk.desc || "").split(/(?<=[.。!?])\s|;|\(| — | - /)[0].slice(0, 40) || "설명 없음";
  function skState(sk) {
    const r = lastRun(sk);
    if (sk.ai === "gemini") return ["실행 미지원", "off"];
    if (r?.status === "running") return ["실행 중…", "run"];
    if (r?.status === "done") return ["완료 · 결과 보기", "done"];
    if (r?.status === "error") return ["오류 · 보기", "err"];
    return [sk.input ? "입력 화면" : "준비됨", ""];
  }
  function drawSkills() {
    const box = $b("bnSkills"), dots = $b("bnSkDots");
    if (!loaded && !SKILLS) { box.innerHTML = loadingNote; dots.innerHTML = ""; return; }
    if (offline) { box.innerHTML = offlineNote("스킬"); dots.innerHTML = ""; return; }
    if (!SKILLS) { box.innerHTML = `<p class="bn-empty">스킬을 찾는 중…</p>`; return; }
    const q = V.skQ.trim().toLowerCase();
    const list = SKILLS.filter(s => !q || `${s.name} ${s.label} ${s.desc}`.toLowerCase().includes(q));
    $b("bnSkSub").textContent = `${SKILLS.length}`;
    const mark = t => { const at = q ? t.toLowerCase().indexOf(q) : -1; return at < 0 ? esc(t) : `${esc(t.slice(0, at))}<mark>${esc(t.slice(at, at + q.length))}</mark>${esc(t.slice(at + q.length))}`; };
    if (!list.length) { box.innerHTML = `<p class="bn-empty">찾는 스킬이 없어요.</p>`; dots.innerHTML = ""; return; }
    const pages = [];
    for (let i = 0; i < list.length; i += 4) pages.push(list.slice(i, i + 4));
    const keep = box.scrollLeft;
    box.innerHTML = pages.map(pg => `<div class="bn-skpage">${pg.map(sk => {
      const [st, cls] = skState(sk);
      return `<div class="bn-skc${sk.mine ? " mine" : ""}" data-k="${esc(skKey(sk))}" tabindex="0" role="button" aria-label="${esc(sk.name)} 편집">
        <div class="bn-skt"><span>${AI[sk.ai][0]} ·</span> <b>${mark(sk.name)}</b></div><div class="bn-skd">${mark(shortDesc(sk))}</div>
        <div class="bn-skr"><button type="button" class="bn-play ${cls}" data-run aria-label="${esc(sk.name)} 실행"${sk.ai === "gemini" || cls === "run" ? " disabled" : ""}>${cls === "run" ? '<i class="bn-spin"></i>' : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`}</button>
        <span class="bn-skst ${cls}"${cls === "done" || cls === "err" ? " data-result" : ""}>${st}</span></div></div>`;
    }).join("")}</div>`).join("");
    box.scrollLeft = Math.min(keep, box.scrollWidth);
    const n = pages.length, show = Math.min(n, 9);
    dots.innerHTML = n > 1 ? Array.from({ length: show }, (_, i) => `<button type="button" aria-label="${i + 1}쪽"></button>`).join("") + (n > show ? `<small>${n}쪽</small>` : "") : "";
    syncDots();
  }
  const syncDots = () => {
    const box = $b("bnSkills"), w = box.clientWidth || 1, cur = Math.round(box.scrollLeft / w);
    [...$b("bnSkDots").querySelectorAll("button")].forEach((d, i) => d.classList.toggle("on", i === Math.min(cur, 8)));
  };
  $b("bnSkills").addEventListener("scroll", () => requestAnimationFrame(syncDots), { passive: true });
  $b("bnSkDots").addEventListener("click", e => { const d = e.target.closest("button"); if (!d) return; const i = [...$b("bnSkDots").querySelectorAll("button")].indexOf(d); $b("bnSkills").scrollTo({ left: i * $b("bnSkills").clientWidth, behavior: reduce() ? "auto" : "smooth" }); });
  $b("bnSkills").addEventListener("click", e => {
    const card = e.target.closest(".bn-skc"); if (!card) return;
    const sk = SKILLS.find(x => skKey(x) === card.dataset.k); if (!sk) return;
    if (e.target.closest("[data-run]")) return sk.input ? runDialog(sk) : runSkill(sk, "");
    if (e.target.closest("[data-result]")) return resultDialog(lastRun(sk));
    skillEditor(sk);
  });
  $b("bnSkills").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("bn-skc")) e.target.click(); });

  let skT = 0;
  async function loadSkills() { // 한국어 짧은 이름을 짓는 동안(labeling) 가끔 다시 받는다
    clearTimeout(skT);
    try { const r = await getJSON("/api/brain/skills"); SKILLS = r.skills || []; drawSkills(); if (r.labeling) skT = setTimeout(loadSkills, 20_000); } catch {}
  }
  async function loadRuns() {
    clearTimeout(runsT);
    try { RUNS = (await getJSON("/api/brain/skills/runs")).runs || []; } catch { return; }
    drawSkills();
    if (RUNS.some(r => r.status === "running")) runsT = setTimeout(loadRuns, 5000);
  }
  async function runSkill(sk, input) {
    try {
      const r = await api("/api/brain/skills/run", { method: "POST", body: JSON.stringify({ ai: sk.ai, name: sk.name, input }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `실행하지 못했어요 (${r.status})`);
      RUNS = [j, ...RUNS]; drawSkills(); closeModal();
      toast(`'${sk.name}' 실행을 시작했어요. 끝나면 카드에 '완료'가 떠요.`, "info", 3500);
      clearTimeout(runsT); runsT = setTimeout(loadRuns, 5000);
      watchRun(j.id, sk.name);
    } catch (e) { toast(e.message, "error", 6000); }
  }
  const watching = new Set();
  function watchRun(id, name) { // 끝나면 알림
    if (watching.has(id)) return; watching.add(id);
    const tick = async () => {
      await loadRuns();
      const r = RUNS.find(x => x.id === id);
      if (r && r.status !== "running") { watching.delete(id); toast(r.status === "done" ? `스킬 '${name}' 완료 — 카드의 '결과 보기'를 눌러 보세요` : `스킬 '${name}' 실행 오류`, r.status === "done" ? "info" : "error", 6000); return; }
      setTimeout(tick, 6000);
    };
    setTimeout(tick, 6000);
  }
  function runDialog(sk) {
    const input = el("textarea", { class: "bn-runin", rows: 5, placeholder: sk.hint || "스킬에 넘길 내용을 적어 주세요" });
    const go = el("button", { class: "btn primary", type: "button", text: "실행", onclick: () => runSkill(sk, input.value.trim()) });
    openModal([sheetHead(`${sk.name} 실행`, shortDesc(sk)), el("div", { class: "sheet-body bn-editor" },
      h(`<p class="bn-help">결과는 이 스킬 전용 폴더에 만들어져요. 메일·노션·캘린더는 <b>읽기만</b> 하고, 셸 명령은 쓰지 않아요.</p>`), input),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", text: "닫기", onclick: closeModal }), go)]);
    input.focus();
  }
  async function download(run, path) {
    try {
      const r = await api(`/api/brain/skills/runs/${encodeURIComponent(run.id)}/file?path=${encodeURIComponent(path)}`);
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob()), a = el("a", { href: url, download: path.split("/").pop() });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast("파일을 받지 못했어요", "error"); }
  }
  function resultDialog(run) {
    if (!run) return;
    const files = run.files?.length ? el("div", { class: "bn-files" }, el("h3", { class: "sec", text: `만든 파일 · ${run.files.length}개` }),
      ...run.files.map(f => el("button", { type: "button", class: "bn-file", text: f, onclick: () => download(run, f) }))) : null;
    openModal([sheetHead(`${run.name} — ${run.status === "done" ? "결과" : "오류"}`, `${run.started.replace("T", " ")}${run.secs ? ` · ${run.secs}초` : ""}${run.input ? ` · 입력: ${clip(run.input, 40)}` : ""}`),
      el("div", { class: "sheet-body" }, run.status === "error" ? el("div", { class: "err-box", text: run.result }) : md(run.result || "(결과 텍스트 없음)"), files),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn primary", type: "button", text: "닫기", onclick: closeModal }))]);
  }
  async function skillEditor(sk) {
    let file = { content: "", editable: false };
    try { file = await getJSON(`/api/brain/skills/file?ai=${sk.ai}&name=${encodeURIComponent(sk.name)}`); } catch (e) { toast(e.message, "error"); }
    const label = el("input", { value: sk.label || "", placeholder: shortDesc(sk), maxlength: 30 });
    const needs = el("input", { type: "checkbox", checked: !!sk.input });
    const body = el("textarea", { class: "bn-skmd", rows: 16, spellcheck: "false", readonly: !file.editable }, );
    body.value = file.content;
    const runs = RUNS.filter(r => r.ai === sk.ai && r.name === sk.name).slice(0, 5);
    const save = el("button", { class: "btn primary", type: "button", text: "저장", onclick: async () => {
      save.disabled = true;
      try {
        const r = await api("/api/brain/skills/file", { method: "PUT", body: JSON.stringify({ ai: sk.ai, name: sk.name, label: label.value.trim(), input: needs.checked, ...(file.editable && body.value !== file.content ? { content: body.value } : {}) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : "저장하지 못했어요");
        SKILLS = (await getJSON("/api/brain/skills")).skills || SKILLS; drawSkills(); closeModal(); toast("스킬을 저장했어요", "info", 2500);
      } catch (e) { toast(e.message, "error"); }
      save.disabled = false;
    } });
    openModal([sheetHead(sk.name, `${AI[sk.ai][0]} · ${sk.mine ? "직접 만든 스킬" : "설치한 스킬(읽기 전용)"} · ${file.path || sk.path}`), el("div", { class: "sheet-body bn-editor" },
      el("div", { class: "bn-form" }, el("label", { class: "bn-field", "data-k": "name" }, el("span", { text: "카드에 보일 짧은 이름" }), label),
        el("label", { class: "bn-field row" }, el("span", { text: "실행 전에 입력 받기(입력 화면)" }), needs)),
      el("h3", { class: "sec", text: file.editable ? "SKILL.md 편집" : "SKILL.md (설치한 스킬은 고칠 수 없어요)" }), body,
      runs.length ? el("div", { class: "bn-files" }, el("h3", { class: "sec", text: "최근 실행" }), ...runs.map(r => el("button", { type: "button", class: "bn-file", text: `${r.started.replace("T", " ").slice(5, 16)} · ${{ running: "실행 중", done: "완료", error: "오류" }[r.status]}`, onclick: () => r.status !== "running" && resultDialog(r) }))) : null),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", text: "닫기", onclick: closeModal }),
        sk.ai !== "gemini" ? el("button", { class: "btn", type: "button", text: "▶ 실행", onclick: () => (needs.checked ? runDialog(sk) : runSkill(sk, "")) }) : null, save)]);
  }
  $b("bnSkQ").addEventListener("input", e => { V.skQ = e.target.value; drawSkills(); });

  function drawWork() {
    const tasks = D.shown ? [...D.shown.tasks.values()] : [];
    const live = D.running && !/완료|중단/.test(D.phaseText);
    $b("bnWorkSub").textContent = live ? `· ${D.phaseText}` : tasks.length ? `${tasks.filter(isFin).length}/${tasks.length} 완료` : "";
  }

  /* ───────── 편집 창 (앱 모달) ───────── */
  const FIELDS = {
    shortcuts: { title: "바로가기", sub: "Vercel 등 자주 여는 주소를 아이콘으로", row: x => `${x.name} · ${x.url}`, fields: [
      { k: "name", label: "이름", ph: "예: 에이전트 오피스", req: true }, { k: "url", label: "주소", type: "url", ph: "https://내프로젝트.vercel.app", req: true },
      { k: "abbr", label: "아이콘 글자(최대 3자)", ph: "AO" }, { k: "color", label: "색", type: "color", def: "#5558e6" }] },
    routines: { title: "루틴", sub: "확인 체크 · 정해진 시간에 AI 팀에게 맡길 업무", row: x => `${x.name} · ${x.kind === "auto" ? "자동" : "확인"} ${x.at}`, fields: [
      { k: "name", label: "이름", ph: "예: 오늘 회고 적기", req: true }, { k: "kind", label: "종류", type: "select", opts: [["check", "확인 체크(직접)"], ["auto", "자동 실행(AI 팀에게 맡김)"]] },
      { k: "at", label: "시간", type: "time", def: "09:00" }, { k: "days", label: "요일", type: "days" },
      { k: "goal", label: "맡길 업무(자동 실행)", type: "textarea", ph: "예: 오늘 받은 메일을 요약하고 답장할 것만 정리해 줘", show: f => f.kind.value === "auto" }] },
    pins: { title: "중요 일정 고정", sub: "화면 맨 위에 떠 있는 중요 일정", row: x => `${x.title} · ${x.when.replace("T", " ")}`, fields: [
      { k: "title", label: "제목", req: true }, { k: "when", label: "날짜·시간", type: "datetime-local", req: true }, { k: "note", label: "메모" }] },
    events: { title: "일정 직접 넣기", sub: "연결한 캘린더에 없는 일정", row: x => `${x.title} · ${x.start.replace("T", " ")}`, fields: [
      { k: "title", label: "제목", req: true }, { k: "start", label: "시작", type: "datetime-local", req: true }, { k: "end", label: "끝", type: "datetime-local" },
      { k: "where", label: "장소" }, { k: "star", label: "중요(위에 띄우기)", type: "check" }] },
    meetings: { title: "회의 지정", sub: "브레인에 보여 줄 노션 회의(주간회의·팀별 미팅)", row: x => `${x.name} · ${x.ref} · ${x.count || 2}건`, fields: [
      { k: "name", label: "이름", ph: "예: 주간회의", req: true }, { k: "ref", label: "노션 페이지·데이터베이스 주소 또는 검색어", ph: "https://www.notion.so/… 또는 '디자인팀 미팅'", req: true }, { k: "write", label: "'쓰기'가 열 노션 주소(선택)", ph: "회의록 모음 보기의 링크 — 비우면 위 주소" }, { k: "count", label: "보여 줄 최근 회의록", type: "select", def: "2", opts: [["1", "1건"], ["2", "2건"], ["3", "3건"], ["4", "4건"], ["5", "5건"]] }],
      help: `회의록이 모이는 <b>노션 페이지나 데이터베이스 주소</b>(공유 → 링크 복사)를 넣으면 그 안에서, <b>검색어</b>를 넣으면 노션 검색으로 최근 30일 회의록을 찾아요. 주소를 넣으면 '쓰기' 단추가 그 페이지를 열어요. 이 컴퓨터의 Claude 에 연결된 Notion 으로 <b>읽기만</b> 해요.` },
    calendars: { title: "캘린더 연결", sub: "iCal 주소로 구독 — 주소는 서버에만 저장되고 화면에 다시 보이지 않아요", row: x => `${x.name} · ${SRC[x.kind]?.[0]} · ${x.host || ""}`, fields: [
      { k: "name", label: "이름", ph: "예: 회사 캘린더", req: true }, { k: "kind", label: "어디 캘린더", type: "select", opts: [["google", "Google 캘린더"], ["phone", "휴대폰(iCloud)"], ["notion", "Notion"], ["other", "기타 .ics"]] },
      { k: "url", label: "iCal 주소", type: "url", ph: "https://calendar.google.com/calendar/ical/…/basic.ics", req: "new" }],
      help: `<b>Google 캘린더</b>: 웹 설정 → 해당 캘린더 → '캘린더 통합' → <b>iCal 형식의 비공개 주소</b> 복사.<br><b>아이폰(iCloud)</b>: 캘린더 앱 → 캘린더 목록의 ⓘ → '공개 캘린더' 켜고 링크 공유(링크를 아는 사람은 볼 수 있어요). 아이폰 일정을 Google 캘린더로 동기화했다면 Google 주소만 넣어도 돼요.<br><b>Notion 캘린더</b>는 iCal 주소가 없어 다음 단계에서 노션 연결로 가져와요.` },
  };
  function editor(kind) {
    const spec = FIELDS[kind];
    let items = structuredClone(CFG[kind] || []), editing = -1;
    const list = el("div", { class: "bn-elist" });
    const form = el("form", { class: "bn-form", autocomplete: "off" });
    const inputs = {};
    for (const f of spec.fields) {
      let input;
      if (f.type === "select") input = el("select", { name: f.k }, ...f.opts.map(([v, t]) => el("option", { value: v, text: t })));
      else if (f.type === "textarea") input = el("textarea", { name: f.k, rows: 3, placeholder: f.ph || "" });
      else if (f.type === "check") input = el("input", { type: "checkbox", name: f.k });
      else if (f.type === "days") input = el("span", { class: "bn-days" }, ...DAYS.map(d => el("label", null, el("input", { type: "checkbox", value: d, checked: true }), DAY_KO[d])));
      else input = el("input", { type: f.type || "text", name: f.k, placeholder: f.ph || "", value: f.def || "" });
      inputs[f.k] = input;
      form.append(el("label", { class: `bn-field${f.type === "check" ? " row" : ""}`, "data-k": f.k }, el("span", { text: f.label }), input));
    }
    const addBtn = el("button", { type: "submit", class: "btn primary", text: "목록에 넣기" });
    form.append(el("div", { class: "bn-formfoot" }, addBtn, el("button", { type: "button", class: "btn", text: "비우기", onclick: () => reset() })));
    const vis = () => { for (const f of spec.fields) if (f.show) form.querySelector(`[data-k="${f.k}"]`).hidden = !f.show(inputs); };
    form.addEventListener("change", vis);
    const val = () => {
      const o = {};
      for (const f of spec.fields) {
        const i = inputs[f.k];
        if (f.type === "check") o[f.k] = i.checked;
        else if (f.type === "days") o[f.k] = [...i.querySelectorAll("input:checked")].map(x => x.value);
        else o[f.k] = i.value.trim();
      }
      return o;
    };
    function reset() {
      editing = -1; addBtn.textContent = "목록에 넣기";
      for (const f of spec.fields) { const i = inputs[f.k]; if (f.type === "check") i.checked = false; else if (f.type === "days") i.querySelectorAll("input").forEach(x => { x.checked = true; }); else i.value = f.def || (f.type === "select" ? f.opts[0][0] : ""); }
      if (inputs.url && kind === "calendars") inputs.url.placeholder = spec.fields.find(f => f.k === "url").ph;
      vis();
    }
    function fill(i) {
      editing = i; const x = items[i]; addBtn.textContent = "바꾸기";
      for (const f of spec.fields) {
        const inp = inputs[f.k], v = x[f.k];
        if (f.type === "check") inp.checked = !!v;
        else if (f.type === "days") inp.querySelectorAll("input").forEach(c => { c.checked = (v || DAYS).includes(c.value); });
        else inp.value = v ?? "";
      }
      if (kind === "calendars") { inputs.url.value = ""; inputs.url.placeholder = `그대로 두면 기존 주소(${x.host || "숨김"}) 유지`; }
      vis(); inputs[spec.fields[0].k].focus();
    }
    function drawList() {
      list.replaceChildren(...(items.length ? items.map((x, i) => el("div", { class: `bn-erow${i === editing ? " on" : ""}` },
        el("button", { type: "button", class: "bn-etext", text: spec.row(x), title: "눌러서 고치기", onclick: () => { fill(i); drawList(); } }),
        el("button", { type: "button", class: "icon-btn", "aria-label": "지우기", title: "지우기", onclick: () => { items.splice(i, 1); if (editing === i) reset(); drawList(); } }, icon("x"))))
        : [el("p", { class: "muted small", text: "아직 없어요. 아래에서 넣어 주세요." })]));
    }
    form.onsubmit = e => {
      e.preventDefault();
      const o = val();
      for (const f of spec.fields) if ((f.req === true || (f.req === "new" && editing < 0)) && !o[f.k]) { toast(`${f.label}을(를) 입력하세요`, "warn"); inputs[f.k].focus(); return; }
      if (kind === "events" && !o.end) o.end = o.start;
      if (editing >= 0) { const prev = items[editing]; items[editing] = { ...prev, ...o, ...(kind === "calendars" && !o.url ? { url: undefined } : {}) }; }
      else items.push(o);
      reset(); drawList();
    };
    const saveBtn = el("button", { type: "button", class: "btn primary", text: "저장", onclick: async () => {
      saveBtn.disabled = true;
      try {
        await save(kind, items.map(x => { const y = { ...x }; if (kind === "calendars" && !y.url) delete y.url; delete y.host; return y; }));
        if (kind === "calendars" || kind === "events") CAL = await getJSON("/api/brain/calendar");
        if (kind === "meetings") { MEET = null; loadMeet(true); }
        closeModal(); render(); toast(`${spec.title} 저장했어요`, "info", 2500);
      } catch (err) { toast(err.message, "error"); }
      saveBtn.disabled = false;
    } });
    reset(); drawList();
    openModal([sheetHead(spec.title, spec.sub), el("div", { class: "sheet-body bn-editor" },
      spec.help ? h(`<p class="bn-help">${spec.help}</p>`) : null, list, el("h3", { class: "sec", text: "넣기 · 고치기" }), form),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", text: "닫기", onclick: closeModal }), saveBtn)]);
  }

  async function importVercel(btn) {
    btn.disabled = true; const label = btn.textContent; btn.textContent = "가져오는 중…";
    try {
      const r = await api("/api/brain/shortcuts/vercel", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `가져오지 못했어요 (${r.status})`);
      CFG = j; VERCEL = { ...(VERCEL || {}), connected: true }; drawApps();
      toast(j.added ? `Vercel 프로젝트 ${j.added}개를 바로가기로 더했어요` : `새로 더할 프로젝트가 없어요 (Vercel ${j.found}개)`, "info", 3500);
    } catch (e) { toast(e.message, "error", 7000); }
    btn.disabled = false; btn.textContent = label;
  }
  ui.addEventListener("click", e => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    if (offline && a.dataset.act !== "board") return toast("서버에 연결되면 설정할 수 있어요", "warn");
    const act = a.dataset.act;
    if (act === "board") return showView("board");
    if (act === "event") return editor("events");
    if (act === "vercel") return importVercel(a);
    if (act === "cals") return editor("calendars");
    editor(act);
  });

  // 중첩 패널·모달·검색 목록까지 실제 스크롤 중에만 얇은 스크롤바를 표시한다.
  const scrollTimers = new WeakMap();
  document.addEventListener("scroll", e => {
    const target = e.target === document ? document.scrollingElement : e.target;
    if (!(target instanceof Element)) return;
    target.classList.add("bn-scrolling");
    clearTimeout(scrollTimers.get(target));
    scrollTimers.set(target, setTimeout(() => { target.classList.remove("bn-scrolling"); scrollTimers.delete(target); }, 850));
  }, { capture: true, passive: true });

  /* ───────── 시작 · 갱신 ───────── */
  // 앱의 상태(업무 진행·연결)가 바뀌면 브리핑·업무 칸을 다시 그린다
  const baseSetPhase = window.setPhase;
  if (typeof baseSetPhase === "function") window.setPhase = function (...a) { const r = baseSetPhase.apply(this, a); if (loaded) { drawBrief(); drawWork(); } return r; };
  const baseConn = window.setConn;
  if (typeof baseConn === "function") window.setConn = function (mode) { const r = baseConn.apply(this, arguments); if (mode === "live" && (offline || (!loaded && !firstLoad))) { firstLoad = load(); loadMail(); loadMeet(); } return r; };
  setInterval(() => { if (loaded && !document.hidden) { drawFloats(); drawBrief(); if (V.cal === "day") drawCal(); } }, 60_000);
  setInterval(() => { if (!document.hidden && !offline) loadCal(); }, 600_000);
  getJSON("/api/notion").then(n => { document.body.dataset.notion = n.enabled ? "on" : "off"; drawMeet(); }, () => {});
  render();
  const loadVercel = () => getJSON("/api/brain/vercel?sync=1").then(v => { const added = v.added && (!VERCEL || VERCEL.added !== v.added); VERCEL = v; if (added) load(); else drawApps(); }, () => {});
  if (NET.mode === "live") { firstLoad = load(); loadMail(); loadMeet(); loadVercel(); } else setTimeout(() => { if (!loaded && !firstLoad) { firstLoad = load(); loadMail(); loadMeet(); } loadVercel(); }, 2500);
  setInterval(() => { if (!document.hidden && VERCEL?.connected) loadVercel(); }, 3_600_000);
  setInterval(() => { if (!document.hidden && MEET?.enabled) loadMeet(); }, 1_800_000);
  $b("bnMeetRefresh").onclick = () => { $b("bnMeetRefresh").classList.add("spin"); MEET = { ...MEET, loading: true }; drawMeet(); loadMeet(true).finally(() => $b("bnMeetRefresh").classList.remove("spin")); };
  setInterval(() => { if (!document.hidden && MAIL?.enabled) loadMail(); }, 600_000);
  $b("bnMailRefresh").onclick = () => { if (MAIL) MAIL = { ...MAIL, loading: true }; drawMail(); loadMail(true); };
  return { reload: load, editor };
})();
