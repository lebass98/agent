'use strict';
/* 모바일 전용 작은 개방형 스튜디오. 기능별 목적지는 유지하고 상하 두 줄의 개인 책상을 두고 가운데는 비워 둔다. */
(() => {
  if(!window.SpaceTheme?.isPixel||!matchMedia('(max-width:760px)').matches)return;
  const d=window.Decor;
  function shrink(value){
    if(Array.isArray(value))return value.map(shrink);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='number'&&/^(x|x0|x1|z|z0|z1)$/.test(k)?v*.55:shrink(v)]));
  }
  for(const key of ['rooms','NPC','LIFE','ENTRANCE','LOBBY_DOOR','TABLE','WHITEBOARD','BOARD_FACE','COUNTER','COFFEE','PANTRY_TABLE','REPORT_SPOT','PRESENT_SPOT','MEET_SEATS'])if(d[key])d[key]=shrink(d[key]);
  const desks=Array.from({length:12},(_,i)=>({x:(i%6-2.5)*3.15,z:i<6?-8.8:8.8,w:2.9,row:Math.floor(i/6),col:i%6,cols:1,facing:i<6?0:Math.PI,exec:i===0}));
  const humanViewScale=1.2**3,unit=1/humanViewScale;
  d.mobileCompact=true;d.OW=22;d.OD=20;d.humanViewScale=humanViewScale;d.mobileUnit=unit;
  d.TABLE={x:0,z:0,w:5.2,d:5.2,radius:2.6};
  d.MEET_SEATS=Array.from({length:12},(_,i)=>{const a=(i+.5)*Math.PI/6;return {x:Math.cos(a)*4.3,z:Math.sin(a)*4.3};});
  d.rooms.meeting={x0:-5.8,x1:5.8,z0:-5.8,z1:5.8,label:'팀 대화 공간',door:null,chip:{x:0,z:0}};
  d.rooms.work={x0:-10,x1:10,z0:-9.6,z1:9.6,label:'개인 작업석',door:null,chip:{x:0,z:-8.8}};
  d.PRESENT_SPOT={x:-5.7,z:0};d.WHITEBOARD={x:-5.7,z:-1};d.BOARD_FACE={x:0,z:0};
  d.ENTRANCE={x:-9.5,z:8};d.LOBBY_DOOR={x:-9.5,z:10,axis:'x',w:2.4};
  d.slots=n=>desks.slice(0,Math.max(0,Math.min(12,n|0)));
  d.spareDesks=n=>desks.slice(n);
  d.COFFEE=Array.from({length:12},(_,i)=>({x:i<6?-9.5:9.5,z:-5.5+(i%6)*2.2}));
  d.COUNTER={x:-10.5,z:0};
  d.spots=n=>d.slots(n).map((desk,i)=>({desk:{...desk},seat:{x:desk.x,z:desk.z+(desk.facing?-.95:.95)},meet:{...d.MEET_SEATS[i]},coffee:{...d.COFFEE[i]}}));
  const rect=(x0,x1,z0,z1)=>({x0,x1,z0,z1});
  d.navRects=()=>[
    rect(-21,-d.OW/2,-21,21),rect(d.OW/2,21,-21,21),rect(-21,21,-21,-d.OD/2),rect(-21,21,d.OD/2,21),
    ...desks.map(p=>rect(p.x-p.w/2,p.x+p.w/2,p.z-.65*unit,p.z+.65*unit))
  ];
  // 본부장·방문객도 새 책상과 겹치지 않는 통로에서 쉰다.
  d.LIFE={...d.LIFE,walk:[{x:-9.5,z:0},{x:9.5,z:0},{x:0,z:6}],window:{x:0,z:-6},windowFace:{x:0,z:-11},sofaApproach:{x:9.5,z:5},sofa:{x:9.5,z:5.5},sofaFace:{x:10.5,z:5.5},chat:[{x:-6,z:-1},{x:-6,z:1}]};
  d.REPORT_SPOT={x:9.5,z:0};d.NPC.meetingDoor={x:-5.7,z:-1};
  d.NPC.headSeat={x:9,z:3};d.NPC.headFace={x:6,z:3};
  d.NPC.wander=[{x:-9.5,z:-5.5},{x:0,z:-6},{x:9.5,z:-5.5},{x:-9.5,z:0},{x:9.5,z:0},{x:-9.5,z:5.5},{x:0,z:6},{x:9.5,z:5.5}];
  d.NPC.duckSpots=d.NPC.wander;d.NPC.back=[{x:9.5,z:5.5},{x:9.5,z:-5.5},{x:-9.5,z:5.5}];
  // 확대 버튼 세 번(1.2³)의 사람 크기를 유지하며 바닥과 가구 배치를 화면 안에 맞춘다.
  function compact(value){
    if(Array.isArray(value))return value.map(compact);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,typeof v==='number'&&/^(x|x0|x1|z|z0|z1|w|d|radius)$/.test(key)?v*unit:compact(v)]));
  }
  for(const desk of desks){desk.x*=unit;desk.z*=unit;desk.w*=unit;}
  for(const key of ['rooms','TABLE','MEET_SEATS','COFFEE','COUNTER','ENTRANCE','LOBBY_DOOR','PRESENT_SPOT','WHITEBOARD','BOARD_FACE','REPORT_SPOT','PANTRY_TABLE','NPC','LIFE'])d[key]=compact(d[key]);
  d.OW*=unit;d.OD*=unit;
})();
