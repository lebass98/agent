"use strict";
/* 브레인 모드 AI 어시스턴트(WnC AI) — 오른쪽 아래 'AI 어시스턴트' 단추 → 대화 패널.
   질문은 /api/brain/assistant(server/assistant.py)로: 브레인의 메일·일정·회의록·루틴을 맥락으로 Claude 가 답한다(읽기 도구만).
   대화는 이 탭(sessionStorage)에만 남는다. 모션은 Moxie 기법(burbuja 단추→패널, respiro 입력 중 점, cavila 생각 중 빛). */
window.BrainAI = (() => {
  if (!window.SpaceTheme?.isBrain) return null;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const h = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const ico = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.5 4.6 2.4 6.9 7.5 9.5-5.1 2.6-7 4.9-7.5 9.5-.5-4.6-2.4-6.9-7.5-9.5 5.1-2.6 7-4.9 7.5-9.5Z"/><path d="M19 2v4M21 4h-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const KEY = "agentOffice.brain.ai";
  const SUGGEST = [
    ["calendar", "오늘과 이번 주 일정을 정리해 줘"],
    ["mail", "답장해야 할 메일을 마감 순으로 알려 줘"],
    ["check", "이번 주 회의에서 나온 할 일을 모아 줘"],
  ];
  let msgs = [];
  try { msgs = JSON.parse(sessionStorage.getItem(KEY) || "[]").filter(m => m && m.role && m.content).slice(-30); } catch {}
  let busy = false;
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch {} };

  const fab = h(`<button type="button" class="bai-fab" aria-haspopup="dialog" aria-expanded="false" aria-label="AI 어시스턴트 열기" title="WnC AI">${SPARK}</button>`);
  const panel = h(`<section class="bai" role="dialog" aria-label="WnC AI" hidden>
    <header class="bai-head"><span class="bai-logo">${SPARK}</span><div><b>WnC AI</b><small><i></i>당신의 업무를 연결하는 AI</small></div>
      <button type="button" class="bai-icon" data-act="new" title="새 대화">${ico("plus")}</button><button type="button" class="bai-icon" data-act="close" title="닫기 (Esc)">${ico("x")}</button></header>
    <div class="bai-body" aria-live="polite"></div>
    <form class="bai-input"><textarea rows="2" maxlength="4000" placeholder="업무에 대해 무엇이든 물어보세요" aria-label="AI 에게 질문"></textarea>
      <div class="bai-row"><small>Enter 전송 · Shift + Enter 줄바꿈</small><button type="submit" class="bai-send" aria-label="보내기" disabled>${ico("arrow-up")}</button></div></form>
    <p class="bai-foot">AI 답변은 정확하지 않을 수 있어요. 중요한 내용은 확인해 주세요.</p></section>`);
  document.body.append(panel, fab);
  const body = panel.querySelector(".bai-body"), input = panel.querySelector("textarea"), send = panel.querySelector(".bai-send");

  function welcome() {
    return `<div class="bai-hello"><p class="bai-eyebrow">YOUR WORK, SIMPLIFIED</p><h2>무엇을 도와드릴까요?</h2>
      <p class="bai-lead">메일·일정·회의록·루틴을 보고 답해요.<br>궁금한 업무 내용을 편하게 물어보세요.</p>
      <div class="bai-sugg">${SUGGEST.map(([i, q], n) => `<button type="button" data-q="${esc(q)}" style="animation-delay:${80 + n * 60}ms">${ico(i)}<span>${esc(q)}</span><em aria-hidden="true">↗</em></button>`).join("")}</div>
      <p class="bai-note">${SPARK}지금은 업무 질의응답을 지원해요 · 메일 보내기·일정 만들기는 하지 않아요</p></div>`;
  }
  function bubble(m) {
    if (m.role === "user") return h(`<div class="bai-msg me"><p>${esc(m.content).replace(/\n/g, "<br>")}</p></div>`);
    const n = h(`<div class="bai-msg ai${m.error ? " err" : ""}"><span class="bai-av">${SPARK}</span><div class="bai-text"></div></div>`);
    n.querySelector(".bai-text").append(m.error ? Object.assign(document.createElement("p"), { textContent: m.content }) : md(m.content));
    return n;
  }
  function draw() {
    body.replaceChildren();
    if (!msgs.length) { body.innerHTML = welcome(); return; }
    for (const m of msgs) body.append(bubble(m));
    if (busy) body.append(h(`<div class="bai-msg ai wait"><span class="bai-av">${SPARK}</span><div class="bai-text"><span class="bai-dots"><i></i><i></i><i></i></span><span class="bai-think">메일·일정·회의록을 살펴보는 중…</span></div></div>`));
    body.scrollTop = body.scrollHeight;
  }
  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    const history = msgs.filter(m => !m.error).slice(-8).map(({ role, content }) => ({ role, content }));
    msgs.push({ role: "user", content: q }); busy = true; save();
    input.value = ""; fit(); draw();
    try {
      const r = await api("/api/brain/assistant", { method: "POST", body: JSON.stringify({ message: q, history }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `답을 받지 못했어요 (${r.status})`);
      msgs.push({ role: "assistant", content: j.answer || "(답이 비었어요)" });
    } catch (e) {
      msgs.push({ role: "assistant", content: e.message || "답을 받지 못했어요.", error: true });
    }
    busy = false; save(); draw();
    if (!panel.hidden) input.focus({ preventScroll: true });
  }
  const fit = () => { input.style.height = "auto"; input.style.height = `${Math.min(140, input.scrollHeight)}px`; send.disabled = !input.value.trim() || busy; };

  let open = function (on) {
    const show = on ?? panel.hidden;
    fab.setAttribute("aria-expanded", String(show));
    if (show) {
      panel.hidden = false; draw();
      if (!(PREF.reduce || matchMedia("(prefers-reduced-motion: reduce)").matches)) panel.animate( // burbuja: 단추에서 패널로 자라난다
        [{ opacity: 0, transform: "translateY(24px) scale(.6)", borderRadius: "40px" }, { opacity: 1, transform: "none", borderRadius: "26px" }],
        { duration: 480, easing: "cubic-bezier(.34,1.56,.64,1)" });
      setTimeout(() => input.focus({ preventScroll: true }), 60);
    } else panel.hidden = true;
    document.body.classList.toggle("bai-open", show);
  };
  panel.addEventListener("click", e => {
    const a = e.target.closest("[data-act]"), s = e.target.closest("[data-q]");
    if (a?.dataset.act === "close") open(false);
    if (a?.dataset.act === "new" && !busy) { msgs = []; save(); draw(); input.focus(); }
    if (s) ask(s.dataset.q);
  });
  panel.querySelector("form").onsubmit = e => { e.preventDefault(); ask(input.value); };
  input.addEventListener("input", fit);
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
  addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden && $("modal")?.hidden !== false) open(false); });

  /* ───────── 팀 업무 지시: 아래 긴 입력창 대신 단추 → 검색창형 모달(기존 #command 폼을 그대로 옮겨 넣는다) ─────────
     데스크톱(761px 이상)만. 오른쪽 사이드바 아래 가운데 줄: 맨 아래 어시스턴트, 바로 위 업무 지시. 휴대폰은 원래 배치 */
  const mqDesk = matchMedia("(min-width: 761px)");
  const form = $("command"), formHome = form?.parentElement, formNext = form?.nextSibling;
  const taskBtn = h(`<button type="button" class="bai-task" aria-haspopup="dialog" aria-label="팀에 업무 지시" title="팀에 업무 지시 (/)">${ico("send")}<i class="bai-ring" aria-hidden="true"></i></button>`);
  const cmd = h(`<div class="bcmd" hidden><div class="bcmd-box" role="dialog" aria-label="팀에 업무 지시">
    <div class="bcmd-head"><b>${ico("users")}팀에 업무 지시</b><small id="bcmdState"></small><button type="button" class="bai-icon" data-close title="닫기 (Esc)">${ico("x")}</button></div>
    <div class="bcmd-slot"></div><div class="bcmd-recent"></div>
    <p class="bcmd-hint">Enter 로 보내기 · Shift+Enter 줄바꿈 · 팀장이 계획을 세워 팀원에게 나눠 맡겨요</p></div></div>`);
  document.body.append(cmd, taskBtn);
  const slot = cmd.querySelector(".bcmd-slot"), recent = cmd.querySelector(".bcmd-recent");
  function drawRecent() {
    const goals = [...new Set((typeof allRuns === "function" ? allRuns() : []).map(r => String(r.goal || "").split("\n")[0].trim()).filter(Boolean))].slice(0, 5);
    recent.innerHTML = goals.length ? `<p>최근 지시</p>${goals.map(g => `<button type="button" data-goal="${esc(g)}">${ico("history")}<span>${esc(g)}</span></button>`).join("")}` : "";
  }
  recent.addEventListener("click", e => { const b = e.target.closest("[data-goal]"); if (!b) return; const g = $("goal"); g.value = b.dataset.goal; g.dispatchEvent(new Event("input", { bubbles: true })); g.focus(); });
  function openCmd(on) {
    if (on) {
      if (bai_open()) open(false);
      cmd.hidden = false; drawRecent();
      $("bcmdState").textContent = D.running ? `진행 중: ${D.phaseText}` : "";
      if (!(PREF.reduce || matchMedia("(prefers-reduced-motion: reduce)").matches)) cmd.firstElementChild.animate([{ opacity: 0, transform: "translateY(-14px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(.34,1.56,.64,1)" });
      setTimeout(() => $("goal")?.focus(), 30);
    } else cmd.hidden = true;
    document.body.classList.toggle("bcmd-open", !!on);
  }
  const bai_open = () => !panel.hidden;
  taskBtn.onclick = () => openCmd(cmd.hidden);
  cmd.addEventListener("click", e => { if (e.target === cmd || e.target.closest("[data-close]")) openCmd(false); });
  form?.addEventListener("submit", () => setTimeout(() => { if (UI.submitting || D.running) openCmd(false); }, 250)); // 보냈으면 닫는다
  addEventListener("keydown", e => {
    if (e.key === "Escape" && !cmd.hidden) { openCmd(false); return; }
    if (e.key === "/" && cmd.hidden && mqDesk.matches && !e.target.closest?.("input, textarea, select, [contenteditable='true']") && $("modal")?.hidden !== false) { e.preventDefault(); openCmd(true); }
  });
  const fabOpen = open;
  open = on => { if ((on ?? panel.hidden) && !cmd.hidden) openCmd(false); fabOpen(on); };

  // 데스크톱이면 입력창을 모달로, 휴대폰이면 제자리로. 단추·패널은 오른쪽 사이드바 가운데 줄에 맞춘다
  function layout() {
    const desk = mqDesk.matches;
    document.body.classList.toggle("bai-dock", desk);
    if (form) {
      if (desk && form.parentElement !== slot) slot.append(form);
      if (!desk && form.parentElement === slot) { formHome.insertBefore(form, formNext); openCmd(false); }
    }
    // 휴대폰: AI 단추를 아래 입력줄 안(보내기 단추 왼쪽)에 나란히 — 입력줄은 한 줄로(brain-ai.css)
    const run = $("runBtn");
    if (!desk && run && fab.parentElement !== run.parentElement) { run.before(fab); fab.classList.add("bai-inline"); }
    if (desk && fab.classList.contains("bai-inline")) { fab.classList.remove("bai-inline"); document.body.append(fab); }
    const r = $("rightcol")?.getBoundingClientRect();
    if (desk && r?.width) {
      document.body.style.setProperty("--bai-x", `${Math.round(r.left + r.width / 2)}px`);
      document.body.style.setProperty("--bai-right", `${Math.round(innerWidth - r.left + 12)}px`);
    }
  }
  // 휴대폰 한 줄 입력줄: 안내 문구를 짧게 (app.js 가 바꿀 때마다 줄인다)
  const goal = $("goal");
  const shortPh = () => {
    if (!goal || mqDesk.matches) return;
    const p = goal.placeholder, short = p.startsWith("팀에 업무를") ? "업무 지시하기" : p.startsWith("팀이 업무를 진행") ? `진행 중${(p.match(/\(([^)]*)\)/) || [])[1] ? ` · ${p.match(/\(([^)]*)\)/)[1]}` : "…"}` : p;
    if (short !== p) goal.placeholder = short;
  };
  if (goal) { new MutationObserver(shortPh).observe(goal, { attributes: true, attributeFilter: ["placeholder"] }); shortPh(); }
  layout();
  addEventListener("resize", layout);
  mqDesk.addEventListener?.("change", layout);
  if (typeof ResizeObserver === "function" && $("rightcol")) new ResizeObserver(layout).observe($("rightcol"));
  setInterval(() => taskBtn.classList.toggle("busy", !!D.running), 1000);  // 팀이 일하는 중이면 단추 둘레가 돈다
  fab.onclick = () => open();
  return { open: on => open(on), ask, task: openCmd };
})();
