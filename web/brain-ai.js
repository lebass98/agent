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

  function open(on) {
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
  }
  fab.onclick = () => open();
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
  return { open, ask };
})();
