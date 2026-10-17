'use strict';
/* Canvas 2D renderer. Three.js supplies only camera/position math and the shared Agent contract.
   No WebGL context, photo sprites, external art or post-processing is used in this theme. */
window.PixelTheme = (() => {
  const T=window.THREE, office=window.Decor;
  const rigs=new Set(), spriteCache=new Map(), faceCache=new Map();
  let night=0,ambientTime=0;
  const palette={ink:'#263b43',edge:'#334a50',cream:'#f4e8cb',mint:'#a7c5ae',green:'#527e6d',wood:'#c68e64',woodLight:'#e3b781',rose:'#c98586',gold:'#eac779',blue:'#759fba'};
  const people={
    claude:{hair:'#664639',shirt:'#f3dfb8',pants:'#bc946c',long:true},
    gpt:{hair:'#30333e',shirt:'#465567',pants:'#303b4c',glasses:true},
    gemini:{hair:'#423c42',shirt:'#82b8c9',pants:'#3d4c58',bun:true},
  };
  const hash=s=>[...String(s)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  function styleOf(key){return people[key]||{hair:['#56413b','#303844','#795a43'][hash(key)%3],shirt:['#c98687','#8fae9c','#b7a0c3','#d2b872','#82a5bd'][hash(key)%5],pants:'#455764',long:hash(key)%3===0,bun:hash(key)%5===0,glasses:hash(key)%4===0};}
  function sprite(key,pose='stand',direction='front',frame=0){
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
    if(faceCache.has(key))return faceCache.get(key);
    const cv=document.createElement('canvas');cv.width=cv.height=24;const c=cv.getContext('2d');
    c.fillStyle=styleOf(key).shirt;c.fillRect(0,0,24,24);c.imageSmoothingEnabled=false;c.drawImage(sprite(key),0,0,24,16,0,1,24,24);
    const face={src:cv.toDataURL(),n:1,index:()=>0};faceCache.set(key,face);return face;
  }
  function buildCharacter(def,key){
    const group=new T.Group(),bone=()=>new T.Group();
    const rig={group,body:bone(),legs:[bone(),bone()],arms:[bone(),bone()],head:bone(),cup:bone(),height:3,pixel:{key,agent:null,seated:false},setFace(){},dispose(){rigs.delete(rig);}};
    rig.faceStrip=faces(key);rig.sprite={hold:()=>false,update(a,dt,seated){rig.pixel.agent=a;rig.pixel.seated=seated;rig.height=seated?2.45:3;}};
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
      this.shadowMap={};this.factor=2;this.width=1;this.height=1;this.hits=[];this.background='#162c35';
    }
    setPixelRatio(){} // Deliberately render on a fixed pixel grid, independent of display DPR.
    setClearColor(color){this.background=new T.Color(color).getStyle();}
    setSize(w,h){
      this.width=w;this.height=h;this.domElement.width=Math.ceil(w/this.factor);this.domElement.height=Math.ceil(h/this.factor);
      this.domElement.style.width=w+'px';this.domElement.style.height=h+'px';this.ctx.imageSmoothingEnabled=false;
    }
    clear(){this.ctx.fillStyle=this.background;this.ctx.fillRect(0,0,this.domElement.width,this.domElement.height);}
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
    plant(x,z,large=false){
      const p=this.point(x,0,z),s=Math.max(1,Math.round(this.unit*(large?.22:.16)));
      this.rect(p.x-2*s,p.y-s,4*s,3*s,'#b48670');this.rect(p.x-s,p.y+2*s,2*s,s,'#7d605b');
      this.rect(p.x-s,p.y-8*s,2*s,7*s,'#44674f');
      for(const [dx,dy,col]of [[-3,-6,'#658d68'],[1,-7,'#86ad78'],[-4,-3,'#93ba84'],[2,-4,'#557f64'],[-2,-9,'#b0cc8c']])this.rect(p.x+dx*s,p.y+dy*s,3*s,3*s,col);
    }
    chair(x,z){this.block(x,z,.8,.7,.55,'#6f9c98','#3d6166');this.block(x,z+.22,.8,.16,1.05,'#8bb9ac','#4a7371');}
    monitor(x,z,kind,phase){
      const p=this.point(x,1.65,z),w=Math.max(5,Math.round(this.unit*.86)),h=Math.max(4,Math.round(w*.66));
      this.rect(p.x-w/2,p.y-h/2,w,h,palette.ink);this.rect(p.x-w/2+1,p.y-h/2+1,w-2,h-2,'#305662');
      const lines=['#8dceb3','#e7c77c','#90b8d2'];
      for(let j=0;j<3;j++)this.rect(p.x-w/2+2,p.y-h/2+2+j*2,Math.max(1,w-5-j-(phase?j%2:0)),1,lines[j]);
      this.rect(p.x,p.y+h/2,1,2,'#b8c4bb');
    }
    desk(d,now){
      const {x,z,w}=d;
      this.block(x,z,w,1.3,.83,d.exec?'#bc956b':palette.woodLight,'#a4775a');
      for(const dx of [-w*.3,w*.3])this.block(x+dx,z+.15,.12,.8,.7,'#92a9a2','#597779');
      const rear=d.facing?z+.28:z-.28;
      this.monitor(x-.57,rear,'code',Math.floor(now/600)%2);this.monitor(x+.5,rear,'chart',0);
      this.block(x,z+(d.facing?-.3:.3),.7,.24,.05,'#d5d9c7','#96a5a4',.85);
      this.plant(x+w/2-.1,z-.38);
      const p=this.point(x+w/2-.35,1.06,z+.35);this.rect(p.x,p.y,2,3,'#f6ebca');
    }
    roomSign(key){
      const r=decor.rooms[key],p=this.point(r.x0+1.3,0,r.z0+1.2),c=this.ctx;
      c.font='bold 6px monospace';const labels={pantry:'COFFEE',work:'STUDIO',exec:'LEAD',meeting:'IDEAS',lounge:'LOUNGE',lobby:'WELCOME',balcony:'GARDEN'};
      const label=labels[key],w=c.measureText(label).width+8;
      this.rect(p.x-w/2,p.y-3,w,10,palette.ink);c.fillStyle='#e9d6ac';c.fillText(label,p.x-w/2+4,p.y+4);
    }
    drawCharacter(rig,now){
      const a=rig.pixel.agent;if(!a||a.hidden||!rig.group.visible)return;
      const pos=rig.group.position,p=this.point(pos.x,0,pos.z);
      const pose=a.presenting||a.mode==='write'?'present':a.lifePose==='seatedTea'?'seatedTea':a.lifePose==='tea'||a.mode==='coffee'?'tea':rig.pixel.seated?(a.mode==='type'?'type':'sit'):a.mode==='walk'?'walk':'stand';
      const rel=Math.atan2(Math.sin(a.targetRot-Math.PI/4),Math.cos(a.targetRot-Math.PI/4));
      const direction=Math.abs(rel)>2.2?'back':Math.abs(rel)>.7?'side':'front';
      const still=window.SpaceTheme?.reduce||document.hidden,frame=still?0:Math.floor(now/(pose==='type'?180:180))%2;
      const sheet=sprite(rig.pixel.key,pose,direction,frame),high=rig.pixel.seated?2.45:3;
      const top=this.point(pos.x,high,pos.z),h=Math.max(12,p.y-top.y),w=Math.round(h*24/36),c=this.ctx;
      this.floor(pos.x,pos.z,1.15,.65,'#263c4335');
      if(rig.pixel.seated&&!['lounge','seatedTea'].includes(a.lifePose))this.chair(pos.x,pos.z);
      c.save();if(rel<-.7&&direction==='side'){c.translate(p.x+w/2,p.y-h);c.scale(-1,1);c.drawImage(sheet,0,0,w,h);}else c.drawImage(sheet,p.x-w/2,p.y-h,w,h);c.restore();
      this.hits.push({a,x:p.x-w/2-2,y:p.y-h-2,w:w+4,h:h+4});
    }
    render(scene,camera){
      this.camera=camera;this.clear();this.hits=[];
      const origin=this.point(0,0,0),u=this.point(1,0,0);this.unit=Math.max(2,Math.hypot(u.x-origin.x,u.y-origin.y));
      const c=this.ctx;
      // Matte wood tile map and room rugs; crisp, limited-colour pixel geometry.
      this.block(0,0,40,40,.35,'#e6c796','#7c715f',-.35);
      for(let x=-20;x<20;x+=2)for(let z=-20;z<20;z+=2){
        const room=Object.entries(decor.rooms).find(([,r])=>x>=r.x0&&x<r.x1&&z>=r.z0&&z<r.z1)?.[0];
        const colors=room==='balcony'?['#b3c797','#aabd8e']:room==='work'?['#d9be93','#d1b58a']:room==='meeting'?['#aec7bf','#a2bdb4']:room==='exec'?['#baa0a6','#b39a9f']:room==='pantry'?['#dcd4b2','#c5ceb0']:room==='lounge'?['#a9c2b3','#a0b9aa']:['#d8c9a9','#d1c1a0'];
        this.floor(x+1,z+1,2,2,colors[(x+z)/2%2===0?0:1],'#7169561c');
      }
      const queue=[],add=(x,z,fn)=>queue.push({depth:x+z,fn});
      // Low cutaway partitions retain the exact navigation openings of the common map.
      const wall=(x,z,w,d)=>add(x,z,()=>this.block(x,z,w,d,1.15,'#f0dfbc','#778e87'));
      wall(0,-20,40,.35);wall(-20,0,.35,40);
      for(const r of Object.values(decor.rooms)){
        if(!r.door)continue;const door=r.door,vertical=door.axis==='z',start=vertical?r.z0:r.x0,end=vertical?r.z1:r.x1,at=vertical?door.z:door.x;
        for(const [a,b]of [[start,at-door.w/2],[at+door.w/2,end]])if(b>a)vertical?wall(door.x,(a+b)/2,.2,b-a):wall((a+b)/2,door.z,b-a,.2);
      }
      const now=window.SpaceTheme?.reduce?0:performance.now();
      for(const d of office.slots(12))add(d.x,d.z,()=>this.desk(d,now));
      for(const s of office.spots(12))add(s.seat.x,s.seat.z,()=>this.chair(s.seat.x,s.seat.z));
      add(decor.TABLE.x,decor.TABLE.z,()=>{this.block(decor.TABLE.x,decor.TABLE.z,5,2,.83,'#e4bd8d','#a47a62');for(const dx of [-1.4,0,1.4])this.monitor(decor.TABLE.x+dx,decor.TABLE.z,'chart',0);});
      for(const s of office.MEET_SEATS||[])add(s.x,s.z,()=>this.chair(s.x,s.z));
      add(9,-9,()=>{this.block(8.6,-9,.2,4,3.3,'#35515d','#263c46');const p=this.point(8.8,2.8,-9);this.rect(p.x-8,p.y-7,17,13,'#28454f');for(let i=0;i<4;i++)this.rect(p.x-6+i*4,p.y+3-(i*2),2,3+i*2,['#8dc8af','#7ca5bc','#d9bc76','#bd99b7'][i]);});
      add(-16,14,()=>{this.block(-16,14,4,1.2,1.2,'#e4c497','#8e7b65');this.block(-17.3,14,.9,.7,1.1,'#c2ccc0','#758d89',1.2);const p=this.point(-15,1.65,14);this.rect(p.x-3,p.y-4,6,7,'#334d54');this.rect(p.x-2,p.y-3,4,3,'#c2dfd1');});
      add(-12.6,15.4,()=>this.block(-12.6,15.4,2.3,1.5,.8,'#d4ac77','#927659'));
      for(const [x,z]of [[12,15.7],[15,15.7],[12,9.1]])add(x,z,()=>{this.block(x,z,2.6,1.2,.55,'#84a99b','#527b76');this.block(x,z-.45,2.6,.3,1.1,'#a7c5ae','#5f8a7b');});
      add(14,17.5,()=>this.block(14,17.5,2,1,.45,'#deb78c','#a17e65'));
      add(-4,17,()=>this.block(-4,17,3.6,1.2,1.05,'#9ab8a4','#608978'));
      // Rear windows, shelving, terrace plants and a few tiny city silhouettes.
      for(let x=-17;x<19;x+=4){add(x,-19,()=>{this.block(x,-19,2.9,.18,2.7,night>.5?'#6c88a1':'#a9d9da','#587b82');const p=this.point(x,2.1,-19);this.rect(p.x-1,p.y-4,2,10,'#e7d6b4');});}
      for(const [x,z]of [[-18,-12],[2,-12],[3,8],[-18,18],[17,18],[18,2],[17,-17],[-17,-17],[-11,-17],[18,-12]])add(x,z,()=>this.plant(x,z,true));
      add(18,5,()=>{this.block(18,5,1,3.8,2.5,'#c4a17c','#8e765f');for(let i=0;i<3;i++){const p=this.point(18,1+i*.5,5);for(let j=0;j<5;j++)this.rect(p.x-5+j*2,p.y-4,1,4,['#a2c2ac','#d9ba81','#b58d9f','#85adbb','#e2c69d'][j]);}});
      for(const rig of rigs){const a=rig.pixel.agent;if(a&&!a.hidden)add(rig.group.position.x,rig.group.position.z,()=>this.drawCharacter(rig,now));}
      queue.sort((a,b)=>a.depth-b.depth);for(const item of queue)item.fn();
      for(let i=0;i<3;i++){const t=window.SpaceTheme?.reduce?0:ambientTime,p=this.point(-8+i*3+Math.sin(t*.2+i)*.35,.1,-17.4+Math.cos(t*.2+i)*.3);this.rect(p.x-2,p.y-1,4,2,'#e7e1cb');this.rect(p.x+2,p.y-2,1,2,'#637e80');this.rect(p.x-1,p.y+1,2,1,'#907b66');}
      for(const key of Object.keys(decor.rooms))this.roomSign(key);
      // Evening uses a flat, restrained tint rather than bright reflections.
      if(night>.01){c.fillStyle=`rgba(27,42,68,${night*.22})`;c.fillRect(0,0,this.domElement.width,this.domElement.height);}
      // Quiet pixel stars in the surrounding void, kept away from room objects.
      const mark=this.point(-20,1,20);this.rect(mark.x-4,mark.y+8,8,1,'#9ec0aa');this.rect(mark.x-1,mark.y+5,2,7,'#9ec0aa');
    }
    pick(clientX,clientY){const r=this.domElement.getBoundingClientRect(),x=(clientX-r.left)/r.width*this.domElement.width,y=(clientY-r.top)/r.height*this.domElement.height;return [...this.hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)?.a||null;}
  }
  if(window.SpaceTheme?.isPixel)window.Decor=decor;
  return {Renderer,buildCharacter,faces,sprite,styleOf,decor,palette,stepAmbient(t){ambientTime=t;}};
})();
