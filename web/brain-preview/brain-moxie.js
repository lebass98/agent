"use strict";
/* 브레인 모드 시안 × Moxie(WnC Motion). 각 위젯에 맞는 Moxie 리소스의 '기법'을 새로 써서 붙인다(코드 복사 아님).
   카드 머리에 쓴 리소스를 ✦ 표시로 달고, 누르면 로컬 Moxie(127.0.0.1:5181)의 그 데모가 열린다.
   시안 HTML 의 data-moxie="slug slug" 를 읽는다. 동작 줄이기 설정이면 움직임은 끈다. */
(() => {
  const B = window.Brain, { $, $$, h, ic } = B;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPRING = "cubic-bezier(.34,1.56,.64,1)";
  const MOXIE = "http://127.0.0.1:5181/";
  const CAT = { lunario: "diagramas", semana: "sistemas", turno: "formularios", bandeja: "sistemas", pila: "avisos", baliza: "avisos", isla: "avisos", dock: "navegacion",
    iman: "botones", cifras: "secciones", raudal: "sistemas", cavila: "texto", aliento: "generativo", jornada: "listas", brinco: "formularios", segmentos: "navegacion",
    sintonia: "interruptores", capsula: "navegacion", hallazgo: "listas", acordeon: "tarjetas", corrillo: "tarjetas", pregunta: "sistemas", racha: "graficos",
    placet: "sistemas", cuenta: "cargas", insignia: "avisos", esqueleto: "cargas", anticipo: "listas", desliz: "listas", remembranza: "listas" };
  const KO = { lunario: "월간 달력", semana: "주간 시간표", turno: "날짜 고르기", bandeja: "알림함", pila: "알림 쌓기", baliza: "새 소식 비콘", isla: "다이내믹 아일랜드", dock: "독 확대",
    iman: "자석 버튼", cifras: "숫자 카운트업", raudal: "흘려 쓰기", cavila: "생각 중", aliento: "숨 쉬는 구", jornada: "할 일 체크", brinco: "튀는 스위치", segmentos: "두 스프링 탭",
    sintonia: "메뉴 표시 이동", capsula: "캡슐 탭", hallazgo: "찾기 하이라이트", acordeon: "아코디언", corrillo: "얼굴 펼치기", pregunta: "추천 질문", racha: "연속 기록",
    placet: "계획 확인", cuenta: "숫자 넘김", insignia: "배지 튀기", esqueleto: "스켈레톤", anticipo: "먼저 보여 주기", desliz: "밀어서 처리", remembranza: "기억 카드" };
  const link = s => `${MOXIE}#${CAT[s]}/${s}`;
  const used = new Set();

  /* ── ✦ Moxie 표시 ── */
  for (const el of $$("[data-moxie]")) {
    const slugs = el.dataset.moxie.split(/\s+/).filter(s => CAT[s]);
    slugs.forEach(s => used.add(s));
    const head = el.querySelector(":scope > header");
    if (!head) continue;
    const tag = h(`<a class="mx" href="${link(slugs[0])}" target="_blank" rel="noopener" title="Moxie: ${slugs.map(s => `${s}(${KO[s]})`).join(", ")}">✦ ${slugs.map(s => KO[s]).join(" · ")}</a>`);
    head.querySelector(".more") ? head.insertBefore(tag, head.querySelector(".more")) : head.append(tag);
  }
  // 막대에 '이 시안의 Moxie' 목록
  const bar = $(".demo-bar");
  if (bar) {
    const btn = h(`<button class="tbtn mxbtn">✦ Moxie ${used.size}</button>`);
    bar.insertBefore(btn, $("#themeT"));
    const pop = h(`<div class="mxpop" hidden><b>이 시안에 쓴 Moxie 리소스 (${used.size})</b><div>${[...used].map(s => `<a href="${link(s)}" target="_blank" rel="noopener"><code>${s}</code>${KO[s]}</a>`).join("")}</div><small>누르면 로컬 Moxie 데모가 새 탭으로 열려요 (npm run dev 또는 5181 서버 필요)</small></div>`);
    document.body.append(pop);
    btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; const r = btn.getBoundingClientRect(); pop.style.top = `${r.bottom + 6}px`; pop.style.right = `${innerWidth - r.right}px`; };
    addEventListener("click", e => { if (!pop.contains(e.target)) pop.hidden = true; });
  }
  if (reduce) return;

  /* ── 두 스프링 표시자: 메뉴(sintonia) · 탭(segmentos · capsula) ── */
  function slider(box, items, current, opt = {}) {
    box.style.position = "relative";
    const m = h(`<span class="mxmark${opt.cls ? " " + opt.cls : ""}" aria-hidden="true"></span>`);
    box.prepend(m);
    let px = null;
    const place = (b, instant) => {
      if (!b) return;
      const x = b.offsetLeft, y = b.offsetTop;
      m.classList.toggle("back", px !== null && (opt.v ? y < px : x < px));
      if (instant) m.style.transition = "none";
      Object.assign(m.style, opt.v ? { top: `${y}px`, bottom: `${box.clientHeight - y - b.offsetHeight}px`, left: `${b.offsetLeft}px`, width: `${b.offsetWidth}px` }
        : { left: `${x}px`, right: `${box.clientWidth - x - b.offsetWidth}px`, top: `${b.offsetTop}px`, height: `${b.offsetHeight}px` });
      px = opt.v ? y : x;
      if (instant) requestAnimationFrame(() => { m.style.transition = ""; });
    };
    place(current(), true);
    box.addEventListener("click", e => { const b = e.target.closest(items); if (b && box.contains(b)) requestAnimationFrame(() => place(current() || b)); });
    addEventListener("resize", () => place(current(), true));
    box.classList.add("mx-slid");
  }
  const rail = $(".rail");
  if (rail) {
    rail.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("button", rail).forEach(x => x.toggleAttribute("aria-current", x === b)); if (!b.closest(".rail").querySelector("[aria-current]") || b !== $$("button", rail)[0]) B.toast(`시안: '${b.textContent.trim()}' 화면은 확정 후 만들어요`); });
    slider(rail, "button", () => $("[aria-current]", rail), { v: true, cls: "rail-mark" });
  }
  for (const seg of $$(".seg, .tabs")) slider(seg, "button", () => $("[aria-selected='true']", seg), { cls: seg.classList.contains("tabs") ? "tab-mark" : "" });

  /* ── 숫자 카운트업 (cifras) ── */
  for (const b of $$(".kpi b")) {
    const m = b.textContent.match(/^(\d+)(.*)$/); if (!m) continue;
    const to = +m[1], rest = m[2], t0 = performance.now(), dur = 900;
    b.style.filter = "blur(2px)";
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); b.textContent = Math.round(to * e) + rest; b.style.filter = `blur(${(1 - k) * 2}px)`; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /* ── 브리핑: 생각 중 → 흘려 쓰기 (cavila · raudal) ── */
  for (const p of $$(".brief > p")) {
    const html = p.innerHTML, text = p.textContent;
    p.innerHTML = `<span class="mx-think">메일·일정·회의록 읽는 중…</span>`;
    const t0 = performance.now();
    setTimeout(() => {
      let i = 0;
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      const tick = () => {
        i = Math.min(text.length, i + 3);
        p.innerHTML = i < text.length ? `${B.esc(text.slice(0, i))}<span class="mx-caret"></span>` : `${html} <span class="mx-thought">${sec}초 동안 정리함</span>`;
        if (i < text.length) setTimeout(tick, 18);
      };
      tick();
    }, 1200);
  }

  /* ── 독 확대 (dock) · 자석 아이콘 (iman) ── */
  for (const d of $$(".dock")) {
    const tiles = $$(".tile", d);
    d.addEventListener("mousemove", e => tiles.forEach(t => { const r = t.getBoundingClientRect(), dist = Math.abs(e.clientX - (r.left + r.width / 2)); const s = 1 + Math.max(0, 1 - dist / 120) * .45; t.style.transform = `translateY(${-(s - 1) * 24}px) scale(${s})`; t.style.transition = "transform .12s"; }));
    d.addEventListener("mouseleave", () => tiles.forEach(t => { t.style.transition = `transform .5s ${SPRING}`; t.style.transform = ""; }));
  }
  for (const t of $$(".apps .tile:not(.add)")) {
    const a = t.closest(".app");
    a.addEventListener("mousemove", e => { const r = t.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); t.style.transition = "transform .1s"; t.style.transform = `translate(${dx * .25}px,${dy * .25}px) rotate(${dx * .15}deg) scale(1.08)`; });
    a.addEventListener("mouseleave", () => { t.style.transition = `transform .55s ${SPRING}`; t.style.transform = ""; });
  }

  /* ── 중요 일정 숨기면 나머지가 스프링으로 자리 잡음 (pila) ── */
  for (const strip of $$(".float-strip, .pinned, #floats")) {
    strip.addEventListener("click", e => {
      if (!e.target.closest(".x")) return;
      const before = new Map($$(".fl", strip).map(f => [f, f.getBoundingClientRect()]));
      setTimeout(() => $$(".fl", strip).forEach(f => { const a = before.get(f), b = f.getBoundingClientRect(); if (!a) return; const dx = a.left - b.left, dy = a.top - b.top; if (dx || dy) f.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 520, easing: SPRING }); }), 240);
    }, true);
  }

  /* ── 메일 행: 누르면 읽음 점이 줄어듦 (bandeja) · 처음엔 스켈레톤 (esqueleto) ── */
  for (const m of $$(".mail")) {
    $$(".mrow", m).forEach((r, i) => { if (i < 3) r.classList.add("unread"); r.onclick = () => r.classList.remove("unread"); });
    const rows = $$(".mrow", m);
    rows.forEach(r => r.classList.add("mx-bone"));
    setTimeout(() => rows.forEach((r, i) => setTimeout(() => r.classList.remove("mx-bone"), i * 90)), 600);
  }

  /* ── 회의록 아코디언 (acordeon) ── */
  for (const box of $$("#meet")) {
    const ms = $$(".meet", box);
    ms.forEach((m, i) => { m.classList.add("mx-acc"); if (i) m.classList.add("shut"); $("h4", m).onclick = () => ms.forEach(x => x.classList.toggle("shut", x !== m || !x.classList.contains("shut"))); });
  }

  /* ── 루틴: 체크가 그려지고 줄이 그어짐 (jornada) · 스위치가 튐 (brinco) ── */
  addEventListener("click", e => {
    const c = e.target.closest(".check,.sw"); if (!c) return;
    c.classList.remove("mx-pop"); void c.offsetWidth; c.classList.add("mx-pop");
  });

  /* ── 팀 얼굴: 겹쳐 있다가 올리면 펼침 (corrillo) ── */
  for (const f of $$("#faces")) f.classList.add("mx-fan");

  /* ── 탭 배지 튀기 (insignia) ── */
  $$(".tabs em").forEach((em, i) => setTimeout(() => em.classList.add("mx-jump"), 900 + i * 200));

  /* ── 명령창 추천 질문 (pregunta) ── */
  const SUG = ["오늘 메일 중 답장할 것만 정리해 줘", "14시 미팅 준비물 체크리스트", "이번 주 회의록 할 일만 모아 줘", "랜딩 배포 오류 고쳐 줘"];
  for (const f of $$(".command")) {
    const inp = $("input", f), box = h(`<div class="mx-sugg" hidden>${SUG.map((s, i) => `<button type="button" style="animation-delay:${i * 50}ms">${s}</button>`).join("")}</div>`);
    f.style.position = "relative"; f.append(box);
    inp.addEventListener("focus", () => { if (!inp.value) box.hidden = false; });
    inp.addEventListener("input", () => { box.hidden = !!inp.value; });
    inp.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
    box.onmousedown = e => e.preventDefault();
    box.onclick = e => { const b = e.target.closest("button"); if (b) { inp.value = b.textContent; box.hidden = true; inp.focus(); } };
  }

  /* ── 스킬 찾기 (hallazgo) ── */
  for (const list of $$("#skills")) {
    const card = list.closest(".card"); if (!card) continue;
    const inp = h(`<input class="mx-find" placeholder="스킬 찾기 (예: 요약, motion)">`);
    list.before(inp);
    inp.oninput = () => {
      const k = inp.value.trim().toLowerCase();
      const before = new Map($$(".sk", list).map(s => [s, s.getBoundingClientRect()]));
      $$(".sk", list).forEach(s => {
        const name = $("b", s), desc = $("small", s), txt = (name.dataset.o ??= name.textContent), d = (desc.dataset.o ??= desc.textContent);
        const hit = !k || (txt + " " + d).toLowerCase().includes(k);
        s.hidden = !hit;
        const mark = (t) => { const at = k ? t.toLowerCase().indexOf(k) : -1; return at < 0 ? B.esc(t) : `${B.esc(t.slice(0, at))}<mark>${B.esc(t.slice(at, at + k.length))}</mark>${B.esc(t.slice(at + k.length))}`; };
        name.innerHTML = mark(txt); desc.innerHTML = mark(d);
      });
      $$(".sk:not([hidden])", list).forEach(s => { const a = before.get(s), b = s.getBoundingClientRect(); if (a && Math.abs(a.top - b.top) > 1) s.animate([{ transform: `translateY(${a.top - b.top}px)` }, { transform: "none" }], { duration: 420, easing: SPRING }); });
    };
  }

  /* ── 연속 기록 (racha): 루틴 카드 아래 12주 격자 ── */
  for (const rt of $$("[data-streak]")) {
    const cells = Array.from({ length: 84 }, (_, i) => { const v = (Math.sin(i * 1.7) + Math.cos(i * .45) + 2) / 4; return `<i style="--v:${v.toFixed(2)};animation-delay:${(i % 7 + Math.floor(i / 7)) * 18}ms"></i>`; }).join("");
    rt.append(h(`<div class="mx-streak"><small>최근 12주 루틴 기록 · 연속 <b>9일</b></small><div>${cells}</div></div>`));
  }
})();
