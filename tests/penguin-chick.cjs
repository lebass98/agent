const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),THREE=require('../web/vendor/three.min.js');
let parent;const ctx={window:{ThemeKit:{},ZooTheme:{LAKE:{x:0,z:0}}},THREE,console,Math,Map,A:()=>parent,Decor:{walkable:()=>true,nav:{route:(p,e)=>[e],los:()=>true}},document:{createElement:()=>({getContext:()=>({fillText(){}}),toDataURL:()=>''})}};
vm.createContext(ctx);for(const f of ['zoo-animals.js','life-zoo.js'])vm.runInContext(fs.readFileSync('web/'+f,'utf8'),ctx);
const cfg=ctx.window.ThemeKit.life.zoo;assert.equal(cfg.npcs.find(n=>n.key==='design').kind,'panda');
const scene=new THREE.Scene(),tick=cfg.ambient(scene,THREE),chick=scene.getObjectByName('gpt-penguin-chick');assert(chick);
const rig=ctx.window.ZooAnimals.build('penguin');parent={rig,group:rig.group};tick(0,.016);assert(chick.visible);const start=chick.position.clone();parent.group.position.x=5;
for(let i=0;i<180;i++)tick(i/60,1/60);assert(chick.position.distanceTo(start)>2);assert(chick.position.distanceTo(parent.group.position)<1.5);
parent=null;tick(4,.016);assert(!chick.visible);console.log('판다 디자인팀장·새끼 펭귄 생성/추적/팀원 제거 처리 통과');
