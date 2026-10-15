"use strict";
/* 사무실 반려견: 에이전트/API와 독립적인 이동·휴식·말풍선 연출.
   실제 사무실 A* 경로를 이용하고 시간 초과 순간이동 없이 목적지에 도착한다. */
window.OfficeDogs = (() => {
  if (typeof HAS3D === "undefined" || !HAS3D || !window.OFFICE_DOG_META) return { list: [] };
  const T = THREE, list = [], direction = new T.Vector3();
  const defs = [
    { key: "corgi", name: "웰시코기", speed: 1.35, start: { x: 4.5, z: 12 }, lines: ["멍! 산책 같이 갈래요?", "짧은 다리로도 어디든 갈 수 있어요!", "잠깐 쓰다듬어 주세요 🐾", "다들 열심히 하네요. 멍멍!", "여기는 제가 순찰할게요!"] },
    { key: "beagle", name: "비글", speed: 1.65, start: { x: 6, z: 5 }, lines: ["킁킁… 맛있는 냄새가 나는데?", "멍멍! 새로운 길을 찾았어요!", "코기야, 같이 놀자!", "잠깐 쉬었다가 또 돌아다닐래요.", "오늘도 좋은 하루예요. 멍!"] },
  ];
  const points = () => [{ x: 4.5, z: 12 }, { x: 6, z: 5 }, { x: 4.5, z: -6 }, { x: -4.5, z: 4.5 }, { x: -11.5, z: 4.5 }, { x: -4.5, z: -6.5 }, { x: -13, z: 13.2 }, { x: 11, z: 14 }, { x: 1, z: -14 }, ...(window.Decor?.LIFE?.walk || [])].filter(p => walkable(p.x, p.z));
  const random = values => values[Math.floor(Math.random()*values.length)];
  function say(d, text) {
    d.bubble.textContent = text || random(d.def.lines);
    d.bubble.hidden = false; d.speech = 4.5;
  }
  function build(def, i) {
    const meta = OFFICE_DOG_META[def.key];
    if (!meta) return;
    const texture = new T.TextureLoader().load(meta.atlas);
    texture.encoding = T.sRGBEncoding;
    const geometry = new T.PlaneGeometry(1, 1); geometry.translate(0, .5, 0);
    const material = new T.MeshBasicMaterial({ map: texture, alphaTest: .1, side: T.DoubleSide, toneMapped: false });
    const mesh = new T.Mesh(geometry, material), group = new T.Group(); group.add(mesh);
    const start = points().find(p => Math.hypot(p.x-def.start.x, p.z-def.start.z)<.1) || points()[i] || points()[0];
    if (!start) { texture.dispose(); geometry.dispose(); material.dispose(); return; }
    group.position.set(start.x, 0, start.z);scene.add(group);
    const bubble = el("div", { class: "office-dog-bubble", hidden: true });
    const tag = el("button", { type: "button", class: "office-dog-tag", text: `🐾 ${def.name}`, "aria-label": `${def.name}에게 말 걸기` });
    const label = el("div", { class: "office-dog-label" }, bubble, tag); document.body.append(label);
    const d = { def, meta, group, mesh, texture, geometry, material, label, bubble, path: [], state: "stand", rest: 1+i*3, dist: 0, yaw: 0, view: "front", frame: "", speech: 0, nextSpeech: 12+i*14, blocked: 0 };
    tag.addEventListener("click", () => { say(d); if (!d.path.length) { d.state="sit";d.rest=3; } });
    list.push(d);setFrame(d, "stand.front", false);
  }
  function setFrame(d, name, mirror) {
    const key = `${name}:${mirror}`;if (key === d.frame) return;d.frame=key;
    const [x,y,w,h,anchor,ppu] = d.meta.frames[name];
    const [aw,ah] = d.meta.size, uv=d.geometry.attributes.uv;
    const left=(mirror?x+w:x)/aw, right=(mirror?x:x+w)/aw, top=1-y/ah, bottom=1-(y+h)/ah;
    uv.setXY(0,left,top);uv.setXY(1,right,top);uv.setXY(2,left,bottom);uv.setXY(3,right,bottom);uv.needsUpdate=true;
    d.mesh.scale.set(w/ppu,h/ppu,1);d.mesh.position.x=(mirror?-1:1)*(w/2-anchor)/ppu;
    d.height=h/ppu;
  }
  function wander(d) {
    const candidates=points().filter(p=>Math.hypot(p.x-d.group.position.x,p.z-d.group.position.z)>2);
    // 도달할 수 없는 후보는 건너뛴다. 벽을 가로지르는 직선 대체 경로는 만들지 않는다.
    for (let tries=0;tries<8 && candidates.length;tries++) {
      const p=candidates.splice(Math.floor(Math.random()*candidates.length),1)[0];
      const path=route(d.group.position,p);
      if(path?.length){d.path=path;d.state="walk";d.blocked=0;return;}
    }
    d.rest=3;
  }
  function update(d, dt) {
    const reduced=mqReduce.matches;
    if(reduced && d.path.length){d.path=[];d.state="stand";d.rest=2;}
    d.speech=Math.max(0,d.speech-dt);d.bubble.hidden=d.speech<=0;
    d.nextSpeech-=dt;
    if(d.nextSpeech<=0){say(d);d.nextSpeech=24+Math.random()*28;}
    let moving=false;
    if(!reduced && d.path.length){
      const pos=d.group.position,p=d.path[0],dx=p.x-pos.x,dz=p.z-pos.z,dist=Math.hypot(dx,dz);
      if(dist<.03)d.path.shift();
      else {
        const step=Math.min(dist,d.def.speed*dt), nx=pos.x+dx/dist*step,nz=pos.z+dz/dist*step;
        const people=[...D.names.map(n=>D.agents[n]),...(window.NPCs?.list||[]).map(n=>n.agent)].filter(Boolean);
        const occupied=people.some(a=>Math.hypot(a.group.position.x-nx,a.group.position.z-nz)<.55)||list.some(o=>o!==d&&Math.hypot(o.group.position.x-nx,o.group.position.z-nz)<.6);
        if(occupied){d.blocked+=dt;if(d.blocked>2){d.path=[];d.rest=1+Math.random()*2;}}
        else {pos.x=nx;pos.z=nz;d.yaw=Math.atan2(dx,dz);d.dist+=step;moving=true;d.blocked=0;}
      }
      if(!d.path.length){d.state=random(["stand","sit","sniff"]);d.rest=3+Math.random()*6;}
    }else if(!reduced){d.rest-=dt;if(d.rest<=0)wander(d);}
    camera.getWorldDirection(direction);
    const camYaw=Math.atan2(-direction.x,-direction.z),rel=Math.atan2(Math.sin(d.yaw-camYaw),Math.cos(d.yaw-camYaw)),a=Math.abs(rel);
    // 넉넉한 방향 임계값으로 카메라·회전 경계에서 앞/옆 이미지가 떨리지 않게 한다.
    const margin=.12;
    if(d.view==="front" && a<.6+margin){}else if(d.view==="back"&&a>2.55-margin){}else d.view=a<.6?"front":a>2.55?"back":"sideR";
    const mirror=d.view==="sideR"&&Math.sin(rel)<0;
    const name=moving?`walk.${d.view}.${Math.floor(d.dist/.22)%2}`:["sit","sniff"].includes(d.state)?d.state:`stand.${d.view}`;
    setFrame(d,name,mirror);
    d.group.rotation.y=camYaw;
    d.mesh.position.y=moving?Math.sin(d.dist/.22*Math.PI)**2*.008:0;
    const v=d.group.position.clone();v.y+=(d.height||d.meta.height)+.15;v.project(camera);
    d.label.hidden=v.z< -1||v.z>1||v.x< -1.1||v.x>1.1||v.y< -1.1||v.y>1.1||!document.getElementById("view").hidden;
    if(!d.label.hidden)d.label.style.transform=`translate(${Math.round((v.x*.5+.5)*innerWidth)}px,${Math.round((-v.y*.5+.5)*innerHeight)}px) translate(-50%,-100%)`;
  }
  for(let i=0;i<defs.length;i++)build(defs[i],i);
  const base=window.declutter;let last=performance.now();
  window.declutter=function(mobile){const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-last)/1000))*SPEED;last=now;if(!document.hidden)for(const d of list)update(d,dt);return base.call(this,mobile);};
  return { list, say: key => { const d=list.find(d=>d.def.key===key);if(d)say(d); } };
})();
