'use strict';
/* Canvas 2D renderer. Three.js supplies only camera/position math and the shared Agent contract.
   Generated pixel atlases are local; no WebGL context or post-processing is used. */
window.PixelTheme = (() => {
  const T=window.THREE, office=window.Decor;
  const rigs=new Set(), spriteCache=new Map(), faceCache=new Map();
  const assets=window.PIXEL_ASSETS_V2||{characters:{},furniture:{}},images=new Map();
  let night=0,ambientTime=0;
  function imageOf(src){
    if(!src||typeof Image==='undefined')return null;
    if(!images.has(src)){const im=new Image();im.src=src;images.set(src,im);}
    const im=images.get(src);return im.complete&&im.naturalWidth?im:null;
  }
  if(window.SpaceTheme?.isPixel)for(const a of [...Object.values(assets.characters),...Object.values(window.PIXEL_ASSETS_V3?.characters||{}),...Object.values(assets.furniture)])imageOf(a.src);
  const lookKey=name=>'agentOffice.pixel.appearance.'+name,lookOverrides=new Map();
  function lookOf(name){let saved=lookOverrides.get(name);try{saved||=localStorage.getItem(lookKey(name));}catch{}return assets.characters[saved]&&['claude','gpt','gemini'].includes(saved)?saved:name;}
  function setLook(name,id,names){
    if(!['claude','gpt','gemini'].includes(id)||names.some(n=>n!==name&&lookOf(n)===id))return false;
    lookOverrides.set(name,id);try{localStorage.setItem(lookKey(name),id);}catch{}return true;
  }
  function frameOf(key,pose,dir,step){
    const a=window.PIXEL_ASSETS_V3?.characters[key]||assets.characters[key];if(!a)return null;
    const action=pose==='type'||pose==='seatedTea'?'sit':pose;
    if(action==='walk'&&step===2)return {asset:a,frame:a.frames[`stand.${dir}`]||a.frames['stand.front']};
    let name=action==='walk'?`walk.${dir}.${step}`:action==='tea'?`tea.${dir==='side'?'side':'front'}`:action==='present'?'present.front':`${action}.${dir}`;
    return {asset:a,frame:a.frames[name]||a.frames['stand.front']};
  }
  // Snap the whole camera translation once, so fixed objects share one stable pixel phase.
  function snapCamera(camera,target,width,height){
    const origin=new T.Vector3().project(camera),w=Math.ceil(width/2),h=Math.ceil(height/2);
    const x=(origin.x*.5+.5)*w,y=(.5-origin.y*.5)*h;
    const stepX=(camera.right-camera.left)/(camera.zoom*w),stepY=(camera.top-camera.bottom)/(camera.zoom*h);
    const right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    const shift=right.multiplyScalar((x-Math.round(x))*stepX).add(up.multiplyScalar((Math.round(y)-y)*stepY));
    camera.position.add(shift);target.add(shift);camera.updateMatrixWorld();
  }
  const palette={ink:'#263b43',edge:'#334a50',cream:'#f4e8cb',mint:'#a7c5ae',green:'#527e6d',wood:'#c68e64',woodLight:'#e3b781',rose:'#c98586',gold:'#eac779',blue:'#759fba'};
  const people={
    claude:{hair:'#664639',shirt:'#f3dfb8',pants:'#bc946c',long:true},
    gpt:{hair:'#30333e',shirt:'#465567',pants:'#303b4c',glasses:true},
    gemini:{hair:'#423c42',shirt:'#82b8c9',pants:'#3d4c58',bun:true},
  };
  const hash=s=>[...String(s)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  function styleOf(key){return people[key]||{hair:['#56413b','#303844','#795a43'][hash(key)%3],shirt:['#c98687','#8fae9c','#b7a0c3','#d2b872','#82a5bd'][hash(key)%5],pants:'#455764',long:hash(key)%3===0,bun:hash(key)%5===0,glasses:hash(key)%4===0};}
  function sprite(key,pose='stand',direction='front',frame=0){
    if(pose==='walk'&&frame===2)pose='stand';
    const id=[key,pose,direction,frame].join(':');if(spriteCache.has(id))return spriteCache.get(id);
    const cv=document.createElement('canvas');cv.width=24;cv.height=36;
    const c=cv.getContext('2d'),p=styleOf(key),skin='#edbc92',back=direction==='back',side=direction==='side';
    const seated=['sit','type','seatedTea'].includes(pose),dy=0;
    const r=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(x,y+dy,w,h);};
    if(p.long){r(5,7,14,16,p.hair);r(4,10,2,12,p.hair);}
    r(7,4,10,11,palette.ink);r(6,6,12,7,palette.ink);r(7,5,10,9,skin);
    r(7,3,10,4,p.hair);r(5,5,3,6,p.hair);r(16,5,3,p.long?15:6,p.hair);
    r(8,2,8,2,p.hair);r(6,4,3,3,p.hair);r(9,4,4,2,p.hair);
    if(p.bun){r(13,0,5,4,palette.ink);r(14,0,3,3,p.hair);}
    if(back){r(7,6,10,8,p.hair);r(8,11,8,3,p.hair);}else{
      r(side?13:9,8,2,2,palette.ink);if(!side)r(14,8,2,2,palette.ink);
      r(12,12,2,1,'#ae7065');r(8,11,2,1,'#d99381');
      if(p.glasses){r(8,7,4,1,palette.ink);r(13,7,4,1,palette.ink);r(8,8,1,3,palette.ink);r(11,8,1,3,palette.ink);r(13,8,1,3,palette.ink);r(16,8,1,3,palette.ink);r(12,8,1,1,palette.ink);}
    }
    r(10,14,5,2,skin);r(7,16,11,11,palette.ink);r(8,16,9,9,p.shirt);r(8,16,2,8,'#ffffff26');r(16,17,1,8,'#00000020');
    if(!back){r(12,16,1,7,'#61768b');r(11,22,3,3,'#f5e9cf');r(12,23,1,1,'#7b9cad');}
    if(seated){r(7,26,10,4,p.pants);r(7,29,4,4,p.pants);r(14,29,4,4,p.pants);r(6,32,5,2,'#efebdb');r(14,32,5,2,'#efebdb');}
    else{
      const step=pose==='walk'?(frame?1:-1):0;
      r(8,26,4,7+step,p.pants);r(13,26,4,7-step,p.pants);r(7,33+step,5,2,'#efebdb');r(13,33-step,6,2,'#efebdb');
    }
    if(pose==='present'){
      r(5,17,3,8,p.shirt);r(5,24,3,3,skin);r(17,17,3,3,p.shirt);r(19,14,3,5,p.shirt);r(20,12,3,3,skin);r(21,11,2,2,palette.ink);
    }else if(pose==='tea'||pose==='seatedTea'){
      r(5,17,3,8,p.shirt);r(5,24,3,3,skin);r(17,18,3,5,p.shirt);r(15,21,5,2,skin);r(14,18,4,4,'#f3e8cf');r(15,19,2,1,'#9f7558');
    }else if(seated){
      r(5,17,3,6,p.shirt);r(17,17,3,6,p.shirt);r(5,23-(pose==='type'?frame:0),6,2,skin);r(15,23,6,2,skin);
    }else{
      r(5,17,3,8,p.shirt);r(17,17,3,8,p.shirt);r(5,25+(pose==='walk'?frame:0),3,2,skin);r(17,25-(pose==='walk'?frame:0),3,2,skin);
    }
    spriteCache.set(id,cv);return cv;
  }
  function faces(key){
    const art=window.PIXEL_ASSETS_V3?.characters[key]||assets.characters[key];
    if(art)return {src:art.portrait,n:1,index:()=>0};
    if(faceCache.has(key))return faceCache.get(key);
    const cv=document.createElement('canvas');cv.width=cv.height=24;const c=cv.getContext('2d');
    c.fillStyle=styleOf(key).shirt;c.fillRect(0,0,24,24);c.imageSmoothingEnabled=false;c.drawImage(sprite(key),0,0,24,16,0,1,24,24);
    const face={src:cv.toDataURL(),n:1,index:()=>0};faceCache.set(key,face);return face;
  }
  // Advance the gait by distance, not wall-clock time: blocked walkers keep both feet planted.
  function updateMotion(rig,a,dt,seated){
    const m=rig.pixel,p=rig.group.position;
    const distance=m.last?Math.hypot(p.x-m.last.x,p.z-m.last.z):0;
    m.moving=a.mode==='walk'&&distance>.0001&&distance<Math.max(2,dt*12);
    if(m.moving)m.travel=(m.travel||0)+distance;
    else m.travel=0;
    m.last={x:p.x,z:p.z};m.agent=a;m.seated=seated;
    rig.height=(seated?2.45:3)*(m.scale||1);
  }
  function motionFrame(rig,reduced){return reduced||!rig.pixel.moving?2:[0,2,1,2][Math.floor((rig.pixel.travel||0)/.32)%4];}
  function buildCharacter(def,key){
    const group=new T.Group(),bone=()=>new T.Group();
    const rig={group,body:bone(),legs:[bone(),bone()],arms:[bone(),bone()],head:bone(),cup:bone(),height:3,pixel:{key,agent:null,seated:false},setFace(){},dispose(){rigs.delete(rig);}};
    rig.faceStrip=faces(key);rig.sprite={hold:()=>false,update(a,dt,seated){updateMotion(rig,a,dt,seated);}};
    rigs.add(rig);return rig;
  }
  // Keep the office's tested routes, 12 desks, 12 meeting/coffee seats and 7 room roles.
  // Scene objects here are state only: drawing is performed by Renderer below.
  const decor={...office,
    rooms:Object.fromEntries(Object.entries(office.rooms).map(([id,r])=>[id,{...r,label:{lobby:'리셉션',pantry:'커피 바',work:'작업 스튜디오',exec:'팀장실',meeting:'아이디어 룸',lounge:'휴식 라운지',balcony:'루프 가든'}[id]}])),
    build(){return{strokes:Array.from({length:5},()=>{const s=new T.Mesh(new T.PlaneGeometry(1,.1),new T.MeshBasicMaterial({color:0x789a89}));s.visible=false;return s;})};},
    deskSet(parent,o){
      const group=new T.Group(),screen=new T.Mesh(new T.PlaneGeometry(1,1),o.mats[0]),mug=new T.Group();
      group.add(screen,mug);group.position.set(o.x,0,o.z);parent.add(group);return{screen,mug,dispose(){}};
    },
    theme(n){night=typeof n==='number'?Math.max(0,Math.min(1,n)):n?1:0;},
    tick(){},setCamera(){},chairNear(){return null;},
  };
  class Renderer {
    constructor(){
      this.domElement=document.createElement('canvas');this.domElement.className='pixel-canvas';
      this.domElement.dataset.renderer='canvas2d';this.ctx=this.domElement.getContext('2d',{alpha:false});
      if(!this.ctx)throw new Error('Canvas 2D를 사용할 수 없습니다.');
      this.shadowMap={};this.factor=2;this.width=1;this.height=1;this.hits=[];this.background='#eee8db';
    }
    setPixelRatio(){} // Deliberately render on a fixed pixel grid, independent of display DPR.
    setClearColor(color){this.background=new T.Color(color).getStyle();}
    setSize(w,h){
      this.width=w;this.height=h;this.domElement.width=Math.ceil(w/this.factor);this.domElement.height=Math.ceil(h/this.factor);
      this.domElement.style.width=this.domElement.width*this.factor+'px';this.domElement.style.height=this.domElement.height*this.factor+'px';this.ctx.imageSmoothingEnabled=false;
    }
    clear(){this.ctx.fillStyle=night>.5?'#243842':'#eee8db';this.ctx.fillRect(0,0,this.domElement.width,this.domElement.height);}
    point(x,y,z){const v=new T.Vector3(x,y,z).project(this.camera);return{x:Math.round((v.x*.5+.5)*this.domElement.width),y:Math.round((.5-v.y*.5)*this.domElement.height)};}
    poly(points,color,stroke){const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
    rect(x,y,w,h,color){this.ctx.fillStyle=color;this.ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
    floor(x,z,w,d,color,stroke){this.poly([[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]].map(p=>this.point(p[0],0,p[1])),color,stroke);}
    block(x,z,w,d,h,top,side=palette.edge,y=0){
      const p=(xx,yy,zz)=>this.point(xx,yy,zz),a=p(x-w/2,y+h,z-d/2),b=p(x+w/2,y+h,z-d/2),c=p(x+w/2,y+h,z+d/2),e=p(x-w/2,y+h,z+d/2);
      this.poly([b,p(x+w/2,y,z-d/2),p(x+w/2,y,z+d/2),c],side,palette.ink);
      this.poly([e,c,p(x+w/2,y,z+d/2),p(x-w/2,y,z+d/2)],side,palette.ink);
      this.poly([a,b,c,e],top,palette.ink);
      this.poly([a,b,{x:b.x,y:b.y+1},{x:a.x,y:a.y+1}],'#ffffff30');
    }
    asset(id,x,z,width,depth=1,flip=false){
      const meta=assets.furniture[id],im=imageOf(meta?.src);if(!im)return false;
      const p=this.point(x,0,z),left=this.point(x-width/2,0,z+depth/2),right=this.point(x+width/2,0,z-depth/2);
      const w=Math.max(3,Math.abs(right.x-left.x)),h=Math.round(w*meta.h/meta.w);
      const bottom=this.point(x+width/2,0,z+depth/2).y;
      const c=this.ctx;c.save();c.translate(Math.round(p.x),Math.round(bottom));if(flip)c.scale(-1,1);
      c.drawImage(im,Math.round(-w/2),-h,w,h);c.restore();return true;
    }
    plant(x,z,large=false){if(!this.asset('plant',x,z,large?1.2:.65,.6))this.block(x,z,.5,.5,1.3,palette.green);}
    chair(x,z){if(!this.asset('chair',x,z,.85,.75))this.block(x,z,.8,.7,.55,'#6f9c98');}
    desk(d){if(!this.asset(d.exec?'leaderDesk':'desk',d.x,d.z,d.w,1.3*(decor.mobileUnit||1),!!d.facing))this.block(d.x,d.z,d.w,1.3*(decor.mobileUnit||1),.83,palette.woodLight);}
    roomSign(key){
      const r=decor.rooms[key],p=this.point(r.x0+1.3,0,r.z0+1.2),c=this.ctx;
      c.font='bold 6px "Pretendard GOV Variable", sans-serif';const labels={pantry:'COFFEE',work:'STUDIO',exec:'LEAD',meeting:'IDEAS',lounge:'LOUNGE',lobby:'WELCOME',balcony:'GARDEN'};
      const label=labels[key],w=c.measureText(label).width+8;
      this.rect(p.x-w/2,p.y-3,w,10,palette.ink);c.fillStyle='#e9d6ac';c.fillText(label,p.x-w/2+4,p.y+4);
    }
    drawCharacter(rig,now){
      const a=rig.pixel.agent;if(!a||a.hidden||!rig.group.visible)return;
      const pos=rig.group.position,p=this.point(pos.x,0,pos.z);
      const pose=a.presenting||a.mode==='write'?'present':a.lifePose==='seatedTea'?'seatedTea':a.lifePose==='tea'||a.mode==='coffee'?'tea':rig.pixel.seated?(a.mode==='type'?'type':'sit'):a.mode==='walk'&&rig.pixel.moving?'walk':'stand';
      const forward=new T.Vector3();this.camera.getWorldDirection(forward);
      const bearing=Math.atan2(-forward.x,-forward.z);
      const rot=Number.isFinite(rig.group.rotation.y)?rig.group.rotation.y:a.targetRot;
      const rel=Math.atan2(Math.sin(rot-bearing),Math.cos(rot-bearing)),angle=Math.abs(rel);
      const old=rig.pixel.direction;
      const direction=old==='front'&&angle<.85?'front':old==='back'&&angle>2.15?'back':old==='side'&&angle>.55&&angle<2.45?'side':angle>2.3?'back':angle>.7?'side':'front';
      rig.pixel.direction=direction;
      const still=window.SpaceTheme?.reduce||document.hidden,frame=pose==='walk'?motionFrame(rig,still):still?0:Math.floor(now/220)%2;
      const generated=frameOf(rig.pixel.key,pose,direction,frame),im=imageOf(generated?.asset.src),f=generated?.frame;
      const top=this.point(pos.x,3,pos.z),unitHeight=Math.max(12,p.y-top.y);
      const h=Math.max(8,Math.round(unitHeight*(rig.pixel.scale||1)*(im?f.h/48:rig.pixel.seated?2.45/3:1)));
      const w=Math.max(5,Math.round(h*(im?f.w/f.h:24/36))),c=this.ctx;
      this.floor(pos.x,pos.z,1.15,.65,'#263c4320');
      if(rig.pixel.seated&&!['lounge','seatedTea'].includes(a.lifePose))this.chair(pos.x,pos.z);
      c.save();c.translate(Math.round(p.x),Math.round(p.y));if(rel<-.7&&direction==='side')c.scale(-1,1);
      if(im)c.drawImage(im,f.x,f.y,f.w,f.h,Math.round(-w/2),-h,w,h);
      else c.drawImage(sprite(rig.pixel.key,pose,direction,frame),Math.round(-w/2),-h,w,h);
      c.restore();
      rig.pixel.placeLabel?.(p,h);
      this.hits.push({a,x:p.x-w/2-2,y:p.y-h-2,w:w+4,h:h+4});
    }
    render(scene,camera){
      this.camera=camera;this.clear();this.hits=[];
      const origin=this.point(0,0,0),u=this.point(1,0,0);this.unit=Math.max(2,Math.hypot(u.x-origin.x,u.y-origin.y));
      const c=this.ctx,compact=this.width<=760;
      // Sparse matte floor: long planks and flat room rugs, no reflected highlights.
      this.block(0,0,decor.OW,decor.OD,.35,'#e8d9b9','#667779',-.35);
      for(let z=-20;!compact&&z<20;z+=2.5)this.floor(0,z+1.25,40,2.5,(z/2.5)%2===0?'#e5d4b2':'#e9dabc');
      for(const [key,color]of Object.entries(compact?{}:{balcony:'#acbf94',meeting:'#bdd0c1',exec:'#dbc9ba',pantry:'#e0d8bf',lounge:'#bdd0c1',lobby:'#e5dfcd'})){
        const r=decor.rooms[key];this.floor((r.x0+r.x1)/2,(r.z0+r.z1)/2,r.x1-r.x0,r.z1-r.z0,color);
      }
      for(const [x,z]of (compact?[]:[[-15,-2.5],[-8,-2.5],[-1,-2.5],[-15,-10.75],[-8,-10.75]]))this.floor(x,z,4.5,4,'#c5d0bb');
      const queue=[],add=(x,z,fn)=>queue.push({depth:this.point(x,0,z).y,fn});
      // Low cutaway partitions retain the exact navigation openings of the common map.
      const wall=(x,z,w,d)=>add(x,z,()=>this.block(x,z,w,d,1.15,'#faf1d9','#a0b0a4'));
      if(!compact){
      wall(0,-20,40,.35);wall(-20,0,.35,40);
      for(const r of Object.values(decor.rooms)){
        if(!r.door)continue;const door=r.door,vertical=door.axis==='z',start=vertical?r.z0:r.x0,end=vertical?r.z1:r.x1,at=vertical?door.z:door.x;
        for(const [a,b]of [[start,at-door.w/2],[at+door.w/2,end]])if(b>a)vertical?wall(door.x,(a+b)/2,.2,b-a):wall((a+b)/2,door.z,b-a,.2);
      }
      }
      const now=window.SpaceTheme?.reduce?0:performance.now();
      for(const d of decor.slots(12))add(d.x,d.z,()=>this.desk(d,now));
      for(const s of decor.spots(12))add(s.seat.x,s.seat.z,()=>this.chair(s.seat.x,s.seat.z));
      if(!compact){
      add(decor.TABLE.x,decor.TABLE.z,()=>this.asset('meetingTable',decor.TABLE.x,decor.TABLE.z,5,2));
      for(const s of office.MEET_SEATS||[])add(s.x,s.z,()=>this.chair(s.x,s.z));
      add(9,-9,()=>this.asset('display',9,-9,1.1,2.8));
      add(-16,14,()=>this.asset('coffeeCounter',-16,14,3.6,1.2));
      add(-12.6,15.4,()=>this.asset('coffeeTable',-12.6,15.4,2.3,1.5));
      for(const [x,z]of [[12,15.7],[15,15.7],[12,9.1]])add(x,z,()=>this.asset('sofa',x,z,2.6,1.2));
      add(14,17.5,()=>this.asset('coffeeTable',14,17.5,2,1));
      add(-4,17,()=>this.asset('reception',-4,17,3.6,1.2));
      add(17,10,()=>this.asset('lamp',17,10,.7,.6));
      // Rear windows, shelving, terrace plants and a few tiny city silhouettes.
      for(let x=-17;x<19;x+=4){add(x,-19,()=>{this.block(x,-19,2.9,.18,2.7,night>.5?'#6c88a1':'#a9d9da','#587b82');const p=this.point(x,2.1,-19);this.rect(p.x-1,p.y-4,2,10,'#e7d6b4');});}
      for(const [x,z]of [[-18,-12],[2,-12],[3,8],[-18,18],[17,18],[18,2],[17,-17],[-17,-17],[-11,-17],[18,-12]])add(x,z,()=>this.plant(x,z,true));
      add(18,5,()=>this.asset('bookcase',18,5,1,3));
      }
      for(const rig of rigs){const a=rig.pixel.agent;if(a&&!a.hidden)add(rig.group.position.x,rig.group.position.z,()=>this.drawCharacter(rig,now));}
      queue.sort((a,b)=>a.depth-b.depth);for(const item of queue)item.fn();
      for(let i=0;!compact&&i<3;i++){const t=window.SpaceTheme?.reduce?0:ambientTime,p=this.point(-8+i*3+Math.sin(t*.2+i)*.35,.1,-17.4+Math.cos(t*.2+i)*.3);this.rect(p.x-2,p.y-1,4,2,'#e7e1cb');this.rect(p.x+2,p.y-2,1,2,'#637e80');this.rect(p.x-1,p.y+1,2,1,'#907b66');}
      for(const key of compact?[]:Object.keys(decor.rooms))this.roomSign(key);
      // Evening uses a flat, restrained tint rather than bright reflections.
      if(night>.01){c.fillStyle=`rgba(27,42,68,${night*.22})`;c.fillRect(0,0,this.domElement.width,this.domElement.height);}
      // Quiet pixel stars in the surrounding void, kept away from room objects.
      const mark=this.point(-20,1,20);this.rect(mark.x-4,mark.y+8,8,1,'#9ec0aa');this.rect(mark.x-1,mark.y+5,2,7,'#9ec0aa');
    }
    pick(clientX,clientY){const r=this.domElement.getBoundingClientRect(),x=(clientX-r.left)/r.width*this.domElement.width,y=(clientY-r.top)/r.height*this.domElement.height;return [...this.hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)?.a||null;}
  }
  if(window.SpaceTheme?.isPixel)window.Decor=decor;
  return {Renderer,buildCharacter,updateMotion,motionFrame,faces,sprite,frameOf,snapCamera,lookOf,setLook,assets,styleOf,decor,palette,stepAmbient(t){ambientTime=t;}};
})();
