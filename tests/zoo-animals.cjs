/* 동물원 동물 12종 + 원장·디자인팀장 rig 계약 검증. node tests/zoo-animals.cjs */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const THREE=require('../web/vendor/three.min.js');
const canvas=()=>({width:0,height:0,getContext:()=>({fillText(){}}),toDataURL:()=> 'data:image/png;base64,'});
const sandbox={window:{THREE},THREE,console,Math,Map,Set,document:{createElement:canvas}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/zoo-animals.js'),'utf8'),sandbox);
const Z=sandbox.window.ZooAnimals;
const ids=Z.species.map(s=>s.id);
assert.equal(ids.length,12);assert.equal(new Set(ids).size,12,'종류 ID 중복');
assert.equal(ids.slice(0,3).join(),'fox,panda,otter');
assert.equal(Z.extras.map(s=>s.id).join(),'elephant,peacock,duck');
for(const s of [...Z.species,...Z.extras]){assert(s.label&&s.emoji,`${s.id} 표시 정보`);assert.equal(typeof s.color,'number');}
const meshCount=g=>{let n=0;g.traverse(o=>{if(o.isMesh){n++;assert(o.geometry.attributes.position.count>0);}});return n;};
for(const {id} of [...Z.species,...Z.extras]){
  const rig=Z.build(id,`t-${id}`);
  assert.equal(rig.group.userData.kind,id);assert.equal(rig.group.name,`zoo-agent-t-${id}`);
  for(const key of ['body','head','cup'])assert(rig[key]?.isObject3D,`${id}.${key}`);
  assert.equal(rig.legs.length,2);assert.equal(rig.arms.length,2);
  assert(rig.legs.every(l=>l.parent===rig.group),`${id} 다리는 group 에`);
  assert(rig.arms.every(a=>a.parent===rig.body)&&rig.head.parent===rig.body,`${id} 팔·머리는 body 에`);
  assert(rig.cup.parent===rig.arms[1]&&!rig.cup.visible);
  assert(rig.props&&rig.preset&&typeof rig.seatOffset==='number');
  assert(rig.height>2.5&&rig.height<=3.6,`${id} height ${rig.height}`);
  assert(meshCount(rig.group)>15,`${id} 메쉬 수`);
  rig.group.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(rig.group);
  assert(b.min.z<-.3&&b.max.z>.4,`${id} 앞뒤 입체 ${b.min.z.toFixed(2)}~${b.max.z.toFixed(2)}`);
  assert(b.max.y>2.2&&b.max.y<=3.6,`${id} 키 ${b.max.y.toFixed(2)}`);assert(b.min.y>-.05&&b.min.y<.12,`${id} 발이 바닥에 ${b.min.y.toFixed(2)}`);
  assert(Math.abs(rig.height-b.max.y)<.75,`${id} 이름표 높이`);
  if(id==='elephant')assert(rig.height>=3.3);if(id==='giraffe')assert(b.max.y>3);
  // 표정: 눈 세로 비율 변화
  const ys=()=>{const v=[];rig.head.traverse(o=>{if(o.isMesh)v.push(o.scale.y);});return v.join();};
  rig.setFace('기본');const base=ys();rig.setFace('웃음');const smile=ys();rig.setFace('놀람');const wow=ys();
  assert(base!==smile&&base!==wow&&smile!==wow,`${id} 표정`);rig.setFace('기본');assert.equal(ys(),base);
  const f=rig.faceStrip;assert(f.src.startsWith('data:image')&&f.n===1&&f.index('웃음')===0);assert.equal(Z.faces(id),f);
  // 한 rig 를 버려도 다른 rig 의 재질은 따로다
  const other=Z.build(id,'other');let shared=false;const mats=new Set();
  rig.group.traverse(o=>o.material&&mats.add(o.material));other.group.traverse(o=>{if(mats.has(o.material))shared=true;});
  assert(!shared,`${id} 재질 공유`);rig.dispose();other.dispose();
}
const fallback=Z.build('unicorn','x');assert.equal(fallback.group.userData.kind,'fox');assert.equal(Z.faces('unicorn'),Z.faces('fox'));
assert.equal(Z.build('PANDA').group.userData.kind,'panda');
console.log(`동물원 동물 ${ids.length}종·NPC ${Z.extras.length}종 rig 계약·입체 범위·표정·재질 분리 검증 통과`);
