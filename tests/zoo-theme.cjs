/* 넓은 동물원: 장식 계약·12석·목적지 사이 이동 경로·통행 금지 구역·동물 선택을 검증한다. 실제 team.toml 은 바꾸지 않는다. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const THREE=require('../web/vendor/three.min.js');
const ctx2d=new Proxy({},{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>{t[k]=v;return true;}});
const canvas=()=>({width:0,height:0,getContext:()=>ctx2d,toDataURL:()=> 'data:image/png;base64,'});
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const sandbox={window:{THREE,SpaceTheme:{isZoo:true}},THREE,console,Uint8Array,Float32Array,Int32Array,Map,Set,Math,Date,Intl,JSON,localStorage,document:{createElement:canvas,hidden:false},matchMedia:()=>({matches:false})};
vm.createContext(sandbox);
const files=['decor.js',...(fs.existsSync(path.join(__dirname,'../web/zoo-animals.js'))?['zoo-animals.js']:[]),'zoo-theme.js'];
for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../web',file),'utf8'),sandbox);
const zoo=sandbox.window.ZooTheme,decor=sandbox.window.Decor;
assert.equal(decor.OW,48);assert.equal(decor.OD,38);
assert.equal(decor.spots(12).length,12,'작업석 12');assert.equal(decor.spots(3).length,3);assert.equal(decor.spareDesks(3).length,9,'빈 마을 책상');
assert.equal(new Set(decor.spots(12).map(p=>`${p.meet.x},${p.meet.z}`)).size,12,'회의실 의자 12');
const scene=new THREE.Scene();const built=decor.build(scene);assert(built.strokes.length>=5);assert(built.strokes.every(x=>!x.visible));
let instanced=0;scene.traverse(o=>{if(o.isInstancedMesh)instanced++;});assert(instanced>=10,'나무·대나무·울타리 등은 한 번에 그린다');
decor.theme(1);decor.theme(0);
for(const name of ['claude','gpt','gemini']){
  const rig=zoo.buildAnimal({},name);assert.equal(rig.legs.length,2);assert.equal(rig.arms.length,2);assert(rig.height>2.4);
  let meshes=0;rig.group.traverse(o=>{if(o.isMesh)meshes++;});assert(meshes>15);
}
// 동물 배정: 기본(여우·판다·수달) → 남은 동물, 같은 동물은 한 명만
const team=['claude','gpt','gemini','writer','coder'];
const a=zoo.assign(team);assert.equal(a.claude,'fox');assert.equal(a.gpt,'panda');assert.equal(a.gemini,'otter');
assert.equal(new Set(Object.values(a)).size,team.length,'동물 중복 없음');
// 길 찾기
decor.nav.build(decor.navRects(12));
const spots=decor.spots(12),life=decor.LIFE;
const destinations=[...spots.flatMap(p=>[p.seat,p.meet,p.coffee]),decor.ENTRANCE,{x:decor.LOBBY_DOOR.x,z:decor.LOBBY_DOOR.z+1.4},decor.PRESENT_SPOT,decor.WHITEBOARD,decor.REPORT_SPOT,...life.walk,life.window,life.sofaApproach,life.sofa,...life.chat];
for(const p of destinations)assert(decor.walkable(p.x,p.z),`목적지가 막힘: ${JSON.stringify(p)}`);
let routes=0;
for(const s of destinations)for(const e of destinations){
  const route=decor.nav.route(s,e);assert(route.length>0);let prev=s;
  for(const p of route){assert(decor.nav.los(prev,p),`장애물 통과: ${JSON.stringify([prev,p])}`);assert(decor.walkable(p.x,p.z));prev=p;}
  assert(Math.hypot(prev.x-e.x,prev.z-e.z)<.001);routes++;
}
assert(!decor.walkable(zoo.LAKE.x,zoo.LAKE.z),'호수는 통행 금지');assert(!decor.walkable(23,17),'섬 바깥은 통행 금지');assert(!decor.walkable(0,11.2),'분수는 통행 금지');
for(const r of Object.values(decor.rooms))assert(r.x1>r.x0&&r.z1>r.z0&&r.label);
console.log(`넓은 동물원 48×38·작업석 12·회의실 의자 12·${routes}개 이동 경로·호수·분수·울타리 통행 금지 검증 통과`);
// 사무실 선택 시 Decor를 교체하지 않는다.
const officeSandbox={...sandbox,window:{THREE,SpaceTheme:{isZoo:false}}};vm.createContext(officeSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/decor.js'),'utf8'),officeSandbox);const original=officeSandbox.window.Decor;
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/zoo-theme.js'),'utf8'),officeSandbox);assert.equal(officeSandbox.window.Decor,original);console.log('사무실 테마의 평면·장식 계약 유지');
