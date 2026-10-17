/* Pixel theme: shared navigation contract + Canvas 2D lifecycle, sprite bounds and hit testing. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const T=require('../web/vendor/three.min.js'),kit=require('../web/theme-kit.js');
const requested=[],rects=[],draws=[];
function canvas(){
 const cv={width:0,height:0,style:{},dataset:{},toDataURL:()=> 'data:image/png;base64,pixel',getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})};
 const c=new Proxy({fillRect:(...r)=>rects.push({cv,r}),drawImage:(...a)=>draws.push(a),measureText:t=>({width:t.length*4})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 cv.getContext=type=>(requested.push(type),c);return cv;
}
const s={window:{THREE:T,SpaceTheme:{isPixel:true,current:'pixel',reduce:false},ThemeKit:{life:{office:{npcs:[1,2,3],guests:[1,2,3],lines:{},words:{}}}}},document:{createElement:canvas,hidden:false},performance:{now:()=>1000},THREE:T,console,Math,Date,Intl,Uint8Array,Float32Array,Int32Array};
vm.createContext(s);for(const name of ['decor.js','pixel-theme.js','life-pixel.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web',name),'utf8'),s);
const pixel=s.window.PixelTheme,d=s.window.Decor;
assert.deepEqual(kit.check(d),[],'12 desks, 12 meeting and coffee seats, seven rooms and NPC destinations');
d.nav.build(d.navRects(12));
const targets=[...d.spots(12).flatMap(s=>[s.seat,s.meet,s.coffee]),...d.NPC.wander,...d.NPC.duckSpots,d.PRESENT_SPOT,d.REPORT_SPOT,d.NPC.headSeat,d.LIFE.window,...d.LIFE.chat,d.LIFE.sofa];
for(const p of targets){const start=d.nav.nearest(d.ENTRANCE),end=d.nav.nearest(p);assert(start&&end&&d.nav.astar(start,end),`unreachable pixel destination: ${JSON.stringify(p)}`);}
for(const key of ['claude','gpt','gemini','hana','jun','sora','min','doyoon','jiyu','hyunwoo','seojin','taeho','sungwoo'])for(const pose of ['stand','walk','sit','type','tea','seatedTea','present'])for(const dir of ['front','back','side'])for(const frame of [0,1]){
 const cv=pixel.sprite(key,pose,dir,frame);assert.equal(cv.width,24);assert.equal(cv.height,36);
 const pixels=rects.filter(o=>o.cv===cv);assert(pixels.length>15);assert(pixels.every(({r:[x,y,w,h]})=>x>=0&&y>=0&&x+w<=24&&y+h<=36),`${key}/${pose}/${dir} sprite clipped`);
 assert.equal(pixel.sprite(key,pose,dir,frame),cv,'sprite cache reused');
}
const renderer=new pixel.Renderer();renderer.setSize(800,600);assert.equal(renderer.domElement.width,400);assert.equal(renderer.domElement.height,300);assert.equal(renderer.domElement.dataset.renderer,'canvas2d');
const camera=new T.OrthographicCamera(-25,25,20,-20,.1,200);camera.position.set(22,20,22);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const rig=pixel.buildCharacter({},'claude'),a={name:'claude',mode:'sit',targetRot:Math.PI,group:rig.group,atDesk:()=>true};rig.sprite.update(a,.1,true);
renderer.render(new T.Scene(),camera);assert(draws.length>0);assert.equal(renderer.hits.length,1);
const h=renderer.hits[0];assert.equal(renderer.pick((h.x+h.w/2)*2,(h.y+h.h/2)*2),a,'body click selects the rendered character');
a.hidden=true;renderer.render(new T.Scene(),camera);assert.equal(renderer.hits.length,0,'hidden arrivals cannot be clicked');
a.hidden=false;rig.dispose();renderer.render(new T.Scene(),camera);assert.equal(renderer.hits.length,0,'disposed appearances do not remain in the renderer');
assert(requested.every(t=>t==='2d'),'no WebGL context requested');
assert.equal(s.window.ThemeKit.life.pixel.npcs.length,3);assert.equal(s.window.ThemeKit.life.pixel.guests.length,3);
const stateOnly=d.build();assert.equal(stateOnly.strokes.length,5);stateOnly.strokes[0].material.color.set('#fff');
const officeBase=require('../web/decor.js'),other={...s,window:{THREE:T,Decor:officeBase,SpaceTheme:{isPixel:false,isZoo:false}}};vm.createContext(other);vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/pixel-theme.js'),'utf8'),other);assert.equal(other.window.Decor,officeBase,'other themes retain their own map');
console.log('픽셀 테마: 공통 규격·전 구역 이동·546개 포즈/방향/프레임 경계·2D 렌더·클릭·숨김·외형 해제·조연 구조 통과');
