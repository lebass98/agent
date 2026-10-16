'use strict';
(() => {
  const api=window.ZooFriends;if(!api)return;const {kinds,build}=api;
  // 미리보기에서는 모델 API만 제공한다. 본 앱에서는 기존 렌더 루프에 연결한다.
  if (!window.SpaceTheme?.isZoo || typeof scene==='undefined' || typeof HAS3D==='undefined' || !HAS3D) return;
  const destinations=[...Decor.LIFE.walk,...Decor.LIFE.chat,Decor.LIFE.sofaApproach,Decor.LIFE.window];
  kinds.forEach((kind,i)=>{const rig=build(kind);rig.group.scale.setScalar(.85);const p=destinations[i];rig.group.position.set(p.x,0,p.z);scene.add(rig.group);api.list.push({rig,path:[],wait:i*.5,time:i*1.3,index:i});});
  let last=performance.now();const previous=window.declutter;
  window.declutter=function(...args) {
    const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;
    const paused=document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('reduce-motion');
    if(!paused && Decor.nav.grid) for(const f of api.list) {
      const p=f.rig.group.position;f.time+=dt;f.wait-=dt;
      if(!f.path.length&&f.wait<=0) {
        f.index=(f.index+1+Math.floor(Math.random()*3))%destinations.length;
        const end=destinations[f.index];
        if(Decor.walkable(end.x,end.z)) {
          const route=Decor.nav.route(p,end);let prev=p;
          if(route.every(q=>{const clear=Decor.nav.los(prev,q);prev=q;return clear;})) f.path=route;
        }
        f.wait=1+Math.random()*2;
      }
      const target=f.path[0];
      if(target) {const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*1.05);
        if(d>.001) {p.x+=dx/d*step;p.z+=dz/d*step;const angle=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(angle-f.rig.group.rotation.y),Math.cos(angle-f.rig.group.rotation.y));f.rig.group.rotation.y+=delta*Math.min(1,dt*9);}
        if(d<=step+.001) f.path.shift();
      }
      f.rig.animate(f.time,!!target);
    }
    return previous.apply(this,args);
  };
})();
