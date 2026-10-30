'use strict';
/* 모바일 전용 작은 개방형 스튜디오. 기능별 목적지는 유지하고 물리적 가구는 개인 책상뿐이다. */
(() => {
  if(!window.SpaceTheme?.isPixel||!matchMedia('(max-width:760px)').matches)return;
  const d=window.Decor;
  function shrink(value){
    if(Array.isArray(value))return value.map(shrink);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='number'&&/^(x|x0|x1|z|z0|z1)$/.test(k)?v*.55:shrink(v)]));
  }
  for(const key of ['rooms','NPC','LIFE','ENTRANCE','LOBBY_DOOR','TABLE','WHITEBOARD','BOARD_FACE','COUNTER','COFFEE','PANTRY_TABLE','REPORT_SPOT','PRESENT_SPOT','MEET_SEATS'])if(d[key])d[key]=shrink(d[key]);
  const desks=Array.from({length:12},(_,i)=>({x:(i%3-1)*6,z:Math.floor(i/3)*5-8,w:3.4,row:Math.floor(i/3),col:i%3,cols:1,facing:0,exec:i===0}));
  d.mobileCompact=true;d.OW=22;d.OD=24;
  d.slots=n=>desks.slice(0,Math.max(0,Math.min(12,n|0)));
  d.spots=n=>d.slots(n).map((desk,i)=>({desk:{...desk},seat:{x:desk.x,z:desk.z+1.25},meet:{...d.MEET_SEATS[i]},coffee:{...d.COFFEE[i]}}));
  d.spareDesks=n=>desks.slice(n);
  const rect=(x0,x1,z0,z1)=>({x0,x1,z0,z1});
  d.navRects=()=>[
    rect(-21,-11,-21,21),rect(11,21,-21,21),rect(-21,21,-21,-12),rect(-21,21,12,21),
    ...desks.map(p=>rect(p.x-p.w/2,p.x+p.w/2,p.z-.65,p.z+.65))
  ];
  // 본부장·방문객도 새 책상과 겹치지 않는 통로에서 쉰다.
  d.NPC.headSeat={x:9,z:3};d.NPC.headFace={x:6,z:3};
  d.NPC.wander=[{x:-9,z:-10},{x:0,z:-10},{x:9,z:-10},{x:-9,z:0},{x:9,z:0},{x:-9,z:10},{x:0,z:10},{x:9,z:10}];
  d.NPC.duckSpots=d.NPC.wander;d.NPC.back=[{x:9,z:10},{x:9,z:-10},{x:-9,z:10}];
})();
