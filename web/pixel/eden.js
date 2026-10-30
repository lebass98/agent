'use strict';
/* 이든의 사람 픽셀 외형과 길 찾기. 대화 순서·반응은 동물원 대화 엔진을 공유한다. */
window.PixelEden = {
  create(scene,T,talk){
    if(!window.PixelTheme||!window.PixelEdenDialogue)return ()=>{};
    const rig=PixelTheme.buildCharacter({},'eden');scene.add(rig.group);rig.pixel.scale=.7;
    const a={name:'eden',npc:'eden',mode:'stand',targetRot:0,group:rig.group,hidden:true};
    rig.sprite.update(a,0,false);
    const tag=document.createElement('div');tag.className='tagwrap chick-tag';tag.hidden=true;
    tag.innerHTML='<div class="bubble"></div><span class="nametag"><i class="dot"></i><b>이든</b></span>';
    tag.style.setProperty('--c','#7fb3d5');document.getElementById('labels').append(tag);
    const label={tag:tag.querySelector('.nametag'),bubble:tag.querySelector('.bubble'),role:null,ly:0,az:0,ax:0,ay:0,lastSay:0,
      get x(){return rig.group.position.x;},get z(){return rig.group.position.z;},
      shown:()=>!tag.hidden,talking:()=>!tag.hidden&&label.bubble.classList.contains('show'),
      moveLabel(){tag.style.transform=`translate3d(${Math.round(this.ax-tag.offsetWidth/2)}px,${Math.round(this.ay-this.ly-tag.offsetHeight)}px,0)`;}
    };
    a.tag=label.tag;talk.addLabel(label);
    const parent=()=>{const m=A('gpt');return m&&!m.ghost&&!m.hidden?m:null;};
    const dialogue=PixelEdenDialogue(rig,tag,talk,label,parent);
    tag.querySelector('.nametag').addEventListener('click',()=>dialogue.say('안녕하세요! 나 이든이야! 같이 기차놀이 할래요? 🚂'));
    let ready=false,path=[],replan=0,lastEnd=null;
    const placeLabel=()=>{
      const p=rig.group.position.clone();p.y+=rig.height;p.project(camera);
      label.ax=Math.round((p.x*.5+.5)*innerWidth/2)*2;
      label.ay=Math.round((.5-p.y*.5)*innerHeight/2)*2;
      label.az=p.z;label.ly=0;tag.hidden=a.hidden;label.moveLabel();
    };
    const tick=(t,raw)=>{
      const mom=parent();a.hidden=!mom;rig.group.visible=!!mom;tag.hidden=!mom;
      if(!mom){ready=false;path=[];return;}
      const p=rig.group.position,target=mom.group.position;
      const seated=['sit','type'].includes(mom.mode)&&mom.atDesk?.();
      const options=seated?[{x:mom.seat.x+.95,z:mom.seat.z+.05},{x:mom.seat.x-.95,z:mom.seat.z+.05}]:[0,1,-1,2,-2].map(i=>({x:target.x+Math.cos(mom.group.rotation.y+i)*2.2,z:target.z-Math.sin(mom.group.rotation.y+i)*2.2}));
      const end=options.find(q=>Decor.walkable(q.x,q.z));if(!end)return;
      if(!ready){p.set(end.x,0,end.z);ready=true;}
      const dt=Math.min(.05,raw)*SPEED;
      replan-=dt;
      if(replan<=0&&(!lastEnd||Math.hypot(end.x-lastEnd.x,end.z-lastEnd.z)>.4||!path.length)){
        replan=.5;lastEnd=end;let prev=p;
        const route=Decor.nav.route(p,end);
        path=route.every(q=>{const ok=Decor.nav.los(prev,q);prev=q;return ok;})?route:[];
      }
      const q=path[0];a.mode='stand';
      if(q){const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz),step=Math.min(d,dt*2.8);
        if(d>.04){p.x+=dx/d*step;p.z+=dz/d*step;a.targetRot=Math.atan2(dx,dz);a.mode='walk';}
        if(d<=step+.04)path.shift();
      }
      const sitting=seated&&Math.hypot(p.x-end.x,p.z-end.z)<.18;
      if(sitting){a.mode='sit';a.targetRot=mom.targetRot;}
      rig.group.rotation.y=a.targetRot;rig.sprite.update(a,dt,sitting);placeLabel();
    };
    return tick;
  }
};
