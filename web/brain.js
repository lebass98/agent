"use strict";
/* 브레인 모드(기본 공간) — 시안 A '커맨드 센터'(web/brain-preview/a.html).
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
  let MAIL = null, mailT = 0, MEET = null, meetT = 0, meetOpen = 0; // /api/brain/mail 결과 {enabled, user, items, error, pending, at}
  const V = { mail: store.get("agentOffice.brain.mail") === "all" ? "all" : "key", cal: store.get("agentOffice.brain.cal") === "week" ? "week" : "day", src: new Set(), skAi: "all", skMine: "mine", skQ: "", edit: false };
  let hiddenFloats = new Set();
  try { hiddenFloats = new Set(JSON.parse(sessionStorage.getItem("agentOffice.brain.hide") || "[]")); } catch {}

  /* ───────── 틀 ───────── */
  const ui = h(`<section class="brain" id="brain" aria-label="브레인">
    <div class="bn-floats" id="bnFloats" aria-label="중요 일정"></div>
    <div class="bn-grid">
      <article class="bn-card bn-brief" id="bnBrief"></article>
      <article class="bn-card bn-cal"><header><h3>${ico("calendar")}통합 캘린더</h3><small id="bnCalSub"></small>
        <span class="bn-seg" id="bnCalView"><button type="button" data-v="day">오늘</button><button type="button" data-v="week">주간</button></span>
        <button type="button" class="bn-mini" data-act="event" title="일정 직접 넣기">${ico("plus")}</button><button type="button" class="bn-mini" data-act="cals" title="캘린더 연결">${ico("gear")}</button></header>
        <div class="bn-chips" id="bnSrc"></div><div class="bn-body" id="bnCal"></div></article>
      <article class="bn-card bn-work"><header><h3>${ico("kanban")}진행 중인 업무</h3><small id="bnWorkSub"></small><button type="button" class="bn-more" data-act="board">보드 ›</button></header><div class="bn-body" id="bnWork"></div></article>
      <article class="bn-card bn-rt"><header><h3>${ico("repeat")}루틴</h3><small id="bnRtSub"></small><button type="button" class="bn-more" data-act="routines">+ 추가·편집</button></header><div class="bn-body"><div id="bnRt"></div><div class="bn-streak" id="bnStreak"></div></div></article>
      <article class="bn-card bn-mail"><header><h3>${ico("mail")}메일 요약</h3><small id="bnMailSub">Gmail</small>
        <span class="bn-seg" id="bnMailView"><button type="button" data-v="key">할 일·중요</button><button type="button" data-v="all">전체</button></span>
        <button type="button" class="bn-mini" id="bnMailRefresh" title="지금 새로 받기">${ico("history")}</button></header><div class="bn-body" id="bnMail"></div></article>
      <article class="bn-card bn-meet"><header><h3>${ico("file")}회의록</h3><small id="bnMeetSub">Notion</small>
        <button type="button" class="bn-more" data-act="meetings">회의 지정</button><button type="button" class="bn-mini" id="bnMeetRefresh" title="지금 새로 읽기">${ico("history")}</button></header><div class="bn-body" id="bnMeet"></div></article>
      <article class="bn-card bn-apps"><header><h3>${ico("grid")}바로가기</h3><small id="bnAppsSub"></small><button type="button" class="bn-more" data-act="vercel" title="Vercel 프로젝트를 바로가기로 가져오기">▲ Vercel 가져오기</button><button type="button" class="bn-more" data-act="shortcuts" style="margin-left:6px">편집</button></header><div class="bn-body"><div class="bn-tiles" id="bnApps"></div></div></article>
      <article class="bn-card bn-skills"><header><h3>${ico("sparkles")}스킬</h3><small id="bnSkSub"></small>
        <span class="bn-seg" id="bnSkMine"><button type="button" data-v="mine">내 스킬</button><button type="button" data-v="all">전체</button></span></header>
        <div class="bn-body"><div class="bn-sktools"><span class="bn-seg" id="bnSkAi"><button type="button" data-v="all">전체</button><button type="button" data-v="claude">Claude</button><button type="button" data-v="gpt">GPT</button><button type="button" data-v="gemini">Gemini</button></span>
        <input class="bn-find" id="bnSkQ" placeholder="스킬 찾기" aria-label="스킬 찾기"></div><div id="bnSkills"></div></div></article>
    </div></section>`);
  document.body.append(ui);
  const $b = id => ui.querySelector("#" + id);

  // 3D 사무실·업무 선반 자리에 맞춰 놓는다(데스크톱·휴대폰 배치를 그대로 따른다)
  function place() {
    const f = $("officeFrame")?.getBoundingClientRect(), s = $("taskShelf")?.getBoundingClientRect();
    if (!f || !f.width) return;
    Object.assign(ui.style, { top: `${f.top}px`, left: `${f.left}px`, right: `${innerWidth - f.right}px`, bottom: `${Math.max(0, innerHeight - Math.max(f.bottom, s?.bottom || 0))}px` });
  }
  addEventListener("resize", place);
  if (typeof ResizeObserver === "function") { const ro = new ResizeObserver(place); for (const id of ["officeFrame", "taskShelf"]) if ($(id)) ro.observe($(id)); }
  // 업무 보드 카드(기존 DOM·클릭 동작 그대로)를 '진행 중인 업무' 칸으로 옮긴다
  const pane = document.querySelector('[data-pane="board"]');
  if (pane) $b("bnWork").append(pane);
  // 현재 업무 카드(목표·단계·완료율·새 업무): 데스크톱에서는 사무실 위에 떠 있던 것을 '진행 중인 업무' 칸 맨 위로. 휴대폰은 원래 자리
  const strip = document.querySelector(".run-strip"), mqDesk = matchMedia("(min-width: 761px)");
  const placeStrip = () => {
    if (!strip) return;
    if (mqDesk.matches) $b("bnWork").prepend(strip);
    else if (strip.parentElement !== document.body) document.body.insertBefore(strip, $("officeFrame"));
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
  async function load() {
    try {
      const [cfg, cal] = await Promise.all([getJSON("/api/brain"), getJSON("/api/brain/calendar")]);
      CFG = cfg; CAL = cal; offline = false;
    } catch { offline = true; }
    loaded = true;
    render();
    if (!SKILLS && !offline) getJSON("/api/brain/skills").then(r => { SKILLS = r.skills || []; drawSkills(); }, () => {});
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
    box.hidden = !list.length;
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
        box.hidden = !box.children.length; place();
      };
      return n;
    }));
  }

  // 오늘 브리핑 (Moxie cavila·cifras): 지금 있는 정보로 요약. 메일이 연결되면 답장할 메일도 더한다
  let briefDone = false;
  function drawBrief() {
    const box = $b("bnBrief");
    if (!loaded) { box.innerHTML = `<div class="bn-briefin"><h2>오늘의 브리핑</h2><p><span class="bn-think">일정·루틴·업무 정리하는 중…</span></p></div>`; return; }
    const now = new Date(), today = ymd(now), evs = events().filter(e => ymd(e.s) === today);
    const next = evs.filter(e => !e.allDay && e.s > now)[0], left = evs.filter(e => e.allDay || e.e > now).length;
    const due = CFG.routines.filter(r => r.on && r.kind === "check" && r.days.includes(dayKey(now)));
    const done = due.filter(r => r.checks?.[today]).length;
    const tasks = D.shown ? [...D.shown.tasks.values()] : [], fin = tasks.filter(isFin).length;
    const lines = [];
    if (offline) lines.push("서버에 연결되면 일정·루틴을 모아 보여 드려요.");
    else {
      lines.push(evs.length ? `오늘 일정 ${evs.length}개${next ? `, 다음은 <b>${hm(next.s)} ${esc(next.title)}</b>` : left ? "" : " — 모두 지났어요"}.` : CFG.calendars.length ? "오늘은 잡힌 일정이 없어요." : "캘린더를 연결하면 오늘 일정을 모아 보여 드려요.");
      if (due.length) lines.push(done === due.length ? "오늘 확인할 루틴을 모두 마쳤어요 👏" : `확인할 루틴 ${due.length - done}개가 남았어요.`);
      const reply = (MAIL?.items || []).filter(m => m.tag === "reply");
      if (reply.length) lines.push(`답장·할 일이 있는 메일 <b>${reply.length}통</b>${reply[0] ? ` (${esc(clip(reply[0].from, 12))} — ${esc(clip(reply[0].summary || reply[0].subject, 28))})` : ""}.`);
      const acts = (MEET?.items || []).flatMap(m => m.actions.filter(a => !a.done));
      if (acts.length) lines.push(`회의록에서 나온 할 일 <b>${acts.length}개</b>가 남았어요.`);
      if (D.running) lines.push(`AI 팀이 “${esc(clip(D.shown?.goal || "", 30))}” 업무를 진행 중이에요 (${esc(D.phaseText)}).`);
    }
    const hour = now.getHours(), hi = hour < 11 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "오늘도 수고했어요";
    box.innerHTML = `<div class="bn-briefin"><span class="bn-orb" aria-hidden="true"></span><h2>${hi} 👋</h2><p>${lines.join(" ")}</p>
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

  // 통합 캘린더 (Moxie semana·lunario): 오늘 시간표 / 주간
  function drawCal() {
    seg($b("bnCalView"), V.cal, v => { V.cal = v; store.set("agentOffice.brain.cal", v); drawCal(); });
    const all = events(), srcs = [...new Set(all.map(e => e.src))];
    $b("bnSrc").replaceChildren(...srcs.map(s => {
      const on = !V.src.has(s);
      return h(`<button type="button" class="bn-chip" aria-pressed="${on}" style="--c:${SRC[s]?.[1]}" data-src="${s}"><i></i>${esc(SRC[s]?.[0] || s)}</button>`);
    }));
    $b("bnSrc").onclick = e => { const b = e.target.closest("[data-src]"); if (!b) return; V.src.has(b.dataset.src) ? V.src.delete(b.dataset.src) : V.src.add(b.dataset.src); drawCal(); };
    const bad = (CAL.status || []).filter(s => !s.ok);
    $b("bnCalSub").textContent = offline ? "" : CFG.calendars.length ? `캘린더 ${CFG.calendars.length}개${bad.length ? ` · ${bad.length}개 오류` : ""}` : "연결된 캘린더 없음";
    const box = $b("bnCal"), list = all.filter(e => !V.src.has(e.src));
    if (!loaded) { box.innerHTML = loadingNote; return; }
    if (offline) { box.innerHTML = offlineNote("일정"); return; }
    if (!CFG.calendars.length && !CFG.events.length) {
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
      const today = list.filter(e => ymd(e.s) === ymd(now) || (e.allDay && e.s <= now && e.e > now));
      const timed = today.filter(e => !e.allDay), allDay = today.filter(e => e.allDay);
      const from = Math.max(0, Math.min(8, ...timed.map(e => e.s.getHours()))), to = Math.min(24, Math.max(20, ...timed.map(e => e.e.getHours() + 1)));
      const H = 42, nowY = (now.getHours() + now.getMinutes() / 60 - from) * H;
      box.innerHTML = (allDay.length ? `<div class="bn-allday">${allDay.map(e => `<span style="--c:${SRC[e.src]?.[1]}">${esc(e.title)}</span>`).join("")}</div>` : "") +
        `<div class="bn-day" style="height:${(to - from) * H}px">${Array.from({ length: to - from }, (_, i) => `<div class="bn-hr" style="top:${i * H}px"><span>${pad(from + i)}:00</span></div>`).join("")}
        ${timed.map((e, i) => { const top = (e.s.getHours() + e.s.getMinutes() / 60 - from) * H, ht = Math.max(24, (e.e - e.s) / 36e5 * H - 3);
          return `<div class="bn-ev${e.e < now ? " past" : ""}${e.star ? " star" : ""}" style="--c:${SRC[e.src]?.[1]};top:${top + 1}px;height:${ht}px;animation-delay:${i * 40}ms"><b>${e.star ? "★ " : ""}${esc(e.title)}</b><small>${hm(e.s)}–${hm(e.e)} · ${esc(SRC[e.src]?.[0] || "")}${e.where ? ` · ${esc(e.where)}` : ""}</small><button type="button" class="bn-pin" data-pin="${esc(e.title)}" data-when="${esc(e.start)}" title="중요 일정으로 고정">${ico("pin")}</button></div>`; }).join("")}
        ${nowY > 0 && nowY < (to - from) * H ? `<div class="bn-now" style="top:${nowY}px"></div>` : ""}</div>` + (timed.length || allDay.length ? "" : `<p class="bn-empty">오늘은 일정이 없어요.</p>`);
      if (!box.dataset.scrolled && nowY > 0) { box.dataset.scrolled = "1"; requestAnimationFrame(() => { box.scrollTop = Math.max(0, nowY - 80); }); }
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
    $b("bnAppsSub").textContent = CFG.shortcuts.length ? `${CFG.shortcuts.length}개` : "";
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
  async function loadMail(refresh = false) {
    clearTimeout(mailT);
    try { MAIL = await getJSON(`/api/brain/mail${refresh ? "?refresh=1" : ""}`); }
    catch { MAIL = MAIL || { enabled: false, offline: true }; }
    drawMail(); drawBrief(); drawFloats();
    if (MAIL?.pending || MAIL?.loading) mailT = setTimeout(() => loadMail(), 10_000); // 가져오기·요약이 끝날 때까지 가끔 다시 본다
  }
  const ago = iso => { if (!iso) return ""; const d = new Date(iso), t = new Date(); return ymd(d) === ymd(t) ? hm(d) : `${d.getMonth() + 1}/${d.getDate()}`; };
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
    $b("bnMailSub").textContent = `${MAIL.user}${MAIL.at ? ` · ${MAIL.at.slice(11)} 받음` : ""}${MAIL.loading ? " · 가져오는 중…" : MAIL.pending ? ` · ${MAIL.pending}통 요약 중` : ""}`;
    const note = MAIL.note ? `<p class="bn-note">${ico("info")}${esc(MAIL.note)}</p>` : "";
    if (MAIL.error && !items.length) { box.innerHTML = `${note}<p class="bn-empty bn-err">${ico("alert")}${esc(MAIL.error)}</p>`; return; }
    if (MAIL.loading && !items.length) { box.innerHTML = `${note}<p class="bn-empty"><span class="bn-think2">Claude 가 Gmail 을 읽고 요약하는 중… (30초쯤)</span></p>`; return; }
    const list = V.mail === "key" ? key : items;
    if (!list.length) { box.innerHTML = `${note}<p class="bn-empty">${items.length ? "답장할 메일이나 중요한 메일이 없어요. '전체'에서 모두 볼 수 있어요." : "최근 받은 메일이 없어요."}</p>`; return; }
    box.innerHTML = `${note}<div class="bn-mails">${list.map((m, i) => {
      const t = TAG[m.tag];
      return `<a class="bn-mrow${m.unread ? " unread" : ""}" href="https://mail.google.com/mail/u/0/#all/${esc(m.thread)}" target="_blank" rel="noopener noreferrer" style="animation-delay:${i * 40}ms" title="Gmail 에서 열기">
        <span class="bn-mav" style="--h:${[...m.from].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}">${esc(m.from.slice(0, 1))}</span>
        <span class="bn-mwho"><b>${esc(m.from)}</b>${t ? `<em class="bn-tag ${t[1]}">${t[0]}</em>` : ""}${m.due ? `<em class="bn-tag due">~${esc(m.due.slice(5).replace("-", "/"))}</em>` : ""}</span><time>${esc(ago(m.date))}</time>
        <span class="bn-msub">${esc(m.subject)}</span>
        <span class="bn-msum">${m.summary ? esc(m.summary) : `<i class="${MAIL.pending ? "bn-think2" : ""}">${MAIL.pending ? "요약 중…" : esc(m.snippet)}</i>`}</span></a>`;
    }).join("")}</div>`;
  }
  async function loadMeet(refresh = false) {
    clearTimeout(meetT);
    try { MEET = await getJSON(`/api/brain/meetings${refresh ? "?refresh=1" : ""}`); }
    catch { MEET = MEET || { enabled: false, offline: true }; }
    drawMeet(); drawBrief();
    if (MEET?.loading) meetT = setTimeout(() => loadMeet(), 10_000);
  }
  // 회의록 (Moxie acordeon: 하나씩 펼치기 · jornada: 할 일 체크)
  function drawMeet() {
    const box = $b("bnMeet");
    $b("bnMeetRefresh").hidden = !MEET?.enabled;
    if (!MEET) { box.innerHTML = loadingNote; return; }
    if (MEET.offline) { box.innerHTML = offlineNote("회의록"); return; }
    if (!MEET.enabled) { box.innerHTML = `<div class="bn-setup">${ico("file")}<b>Notion 회의록</b><p>서버 컴퓨터의 <code>claude</code> CLI 에 claude.ai Notion 커넥터가 연결돼 있으면 회의록을 가져와요.</p></div>`; return; }
    const items = MEET.items || [];
    $b("bnMeetSub").textContent = `Notion${MEET.at ? ` · ${MEET.at.slice(11)} 읽음` : ""}${MEET.loading ? " · 읽는 중…" : ""}`;
    const hint = MEET.custom ? "" : `<p class="bn-note">${ico("info")}'회의'로 찾은 최근 회의록이에요. <button type="button" class="bn-link" data-act="meetings">회의 지정</button>에서 주간회의·팀별 미팅 페이지를 정해 주세요.</p>`;
    if (MEET.error && !items.length) { box.innerHTML = `${hint}<p class="bn-empty bn-err">${ico("alert")}${esc(MEET.error)}</p>`; return; }
    if (!items.length) { box.innerHTML = hint + (MEET.loading ? `<p class="bn-empty"><span class="bn-think2">Claude 가 Notion 회의록을 읽고 정리하는 중… (1분쯤)</span></p>` : `<p class="bn-empty">최근 ${14}일 안의 회의록이 없어요.</p>`); return; }
    meetOpen = Math.min(meetOpen, items.length - 1); // -1 = 모두 접음
    box.innerHTML = hint + `<div class="bn-meets">${items.map((m, i) => `<section class="bn-mt${i === meetOpen ? " open" : ""}" data-i="${i}">
      <button type="button" class="bn-mth"><b>${esc(m.title)}</b><span>${[m.source, m.date && m.date.slice(5).replace("-", "/"), m.attendees].filter(Boolean).map(esc).join(" · ")}</span>
        ${m.actions.length ? `<em>${m.actions.filter(a => !a.done).length}/${m.actions.length}</em>` : ""}</button>
      <div class="bn-mtb">${m.points.length ? `<ul>${m.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
        ${m.actions.map((a, j) => `<label class="bn-act${a.done ? " done" : ""}"><input type="checkbox" data-key="${m.id}:${j}"${a.done ? " checked" : ""}><span>${esc(a.text)}${a.owner ? ` <small>· ${esc(a.owner)}</small>` : ""}</span></label>`).join("")}
        <a class="bn-link" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">노션에서 열기 ↗</a></div></section>`).join("")}</div>`;
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

  // 스킬 (Moxie hallazgo: 찾기 하이라이트)
  function drawSkills() {
    seg($b("bnSkMine"), V.skMine, v => { V.skMine = v; drawSkills(); });
    seg($b("bnSkAi"), V.skAi, v => { V.skAi = v; drawSkills(); });
    const box = $b("bnSkills");
    if (offline) { box.innerHTML = offlineNote("스킬"); return; }
    if (!SKILLS) { box.innerHTML = `<p class="bn-empty">스킬을 찾는 중…</p>`; return; }
    const q = V.skQ.trim().toLowerCase();
    const list = SKILLS.filter(s => (V.skMine === "all" || s.mine) && (V.skAi === "all" || s.ai === V.skAi) && (!q || `${s.name} ${s.desc}`.toLowerCase().includes(q)));
    $b("bnSkSub").textContent = `${SKILLS.filter(s => s.mine).length}개 직접 · ${SKILLS.length}개 전체`;
    const mark = t => { const at = q ? t.toLowerCase().indexOf(q) : -1; return at < 0 ? esc(t) : `${esc(t.slice(0, at))}<mark>${esc(t.slice(at, at + q.length))}</mark>${esc(t.slice(at + q.length))}`; };
    box.innerHTML = list.length ? list.slice(0, 80).map(s => `<div class="bn-sk" title="${esc(s.path)}"><span class="bn-ai" style="--c:${AI[s.ai][1]}">${AI[s.ai][2]}</span><b>${mark(s.name)}</b><small>${mark(s.desc || "설명 없음")}</small><em>${s.mine ? "직접" : "설치"}</em></div>`).join("")
      : `<p class="bn-empty">${q ? "찾는 스킬이 없어요." : V.skMine === "mine" ? "직접 만든 스킬이 없어요. '전체'에서 설치한 스킬을 볼 수 있어요." : "스킬이 없어요."}</p>`;
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
    meetings: { title: "회의 지정", sub: "브레인에 보여 줄 노션 회의(주간회의·팀별 미팅)", row: x => `${x.name} · ${x.ref}`, fields: [
      { k: "name", label: "이름", ph: "예: 주간회의", req: true }, { k: "ref", label: "노션 페이지·데이터베이스 주소 또는 검색어", ph: "https://www.notion.so/… 또는 '디자인팀 미팅'", req: true }],
      help: `회의록이 모이는 <b>노션 페이지나 데이터베이스 주소</b>(공유 → 링크 복사)를 넣으면 그 안에서, <b>검색어</b>를 넣으면 노션 검색으로 최근 2주 회의록을 찾아요. 이 컴퓨터의 Claude 에 연결된 Notion 으로 <b>읽기만</b> 해요.` },
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
      CFG = j; drawApps();
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

  /* ───────── 시작 · 갱신 ───────── */
  // 앱의 상태(업무 진행·연결)가 바뀌면 브리핑·업무 칸을 다시 그린다
  const baseSetPhase = window.setPhase;
  if (typeof baseSetPhase === "function") window.setPhase = function (...a) { const r = baseSetPhase.apply(this, a); if (loaded) { drawBrief(); drawWork(); } return r; };
  const baseConn = window.setConn;
  if (typeof baseConn === "function") window.setConn = function (mode) { const r = baseConn.apply(this, arguments); if (mode === "live" && (offline || !loaded)) { load(); loadMail(); loadMeet(); } return r; };
  setInterval(() => { if (loaded && !document.hidden) { drawFloats(); drawBrief(); if (V.cal === "day") drawCal(); } }, 60_000);
  setInterval(() => { if (!document.hidden && !offline) getJSON("/api/brain/calendar").then(c => { CAL = c; drawCal(); drawFloats(); drawBrief(); }, () => {}); }, 600_000);
  getJSON("/api/notion").then(n => { document.body.dataset.notion = n.enabled ? "on" : "off"; drawMeet(); }, () => {});
  render();
  if (NET.mode === "live") { load(); loadMail(); loadMeet(); } else setTimeout(() => { if (!loaded) { load(); loadMail(); loadMeet(); } }, 2500);
  setInterval(() => { if (!document.hidden && MEET?.enabled) loadMeet(); }, 1_800_000);
  $b("bnMeetRefresh").onclick = () => { $b("bnMeetRefresh").classList.add("spin"); MEET = { ...MEET, loading: true }; drawMeet(); loadMeet(true).finally(() => $b("bnMeetRefresh").classList.remove("spin")); };
  setInterval(() => { if (!document.hidden && MAIL?.enabled) loadMail(); }, 600_000);
  $b("bnMailRefresh").onclick = () => { $b("bnMailRefresh").classList.add("spin"); loadMail(true).finally(() => $b("bnMailRefresh").classList.remove("spin")); };
  return { reload: load, editor };
})();
