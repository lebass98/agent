"use strict";
/* 에이전트 설정 — '에이전트' 화면의 [설정]·[에이전트 추가] 버튼으로 연다.
   팀장·업무 배정 원칙, 팀원별 AI 선택(연결 방식)·모델·하는 일을 고치고, 팀원을 추가·삭제해 team.toml 에 저장한다.
   GET/PUT /api/team/config (docs/events.md). 저장하면 서버가 팀을 다시 꾸리고 모든 화면에 hello 를 다시 보내 사무실이 새 팀으로 바뀐다.
   app.js 의 전역(el·icon·api·getJSON·toast·openModal·closeModal·sheetHead·NET·memberDef·D) 위에 붙는다. */
window.TeamSettings = (() => {
  const S = { cfg: null, providers: [], limits: { members: 12, role: 300, guide: 2000 }, draft: null, saving: false };
  const live = () => NET.mode === "live";
  const prov = id => S.providers.find(p => p.id === id);
  const clone = o => JSON.parse(JSON.stringify(o));

  async function open(opts = {}) {
    if (!live()) { toast(NET.mode === "demo" ? "에이전트 설정은 서버에 연결되어 있을 때만 바꿀 수 있어요." : "서버에 연결된 뒤 다시 시도해 주세요.", "info", 3500); return; }
    openModal([sheetHead("에이전트 설정", "불러오는 중…"), el("div", { class: "sheet-body" }, el("p", { class: "muted", text: "팀 설정을 불러오는 중…" }))]);
    try {
      const j = await getJSON("/api/team/config");
      S.cfg = j.config; S.providers = j.providers || []; S.limits = { ...S.limits, ...(j.limits || {}) }; S.mock = !!j.mock;
    } catch (e) {
      openModal([sheetHead("에이전트 설정"), el("div", { class: "sheet-body" }, el("p", { class: "error-text", role: "alert", text: e.message || "팀 설정을 불러오지 못했어요." }))]);
      return;
    }
    S.draft = clone(S.cfg);
    if (opts.add) addMember(false);
    render(opts.add ? "new" : opts.focus);
  }

  function addMember(rerender = true) {
    if (S.draft.members.length >= S.limits.members) { toast(`팀원은 최대 ${S.limits.members}명까지예요.`, "warn"); return; }
    const used = new Set(S.draft.members.map(m => m.name));
    let i = S.draft.members.length + 1, name = `agent${i}`;
    while (used.has(name)) name = `agent${++i}`;
    S.draft.members.push({ name, provider: "claude-cli", model: "sonnet", role: "", _new: true });
    if (rerender) render("new");
  }

  /** 화면 전체를 다시 그린다. focus: 팀원 이름 또는 "new"(마지막 추가 팀원) */
  function render(focus) {
    const d = S.draft, err = el("p", { class: "error-text small ts-err", role: "alert", hidden: true });
    const save = el("button", { class: "btn", type: "submit", text: "저장" });
    const leader = el("select", { class: "text-input", id: "tsLeader", "aria-label": "팀장", onchange: e => { d.leader = e.target.value; render(); } },
      ...d.members.map(m => el("option", { value: m.name, selected: m.name === d.leader, text: label(m) })));
    const guide = el("textarea", { class: "text-input", id: "tsGuide", rows: "5", maxlength: String(S.limits.guide), oninput: e => { d.guide = e.target.value; } });
    guide.value = d.guide || "";
    const list = el("div", { class: "ts-members" }, ...d.members.map((m, i) => memberCard(m, i)));
    const form = el("form", { class: "sheet-form ts-form", autocomplete: "off", onsubmit: e => { e.preventDefault(); submit(save, err); } },
      el("div", { class: "sheet-body" },
        S.mock ? el("p", { class: "ts-note", role: "note" }, icon("alert"), "지금은 모의 실행 중이라 실제 AI 를 부르지 않아요. 저장한 설정은 실제 실행 때 쓰여요.") : null,
        el("section", { class: "ts-sec" },
          el("h3", { class: "ts-h" }, icon("gear"), "팀장과 업무 배정 원칙"),
          el("div", { class: "field" }, el("label", { class: "field-label", for: "tsLeader", text: "팀장" }), leader,
            el("small", { class: "muted", text: "팀장이 목표를 업무로 나누고 팀원에게 배정한 뒤, 결과를 검수해 최종 보고서를 씁니다." })),
          el("div", { class: "field" }, el("label", { class: "field-label", for: "tsGuide", text: "업무 배정 원칙 (선택)" }), guide,
            el("small", { class: "muted", text: "팀장이 업무를 나눌 때 가장 먼저 따르는 규칙이에요. 예: 핵심 개발·문서는 claude, 이미지·UI 는 gpt, 정리·번역은 gemini." }))),
        el("section", { class: "ts-sec" },
          el("div", { class: "ts-h-row" }, el("h3", { class: "ts-h" }, icon("users"), `팀원 ${d.members.length}명`),
            el("button", { class: "tbtn accent", type: "button", disabled: d.members.length >= S.limits.members, onclick: () => addMember() }, icon("plus"), "에이전트 추가")),
          list),
        el("p", { class: "muted small", text: "저장하면 team.toml 이 바뀌고 팀이 바로 다시 꾸려져요(바로 전 파일은 team.toml.bak 으로 남아요). 진행 중인 업무가 있으면 끝난 뒤 저장할 수 있어요." }),
        err),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", text: "취소", onclick: closeModal }), save));
    openModal([sheetHead("에이전트 설정", "AI 선택 · 모델 · 하는 일 · 팀장"), form]);
    const target = focus === "new" ? list.lastElementChild : focus ? list.querySelector(`[data-name="${CSS.escape(focus)}"]`) : null;
    if (target) {
      target.scrollIntoView({ block: "center" });
      (target.querySelector(focus === "new" ? ".ts-name" : "select") || target).focus({ preventScroll: true });
    }
  }

  function label(m) {
    const p = prov(m.provider);
    return `${m.name}${p ? ` · ${p.brand}` : ""}`;
  }

  function memberCard(m, i) {
    const d = S.draft, id = `ts${i}`, p = prov(m.provider), isLeader = m.name === d.leader;
    const known = (() => { try { return memberDef(m.name); } catch { return null; } })();
    const color = known?.color || "#8a94a6";
    const name = m._new
      ? el("input", { class: "text-input ts-name", id: `${id}n`, type: "text", value: m.name, maxlength: "20", spellcheck: "false", autocapitalize: "off", "aria-label": "팀원 이름(영문)",
          oninput: e => { const old = m.name; m.name = e.target.value.trim().toLowerCase(); if (d.leader === old) d.leader = m.name; } })
      : el("strong", { class: "ts-title", text: known?.label || m.name });
    const providerSel = el("select", { class: "text-input", id: `${id}p`, onchange: e => {
      m.provider = e.target.value;
      const np = prov(m.provider);
      if (np?.models?.length && !np.models.includes(m.model)) m.model = np.models[0];
      render(m.name);
    } }, ...S.providers.map(o => el("option", { value: o.id, selected: o.id === m.provider, text: `${o.brand} — ${o.label}${o.ready ? "" : " (준비 안 됨)"}` })),
      p ? null : el("option", { value: m.provider, selected: true, text: `${m.provider} (알 수 없음)` }));
    const listId = `${id}ml`;
    const model = el("input", { class: "text-input", id: `${id}m`, type: "text", value: m.model, list: listId, maxlength: "80", spellcheck: "false", autocapitalize: "off",
      oninput: e => { m.model = e.target.value.trim(); } });
    const role = el("textarea", { class: "text-input", id: `${id}r`, rows: "2", maxlength: String(S.limits.role), placeholder: "예: 디자이너. 이미지·그림 제작, UI/UX 탐색과 시안", oninput: e => { m.role = e.target.value; } });
    role.value = m.role || "";
    const del = el("button", { class: "tbtn ts-del", type: "button", disabled: d.members.length <= 1, "aria-label": `${m.name} 팀원 삭제`, title: "팀원 삭제",
      onclick: () => {
        d.members.splice(i, 1);
        if (d.leader === m.name) d.leader = d.members[0]?.name || "";
        render();
      } }, icon("x"), "삭제");
    return el("article", { class: `ts-card${isLeader ? " leader" : ""}`, "data-name": m.name, style: { "--c": color } },
      el("header", { class: "ts-card-head" },
        el("span", { class: "ts-dot", "aria-hidden": "true" }), name,
        isLeader ? el("span", { class: "badge", text: "팀장" }) : null,
        m._new ? el("span", { class: "badge meet", text: "새 팀원" }) : null,
        del),
      el("div", { class: "ts-grid" },
        el("div", { class: "field" }, el("label", { class: "field-label", for: `${id}p`, text: "AI 선택" }), providerSel,
          p && !p.ready ? el("small", { class: "ts-warn", text: `${p.hint || "준비 안 됨"} — 저장은 되지만 실제 실행 때 실패해요.` }) : null),
        el("div", { class: "field" }, el("label", { class: "field-label", for: `${id}m`, text: "모델" }), model,
          el("datalist", { id: listId }, ...(p?.models || []).map(v => el("option", { value: v }))),
          el("small", { class: "muted", text: m.provider === "claude-cli" ? "opus · sonnet · haiku 중 하나" : m.provider === "antigravity-cli" ? "터미널 `agy models` 로 전체 목록 확인" : (p?.models?.length ? `추천: ${p.models.join(", ")}` : "모델 이름을 직접 입력") }))),
      el("div", { class: "field" }, el("label", { class: "field-label", for: `${id}r`, text: "하는 일" }), role,
        m._new ? el("small", { class: "muted", text: "이름은 영문 소문자로 시작(영문·숫자·-·_ 20자). 화면에는 첫 글자를 대문자로 보여 줘요." }) : null));
  }

  async function submit(save, err) {
    if (S.saving) return;
    S.saving = true; save.disabled = true; err.hidden = true;
    const config = { leader: S.draft.leader, guide: S.draft.guide || "", members: S.draft.members.map(({ name, provider, model, role }) => ({ name, provider, model, role })) };
    try {
      const r = await api("/api/team/config", { method: "PUT", body: JSON.stringify({ config }) });
      const j = await r.json().catch(() => null);
      if (r.status === 401 || r.status === 403) throw new Error(KEY_MSG);
      if (!r.ok) throw new Error(typeof j?.detail === "string" ? j.detail : `저장하지 못했어요 (${r.status})`);
      S.cfg = j.config;
      closeModal();
      toast("에이전트 설정을 저장했어요. 팀이 새 설정으로 출근합니다.", "info", 4000);
    } catch (e) {
      err.textContent = e.message || "저장하지 못했어요."; err.hidden = false;
      err.scrollIntoView({ block: "nearest" });
    } finally { S.saving = false; save.disabled = false; }
  }

  return { open, add: () => open({ add: true }), edit: name => open({ focus: name }) };
})();
