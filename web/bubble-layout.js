'use strict';
/* 장면 라벨 정리 뒤 실제 화면의 UI 영역을 피해 말풍선을 사무실 안으로 넣는다. */
window.BubbleLayout=(()=>{
  const labels=document.getElementById('labels'),frame=document.getElementById('officeFrame');
  const stable=new WeakMap(),texts=new WeakMap();
  const shown=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return !e.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
  function bounds(){
    const r=frame.getBoundingClientRect();
    const b={left:Math.max(0,r.left)+10,right:Math.min(innerWidth,r.right)-10,top:Math.max(0,r.top)+10,bottom:Math.min(innerHeight,r.bottom)-10};
    for(const e of frame.querySelectorAll('.room-switch,.team-toggle,.camera-toggle,.office-tools,.office-live')){
      if(!shown(e))continue;const q=e.getBoundingClientRect();
      if(q.top<r.top+r.height/2)b.top=Math.max(b.top,q.bottom+10);
      else b.bottom=Math.min(b.bottom,q.top-10);
    }
    return b;
  }
  const overlaps=(a,b)=>a.left<b.right+5&&a.right>b.left-5&&a.top<b.bottom+5&&a.bottom>b.top-5;
  function place(preferred,b,obstacles){
    const w=preferred.width,h=preferred.height;
    const clamp=(n,a,z)=>Math.max(a,Math.min(z,n));
    const xs=[preferred.left,b.left,b.right-w],ys=[preferred.top,b.top,b.bottom-h];
    for(const o of obstacles){xs.push(o.left-w-6,o.right+6);ys.push(o.top-h-6,o.bottom+6);}
    let best=null,cost=Infinity;
    for(const x of xs)for(const y of ys){
      const left=clamp(x,b.left,b.right-w),top=clamp(y,b.top,b.bottom-h),r={left,top,right:left+w,bottom:top+h};
      if(obstacles.some(o=>overlaps(r,o)))continue;
      const distance=(left-preferred.left)**2+(top-preferred.top)**2;
      if(distance<cost){best=r;cost=distance;}
    }
    return best;
  }
  function update(){
    if(!labels||!frame)return;
    // 정지 중의 1px 투영·치수 반올림 차이는 이전 위치를 유지한다.
    for(const wrap of labels.querySelectorAll('.tagwrap')){
      const tag=wrap.querySelector('.nametag');if(!tag||!shown(wrap))continue;
      const r=tag.getBoundingClientRect(),old=stable.get(wrap);
      const x=old&&Math.abs(r.left-old.x)<1.5?old.x:Math.round(r.left);
      const y=old&&Math.abs(r.top-old.y)<1.5?old.y:Math.round(r.top);
      wrap.style.translate=`${x-r.left}px ${y-r.top}px`;stable.set(wrap,{x,y});
    }
    const b=bounds(),width=Math.max(1,b.right-b.left),height=Math.max(1,b.bottom-b.top);
    const obstacles=[...labels.querySelectorAll('.nametag')].filter(shown).map(e=>e.getBoundingClientRect());
    const bubbles=[...labels.querySelectorAll('.bubble.show')].sort((a,c)=>(parseInt(c.parentElement.style.zIndex)||0)-(parseInt(a.parentElement.style.zIndex)||0));
    for(const bubble of bubbles){
      const text=bubble.textContent.trim();
      if(texts.get(bubble)!==text){bubble.scrollTop=0;texts.set(bubble,text);}
      bubble.classList.remove('scrollable');
      const long=text.length>55;
      bubble.style.maxWidth=Math.min(long?(innerWidth<=760?280:360):(innerWidth<=760?150:210),width)+'px';
      bubble.style.maxHeight=height+'px';
      const offset=(bubble.style.translate||'').split(/\s+/).map(parseFloat);
      let r=bubble.getBoundingClientRect(),target=place(r,b,obstacles);
      if(!target){
        // 긴 대사는 고정 높이로 자르지 않고 이름표 사이의 실제 빈 공간을 사용한다.
        const edges=[b.top,b.bottom,...obstacles.flatMap(o=>[Math.max(b.top,o.top-6),Math.min(b.bottom,o.bottom+6)])].sort((a,c)=>a-c);
        const gaps=[...new Set(edges.flatMap((v,i)=>edges.slice(i+1).map(end=>end-v)))].filter(h=>h>=48&&h<r.height).sort((a,c)=>c-a);
        for(const gap of gaps){bubble.style.maxHeight=gap+'px';r=bubble.getBoundingClientRect();target=place(r,b,obstacles);if(target)break;}
      }
      bubble.classList.toggle('scrollable',bubble.scrollHeight>bubble.clientHeight+1);
      bubble.tabIndex=bubble.scrollHeight>bubble.clientHeight+1?0:-1;
      bubble.classList.toggle('covered',!target);
      if(!target)continue;
      const dx=target.left-r.left,dy=target.top-r.top;
      bubble.style.translate=`${(offset[0]||0)+dx}px ${(offset[1]||0)+dy}px`;
      bubble.style.setProperty('--bubble-tail-x',Math.max(10,Math.min(r.width-10,r.width/2-dx))+'px');
      obstacles.push(target);
    }
  }
  const originalDeclutter=declutter;
  declutter=function(...args){
    for(const e of labels.querySelectorAll('.tagwrap'))e.style.translate='';
    return originalDeclutter.apply(this,args);
  };
  if(renderer){const render=renderer.render;renderer.render=function(...args){const result=render.apply(this,args);update();return result;};}
  return {update,bounds,place};
})();
