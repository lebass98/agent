"use strict";
/* 팀 실행 보강 화면 — app.js 를 크게 고치지 않고 전역(VIEWS·NET·D·api·getJSON·el·icon·toast·openModal·sheetHead·closeModal…) 위에 붙는다.
   1) 중단된 업무 이어 하기: 서버가 다시 켜졌을 때 끊긴 업무가 있으면 화면 아래에 [이어 하기] 카드 (GET /api/runs/resumable, POST …/resume·dismiss)
   2) 사용량: '분석' 보기에 최근 7일 팀원별 호출·시간·토큰·(API 환산) 비용 (GET /api/usage)
   3) 결과 알림(n8n·웹훅): 설정 > 결과 알림 (GET/PUT /api/notify, POST /api/notify/test)
   4) 외부 도구(MCP): 설정 > 외부 도구 목록·등록 (GET/PUT/DELETE /api/tools) + 업무 지시 직전 '이번 업무에 허락' 확인 창(beforeRun)
   index.html 에서 app.js 다음에 읽는다. 스타일은 extras.css. */
window.Extras = (() => {
  const live = () => NET.mode === "live";
  const num = n => Number(n || 0).toLocaleString("ko-KR");
  const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || 0));
  const usd = n => (n ? `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}` : "—");
  async function send(path, method, body) {
    const r = await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw new Error(KEY_MSG);
    if (!r.ok) throw new Error(typeof j?.detail === "string" ? j.detail : `요청이 실패했어요 (${r.status})`);
    return j;
  }
  const rowEl = (label, sub, ctrl) => el("div", { class: "set-row" }, el("div", { class: "lbl" }, label, sub ? el("small", { text: sub }) : null), ctrl);

  /* ── 1) 이어 하기 카드 ── */
  const RS = { list: [], hidden: new Set(), busy: false };
  let card = null;
  async function checkResumable() {
    if (!live() || D.running) return paintResume();
    try { RS.list = (await getJSON("/api/runs/resumable")).runs || []; } catch { RS.list = []; }
    paintResume();
  }
  function paintResume() {
    const item = live() && !D.running ? RS.list.find(r => !RS.hidden.has(r.run_id)) : null;
    if (!item) { if (card) card.hidden = true; return; }
    if (!card) { card = el("section", { class: "resume-card", role: "status", "aria-live": "polite" }); document.body.append(card); }
    const why = item.status === "error" ? "오류로 멈춘 업무" : "서버가 꺼져 끊긴 업무";
    const prog = item.total ? `${item.done}/${item.total}개 업무 끝남` : "계획 단계에서 멈춤";
    card.replaceChildren(...[
      el("div", { class: "rc-head" }, icon("history"), el("strong", { text: `${why}가 있어요` }),
        el("button", { class: "icon-btn rc-x", type: "button", "aria-label": "닫기", onclick: () => { RS.hidden.add(item.run_id); paintResume(); } }, icon("x"))),
      el("p", { class: "rc-goal", text: clip(item.goal || "(목표 없음)", 120), title: item.goal }),
      el("p", { class: "rc-meta", text: [fmtCreated(item.created), prog, item.project ? `프로젝트 ${item.project}` : ""].filter(Boolean).join(" · ") }),
      item.error ? el("p", { class: "rc-err", text: clip(item.error, 140) }) : null,
      el("div", { class: "rc-actions" },
        el("button", { class: "tbtn", type: "button", disabled: RS.busy, onclick: () => dismiss(item) }, "그만두기"),
        el("button", { class: "btn", type: "button", disabled: RS.busy, onclick: () => resume(item) }, icon("zap"), "이어 하기"))].filter(Boolean));
    card.hidden = false;
  }
  async function resume(item) {
    if (RS.busy) return;
    let tools;
    if (item.tools?.length) { // 끊기기 전에 외부 도구를 허락했던 업무: 이어 할 때도 다시 묻는다
      const c = await beforeRun(item.tools);
      if (c === null) return;
      tools = c.tools;
    }
    RS.busy = true; paintResume();
    try {
      await send(`/api/runs/${encodeURIComponent(item.run_id)}/resume`, "POST", { tools });
      UI.mine.add(item.run_id); // 끝나면 보고서 창을 자동으로 연다
      RS.list = RS.list.filter(r => r.run_id !== item.run_id);
      toast("끊긴 지점부터 이어 합니다. 끝난 업무는 다시 하지 않아요.", "info", 4000);
    } catch (e) { toast(e.message, "error", 5000); }
    finally { RS.busy = false; paintResume(); }
  }
  async function dismiss(item) {
    try { await send(`/api/runs/${encodeURIComponent(item.run_id)}/dismiss`, "POST"); } catch { /* 표시만 지운다 */ }
    RS.list = RS.list.filter(r => r.run_id !== item.run_id);
    paintResume();
  }

  /* ── 2) 사용량 ('분석' 보기) ── */
  const US = { data: null, at: 0, loading: false, error: "" };
  async function loadUsage(force) {
    if (!live() || US.loading || (!force && US.data && Date.now() - US.at < 30000)) return;
    US.loading = true;
    try { US.data = await getJSON("/api/usage?days=7"); US.at = Date.now(); US.error = ""; }
    catch (e) { US.error = e.message; }
    finally { US.loading = false; if (VIEW.name === "stats") renderView(); }
  }
  function usageSection() {
    const head = el("h3", { class: "sec" }, icon("zap"), "사용량", el("span", { class: "cnt", text: "최근 7일 · 서버 기록" }));
    if (!live()) return [head, el("p", { class: "empty", text: "서버에 연결되면 팀원별 사용량을 보여 줘요." })];
    loadUsage();
    if (US.error && !US.data) return [head, el("p", { class: "error-text", text: US.error })];
    const u = US.data;
    if (!u) return [head, el("p", { class: "empty", text: "불러오는 중…" })];
    if (!u.total.calls) return [head, el("p", { class: "empty", text: "최근 7일 사용 기록이 없어요. 업무를 실행하면 호출마다 시간·토큰이 쌓여요." })];
    const stat = (k, v, note) => el("div", { class: "stat" }, el("div", { class: "k", text: k }), el("div", { class: "v", text: v }), note ? el("div", { class: "k", text: note }) : null);
    const names = Object.keys(u.by_member), max = Math.max(1, ...names.map(n => u.by_member[n].ms));
    const bar = n => {
      const s = u.by_member[n], d = (() => { try { return memberDef(n); } catch { return { label: n, color: "#8a94a6" }; } })();
      return el("div", { class: "brow", style: { "--c": d.color } }, el("span", { class: "bname mc", text: d.label }),
        el("span", { class: "ubar", "aria-hidden": "true" }, el("i", { style: { width: `${Math.max(2, s.ms / max * 100)}%` } })),
        el("span", { class: "bval", text: `${s.calls}회 · ${fmtDur(s.ms)} · ${tok(s.input_tokens + s.output_tokens)} 토큰` }));
    };
    const stageKo = { plan: "계획", task: "업무", check: "중간 검수", review: "최종 보고" };
    return [head,
      el("div", { class: "stat-grid" },
        stat("호출", `${num(u.total.calls)}회`, `업무 ${u.runs}건`),
        stat("AI 작업 시간", fmtDur(u.total.ms)),
        stat("토큰(입력+출력)", tok(u.total.input_tokens + u.total.output_tokens), `입력 ${tok(u.total.input_tokens)} · 출력 ${tok(u.total.output_tokens)}`),
        stat("API 환산 비용", usd(u.total.cost_usd), "구독(CLI)은 실제 청구 아님")),
      el("div", { class: "bars" }, ...names.map(bar)),
      el("p", { class: "muted small", text: `단계별: ${Object.entries(u.by_stage).map(([k, s]) => `${stageKo[k] || k} ${s.calls}회`).join(" · ")}. 토큰·비용은 CLI 가 알려 준 만큼만 집계돼요(Claude 는 정확, Codex·Antigravity 는 시간만).` }),
      el("button", { class: "tbtn", type: "button", onclick: () => loadUsage(true) }, icon("history"), "새로 고침")];
  }

  /* ── 3) 결과 알림(n8n·웹훅) ── */
  async function openNotify() {
    if (!live()) { toast("서버에 연결된 뒤 설정할 수 있어요.", "info"); return; }
    let cfg;
    try { cfg = await getJSON("/api/notify"); } catch (e) { toast(e.message, "error"); return; }
    const url = el("input", { class: "text-input", id: "ntUrl", type: "url", value: cfg.url || "", placeholder: "https://n8n.example.com/webhook/…", autocomplete: "off", spellcheck: "false" });
    const secret = el("input", { class: "text-input", id: "ntSecret", type: "password", autocomplete: "new-password", placeholder: cfg.has_secret ? "저장됨 — 바꿀 때만 입력" : "선택: 받는 쪽에서 위조를 확인할 비밀 키" });
    const on = el("input", { type: "checkbox", id: "ntOn", checked: cfg.enabled });
    const msg = el("p", { class: "small nt-msg", role: "status" }, cfg.last ? lastText(cfg.last) : "");
    const save = async (quiet) => {
      const body = { url: url.value.trim(), enabled: on.checked };
      if (secret.value) body.secret = secret.value;
      const j = await send("/api/notify", "PUT", body);
      secret.value = ""; secret.placeholder = j.has_secret ? "저장됨 — 바꿀 때만 입력" : secret.placeholder;
      if (!quiet) toast(j.enabled ? "업무가 끝나면 결과를 이 주소로 보내요." : "결과 알림을 껐어요.", "info");
      return j;
    };
    const form = el("form", { class: "sheet-form", autocomplete: "off", onsubmit: async e => {
      e.preventDefault();
      try { await save(); closeModal(); } catch (x) { msg.textContent = x.message; msg.className = "small nt-msg error-text"; }
    } },
      el("div", { class: "sheet-body" },
        el("p", { class: "muted", text: "업무가 끝날 때마다 목표·최종 보고서·성공 여부·사용량을 JSON 으로 이 주소에 보내요. n8n 의 Webhook 노드(POST) 주소를 넣으면 메일·슬랙·노션 저장 같은 후속 자동화를 붙일 수 있어요." }),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "ntUrl", text: "받을 주소(URL)" }), url),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "ntSecret", text: "비밀 키 (선택)" }), secret,
          el("small", { text: "넣으면 본문의 HMAC-SHA256 값을 X-Agent-Signature: sha256=… 헤더로 붙여요." })),
        el("label", { class: "consent-check", for: "ntOn" }, on, el("span", { text: "업무가 끝나면 알림 보내기" })),
        el("button", { class: "tbtn", type: "button", onclick: async () => {
          try { await save(true); msg.textContent = "시험 알림을 보내는 중…"; msg.className = "small nt-msg"; const r = await send("/api/notify/test", "POST");
            msg.textContent = r.ok ? `시험 알림 성공 (HTTP ${r.status})` : `시험 알림 실패: ${r.error || r.status}`; msg.className = `small nt-msg ${r.ok ? "ok-text" : "error-text"}`;
          } catch (x) { msg.textContent = x.message; msg.className = "small nt-msg error-text"; }
        } }, icon("send"), "시험 알림 보내기"),
        msg,
        el("details", { class: "nt-help" }, el("summary", { text: "n8n 에서 업무를 시작시키려면" }),
          el("p", { text: "n8n 의 HTTP Request 노드로 이 서버에 POST /api/run 을 보내면 돼요. 본문: {\"goal\": \"할 일\"}. --lan 으로 켰다면 헤더 X-Access-Key 에 접속 키를 넣으세요. 예약(Schedule) 노드와 묶으면 '매일 아침 9시에 이 업무 실행 → 결과를 메일로' 같은 흐름이 돼요." }))),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", text: "닫기", onclick: closeModal }), el("button", { class: "btn", type: "submit", text: "저장" })));
    openModal([sheetHead("결과 알림 (n8n·웹훅)", "업무가 끝나면 결과를 다른 서비스로 보내기"), form]);
  }
  const lastText = l => `마지막 전송: ${fmtCreated(l.at)} · ${l.ok ? "성공" : `실패 (${l.error || l.status})`}`;

  /* ── 4) 외부 도구(MCP) ── */
  const TL = { servers: null, members: [], at: 0 };
  async function loadTools(force) {
    if (!live()) return TL;
    if (!force && TL.servers && Date.now() - TL.at < 15000) return TL;
    const j = await getJSON("/api/tools");
    TL.servers = j.servers || []; TL.members = j.members || []; TL.at = Date.now();
    return TL;
  }
  const EXAMPLES = {
    remote: '{\n  "type": "http",\n  "url": "https://mcp.composio.dev/…/mcp",\n  "headers": { "Authorization": "Bearer …" }\n}',
    stdio: '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"]\n}',
  };
  async function openTools() {
    if (!live()) { toast("서버에 연결된 뒤 설정할 수 있어요.", "info"); return; }
    try { await loadTools(true); } catch (e) { toast(e.message, "error"); return; }
    const err = el("p", { class: "error-text small", role: "alert", hidden: true });
    const name = el("input", { class: "text-input", id: "tlName", type: "text", maxlength: "32", placeholder: "예: gmail, slack, composio", autocomplete: "off", spellcheck: "false" });
    const desc = el("input", { class: "text-input", id: "tlDesc", type: "text", maxlength: "200", placeholder: "예: 메일 읽기·보내기", autocomplete: "off" });
    const conf = el("textarea", { class: "text-input mono", id: "tlConf", rows: "6", spellcheck: "false", placeholder: EXAMPLES.remote });
    const list = TL.servers.length
      ? el("ul", { class: "tl-list" }, ...TL.servers.map(s => el("li", null,
          el("div", null, el("strong", { text: s.name }), el("span", { class: "badge", text: s.kind === "stdio" ? "이 컴퓨터에서 실행" : "원격" }),
            el("small", { class: "muted", text: [s.description, s.target].filter(Boolean).join(" · ") })),
          el("button", { class: "tbtn", type: "button", onclick: async () => {
            try { await send(`/api/tools/${encodeURIComponent(s.name)}`, "DELETE"); await openTools(); } catch (x) { toast(x.message, "error"); }
          } }, icon("x"), "삭제"))))
      : el("p", { class: "empty", text: "등록한 외부 도구가 없어요." });
    const who = TL.members.length ? TL.members.map(n => { try { return memberDef(n).label; } catch { return n; } }).join(", ") : "없음 (claude-cli 로 연결된 팀원만 쓸 수 있어요)";
    const form = el("form", { class: "sheet-form", autocomplete: "off", onsubmit: async e => {
      e.preventDefault(); err.hidden = true;
      let cfg;
      try { cfg = JSON.parse(conf.value); } catch { err.textContent = "설정이 올바른 JSON 이 아니에요."; err.hidden = false; return; }
      if (cfg && cfg.mcpServers && typeof cfg.mcpServers === "object") { // {"mcpServers": {"이름": {...}}} 통째로 붙여 넣은 경우
        const [k, v] = Object.entries(cfg.mcpServers)[0] || [];
        if (k && !name.value.trim()) name.value = k.toLowerCase();
        cfg = v;
      }
      try {
        await send(`/api/tools/${encodeURIComponent(name.value.trim().toLowerCase())}`, "PUT", { config: cfg, description: desc.value.trim() });
        toast("외부 도구를 등록했어요. 업무를 지시할 때 이번 업무에 쓸지 물어볼게요.", "info", 4500);
        await openTools();
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    } },
      el("div", { class: "sheet-body" },
        el("div", { class: "consent-warn", role: "note" }, icon("alert"), el("div", null,
          el("strong", { text: "외부 도구를 쓰면 AI 팀이 메일·슬랙·깃허브 같은 바깥 서비스에서 실제로 읽고 쓸 수 있어요." }),
          el("p", { text: "등록만으로는 쓰이지 않아요. 업무를 지시할 때마다 ‘이번 업무에 허락’한 도구만 그 업무에 붙어요. 등록·삭제는 서버가 켜진 컴퓨터에서만 할 수 있어요." }))),
        el("p", { class: "muted small", text: `쓸 수 있는 팀원: ${who}` }),
        el("h3", { class: "sec" }, icon("zap"), "등록한 도구"), list,
        el("h3", { class: "sec" }, icon("plus"), "도구 추가"),
        el("div", { class: "form-grid" },
          el("div", { class: "field" }, el("label", { class: "field-label", for: "tlName", text: "이름 (영문)" }), name),
          el("div", { class: "field" }, el("label", { class: "field-label", for: "tlDesc", text: "설명" }), desc)),
        el("div", { class: "field" }, el("label", { class: "field-label", for: "tlConf", text: "MCP 서버 설정 (JSON)" }), conf,
          el("small", null, "Composio 같은 서비스가 준 MCP 주소는 원격 형식으로, 이 컴퓨터에서 실행하는 서버는 command 형식으로 넣어요. ",
            el("button", { class: "link", type: "button", onclick: () => { conf.value = EXAMPLES.remote; } }, "원격 예시"), " · ",
            el("button", { class: "link", type: "button", onclick: () => { conf.value = EXAMPLES.stdio; } }, "command 예시"))),
        err),
      el("footer", { class: "sheet-foot" }, el("button", { class: "btn secondary", type: "button", text: "닫기", onclick: closeModal }), el("button", { class: "btn", type: "submit", text: "등록" })));
    openModal([sheetHead("외부 도구 (MCP)", "AI 팀이 쓸 수 있는 바깥 서비스 연결"), form]);
  }

  /** 업무 지시 직전: 외부 도구가 등록돼 있으면 이번 업무에 쓸지 묻는다. → {tools: [...]} · {} (도구 없이) · null (취소) */
  async function beforeRun(preset) {
    if (!live()) return {};
    try { await loadTools(); } catch { return {}; }
    if (!TL.servers?.length || !TL.members.length) return {};
    const remembered = (() => { try { return JSON.parse(store.get("agentOffice.tools") || "[]"); } catch { return []; } })();
    const want = new Set(preset || remembered);
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; obs.disconnect(); resolve(v); };
      const boxes = TL.servers.map(s => el("label", { class: "tl-pick" }, el("input", { type: "checkbox", value: s.name, checked: want.has(s.name) }),
        el("span", null, el("strong", { text: s.name }), el("small", { class: "muted", text: s.description || s.target }))));
      const pick = () => boxes.map(b => b.querySelector("input")).filter(i => i.checked).map(i => i.value);
      const ok = el("button", { class: "btn", type: "button", onclick: () => { const t = pick(); store.set("agentOffice.tools", JSON.stringify(t)); closeModal(); finish({ tools: t }); } }, icon("check"), "허락하고 실행");
      openModal([sheetHead("이번 업무에 외부 도구를 쓸까요?", "허락한 도구만 이번 업무에 붙어요"),
        el("div", { class: "sheet-body" },
          el("div", { class: "consent-warn", role: "note" }, icon("alert"), el("div", null,
            el("strong", { text: "허락하면 AI 팀원이 이 도구로 바깥 서비스에서 실제로 읽고 쓸 수 있어요." }),
            el("p", { text: "메일 발송·게시·삭제 같은 행동은 업무 지시에 분명히 적힌 경우에만 하도록 안내해요. 한 일은 결과에 남아요." }))),
          el("div", { class: "tl-picks", role: "group", "aria-label": "이번 업무에 허락할 외부 도구" }, ...boxes)),
        el("footer", { class: "sheet-foot" },
          el("button", { class: "btn secondary", type: "button", text: "취소", onclick: () => { closeModal(); finish(null); } }),
          el("button", { class: "btn secondary", type: "button", text: "도구 없이 실행", onclick: () => { closeModal(); finish({}); } }), ok)], true);
      // 바깥을 눌러 닫거나 ✕ 로 닫으면 취소
      const obs = new MutationObserver(() => { if ($("modal").hidden) finish(null); });
      obs.observe($("modal"), { attributes: true, attributeFilter: ["hidden"] });
    });
  }

  /* ── 설정·분석 보기에 끼워 넣기 ── */
  if (typeof VIEWS.settings === "function") {
    const base = VIEWS.settings;
    VIEWS.settings = function () {
      const rows = [].concat(base());
      const i = rows.findIndex(r => r?.tagName === "H3" && r.textContent.includes("서버 정보"));
      rows.splice(i >= 0 ? i : rows.length, 0,
        rowEl("결과 알림 (n8n·웹훅)", "업무가 끝나면 결과를 다른 서비스로 보내요.", el("button", { class: "tbtn", type: "button", onclick: openNotify }, icon("send"), "설정")),
        rowEl("외부 도구 (MCP)", "메일·슬랙·깃허브 같은 바깥 서비스를 AI 팀이 쓰게 연결해요. 업무마다 허락을 받아요.", el("button", { class: "tbtn", type: "button", onclick: openTools }, icon("zap"), "관리")));
      return rows;
    };
  }
  if (typeof VIEWS.stats === "function") {
    const base = VIEWS.stats;
    VIEWS.stats = function () { return [...[].concat(base()), ...usageSection()]; };
  }

  // 서버 연결 상태가 바뀌거나 업무가 끝나면 이어 할 업무를 다시 확인한다
  let was = "", wasRunning = false;
  setInterval(() => {
    if (NET.mode !== was) { was = NET.mode; RS.hidden.clear(); checkResumable(); }
    if (wasRunning !== D.running) { wasRunning = D.running; if (!D.running) setTimeout(checkResumable, 1500); else paintResume(); }
  }, 1000);

  return { beforeRun, openNotify, openTools, checkResumable, loadUsage };
})();
