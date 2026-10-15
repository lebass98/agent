/* 강아지 에셋 계약 및 3D 미지원 환경 검증: node tests/office-dogs.cjs */
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'../web'),ctx={window:{}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'sprites/dogs/dogs.js'),'utf8'),ctx);
assert.deepEqual(Object.keys(ctx.window.OFFICE_DOG_META).sort(),['beagle','corgi']);
for(const [key,meta] of Object.entries(ctx.window.OFFICE_DOG_META)){
 const png=fs.readFileSync(path.join(root,meta.atlas));
 assert.equal(png.readUInt32BE(16),meta.size[0],key+' atlas width');assert.equal(png.readUInt32BE(20),meta.size[1],key+' atlas height');
 assert.equal(Object.keys(meta.frames).length,12);
 for(const view of ['front','sideR','back'])for(const phase of [0,1])assert(meta.frames[`walk.${view}.${phase}`]);
 for(const [pose,[x,y,w,h,anchor,ppu]] of Object.entries(meta.frames)){
  assert(x>=0&&y>=0&&w>0&&h>0&&anchor>=0&&anchor<=w&&ppu>0,key+':'+pose);
  assert(x+w<=meta.size[0]&&y+h<=meta.size[1],key+':'+pose+' bounds');
  if(pose.startsWith('walk.'))assert.equal(ppu,meta.frames[`stand.${pose.split('.')[1]}`][5],key+': moving scale');
 }
}
vm.runInContext(fs.readFileSync(path.join(root,'office-dogs.js'),'utf8'),ctx);
assert.equal(ctx.window.OfficeDogs.list.length,0);
console.log('2종 × 12자세: 실제 PNG 크기·프레임 범위·걷기 배율·3D 미지원 환경 통과');
