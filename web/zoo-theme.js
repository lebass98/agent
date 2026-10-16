'use strict';
/* 선택한 동물원 공간: 사무실과 같은 Decor/Agent 계약을 사용한다. 모든 동물은 실제 입체 메쉬다. */
window.ZooTheme = (() => {
  const office = window.Decor;
  const trees = [[-8,-4,1.1],[-5,-6,1],[-1,-6,1.2],[3,-6,.9],[8,-5,1.05],[9,-2.5,1],[-8,3,.9],[-4,5,.85]];
  const desks = [{x:-4.8,z:-2.5,w:2.2}, {x:-5.8,z:1.5,w:2.2}, {x:5.8,z:1.5,w:2.2}];
  const meetings = [{x:-1.8,z:.9}, {x:1.8,z:.9}, {x:0,z:2.8}];
  const coffees = [{x:-1.5,z:5.6}, {x:0,z:4.5}, {x:1.5,z:5.6}];
  const R = (x,z,w,d,tag) => ({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2,tag});
  const icons = {claude:'🦊',gpt:'🐼',gemini:'🦦'};
  const kinds = {claude:'fox',gpt:'panda',gemini:'otter'};
  const portraits = new Map();
  function faces(name) {
    const key=String(name).toLowerCase();
    if (!portraits.has(key)) {
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d'); ctx.font='92px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';ctx.fillText(icons[key] || '🐾',64,70);
      portraits.set(key,{src:canvas.toDataURL(),n:1,index:()=>0});
    }
    return portraits.get(key);
  }
  // 메쉬·재질은 호출별로 소유한다. 팀 재배치 시 공용 재질을 함께 dispose하지 않는다.
  function kit() {
    const T=THREE, materials=new Map();
    function material(color) { if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.85}));return materials.get(color); }
    function mesh(p,g,c,x=0,y=0,z=0) { const m=new T.Mesh(g,material(c));m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;p.add(m);return m; }
    function box(p,c,x,y,z,w,h,d) {return mesh(p,new T.BoxGeometry(w,h,d),c,x,y,z);}
    function ball(p,c,x,y,z,sx,sy=sx,sz=sx) {const m=mesh(p,new T.SphereGeometry(1,20,14),c,x,y,z);m.scale.set(sx,sy,sz);return m;}
    function cylinder(p,c,x,y,z,r,h) {return mesh(p,new T.CylinderGeometry(r,r,h,20),c,x,y,z);}
    function beam(p,c,a,b,r) {const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);const m=cylinder(p,c,...start.clone().add(end).multiplyScalar(.5).toArray(),r,delta.length());m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;}
    return {T,mesh,box,ball,cylinder,beam};
  }
  function buildAnimal(def,name) {
    const {T,mesh,box,ball,cylinder}=kit();
    const kind=kinds[String(name).toLowerCase()] || 'fox';
    const orange=0xd98039,cream=0xf2dec0,dark=0x30332e,brown=0x8d6247;
    const color=kind==='fox'?orange:kind==='panda'?0xf2eee0:brown;
    const group=new T.Group(),body=new T.Group(),head=new T.Group();group.add(body);head.position.set(0,1.8,.04);body.add(head);
    ball(body,color,0,.92,0,.53,.68,.43);ball(body,kind==='panda'?color:cream,0,.94,.34,.36,.43,.13);
    ball(head,color,0,0,0,.61,.53,.49);
    const legs=[],arms=[],eyes=[];
    for(const side of [-1,1]) {
      const leg=new T.Group();leg.position.set(side*.28,.4,0);group.add(leg);legs.push(leg);
      ball(leg,kind==='panda'?dark:color,0,-.12,.13,.22,.2,.31);
      const arm=new T.Group();arm.position.set(side*.51,1.2,.02);body.add(arm);arms.push(arm);
      ball(arm,kind==='panda'?dark:color,side*.02,-.22,.06,.18,.35,.19);
      if(kind==='fox') {
        const ear=mesh(head,new T.ConeGeometry(.23,.6,4),orange,side*.4,.57,-.03);ear.rotation.z=-side*.2;
        const inner=mesh(head,new T.ConeGeometry(.12,.35,3),cream,side*.4,.58,.12);inner.rotation.z=-side*.2;
      } else ball(head,kind==='panda'?dark:brown,side*.43,.4,-.04,.22,.22,.14);
      if(kind==='panda')ball(head,dark,side*.24,.03,.404,.18,.21,.07);
      eyes.push(ball(head,0x171f1b,side*.23,.07,.465,.065));ball(head,0xffffff,side*.21,.1,.512,.018);
    }
    ball(head,cream,0,-.21,.43,.31,.2,.18);ball(head,0x292c26,0,-.12,.6,.09,.065,.07);
    if(kind!=='panda') {
      const tail=ball(body,color,kind==='fox'?.45:0,.65,-.48,.26,.32,kind==='fox'?.72:.65);tail.rotation.y=kind==='fox'?-.65:0;
      if(kind==='fox')ball(body,cream,.76,.65,-.95,.22,.25,.27);
    }
    box(body,kind==='fox'?0x68865b:kind==='panda'?0x3c8781:0xc6a05b,0,1.32,.36,.31,.16,.15);
    const cup=new T.Group();arms[1].add(cup);cup.position.set(0,-.4,.1);cylinder(cup,0xf4e7cc,0,0,0,.085,.16);cup.visible=false;
    group.name=`zoo-agent-${name}`;group.userData.kind=kind;
    // 기존 걷기·타이핑·발표 동작이 이 관절에 그대로 적용된다.
    return {group,body,head,legs,arms,cup,props:{},preset:{},height:2.95,seatOffset:.02,
      faceStrip:faces(name),setFace(expr){for(const eye of eyes)eye.scale.y=expr==='웃음'?.025:expr==='놀람'?.085:.065;},dispose(){}};
  }
  function build(scene) {
    const {T,box,ball,cylinder,beam}=kit();
    const ground=cylinder(scene,0x7b9d66,0,-.45,0,12,.8);ground.scale.z=.78;
    const slab=cylinder(scene,0xb89a74,0,-.89,0,11.95,.15);slab.scale.z=.78;
    cylinder(scene,0xd9bd8d,0,-.035,0,3.35,.08);
    // 바닥은 y=0. 동물의 발 원점과 맞춰 광장에서 발이 묻히지 않는다.
    for(const [x,z,a,length] of [[-4.7,0,Math.PI/2,7],[4.6,-1,1.8,7],[0,5.1,0,6]]) {
      const path=box(scene,0xd9bd8d,x,-.025,z,1.65,.06,length);path.rotation.y=a;
    }
    const pond=cylinder(scene,0x8fbaa7,5,.015,-2.8,3.2,.06);pond.scale.z=.75;
    const water=cylinder(scene,0x56aeb8,5,.06,-2.8,2.85,.04);water.scale.z=.73;water.material.roughness=.28;
    for(let i=0;i<15;i++){const a=i/15*Math.PI*2;ball(scene,0x939a8a,5+3*Math.cos(a),.22,-2.8+2.25*Math.sin(a),.48,.3,.38);}
    for(let i=0;i<5;i++){const a=i*1.4;cylinder(scene,0x538958,5+Math.cos(a)*1.8,.09,-2.8+Math.sin(a)*1.3,.24,.04);}
    for(const [x,z,s] of trees) {
      const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(s);scene.add(g);
      cylinder(g,0x866444,0,1.1,0,.16,2.2);ball(g,0x4b8051,0,2.6,0,1.05,1.3,1);ball(g,0x6a9859,.6,2.7,.1,.72);ball(g,0x5a8c50,-.55,2.5,.3,.8);
    }
    for(let i=0;i<10;i++) {
      const x=-6.7+(i%5)*.65,z=-3.8-Math.floor(i/5)*.8,h=2.5+(i%3)*.4;
      cylinder(scene,0x5a8c48,x,h/2,z,.07,h);
      for(let j=1;j<4;j++)cylinder(scene,0x91b967,x,j*.65,z,.085,.05);
      ball(scene,0x709b48,x+.15,h-.3,z,.3,.12,.12);
    }
    for(let i=0;i<24;i++) {
      const a=i/24*Math.PI*2,b=(i+1)/24*Math.PI*2;if(a>1.15&&a<1.95)continue;
      const x=10.8*Math.cos(a),z=8*Math.sin(a);cylinder(scene,0x9c7851,x,.48,z,.095,.95);
      for(const y of [.35,.7])beam(scene,0xc7aa7d,[x,y,z],[10.8*Math.cos(b),y,8*Math.sin(b)],.04);
    }
    for(const x of [-1.15,1.15])cylinder(scene,0x886342,x,1.2,-2.2,.08,2.4);
    box(scene,0x946f48,0,2,-2.2,2.8,1.65,.16);box(scene,0xeee6cb,0,2,-2.1,2.55,1.4,.04);
    const strokes=Array.from({length:5},(_,i)=>{const m=box(scene,0x567963,-.1,2.5-i*.24,-2.06,1.4-i*.13,.05,.025);m.material=m.material.clone();m.visible=false;return m;});
    cylinder(scene,0x916d47,0,.4,1,1,.8);cylinder(scene,0xd4b07c,0,.83,1,1.12,.12);
    for(const p of meetings)cylinder(scene,0xba9364,p.x,.18,p.z,.32,.36);
    // 휴식 벤치와 차를 마시는 작은 원목 테이블.
    box(scene,0xba9364,-3, .4,4.6,1.8,.15,.65);
    for(const x of [-3.6,-2.4])box(scene,0x916d47,x,.18,4.6,.13,.35,.5);
    cylinder(scene,0xd4b07c,0,.8,5.6,.65,.12);cylinder(scene,0x916d47,0,.38,5.6,.12,.76);
    for(let i=0;i<35;i++) {
      const a=i*2.399,r=4+(i%6)*.85,x=Math.cos(a)*r,z=Math.sin(a)*r*.75;
      if(Math.abs(z)<1||x>2&&z<0)continue;
      ball(scene,0x689455,x,.18,z,.32,.2,.3);if(i%3===0)ball(scene,0xe7ca85,x,.4,z,.09);
    }
    // 마지막 프레임에서도 정상 색과 움직임 줄이기를 유지한다.
    ground.onBeforeRender=()=>{if(!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&!window.SpaceTheme.reduce)water.position.y=.06+Math.sin(performance.now()/1500)*.006;};
    return {strokes};
  }
  function deskSet(parent,opts) {
    const {T,box,cylinder}=kit(),{x,z,w,mats}=opts;
    for(const dx of [-w/2+.15,w/2-.15])box(parent,0x95744b,x+dx,.4,z,.13,.8,.65);
    box(parent,0xc5a16c,x,.84,z,w,.14,.85);
    const screens=mats.map((material,i)=>{
      const group=new T.Group();group.position.set(x+(i? .47:-.47),.92,z-.23);parent.add(group);
      box(group,0x344e45,0,.32,0,.85,.54,.06);
      const screen=new T.Mesh(new T.PlaneGeometry(.76,.45),material);screen.position.set(0,.32,.035);group.add(screen);return screen;
    });
    box(parent,0xe7dcc7,x,.94,z+.2,.7,.035,.19);
    const mug=cylinder(parent,0xf4e7cc,x+w/2-.2,1,z+.18,.075,.16);
    cylinder(parent,0xba9364,x,.18,z+1.15,.34,.36);
    return {screen:screens[0],mug};
  }
  function spots(n) {return desks.slice(0,n).map((d,i)=>({desk:{...d,facing:0},seat:{x:d.x,z:d.z+1.15},meet:{...meetings[i]},coffee:{...coffees[i]}}));}
  function navRects(n) {
    return [R(5,-2.8,6.8,5.2,'pond'),R(0,1,2.25,1.7,'table'),R(0,-2.2,2.9,.3,'board'),R(0,5.6,1.3,.8,'tea'),
      R(-5.4,-4.2,3.4,1.6,'bamboo'),...trees.map(([x,z])=>R(x,z,.55,.55,'tree')),...desks.slice(0,n).map(d=>R(d.x,d.z,d.w,.85,'desk'))];
  }
  function activate() {
    if(!office)return;
    const nav=Object.assign({},office.nav,{x0:-13,z0:-11,grid:null,rects:[]});
    nav.build=function(rects){
      const c=this.cell,r=this.r;this.rects=rects.map(q=>({...q,ix0:q.x0-r,ix1:q.x1+r,iz0:q.z0-r,iz1:q.z1+r}));
      this.nx=Math.round(26/c);this.nz=Math.round(22/c);this.grid=new Uint8Array(this.nx*this.nz);
      for(let j=0;j<this.nz;j++)for(let i=0;i<this.nx;i++) {
        const {x,z}=this.center(i,j);
        const inside=(x/10.6)**2+(z/7.8)**2<1;
        this.grid[j*this.nx+i]=inside&&!this.rects.some(q=>x>=q.ix0&&x<=q.ix1&&z>=q.iz0&&z<=q.iz1)?1:0;
      }
      return this;
    };
    const rooms={
      lobby:{x0:-2,x1:2,z0:6,z1:8,label:'동물원 입구'},
      work:{x0:-8,x1:8,z0:-4,z1:4,label:'서식지 작업실'},
      meeting:{x0:-3.5,x1:3.5,z0:-2.5,z1:3.5,label:'협업 광장'},
      exec:{x0:-7,x1:-3,z0:-3.5,z1:0,label:'여우 작업실'},
      pantry:{x0:-3,x1:3,z0:4.5,z1:6.5,label:'차 한 잔'},
      lounge:{x0:-5,x1:-1,z0:3.5,z1:6,label:'쉼터'},
      balcony:{x0:2,x1:8,z0:-5,z1:0,label:'수달 연못'}
    };
    for(const room of Object.values(rooms))room.door=null;
    window.Decor={OW:26,OD:22,PART_H:0,rooms,nav,sun:office.sun,spots,navRects,build,deskSet,spareDesks:()=>[],walkable:(x,z)=>nav.walkable(x,z),
      TABLE:{x:0,z:1},PRESENT_SPOT:{x:-1.8,z:-.8},WHITEBOARD:{x:0,z:-.5},BOARD_FACE:{x:0,z:-2.2},COUNTER:{x:0,z:5.6},PANTRY_TABLE:{x:0,z:5.6},COFFEE:coffees,
      ENTRANCE:{x:0,z:6.7},LOBBY_DOOR:{axis:'x',x:0,z:6.2},REPORT_SPOT:{x:-3.1,z:-1.1},
      LIFE:{walk:[{x:-2.6,z:2.8},{x:-1.6,z:4},{x:2.8,z:3.5}],window:{x:.2,z:-4.4},windowFace:{x:5,z:-3},sofaApproach:{x:-3,z:5.5},sofa:{x:-3,z:4.9},sofaFace:{x:-3,z:6.5},chat:[{x:-1.5,z:5.6},{x:1.5,z:5.6}]},
      theme(){},themed:{}};
  }
  if(window.SpaceTheme?.isZoo)activate();
  return {buildAnimal,faces,icons,spots,navRects};
})();
