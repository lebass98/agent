const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),THREE=require('../web/vendor/three.min.js');
const ctx={window:{},THREE,console};vm.createContext(ctx);vm.runInContext(fs.readFileSync('web/zoo-friends.js','utf8'),ctx);
for(const kind of ctx.window.ZooFriends.kinds){const r=ctx.window.ZooFriends.build(kind);r.group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(r.group);assert(box.max.z-box.min.z>1);assert(box.min.y>=-.01);r.animate(0,true);const a=r.legs[0].rotation.x;r.animate(.17,true);assert.notEqual(r.legs[0].rotation.x,a);r.animate(.17,false);assert.equal(r.legs[0].rotation.x,0);r.dispose();}
// 실제 동물원 격자로 산책 목적지 사이의 모든 경로를 확인한다.
const c2d=new Proxy({},{get:()=>()=>{}});Object.assign(ctx,{document:{createElement:()=>({getContext:()=>c2d,toDataURL:()=>''})},localStorage:{getItem:()=>null},matchMedia:()=>({matches:false})});ctx.window.SpaceTheme={isZoo:true};
for(const f of ['decor.js','zoo-animals.js','zoo-theme.js'])vm.runInContext(fs.readFileSync('web/'+f,'utf8'),ctx);
const d=ctx.window.Decor;d.nav.build(d.navRects(12));const ps=[...d.LIFE.walk,...d.LIFE.chat,d.LIFE.sofaApproach,d.LIFE.window];
let valid=0;for(const a of ps){assert(d.walkable(a.x,a.z),JSON.stringify(a));for(const b of ps){const path=d.nav.route(a,b);assert(path.length);let prev=a;for(const p of path){if(!d.nav.los(prev,p))break;prev=p;}if(Math.hypot(prev.x-b.x,prev.z-b.z)<.01)valid++;}}
assert.equal(valid,49);console.log('친구 3종 입체·관절 및 안전 산책 경로 '+valid+'개 확인 (불통 경로는 실행에서 제외)');

vm.runInContext(fs.readFileSync('web/zoo-friends.js','utf8'),ctx);assert.equal(ctx.window.ZooAnimals.species.length,15);for(const k of ctx.window.ZooFriends.kinds){const r=ctx.window.ZooAnimals.build(k);assert.equal(r.group.userData.kind,k);assert(r.head&&r.cup&&r.setFace);}
// 손님 산책은 공통 조연 엔진(life.js)이 한다: 동물원 내용(life-zoo.js)에 친구 3종이 손님으로 등록되는지 확인
for(const f of ['theme-kit.js','life-zoo.js'])vm.runInContext(fs.readFileSync('web/'+f,'utf8'),ctx);
const zooLife=ctx.window.ThemeKit.life.zoo;assert.equal(JSON.stringify(zooLife.guests.map(g=>g.kind)),JSON.stringify([...ctx.window.ZooFriends.kinds]));assert(zooLife.guests.every(g=>g.alt.length===3));
console.log('동물원 손님 3종(공통 엔진 등록) 확인');
