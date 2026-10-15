/* 외형 선택·저장과 모든 행동/표정 에셋 계약 검증: node tests/character-looks.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict'), path = require('path');
const root = path.join(__dirname, '../web');
const saved = new Map();
function context(blocked = false) {
  const c = { window: {}, localStorage: { getItem(k) { if(blocked)throw Error();return saved.get(k); }, setItem(k,v) { if(blocked)throw Error();saved.set(k,v); } } };
  vm.createContext(c);
  for (const file of ['sprites/sprites.js','sprites/work-seated.js','sprites/office-life.js','sprites/people.js','character-looks.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
  c.SPRITE_META=c.window.SPRITE_META;
  vm.runInContext(fs.readFileSync(path.join(root,'sprite-chars.js'),'utf8'),c);
  return c.window;
}
let w = context();
assert.equal(w.CharacterLooks.list.length, 13);
assert.equal(w.CharacterLooks.get('claude'), 'claude');
assert.equal(w.CharacterLooks.set('claude', '../../invalid'), false);
assert.equal(w.CharacterLooks.set('claude', 'jiyu'), true);
assert.equal(context().CharacterLooks.get('claude'), 'jiyu');
w = context(true); w.CharacterLooks.set('custom-agent','hyunwoo');
assert.equal(w.CharacterLooks.get('custom-agent'),'hyunwoo');
for (const {id} of w.CharacterLooks.list) {
  const c=w.SPRITE_META.chars[id]; assert(c,id);
  for(const key of ['stand.front','stand.sideL','stand.sideR','stand.back','walk.front','walk.sideR','walk.back','sit.front','sit.sideR','sit.back','rise.middle'])assert(c.frames[key],`${id}:${key}`);
  for(const meta of [c,w.WORK_SEATED_META.chars[id],w.OFFICE_LIFE_META.chars[id]]) {
    assert(fs.existsSync(path.join(root,meta.atlas)), meta.atlas);
    for(const [x,y,width,height,ax,ppu] of Object.values(meta.frames)) {
      assert(x>=0 && y>=0 && width>0 && height>0 && ppu>0 && ax>=0 && ax<=width);
      assert(x+width<=meta.size[0] && y+height<=meta.size[1]);
    }
  }
  const face = w.SpriteChars.faces(id);
  assert.equal(face.n,6);assert.equal(face.index('생각'),4);assert.equal(face.index('invalid'),0);
  assert(fs.existsSync(path.join(root,face.src)),face.src);
}
console.log('13종: 선택 검증·새로고침 복원·저장소 차단·행동 좌표·표정 파일 확인 통과');
w=context();
w.CharacterLooks.reconcile(['claude','gpt','gemini']);
assert.equal(w.CharacterLooks.set('gpt',w.CharacterLooks.get('claude'),['claude','gpt','gemini']),false);
w.CharacterLooks.set('claude','sungwoo');w.CharacterLooks.set('gpt','sungwoo');
w.CharacterLooks.reconcile(['claude','gpt','gemini']);
assert.equal(new Set(['claude','gpt','gemini'].map(n=>w.CharacterLooks.get(n))).size,3);
assert.equal(w.CharacterLooks.available('gpt',w.CharacterLooks.get('claude'),['claude','gpt','gemini']),false);
console.log('중복 선택 거부·이전 중복 저장값 자동 정리 확인 통과');

for(const {id} of w.CharacterLooks.list.filter(p=>p.age)){
  const c=w.OFFICE_LIFE_META.chars[id];
  for(const pose of ['lounge.front','lounge.sideR','lounge.back','tea','present','seatedTea']){
    assert(c.frames[pose],`${id}:${pose}`);
    const f=c.frames[pose],expected=pose.startsWith('lounge.')||pose==='seatedTea'?1.22:1.75;
    assert(Math.abs(f[3]/f[5]-expected)<.001,`${id}:${pose} 실제 높이`);
  }
}
console.log('신규 10명: 가구 없는 착석 3방향·전신 차/발표·앉아서 차 마시기 60포즈 및 높이 확인 통과');
