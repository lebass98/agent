/* Pixel theme: shared navigation contract + Canvas 2D lifecycle, sprite bounds and hit testing. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const T=require('../web/vendor/three.min.js'),kit=require('../web/theme-kit.js');
const requested=[],rects=[],draws=[];
function canvas(){
 const cv={width:0,height:0,style:{},dataset:{},toDataURL:()=> 'data:image/png;base64,pixel',getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};
 const c=new Proxy({fillRect:(...r)=>rects.push({cv,r}),drawImage:(...a)=>draws.push(a),measureText:t=>({width:t.length*4})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 cv.getContext=type=>(requested.push(type),c);return cv;
}
const s={window:{THREE:T,SpaceTheme:{isPixel:true,current:'pixel',reduce:false},ThemeKit:{life:{office:{npcs:[1,2,3],guests:[1,2,3],lines:{},words:{}}}}},document:{createElement:canvas,hidden:false},Image:class{constructor(){this.complete=true;this.naturalWidth=256;}},performance:{now:()=>1000},THREE:T,console,Math,Date,Intl,Uint8Array,Float32Array,Int32Array};
vm.createContext(s);for(const name of ['decor.js','pixel/v2/assets.js','life-office.js','pixel-theme.js','life-pixel.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web',name),'utf8'),s);
const pixel=s.window.PixelTheme,d=s.window.Decor;
assert.deepEqual(kit.check(d),[],'12 desks, 12 meeting and coffee seats, seven rooms and NPC destinations');
d.nav.build(d.navRects(12));
const targets=[...d.spots(12).flatMap(s=>[s.seat,s.meet,s.coffee]),...d.NPC.wander,...d.NPC.duckSpots,d.PRESENT_SPOT,d.REPORT_SPOT,d.NPC.headSeat,d.LIFE.window,...d.LIFE.chat,d.LIFE.sofa];
for(const p of targets){const start=d.nav.nearest(d.ENTRANCE),end=d.nav.nearest(p);assert(start&&end&&d.nav.astar(start,end),`unreachable pixel destination: ${JSON.stringify(p)}`);}
const manifest=pixel.assets;
assert.equal(Object.keys(manifest.characters).length,9);
assert.equal(Object.keys(manifest.furniture).length,12);
for(const [id,a]of Object.entries(manifest.characters)){
 assert.equal(Object.keys(a.frames).length,16);
 assert.equal(pixel.faces(id).src,a.portrait);
 for(const dir of ['front','side','back'])for(const frame of [0,1])assert.equal(pixel.frameOf(id,'walk',dir,frame).frame.h,48,'walk animation keeps a fixed height');
 for(const file of [a.src,a.portrait]){
  const png=fs.readFileSync(path.join(__dirname,'../web',file));
  assert.equal(png.readUInt32BE(0),0x89504e47,'real PNG asset');
  assert.equal(png.readUInt32BE(16),file===a.src?256:48);
 }
 for(const pose of ['stand','walk','sit','type','tea','seatedTea','present'])for(const dir of ['front','side','back'])for(const step of [0,1]){
  const {frame:f}=pixel.frameOf(id,pose,dir,step);
  assert(f&&f.w>0&&f.h>0&&f.x>=0&&f.y>=0&&f.x+f.w<=256&&f.y+f.h<=256,`${id}/${pose}/${dir} within atlas`);
 }
 assert(pixel.frameOf(id,'sit','front',0).frame.h<pixel.frameOf(id,'stand','front',0).frame.h,'seated proportions shorter');
}
for(const a of Object.values(manifest.furniture))assert(fs.existsSync(path.join(__dirname,'../web',a.src)));
assert.equal(pixel.frameOf('new-team-member','stand','front',0),null,'additional members have procedural fallback');
assert.equal(pixel.setLook('claude','gpt',['claude','gpt','gemini']),false,'another member appearance is reserved');
assert.equal(pixel.setLook('claude','claude',['claude','gpt','gemini']),true);
const renderer=new pixel.Renderer();renderer.setSize(800,600);assert.equal(renderer.domElement.width,400);assert.equal(renderer.domElement.height,300);assert.equal(renderer.domElement.dataset.renderer,'canvas2d');
const camera=new T.OrthographicCamera(-25,25,20,-20,.1,200);camera.position.set(22,20,22);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const rig=pixel.buildCharacter({},'claude'),a={name:'claude',mode:'sit',targetRot:Math.PI,group:rig.group,atDesk:()=>true};rig.sprite.update(a,.1,true);
renderer.render(new T.Scene(),camera);assert(draws.some(args=>args.length===9&&args[0].src===manifest.characters.claude.src),'actual atlas frame is drawn');assert.equal(renderer.hits.length,1);
const h=renderer.hits[0];assert.equal(renderer.pick((h.x+h.w/2)*2,(h.y+h.h/2)*2),a,'body click selects the rendered character');
a.hidden=true;renderer.render(new T.Scene(),camera);assert.equal(renderer.hits.length,0,'hidden arrivals cannot be clicked');
a.hidden=false;rig.dispose();renderer.render(new T.Scene(),camera);assert.equal(renderer.hits.length,0,'disposed appearances do not remain in the renderer');
assert(requested.every(t=>t==='2d'),'no WebGL context requested');
assert.equal(s.window.ThemeKit.life.pixel.npcs.length,3);assert.equal(s.window.ThemeKit.life.pixel.guests.length,3);
assert.deepEqual(Array.from(s.window.ThemeKit.life.pixel.npcs,n=>n.kind),['design','head','finance']);
assert.deepEqual(Array.from(s.window.ThemeKit.life.pixel.guests,n=>n.kind),['visitor','courier','intern']);
const stateOnly=d.build();assert.equal(stateOnly.strokes.length,5);stateOnly.strokes[0].material.color.set('#fff');
const officeBase=require('../web/decor.js'),other={...s,window:{THREE:T,Decor:officeBase,SpaceTheme:{isPixel:false,isZoo:false}}};vm.createContext(other);vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/pixel-theme.js'),'utf8'),other);assert.equal(other.window.Decor,officeBase,'other themes retain their own map');
// Subpixel panning must move all geometry on the same 2 CSS-pixel grid.
const target=new T.Vector3();camera.position.x+=.031;camera.lookAt(target);camera.updateMatrixWorld();
for(let i=0;i<10;i++){
 camera.position.x+=.037;target.x+=.037;camera.updateMatrixWorld();
 pixel.snapCamera(camera,target,801,601);
 const p=new T.Vector3().project(camera),x=(p.x*.5+.5)*401,y=(.5-p.y*.5)*301;
 assert(Math.abs(x-Math.round(x))<1e-6&&Math.abs(y-Math.round(y))<1e-6,'camera raster phase is integral');
 const before=camera.position.clone();pixel.snapCamera(camera,target,801,601);
 assert(before.distanceTo(camera.position)<1e-8,'snapping does not cause drift');
}
console.log('픽셀 테마: 공통 규격·전 구역 이동·9명 전용 144프레임·가구 12종·픽셀 격자 고정·2D 렌더·클릭·숨김·외형 해제·조연 구조 통과');

// Gait phase follows distance and remains still while waiting/blocked, at every playback speed.
const walker=pixel.buildCharacter({},'gpt'),walking={mode:'walk',targetRot:0};
pixel.updateMotion(walker,walking,.016,false);
assert.equal(pixel.motionFrame(walker,false),2,'no displacement means planted feet');
walker.group.position.x=.33;pixel.updateMotion(walker,walking,.1,false);
assert.equal(pixel.motionFrame(walker,false),2,'passing pose after first contact');
walker.group.position.x=.65;pixel.updateMotion(walker,walking,.1,false);
assert.equal(pixel.motionFrame(walker,false),1,'opposite contact after half stride');
assert.equal(pixel.motionFrame(walker,true),2,'reduced motion plants both feet');
pixel.updateMotion(walker,walking,.1,false);assert.equal(walker.pixel.moving,false,'blocked walker does not walk on the spot');
walker.group.position.x=20;pixel.updateMotion(walker,walking,.016,false);assert.equal(walker.pixel.moving,false,'teleport does not animate a long stride');
walker.dispose();

const mobile={...s,window:{...s.window,Decor:{...pixel.decor},SpaceTheme:{isPixel:true}},matchMedia:()=>({matches:true})};
vm.createContext(mobile);vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/pixel/mobile-layout.js'),'utf8'),mobile);
const compact=mobile.window.Decor;
assert(compact.OW<d.OW&&compact.OD<d.OD,'mobile floor is physically smaller');
assert.equal(compact.slots(12).length,12,'all personal desks supported');
assert.equal(new Set(compact.slots(12).map(p=>p.z)).size,2,'desks form exactly two rows');
for(const desk of compact.slots(12))assert(Math.abs(desk.z)>compact.OD/2-1.3,'desks sit at top and bottom edges');
assert.equal(compact.TABLE.x,0);assert.equal(compact.TABLE.z,0);assert(compact.TABLE.radius>0,'round table in the centre');
assert.equal(new Set(compact.slots(12).map(p=>p.x+','+p.z)).size,12,'desks never overlap');
compact.nav.build(compact.navRects(12));
assert.equal(compact.nav.walkable(0,0),false,'characters cannot walk through the round table');
for(const p of [...compact.spots(12).flatMap(s=>[s.seat,s.meet,s.coffee]),...compact.NPC.wander,compact.LIFE.window,compact.LIFE.sofa,...compact.LIFE.chat,compact.PRESENT_SPOT,compact.REPORT_SPOT]){
 const from=compact.nav.nearest(compact.ENTRANCE),to=compact.nav.nearest(p);
 assert(from&&to&&compact.nav.astar(from,to),'compact layout destinations remain reachable');
}
const v3=JSON.parse(fs.readFileSync(path.join(__dirname,'../web/pixel/v3/manifest.json')));
assert.equal(Object.keys(v3.characters).length,10,'nine adults plus human Eden');
for(const [id,a] of Object.entries(v3.characters)){
 assert.equal(Object.keys(a.frames).length,16);
 for(const f of Object.values(a.frames))assert(f.w>0&&f.h>0&&f.x+f.w<=256&&f.y+f.h<=256,id+' frame fits atlas');
 for(const file of [a.src,a.portrait])assert(fs.existsSync(path.join(__dirname,'../web',file)));
}
console.log('이동 거리 기반 보행·멈춤·순간 이동·동작 줄이기·모바일 12석 길 찾기·신규 10명 행동 에셋 통과');
