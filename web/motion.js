"use strict";
/* 화면 모션 — WnC Motion 제안 '풀' 단계 (Moxie proposals/agentoffice.html · demo-agent/full.html).
   app.js·dashboard.js 는 고치지 않고, 전역 함수를 감싸거나 DOM 변화를 지켜보며 붙는다(outside.js 와 같은 방식).
   html.mo 일 때만 움직인다: 설정 '움직임 줄이기'(PREF.reduce)나 시스템 '동작 줄이기'면 모두 끈다. 3D 사무실(three.js)은 건드리지 않는다.
   팀장 계획은 3D 회의실 발표가 이미 보여 주므로 '계획 확인 창'은 넣지 않았다(실행 전 멈추려면 서버 단계가 필요). */
window.Motion = (() => {
  const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  const off = () => !!PREF.reduce || mqReduce.matches;
  const SPRING = "cubic-bezier(.34,1.56,.64,1)";
  const root = document.documentElement;
  const sync = () => root.classList.toggle("mo", !off());
  /** 전역 함수 감싸기: before 의 반환값을 after 에 넘긴다 */
  function wrap(name, after, before) {
    const f = window[name];
    if (typeof f !== "function") return;
    window[name] = function (...args) {
      const b = before && !off() ? before.apply(this, args) : undefined;
      const r = f.apply(this, args);
      if (after && !off()) after.call(this, r, args, b);
      return r;
    };
  }
  const restart = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
  const once = (node, cls, ms) => { restart(node, cls); clearTimeout(node._moT); node._moT = setTimeout(() => node.classList.remove(cls), ms); };

  /* ───────── 미끄러지는 선택 표시 (sintonia · subrayado · segmentos) ───────── */
  function markIn(box, sel, twoEdge) {
    if (!box) return;
    let m = box.querySelector(":scope > .mo-mark");
    if (!m) { m = el("span", { class: "mo-mark mo-instant", "aria-hidden": "true" }); box.prepend(m); }
    const b = box.querySelector(sel);
    if (!b || !b.offsetWidth) { m.style.opacity = "0"; return; }
    const first = m.style.opacity !== "1";
    m.classList.toggle("mo-instant", first);
    const x = b.offsetLeft, y = b.offsetTop;
    if (twoEdge) { // 앞쪽은 빨리, 뒤쪽은 늦게 따라와 늘어났다 줄어든다
      m.classList.toggle("back", x < +(m.dataset.x || 0));
      Object.assign(m.style, { left: `${x}px`, right: `${box.clientWidth - x - b.offsetWidth}px`, width: "auto" });
    } else Object.assign(m.style, { left: `${x}px`, top: `${y}px`, width: `${b.offsetWidth}px`, height: `${b.offsetHeight}px` });
    m.dataset.x = x; m.style.opacity = "1";
    if (first) requestAnimationFrame(() => m.classList.remove("mo-instant"));
  }
  const marks = () => {
    markIn($("sidenav"), "[aria-current='page']");
    markIn(document.querySelector(".room-switch"), "[aria-pressed='true']");
    markIn($("speed"), "button.on", true);
  };

  /* ───────── 업무 카드 (오른쪽 위 현재 업무 띠) ───────── */
  const RUN = { id: null, step: -1, planT0: 0, thoughtFor: null, pct: "", stamped: null };
  function spark(from, to) {   // estados: 빛이 선을 따라 다음 단계로 가고, 도착한 단계가 켜진다
    const box = $("runSteps"), lis = [...box.children];
    if (!lis[to] || !box.offsetWidth) return;
    let s = box.querySelector(".mo-spark");
    if (!s) { s = el("span", { class: "mo-spark", "aria-hidden": "true" }); box.append(s); }
    const cx = li => li.offsetLeft + 8;
    s.animate([{ left: `${cx(lis[from])}px`, opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .85 }, { left: `${cx(lis[to])}px`, opacity: 0 }],
      { duration: 650, easing: "cubic-bezier(.5,0,.3,1)" }).finished.then(() => once(lis[to], "mo-lit", 600), () => {});
  }
  function syncRun() {
    if (off()) return;
    const run = D.shown, tasks = run ? [...run.tasks.values()] : [], fin = tasks.filter(isFin).length;
    const strip = document.querySelector(".run-strip"), phase = $("activePhase");
    if (!strip || !phase) return;
    if (run?.run_id !== RUN.id) { // 새 업무: 도장·접힌 문구 정리
      RUN.id = run?.run_id ?? null; RUN.step = -1; RUN.planT0 = 0; RUN.thoughtFor = null;
      phase.removeAttribute("data-thought");
      strip.querySelector(".mo-stamp")?.remove();
    }
    strip.classList.toggle("mo-going", !!(D.running && tasks.length && fin < tasks.length));
    // cavila: 팀장이 계획하는 동안 빛 띠, 계획이 나오면 "계획 n초"로 접힌다
    const thinking = !!(D.running && run && !tasks.length);
    phase.classList.toggle("mo-think", thinking);
    if (thinking && !RUN.planT0) RUN.planT0 = performance.now();
    if (!thinking && RUN.planT0 && tasks.length && RUN.thoughtFor !== RUN.id) {
      RUN.thoughtFor = RUN.id;
      phase.dataset.thought = `${((performance.now() - RUN.planT0) / 1000).toFixed(1)}초 동안 계획함`;
      setTimeout(() => { if (RUN.thoughtFor === RUN.id) phase.removeAttribute("data-thought"); }, 9000);
    }
    // 단계 이동
    const cur = [...$("runSteps").children].findIndex(li => li.classList.contains("current"));
    if (cur > RUN.step && RUN.step >= 0) spark(RUN.step, cur);
    if (cur >= 0) RUN.step = cur;
    // 완료율 숫자가 바뀌면 아래에서 굴러 올라온다
    const pct = $("completionValue").textContent;
    if (pct !== RUN.pct) { if (RUN.pct && /%/.test(pct)) restart($("completionValue"), "mo-bump"); RUN.pct = pct; }
  }
  function stamp() {   // sello: 검수 통과 순간 "승인" 도장
    const strip = document.querySelector(".run-strip"), r = D.lastRun;
    if (!strip || !r?.report || !D.running || RUN.stamped === r.run_id) return;
    RUN.stamped = r.run_id;
    strip.querySelector(".mo-stamp")?.remove();
    const s = el("span", { class: "mo-stamp", "aria-hidden": "true", text: "승인" });
    strip.append(s); restart(strip, "mo-thud");
    setTimeout(() => s.classList.add("mo-gone"), 7000);
    setTimeout(() => s.remove(), 7700);
  }

  /* ───────── 업무 목록: 상태가 바뀌면 카드가 제자리로 미끄러지고, 막 끝난 카드는 체크가 그려짐 (antesala · jornada) ───────── */
  const BOARDV = new Map();
  const rowKey = r => (r.title || "").replace(/ · 결과 보기$/, "");
  function boardBefore() {
    return new Map([...$("board").querySelectorAll(".trow")].map(r => [rowKey(r), r.getBoundingClientRect()]));
  }
  function boardAfter(_, __, before) {
    const rows = [...$("board").querySelectorAll(".trow")];
    rows.forEach((r, i) => {
      const k = rowKey(r), st = ["doing", "todo", "done", "failed"].find(c => r.classList.contains(c)), was = BOARDV.get(k);
      BOARDV.set(k, st);
      if (was && was !== "done" && st === "done") once(r, "mo-justdone", 1600);
      const a = before?.get(k), b = r.getBoundingClientRect();
      if (!a) { if (before?.size) r.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: SPRING, delay: i * 40 }); return; }
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) r.animate([{ transform: `translate(${dx}px,${dy}px)`, boxShadow: "0 10px 24px rgba(0,0,0,.16)" }, { transform: "none", boxShadow: "none" }], { duration: 620, easing: SPRING });
    });
  }

  /* ───────── 알림 쌓기 (pila) ───────── */
  const baseToast = window.toast;
  function layoutToasts(box) {
    let y = 0, top = 0;
    [...box.children].forEach((t, i) => {
      if (i < 3) { t.style.transform = `translateY(${y}px)`; t.style.opacity = t.classList.contains("show") ? "1" : "0"; top = y; y += t.offsetHeight + 8; }
      else { const k = i - 2; t.style.transform = `translateY(${top + k * 9}px) scale(${1 - k * .05})`; t.style.opacity = k > 2 ? "0" : String(1 - k * .3); }
      t.style.zIndex = String(20 - i);
    });
  }
  function toast(msg, kind = "info", ms = 4500) {
    if (off()) return baseToast(msg, kind, ms);
    const box = $("toasts");
    while (box.childElementCount >= 6) box.lastChild.remove();
    const t = el("div", { class: `toast ${kind} mo-t`, role: kind === "error" ? "alert" : "status" }, msg);
    t.style.transform = "translateY(-28px)"; t.style.opacity = "0";
    box.prepend(t);
    requestAnimationFrame(() => requestAnimationFrame(() => { t.classList.add("show"); layoutToasts(box); }));
    setTimeout(() => {
      t.classList.remove("show"); t.style.opacity = "0"; t.style.transform += " translateX(24px)";
      setTimeout(() => { t.remove(); layoutToasts(box); }, 300);
    }, ms);
  }

  /* ───────── 말풍선: 말하기 전 점 세 개 (respiro) ───────── */
  function patchSay() {
    if (typeof Agent === "undefined" || Agent.prototype._moSay) return;
    const base = Agent.prototype.say;
    Agent.prototype._moSay = base;
    Agent.prototype.say = function (text, ms = 2600) {
      if (off() || this.ghost) return base.call(this, text, ms);
      const dots = Math.min(900, 320 + String(text).length * 14); // 연출 시간 기준(속도 배율을 따른다)
      base.call(this, text, ms ? ms + dots : ms);
      const b = this.bubble, my = (this._moSeq = (this._moSeq || 0) + 1);
      b.replaceChildren(el("span", { class: "mo-dots", "aria-hidden": "true" }, el("i"), el("i"), el("i")));
      this._lw = 0;
      setTimeout(() => { if (this._moSeq === my && b.classList.contains("show")) { b.textContent = text; this._lw = 0; } }, dots / SPEED);
    };
  }

  /* ───────── 활동 로그: 들어오기 (anticipo) ───────── */
  function logAfter() {
    const r = $("log").firstElementChild;
    if (!r?.classList.contains("lrow") || r._mo) return;
    r._mo = true; r.classList.add("mo-pending");
    setTimeout(() => { r.classList.remove("mo-pending"); once(r, "mo-landed", 700); }, 600 / Math.min(SPEED, 2));
  }

  /* ───────── 검색 팔레트: 글자 하이라이트 + 자리 이동 (hallazgo) ───────── */
  function palBefore() { return new Map([...$("paletteList").querySelectorAll(".pitem")].map(b => [b.querySelector(".ptxt")?.textContent, b.getBoundingClientRect()])); }
  function palAfter(_, [q], before) {
    const k = String(q || "").trim();
    [...$("paletteList").querySelectorAll(".pitem")].forEach((b, i) => {
      const t = b.querySelector(".ptxt"), s = t?.textContent || "";
      const at = k ? s.toLowerCase().indexOf(k.toLowerCase()) : -1;
      if (at >= 0) t.replaceChildren(s.slice(0, at), el("mark", { text: s.slice(at, at + k.length) }), s.slice(at + k.length));
      const a = before.get(s), r = b.getBoundingClientRect();
      if (!a) b.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: SPRING, delay: Math.min(i, 8) * 18, fill: "backwards" });
      else if (Math.abs(a.top - r.top) > 1) b.animate([{ transform: `translateY(${a.top - r.top}px)` }, { transform: "none" }], { duration: 420, easing: SPRING });
    });
  }

  /* ───────── 보고서: 처음 열 때 흘러 들어오기 (raudal) · 지난 업무 불러오는 동안 스켈레톤 (esqueleto) ───────── */
  let streamT = 0;
  function reportBefore(v) { return !!(v?.report && v.run_id != null && store.get(REPORT_SEEN) !== String(v.run_id)); }
  function reportAfter(_, __, unread) {
    if (!unread) return;
    const box = $("sheet")?.querySelector(".sheet-body .md");
    if (!box) return;
    const blocks = [...box.children];
    box.classList.add("mo-stream");
    const caret = el("span", { class: "mo-caret", "aria-hidden": "true" });
    clearTimeout(streamT);
    let i = 0;
    const next = () => {
      if (!box.isConnected) return;
      const b = blocks[i++];
      if (!b) { caret.remove(); box.classList.remove("mo-stream"); return; }
      b.classList.add("mo-in");
      (b.matches("ul,ol") ? b.lastElementChild || b : b.matches("table") ? b.querySelector("tr:last-child > :last-child") || b : b).append(caret);
      streamT = setTimeout(next, Math.min(420, 90 + b.textContent.length * 3) / Math.min(SPEED, 2));
    };
    next();
  }
  function runAfter() {
    const body = $("sheet")?.querySelector(".sheet-body");
    const p = body?.firstElementChild;
    if (body && p?.classList.contains("muted") && body.childElementCount === 1)
      body.replaceChildren(el("div", { class: "mo-bone h" }), ...[92, 80, 96, 64, 88, 72].map(w => el("div", { class: "mo-bone", style: { width: `${w}%` } })));
  }

  /* ───────── 입력창: 추천 지시 · 보낼 때 빛 (pregunta) ───────── */
  const EXAMPLES = ["오늘 할 일 정리하고 우선순위 매기기", "랜딩 페이지 문구 다듬기", "회의록 요약해서 할 일 뽑기"];
  let sugg = null;
  function drawSugg() {
    if (!sugg) return;
    const g = $("goal"), show = !off() && document.activeElement === g && !g.value.trim() && !D.running && !UI.submitting && !g.disabled;
    if (!show) { sugg.hidden = true; return; }
    if (!sugg.hidden) return;
    const recent = [...new Set((typeof allRuns === "function" ? allRuns() : []).map(r => String(r.goal || "").split("\n")[0].trim()).filter(Boolean))].slice(0, 2);
    const list = [...recent, ...EXAMPLES].filter((s, i, a) => a.indexOf(s) === i).slice(0, 3);
    sugg.replaceChildren(el("small", { text: recent.length ? "최근·추천" : "추천" }), ...list.map((s, i) =>
      el("button", { type: "button", title: s, text: clip(s, 34), style: { "animation-delay": `${i * 50}ms` },
        onpointerdown: e => e.preventDefault(), // 입력창 포커스를 잃지 않게
        onclick: () => { g.value = s; fitGoal(); sugg.hidden = true; g.focus(); } })));
    sugg.hidden = false;
  }
  function initSugg() {
    const form = $("command"), g = $("goal");
    if (!form || !g) return;
    sugg = el("div", { class: "mo-sugg", hidden: true, role: "group", "aria-label": "추천 지시" });
    form.append(sugg);
    for (const ev of ["focus", "input", "blur"]) g.addEventListener(ev, () => setTimeout(drawSugg, ev === "blur" ? 120 : 0));
  }
  function sendBefore() {
    const g = $("goal");
    if (!D.running && !UI.submitting && g?.value.trim()) { restart($("command"), "mo-sent"); if (sugg) sugg.hidden = true; }
  }

  /* ───────── 상단 바: 경과 시간 넘김 (cuenta) · 연결 신호 (senal) ───────── */
  let clockBox = null, clockPrev = "";
  function drawClock() {
    const src = $("clockText");
    if (!src) return;
    src.classList.toggle("mo-sr", !off());
    if (!clockBox) { clockBox = el("span", { class: "mo-clock", "aria-hidden": "true" }); src.after(clockBox); }
    const s = src.textContent;
    if (s === clockPrev) return;
    if (clockBox.children.length !== s.length) clockBox.replaceChildren(...[...s].map(c => el("span", { text: c })));
    [...s].forEach((c, i) => {
      const d = clockBox.children[i];
      if (d.textContent === c) return;
      d.textContent = c;
      if (clockPrev && !off()) restart(d, "mo-flip");
    });
    clockPrev = s;
  }
  let connWas = "";
  function connAfter(_, [mode]) {
    if (mode === "live" && connWas && connWas !== "live") once($("conn"), "mo-pop", 800);
    connWas = mode;
  }

  /* ───────── 팀원 얼굴: 일을 시작·끝내면 튀어 오름 (insignia) ───────── */
  function watchFaces() {
    const box = $("activityAgents");
    if (!box) return;
    new MutationObserver(list => {
      if (off()) return;
      for (const m of list) {
        const t = m.target;
        if (!t.classList?.contains("face-ring")) continue;
        const was = / busy\b/.test(` ${m.oldValue || ""}`), now = t.classList.contains("busy");
        if (was !== now && m.oldValue != null) once(t.closest(".activity-agent"), "mo-jump", 700);
      }
    }).observe(box, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  }

  /* ───────── 낮·밤: 누른 자리에서 원이 퍼짐 (anochecer) ───────── */
  let lastPt = null;
  addEventListener("pointerdown", e => { lastPt = { x: e.clientX, y: e.clientY, t: performance.now() }; }, true);
  function patchTheme() {
    const base = window.setThemeMode;
    if (typeof base !== "function") return;
    window.setThemeMode = function (mode) {
      const before = isDark();
      if (off() || !document.startViewTransition || !lastPt || performance.now() - lastPt.t > 1500) return base(mode);
      const { x, y } = lastPt, R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const vt = document.startViewTransition(() => base(mode));
      vt.ready.then(() => {
        if (isDark() === before) return; // 밝기가 그대로면(시스템 → 같은 색) 원을 그리지 않는다
        root.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" });
      }, () => {});
    };
  }

  /* ───────── 붙이기 ───────── */
  function init() {
    sync();
    mqReduce.addEventListener?.("change", () => { sync(); marks(); drawClock(); });
    const baseReduce = window.setReduce;
    window.setReduce = v => { baseReduce(v); sync(); marks(); drawClock(); };

    window.toast = toast;
    wrap("renderBoard", boardAfter, boardBefore);
    wrap("log", logAfter);
    wrap("renderPalette", palAfter, palBefore);
    wrap("openReport", reportAfter, reportBefore);
    wrap("openRun", runAfter);
    wrap("submitGoal", null, sendBefore);
    wrap("paintReport", stamp);
    wrap("setConn", connAfter);
    wrap("setSpeed", () => markIn($("speed"), "button.on", true));
    wrap("updateInput", drawSugg);
    patchSay();
    patchTheme();
    initSugg();
    watchFaces();

    // 선택 표시: 메뉴·공간 목록이 바뀌거나 크기가 바뀌면 다시 맞춘다
    const mo = new MutationObserver(() => off() || marks());
    for (const box of [$("sidenav"), document.querySelector(".room-switch")]) if (box) mo.observe(box, { subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-pressed"] });
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => off() || marks());
      for (const box of [$("sidenav"), document.querySelector(".room-switch"), $("speed")]) if (box) ro.observe(box);
    }
    // 현재 업무 띠: dashboard.js 가 글자를 다시 쓸 때마다 확인
    const runObs = new MutationObserver(() => syncRun());
    for (const id of ["activePhase", "completionValue", "runSteps"]) if ($(id)) runObs.observe($(id), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const clk = $("clockText");
    if (clk) new MutationObserver(drawClock).observe(clk, { childList: true, characterData: true, subtree: true });
    connWas = NET?.mode || "";
    marks(); syncRun(); drawClock();
    document.fonts?.ready.then(() => off() || marks());
  }
  init();
  return { get on() { return !off(); }, refresh: () => { sync(); marks(); syncRun(); drawClock(); } };
})();
