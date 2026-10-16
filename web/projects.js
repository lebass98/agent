"use strict";
/* 프로젝트(폴더 접근) — Claude 앱의 '프로젝트'처럼 로컬 폴더를 골라 전체 접근을 허락하고, 팀 업무를 그 폴더 안에서 실행한다.
   - 명령창의 폴더 버튼(#projectBtn) → 메뉴: 등록한 프로젝트 고르기 / 프로젝트 없이 / 폴더 열기… / 프로젝트 관리
   - 폴더 열기: 이 컴퓨터에서 접속했으면 운영체제 폴더 선택 창(Finder·탐색기, POST /api/fs/pick),
     다른 기기(휴대폰)면 앱 안 폴더 고르기 창(GET /api/fs/list, 하위 폴더 이름만) → 동의 창(체크해야 추가) → POST /api/projects {confirm: true}
   - 고른 프로젝트 id 는 localStorage(agentOffice.project)에 기억하고, 업무 지시 때 app.js 가 project_id 로 보낸다.
   - '프로젝트' 보기(VIEWS.projects)와 설정에서 목록·이름 바꾸기·접근 해제.
   app.js 의 전역(el·icon·api·getJSON·store·toast·openModal·closeModal·sheetHead·popMenu·NET·VIEW·renderView·showView) 위에 붙는다. */
window.Projects = (() => {
  const KEY = "agentOffice.project";
  const S = { list: [], loaded: false, loading: null, current: store.get(KEY) || "", error: "" };
  const live = () => NET.mode === "live";

  const current = () => S.list.find(p => p.id === S.current) || null;
  function setCurrent(id) {
    S.current = id || "";
    store.set(KEY, S.current);
    paint();
  }

  /** 명령창 버튼: 고른 프로젝트 이름(없으면 '프로젝트 없음') */
  function paint() {
    const b = $("projectBtn"), p = current();
    if (!b) return;
    $("projectName").textContent = p ? p.name : "프로젝트 없음";
    b.classList.toggle("on", !!p);
    b.title = p ? `프로젝트 폴더: ${p.path}` : "프로젝트 폴더 선택";
    b.setAttribute("aria-label", p ? `프로젝트: ${p.name} (${p.path}) — 바꾸기` : "프로젝트: 없음 (폴더 선택)");
    if (VIEW.name === "projects") renderView();
  }

  async function load(force) {
    if (!live()) return;
    if (S.loading) return S.loading;
    if (S.loaded && !force) return;
    S.loading = (async () => {
      try {
        const data = await getJSON("/api/projects");
        S.list = Array.isArray(data?.projects) ? data.projects.filter(p => p && p.id && p.path) : [];
        S.loaded = true; S.error = "";
        if (S.current && !S.list.some(p => p.id === S.current)) setCurrent(""); // 다른 기기에서 해제된 프로젝트
      } catch (e) { S.error = e.message || "프로젝트 목록을 불러오지 못했어요."; }
      finally { S.loading = null; paint(); }
    })();
    return S.loading;
  }

  async function send(path, method, body) {
    const r = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw new Error(KEY_MSG);
    if (!r.ok) throw new Error(typeof j?.detail === "string" ? j.detail : `요청이 실패했어요 (${r.status})`);
    return j;
  }

  /* ── 메뉴 ── */
  async function openMenu() {
    const b = $("projectBtn");
    if (!live()) { toast(NET.mode === "demo" ? "프로젝트(폴더 접근)는 서버에 연결되어 있을 때만 쓸 수 있어요." : "서버에 연결된 뒤 다시 시도해 주세요.", "info", 3500); return; }
    if (!$("popmenu").hidden && POP.anchor === b) return closeMenu();
    await load();
    // 프로젝트(등록해 둔 작업 단위: 이름 + 폴더)와 폴더(새로 열기·관리)를 구역으로 나눠 보여 준다
    const short = path => { const parts = String(path).split(/[\\/]/).filter(Boolean); return (parts.length > 2 ? "…/" : "/") + parts.slice(-2).join("/"); };
    const items = [{ heading: `프로젝트 ${S.list.length ? S.list.length + "개" : ""}`.trim() }];
    if (!S.list.length) items.push({ note: "등록한 프로젝트가 없어요. 아래 ‘폴더 열기…’로 만들어요." });
    for (const p of S.list) items.push({ label: p.name, sub: short(p.path), title: p.path, icon: "kanban", checked: p.id === S.current,
      onpick: () => { setCurrent(p.id); toast(`프로젝트 ‘${p.name}’ 안에서 업무를 실행해요.`, "info", 2500); } });
    items.push({ label: "프로젝트 없이 실행", sub: "폴더에 접근하지 않아요", icon: "x", checked: !current(), onpick: () => setCurrent("") });
    items.push({ sep: true }, { heading: "폴더" });
    items.push({ label: "폴더 열기…", sub: "새 폴더를 골라 프로젝트로 추가", icon: "folder-open", onpick: () => openFolder() });
    items.push({ label: "프로젝트 관리", sub: "이름 바꾸기·접근 해제", icon: "gear", onpick: () => showView("projects") });
    popMenu(b, items);
  }

  /* ── 폴더 열기: Finder·탐색기 먼저, 못 쓰면 앱 안 폴더 고르기 창 ── */
  let picking = false;
  async function openFolder() {
    if (!live() || picking) return;
    picking = true;
    const t = setTimeout(() => toast("Finder·탐색기 창에서 폴더를 고르세요. 창이 안 보이면 Dock·작업 표시줄을 확인하세요.", "info", 6000), 700);
    try {
      const j = await send("/api/fs/pick", "POST");
      if (!j?.native) return openPicker();
      if (j.cancelled) return;
      if (j.error) { toast(j.error, "error", 5000); return; }
      openConsent(j.path, () => { closeModal(); openFolder(); });
    } catch (e) {
      toast(e.message || "폴더 선택 창을 열지 못했어요.", "error", 4000);
    } finally { clearTimeout(t); picking = false; }
  }

  /* ── 앱 안 폴더 고르기(휴대폰 등 다른 기기) ── */
  const PK = { path: "", hidden: false, data: null };
  async function openPicker(path) {
    if (!live()) return;
    if (path !== undefined) PK.path = path;
    const body = el("div", { class: "sheet-body picker" }, el("p", { class: "muted", text: "폴더를 불러오는 중…" }));
    const choose = el("button", { class: "btn", type: "button", disabled: true, text: "이 폴더 선택", onclick: () => PK.data?.selectable && openConsent(PK.data.path) });
    openModal([sheetHead("폴더 열기", "AI 팀이 작업할 폴더를 고르세요. 파일 내용은 이 창에서 읽지 않아요."), body,
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", text: "취소", onclick: closeModal }), choose)]);
    try {
      PK.data = await send(`/api/fs/list?${new URLSearchParams({ path: PK.path || "", hidden: PK.hidden ? "1" : "0" })}`, "GET");
    } catch (e) {
      if (body.isConnected) body.replaceChildren(el("p", { class: "error-text", role: "alert", text: e.message || "폴더를 열 수 없어요." }),
        el("button", { class: "tbtn", type: "button", onclick: () => openPicker("") }, icon("house"), "홈으로"));
      return;
    }
    if (!body.isConnected) return;
    const d = PK.data;
    PK.path = d.path;
    choose.disabled = !d.selectable;
    body.replaceChildren(...pickerBody(d).filter(Boolean));
    body.querySelector(".crumbs button:last-child")?.focus({ preventScroll: true });
  }

  function pickerBody(d) {
    const go = p => openPicker(p);
    const roots = el("div", { class: "pk-roots", role: "group", "aria-label": "빠른 이동" },
      ...(d.roots || []).map(r => el("button", { type: "button", class: `pk-root${r.path === d.path ? " on" : ""}`, "aria-pressed": String(r.path === d.path), onclick: () => go(r.path) },
        icon(r.name === "상위 폴더" ? "arrow-up" : r.name === "홈" ? "house" : "folder"), r.name)));
    // 경로 조각(breadcrumb)
    const parts = d.path.split("/").filter(Boolean), crumbs = [el("button", { type: "button", onclick: () => go("/"), "aria-label": "디스크 최상위", text: "/" })];
    parts.forEach((name, i) => {
      const p = "/" + parts.slice(0, i + 1).join("/");
      crumbs.push(el("span", { class: "sep", "aria-hidden": "true", text: "›" }),
        el("button", { type: "button", onclick: () => go(p), "aria-current": i === parts.length - 1 ? "location" : null, text: name }));
    });
    const input = el("input", { class: "text-input", id: "pkPath", type: "text", value: d.path, autocomplete: "off", spellcheck: "false", autocapitalize: "off", "aria-label": "폴더 경로" });
    const jump = el("form", { class: "pk-jump", onsubmit: e => { e.preventDefault(); go(input.value.trim()); } }, input,
      el("button", { class: "tbtn", type: "submit", text: "이동" }));
    const hidden = el("label", { class: "pk-hidden" }, el("input", { type: "checkbox", checked: PK.hidden, onchange: e => { PK.hidden = e.target.checked; go(d.path); } }), "숨김 폴더 보기");
    const list = d.dirs.length
      ? el("ul", { class: "pk-list", "aria-label": `${d.path} 안의 폴더 ${d.dirs.length}개` }, ...d.dirs.map(x => el("li", null,
        el("button", { type: "button", class: "pk-dir", onclick: () => go(x.path), title: x.path }, icon("folder"), el("span", { class: "nm", text: x.name }),
          x.has_children ? icon("chev-right") : null))))
      : el("p", { class: "empty", text: "하위 폴더가 없어요. 이 폴더를 그대로 고를 수 있어요." });
    return [
      roots,
      el("nav", { class: "crumbs", "aria-label": "현재 위치" }, ...crumbs),
      el("div", { class: "pk-tools" }, jump, hidden),
      d.selectable ? null : el("p", { class: "pk-reason", role: "status" }, icon("alert"), d.reason || "이 폴더는 고를 수 없어요."),
      list,
      d.truncated ? el("p", { class: "muted small", text: "폴더가 많아 앞쪽 500개만 보여요. 경로를 직접 입력해 이동하세요." }) : null,
    ];
  }

  /* ── 동의 ── */
  function openConsent(path, back = () => openPicker(path)) {
    const name = path.split("/").filter(Boolean).pop() || path;
    const nameInput = el("input", { class: "text-input", id: "pjName", type: "text", value: name, maxlength: "80", autocomplete: "off" });
    const err = el("p", { class: "error-text small", role: "alert", hidden: true });
    const add = el("button", { class: "btn", type: "submit", disabled: true, text: "허락하고 추가" });
    const agree = el("input", { type: "checkbox", id: "pjAgree", onchange: e => { add.disabled = !e.target.checked; } });
    const form = el("form", { class: "sheet-form", autocomplete: "off", onsubmit: async e => {
      e.preventDefault();
      if (!agree.checked) return;
      add.disabled = true; err.hidden = true;
      try {
        const j = await send("/api/projects", "POST", { path, name: nameInput.value.trim() || undefined, confirm: true });
        await load(true);
        setCurrent(j.project.id);
        closeModal();
        toast(`프로젝트 ‘${j.project.name}’ 를 추가했어요. 이제 업무가 이 폴더 안에서 실행돼요.`, "info", 4000);
      } catch (x) { err.textContent = x.message; err.hidden = false; add.disabled = !agree.checked; }
    } },
      el("div", { class: "sheet-body" },
        el("div", { class: "consent-warn", role: "note" }, icon("alert"),
          el("div", null,
            el("strong", { text: "이 폴더의 모든 파일을 AI 팀(Claude·GPT·Gemini)이 읽고, 만들고, 고치고, 지울 수 있습니다." }),
            el("p", { text: "업무를 실행하면 팀원들이 이 폴더를 작업 폴더로 삼아 파일을 직접 바꿉니다. 파일 내용은 각 AI 서비스로 전송될 수 있어요. 중요한 파일은 먼저 백업하거나 Git 으로 관리하는 폴더를 고르세요. 접근은 ‘프로젝트’ 화면에서 언제든 해제할 수 있어요." }))),
        el("p", { class: "field-label", text: "폴더" }),
        el("code", { class: "proj-path block", text: path }),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "pjName", text: "프로젝트 이름" }), nameInput),
        el("label", { class: "consent-check", for: "pjAgree" }, agree, el("span", { text: "이해했고 전체 접근을 허락합니다" })),
        err),
      el("footer", { class: "sheet-foot" },
        el("button", { class: "btn secondary", type: "button", text: "취소", onclick: closeModal }), add));
    openModal([sheetHead("폴더 전체 접근 허락", name, back), form]);
    agree.focus({ preventScroll: true });
  }

  /* ── 이름 바꾸기 ── */
  function openRename(p) {
    const input = el("input", { class: "text-input", id: "pjRename", type: "text", value: p.name, maxlength: "80", autocomplete: "off" });
    const err = el("p", { class: "error-text small", role: "alert", hidden: true });
    const form = el("form", { class: "sheet-form", onsubmit: async e => {
      e.preventDefault();
      try { await send(`/api/projects/${encodeURIComponent(p.id)}`, "PATCH", { name: input.value }); await load(true); closeModal(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
    } },
      el("div", { class: "sheet-body" }, el("label", { class: "field-label", for: "pjRename", text: "프로젝트 이름" }), input, err),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", text: "취소", onclick: closeModal }), el("button", { class: "btn", type: "submit", text: "저장" })));
    openModal([sheetHead("이름 바꾸기", p.path), form], true);
    input.select();
  }

  /* ── 접근 해제(두 번 눌러 확인) ── */
  const ARM = { id: "", t: 0 };
  async function revoke(p, btn) {
    if (ARM.id !== p.id) {
      ARM.id = p.id; clearTimeout(ARM.t);
      btn.textContent = "한 번 더 누르면 해제"; btn.classList.add("danger-armed");
      ARM.t = setTimeout(() => { ARM.id = ""; if (VIEW.name === "projects") renderView(); }, 4000);
      return;
    }
    ARM.id = ""; clearTimeout(ARM.t);
    try {
      await send(`/api/projects/${encodeURIComponent(p.id)}`, "DELETE");
      if (S.current === p.id) setCurrent("");
      await load(true);
      toast(`‘${p.name}’ 폴더 접근을 해제했어요. 폴더와 파일은 그대로 있어요.`, "info", 3500);
    } catch (x) { toast(x.message, "error"); }
  }

  /* ── '프로젝트' 보기 ── */
  function view() {
    if (!S.loaded && live()) load().then(() => VIEW.name === "projects" && renderView());
    const head = [
      el("p", { class: "muted", text: "프로젝트는 AI 팀이 파일을 직접 읽고 고칠 수 있게 허락한 로컬 폴더예요. 명령창의 폴더 버튼으로 고르면 다음 업무가 그 폴더 안에서 실행돼요." }),
      el("div", { class: "toolbar" },
        el("button", { class: "tbtn accent", type: "button", disabled: !live(), onclick: () => openFolder() }, icon("plus"), "폴더 열기…"),
        el("button", { class: "tbtn", type: "button", disabled: !live(), onclick: () => load(true) }, icon("history"), "새로 고침")),
    ];
    if (!live()) return [...head, el("p", { class: "empty", text: "서버에 연결되면 프로젝트를 쓸 수 있어요. (데모 모드에서는 폴더에 접근하지 않아요)" })];
    if (S.error) return [...head, el("p", { class: "error-text", text: S.error })];
    if (!S.loaded) return [...head, el("p", { class: "empty", text: "불러오는 중…" })];
    if (!S.list.length) return [...head, el("p", { class: "empty", text: "아직 등록한 프로젝트가 없어요. ‘폴더 열기…’로 작업할 폴더를 추가하세요." })];
    return [...head, el("ul", { class: "proj-list", "aria-label": `프로젝트 ${S.list.length}개` }, ...S.list.map(p => {
      const on = p.id === S.current, del = el("button", { class: "tbtn", type: "button", onclick: e => revoke(p, e.currentTarget) }, ARM.id === p.id ? "한 번 더 누르면 해제" : "접근 해제");
      if (ARM.id === p.id) del.classList.add("danger-armed");
      return el("li", { class: `proj-item${on ? " on" : ""}` },
        el("div", { class: "proj-main" },
          el("strong", null, icon("folder-open"), el("span", { text: p.name }), on ? el("span", { class: "badge", text: "사용 중" }) : null),
          el("code", { class: "proj-path", text: p.path }),
          el("small", { class: "muted", text: `전체 접근 허락 · ${fmtCreated(p.granted_at)}` })),
        el("div", { class: "proj-actions" },
          el("button", { class: `tbtn${on ? "" : " accent"}`, type: "button", "aria-pressed": String(on), onclick: () => setCurrent(on ? "" : p.id) }, on ? "선택 해제" : "선택"),
          el("button", { class: "tbtn", type: "button", onclick: () => openRename(p) }, "이름 바꾸기"),
          del));
    }))];
  }

  $("projectBtn")?.addEventListener("click", openMenu);
  paint();
  // 서버 연결(재연결 포함)되면 목록을 불러온다
  let was = "";
  setInterval(() => { if (NET.mode !== was) { was = NET.mode; if (live()) load(true); else paint(); } }, 1000);

  return { currentId: () => (live() && current() ? S.current : ""), current, forget: id => { if (S.current === id) setCurrent(""); load(true); }, view, load, openPicker, openFolder };
})();
