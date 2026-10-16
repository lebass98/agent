/* 실제 동물 rig 계약과 목적지 간 경로를 검증한다. 실제 team.toml은 변경하지 않는다. */
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const THREE=require('../web/vendor/three.min.js');
const canvas=()=>({width:0,height:0,getContext:()=>({fillText(){}}),toDataURL:()=> 'data:image/png;base64,'});
const sandbox={window:{THREE,SpaceTheme:{isZoo:true}},THREE,console,Uint8Array,Float32Array,Int32Array,Map,Set,Math,Date,Intl,document:{createElement:canvas}};
vm.createContext(sandbox);
for(const file of ['decor.js','zoo-theme.js'])vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../web',file),'utf8'),sandbox);
const zoo=sandbox.window.ZooTheme,decor=sandbox.window.Decor;
assert.equal(decor.OW,26);assert.equal(decor.spots(3).length,3);assert.equal(decor.spareDesks(3).length,0);
const scene=new THREE.Scene();const built=decor.build(scene);assert.equal(built.strokes.length,5);assert(built.strokes.every(x=>!x.visible));
for(const [name,kind] of [['claude','fox'],['gpt','panda'],['gemini','otter']]){
  const rig=zoo.buildAnimal({},name);assert.equal(rig.group.userData.kind,kind);assert(!rig.sprite);
  assert.equal(rig.legs.length,2);assert.equal(rig.arms.length,2);assert(rig.height>2.5);
  let meshes=0;rig.group.traverse(o=>{if(o.isMesh){meshes++;assert(o.geometry.attributes.position.count>0);}});assert(meshes>15);
  const bounds=new THREE.Box3().setFromObject(rig.group);assert(bounds.min.z<-.3);assert(bounds.max.z>.4);assert(bounds.max.y>2.3);
}
decor.nav.build(decor.navRects(3));
const spots=decor.spots(3),life=decor.LIFE;
const destinations=[...spots.flatMap(p=>[p.seat,p.meet,p.coffee]),decor.ENTRANCE,{x:decor.LOBBY_DOOR.x,z:decor.LOBBY_DOOR.z+1.4},decor.PRESENT_SPOT,decor.WHITEBOARD,decor.REPORT_SPOT,...life.walk,life.window,life.sofaApproach,life.sofa,...life.chat];
for(const p of destinations)assert(decor.walkable(p.x,p.z),`목적지가 막힘: ${JSON.stringify(p)}`);
let routes=0;
for(const a of destinations)for(const b of destinations){
  const path=decor.nav.route(a,b);assert(path.length>0);let prev=a;
  for(const p of path){assert(decor.nav.los(prev,p),`장애물 통과: ${JSON.stringify([prev,p])}`);assert(decor.walkable(p.x,p.z));prev=p;}
  assert(Math.hypot(prev.x-b.x,prev.z-b.z)<.001);routes++;
}
assert(!decor.walkable(5,-2.8),'연못은 통행 금지');assert(!decor.walkable(12,8),'섬 바깥은 통행 금지');
console.log(`동물 3종 실제 3D rig·작업/회의/휴식 목적지·${routes}개 이동 경로·연못 충돌 검증 통과`);
// 사무실 선택 시 Decor를 교체하지 않는다.
const officeSandbox={...sandbox,window:{THREE,SpaceTheme:{isZoo:false}}};vm.createContext(officeSandbox);
vm.runInContext(fs.readFileSync('web/decor.js','utf8'),officeSandbox);const original=officeSandbox.window.Decor;
vm.runInContext(fs.readFileSync('web/zoo-theme.js','utf8'),officeSandbox);assert.equal(officeSandbox.window.Decor,original);console.log('사무실 테마의 평면·장식 계약 유지');
