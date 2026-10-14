// 오프라인 입체 에셋 생성: node scripts/assets/build.cjs
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '../..');
const THREE = require(path.join(root, 'web/vendor/three.min.js'));
// 텍스처는 OBJ에 포함하지 않는다. 브라우저 런타임에서 원래 캔버스 얼굴을 사용한다.
const ctx = new Proxy({}, { get: (o, k) => k === 'measureText' ? () => ({width: 80}) : k === 'getImageData' ? () => ({data: new Uint8ClampedArray(4)}) : k.startsWith('create') ? () => ({addColorStop(){}}) : () => {}, set: (o,k,v) => (o[k]=v,true) });
const element = () => ({style:{},dataset:{},classList:{add(){}},appendChild(){},prepend(){},getContext:()=>ctx});
const window = {THREE, dispatchEvent(){}};
const sandbox = {window, THREE, document:{createElement:element, getElementById:()=>element(),body:element()}, Event:class{}, console, Math};
vm.createContext(sandbox);
for (const file of ['model-kit.js','apple-assets.js','characters.js','decor.js']) {vm.runInContext(fs.readFileSync(path.join(root,'web',file),'utf8'),sandbox);sandbox.ModelKit=window.ModelKit;sandbox.AppleAssets=window.AppleAssets;}
const out = path.join(root,'web/assets/3d'); fs.mkdirSync(out,{recursive:true});
function exportOBJ(group, name) {
  group.updateMatrixWorld(true);
  const lines = [`# Agent Office; units: meters; Y up; +Z forward`, `mtllib ${name}.mtl`], materials = [];
  let offset = 1, meshIndex = 0;
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (let ancestor=mesh; ancestor; ancestor=ancestor.parent) if (!ancestor.visible) return;
    const geo = mesh.geometry, pos = geo.attributes.position, colors = geo.attributes.color;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const id = `material_${meshIndex++}`, c = material.color || new THREE.Color(0xffffff);
    materials.push(`newmtl ${id}\nKd ${c.r} ${c.g} ${c.b}\nd ${material.opacity}\n`);
    lines.push(`o ${mesh.name || 'mesh_'+meshIndex}`,`usemtl ${id}`);
    const v = new THREE.Vector3();
    for(let i=0;i<pos.count;i++) {
      v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      const color = colors ? ` ${colors.getX(i)} ${colors.getY(i)} ${colors.getZ(i)}` : '';
      lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}${color}`);
    }
    const index=geo.index, count=index ? index.count : pos.count;
    for(let i=0;i<count;i+=3) lines.push('f '+[0,1,2].map(j=>offset+(index?index.getX(i+j):i+j)).join(' '));
    offset += pos.count;
  });
  fs.writeFileSync(path.join(out,name+'.obj'),lines.join('\n')+'\n');
  fs.writeFileSync(path.join(out,name+'.mtl'),materials.join('\n'));
  console.log(name, offset-1, 'vertices');
}
for(const name of ['claude','gpt','gemini']) {
  const rig=window.Characters.build({color:0x4f7cf7},name);
  exportOBJ(rig.group,name);
  const height=new THREE.Box3().setFromObject(rig.group);
  if(Math.abs(height.min.y)>1e-5 || Math.abs(height.max.y-rig.group.userData.height)>1e-5) throw Error('캐릭터 키/접지 검증 실패');
}
const apple=new THREE.Group();
for(const [i,name] of ['Studio Display','Mac mini','Magic Keyboard','Magic Mouse','MacBook','iPad','Apple TV','HomePod mini'].entries()){const a=window.AppleAssets.build(name).group;a.position.set((i%4)*.8,0,Math.floor(i/4)*.7);apple.add(a);}
exportOBJ(apple,'apple');
const office=new THREE.Group(); window.Decor.build(office,{small:true});
for(const [i,p] of window.Decor.spots(3).entries()) window.Decor.deskSet(office,{...p.desk,exec:i===0,mats:[new THREE.MeshStandardMaterial({color:0x162434}),new THREE.MeshStandardMaterial({color:0x162434})],label:''});
exportOBJ(office,'office');
fs.writeFileSync(path.join(out,'dimensions.json'),JSON.stringify({units:'meters',up:'+Y',forward:'+Z',office:{width:32,depth:22,wallHeight:4,partitionHeight:2.6},characters:{claude:1.72,gpt:1.78,gemini:1.68},desk:{width:2.6,depth:1.2,topHeight:.815},chair:{seatHeight:.535},rooms:window.Decor.rooms},null,2));
