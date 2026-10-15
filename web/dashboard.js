"use strict";
/* 대시보드 시안 v2. 기존 리듀서 D/팀원 상태에서만 표시 데이터를 읽는다. */
window.Dashboard = (() => {
  let pending = 0, lastTeam = "", selectedRoom = "all";
  const cards = new Map();
  function schedule() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); }); }
  /* 얼굴에 마우스를 올리거나 키보드로 포커스하면 상태 카드(이름·역할·상태·지금 하는 일·진행률)를 띄운다.
     패널이 overflow 로 잘리지 않게 body 에 붙인 고정 위치 요소 하나를 같이 쓴다. */
  let tip = null, tipFor = "";
  function showTip(n) {
    tipFor = n;
    if (!tip) { tip = el("div",{class:"face-tip",role:"tooltip",id:"faceTip"}); document.body.append(tip); }
    fillTip();
    const b = cards.get(n)?.button.getBoundingClientRect();
    if (!b) return;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2));
    const below = b.bottom + 8 + h < innerHeight - 8;
    tip.style.left = `${Math.round(x)}px`; tip.style.top = `${Math.round(below ? b.bottom + 8 : b.top - h - 8)}px`;
    cards.get(n).button.setAttribute("aria-describedby", "faceTip");
  }
  function hideTip() { if (tip) tip.hidden = true; if (tipFor) cards.get(tipFor)?.button.removeAttribute("aria-describedby"); tipFor = ""; }
  function fillTip() {
    const c = cards.get(tipFor), i = c?.info;
    if (!tip || !c || !i) return;
    tip.style.setProperty("--c", c.d.color);
    tip.replaceChildren(
      el("div",{class:"ft-head"}, el("strong",{text:c.d.label}), el("span",{class:`ft-status${i.busy ? " busy" : ""}${i.failed ? " failed" : ""}`,text:i.failed ? `${i.status} · 실패 있음` : i.status})),
      c.d.role ? el("p",{class:"ft-role",text:c.d.role}) : null,
      el("p",{class:"ft-task",text:i.task}),
      el("div",{class:"ft-prog"}, el("span",{class:"bar"},el("i",{style:{width:`${i.pct}%`}})), el("small",{text:i.total ? `업무 ${i.fin}/${i.total} · ${i.pct}%` : "배정된 업무 없음"})),
      el("small",{class:"ft-model",text:c.d.model || PROVIDER_KO[c.d.provider] || c.d.provider || ""}));
  }
  addEventListener("scroll", hideTip, true);
  addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });

  function render() {
    if (!document.getElementById("activityAgents")) return;
    const names = D.names, teamKey = names.map(n => `${n}:${A(n).def.model}:${A(n).def.provider}:${A(n).def.role}:${appearanceOf(n)}`).join("|");
    if (teamKey !== lastTeam) {
      lastTeam = teamKey; cards.clear();
      $("activityAgents").replaceChildren(...names.map(n => {
        const d = A(n).def;
        const avatar = facesOf(n) ? el("span", {class:"activity-avatar face",style:faceVars(facesOf(n)),"aria-hidden":"true"}) : el("span",{class:"activity-avatar",text:d.initial,"aria-hidden":"true"});
        // 얼굴만 보이는 팀원 칩: 얼굴 둘레 테두리(링)가 그 팀원의 업무 진행률. 이름·역할·상태는 툴팁·스크린리더로
        const ring = el("span",{class:"face-ring","aria-hidden":"true"}, avatar);
        const button = el("button",{type:"button",class:"activity-agent",style:{"--c":d.color,"--p":0},onclick:()=>{ hideTip(); window.CharacterChat?.open(n); },
          onpointerenter:()=>showTip(n),onpointerleave:hideTip,onfocus:()=>showTip(n),onblur:hideTip}, ring);
        cards.set(n,{button,ring,avatar,d}); return button;
      }));
    }
    const runNow = D.shown, all = runNow ? [...runNow.tasks.values()] : [];
    for (const n of names) {
      const state = A(n).card?.st || IDLE, c = cards.get(n), busy = BUSY.includes(state.status);
      const mine = all.filter(t => t.assignee === n), fin = mine.filter(isFin).length, failed = mine.some(t => t.vstate === "failed");
      const pct = mine.length ? Math.round(fin / mine.length * 100) : 0;
      const task = state.task && state.task !== "—" ? state.task : "새 업무를 기다리고 있어요";
      c.button.style.setProperty("--p", busy && pct < 8 ? 8 : pct); // 작업 중인데 0% 면 조금 채워 움직임이 보이게
      c.ring.className = `face-ring${busy ? " busy" : ""}${mine.length ? " has" : ""}${failed ? " failed" : ""}`;
      const prog = mine.length ? `업무 ${fin}/${mine.length} (${pct}%)` : "배정된 업무 없음";
      c.info = { status: state.status, busy, task, fin, total: mine.length, pct, failed };
      c.button.setAttribute("aria-label", `${c.d.label}, ${state.status}, ${prog}. 말 걸기`);
      if (facesOf(n)) for (const [k,v] of Object.entries(faceVars(facesOf(n),A(n).expr))) c.avatar.style.setProperty(k,v);
    }
    if (tipFor) fillTip();
    $("teamActivityCount").textContent = `${names.length}명의 에이전트 · ${names.filter(n=>BUSY.includes(A(n).card?.st.status)).length}명 작업 중`;
    const run = D.shown, tasks = run ? [...run.tasks.values()] : [], completed = tasks.filter(isFin).length;
    const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
    $("activeGoal").textContent = run?.goal || "팀과 함께, 다음 아이디어를 현실로";
    $("activeGoal").title = run?.goal || "";
    const proj = run?.project, chip = $("runProject");
    if (chip) {
      chip.hidden = !proj;
      if (proj) { $("runProjectName").textContent = proj.name; chip.title = `프로젝트 폴더: ${proj.path}`; chip.setAttribute("aria-label", `이 업무의 프로젝트: ${proj.name} (${proj.path})`); }
    }
    $("activePhase").textContent = run ? `${D.phaseText} · ${completed}/${tasks.length}개 업무 종료` : "업무를 입력하면 팀장이 계획하고 배정합니다";
    $("completionValue").textContent = tasks.length ? `${percent}%` : "대기";
    $("completionBar").value = percent;
    const phase = /검수|보고/.test(D.phaseText) || (tasks.length && completed === tasks.length) ? 2 : tasks.length ? 1 : 0;
    [...$("runSteps").children].forEach((node,i)=>{ node.classList.toggle("complete",!!run && (i<phase || (!D.running && completed===tasks.length && tasks.length>0))); node.classList.toggle("current",!!run && i===phase); if(run && i===phase)node.setAttribute("aria-current","step");else node.removeAttribute("aria-current"); });
    $("newTaskBtn").disabled = !!D.running || !!UI.submitting;
    layout();
  }
  function layout() {
    const r = $("officeFrame").getBoundingClientRect();
    const inset = `${Math.max(0,r.top)}px ${Math.max(0,innerWidth-r.right)}px ${Math.max(0,innerHeight-r.bottom)}px ${Math.max(0,r.left)}px`;
    $("stage").style.clipPath = `inset(${inset} round 14px)`;
    $("labels").style.clipPath = `inset(${inset} round 14px)`;
  }
  function init() {
    // 업무 카드의 기존 DOM과 클릭 핸들러를 보존한다.
    $("taskShelf").append(document.querySelector('[data-pane="board"]'));
    $("railProfile").onclick=()=>showView("settings");
    $("activityMembers").onclick=()=>showView("members");
    // 팀 활동 접기·펼치기 (브라우저에 기억). 접힌 띠에서 얼굴을 누르면 대화창, 화살표를 누르면 다시 펼친다
    const setTeamCollapsed=on=>{document.body.classList.toggle("team-collapsed",on);const b=$("activityCollapse");b.setAttribute("aria-expanded",String(!on));b.setAttribute("aria-label",on?"팀 활동 펼치기":"팀 활동 접기");b.title=on?"팀 활동 펼치기":"팀 활동 접기";store.set("agentOffice.teamCollapsed",on?"1":"0");};
    $("activityCollapse").onclick=()=>setTeamCollapsed(!document.body.classList.contains("team-collapsed"));
    setTeamCollapsed(store.get("agentOffice.teamCollapsed")==="1");
    $("activityClose").onclick=()=>{setDock(false);$("teamToggle").setAttribute("aria-expanded","false");$("teamToggle").focus();};
    $("teamToggle").onclick=()=>{const open=!$("dock").classList.contains("open");setDock(open,"log");$("teamToggle").setAttribute("aria-expanded",String(open));};
    $("newTaskBtn").onclick=()=>{closeView();$("goal").focus();};
    $("cameraReset").onclick=()=>{resetView();selectRoom("all");};
    for(const [id,delta] of [["cameraIn",.2],["cameraOut",-.2]]) $(id).onclick=()=>{if(HAS3D){const zoom=Math.min(controls.maxZoom,Math.max(controls.minZoom,camera.zoom+delta));setView(cam.view,controls.target.clone(),true,zoom);}};
    const moves={left:[-1,0],right:[1,0],up:[0,1],down:[0,-1]};
    for(const b of document.querySelectorAll("[data-pan]"))b.onclick=()=>pan(...moves[b.dataset.pan]);
    $("stage").addEventListener("keydown",e=>{
      const key={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"up",ArrowDown:"down"}[e.key];
      if(key && !e.altKey && !e.ctrlKey && !e.metaKey){e.preventDefault();pan(...moves[key]);}
    });
    for (const button of document.querySelectorAll("[data-room]")) button.onclick=()=>focusRoom(button.dataset.room);
    if (typeof ResizeObserver === "function") new ResizeObserver(()=>{layout(); if(HAS3D)resize();}).observe($("officeFrame"));
    schedule();
  }
  function selectRoom(name) {
    selectedRoom=name;
    for(const b of document.querySelectorAll("[data-room]")) {
      b.setAttribute("aria-pressed",String(b.dataset.room===name));
      if(b.dataset.room===name)b.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"});
    }
  }
  function focusRoom(name, animate=true) {
    selectRoom(name);
    if(!HAS3D)return;
    if(name==="all")return resetView();
    let r=ROOMS[name];if(!r)return;
    if(name==='work'){
      const seats=D.names.map(A).filter(a=>!a.ghost&&a.seat.x>=r.x0&&a.seat.x<=r.x1).map(a=>a.seat);
      if(seats.length)r={x0:Math.min(...seats.map(p=>p.x))-1.8,x1:Math.max(...seats.map(p=>p.x))+1.8,z0:Math.min(...seats.map(p=>p.z))-2.1,z1:Math.max(...seats.map(p=>p.z))+1.1};
    }
    UI.focused=`room:${name}`;
    const points=[];
    for(const x of [r.x0-.3,r.x1+.3])for(const z of [r.z0-.3,r.z1+.3])for(const y of [0,3])points.push(new THREE.Vector3(x,y,z));
    frame(animate,1,points);
  }
  function pan(dx,dy) {
    if(!HAS3D)return;
    cam.tween=null;UI.focused="manual";
    const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    const delta=right.multiplyScalar(dx).addScaledVector(up,dy).multiplyScalar(cam.view/camera.zoom*.08);
    camera.position.add(delta);controls.target.add(delta);controls.update();
  }
  function restoreRoom() { if(selectedRoom!=="all")focusRoom(selectedRoom,false); }
  return {init,schedule,layout,selectRoom,restoreRoom};
})();
