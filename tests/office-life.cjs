const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
(async()=>{for(const type of ['walk','tea','sofa','window','pantryChat']){
let now=1;const timers=[];
const agents=['claude','gpt'].map(name=>({name,ghost:false,hidden:false,mode:'sit',group:{position:{x:0,z:0}},seat:{x:0,z:0},coffee:{x:-11,z:-7},card:{st:{status:'대기'}},bubble:{classList:{remove(){}}},walkTo(p){Object.assign(this.group.position,p);this.mode='walk';return Promise.resolve(true)},teleport(p){Object.assign(this.group.position,p);this.mode='stand'},face(){},say(){},sitDesk(){this.mode='sit'}}));
const D={running:false,greeted:true,stage:{n:0},names:agents.map(a=>a.name)};
const s={window:{},D,document:{hidden:false,addEventListener(){}},performance:{now:()=>now},SPEED:1,mqReduce:{matches:false},HAS3D:true,BUSY:['작업 중'],IDLE:{status:'대기'},A:n=>agents.find(a=>a.name===n),pick:xs=>xs.includes(type)?type:xs[0],setMember:(n,v)=>s.A(n).card.st=v,coffeeFace:()=>({x:0,z:0}),setTimeout:r=>(timers.push(r),timers.length),clearTimeout(){},Math,console};
vm.createContext(s);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../web/office-life.js'),'utf8'),s);const life=s.window.OfficeLife;
life.tick();now=13000;life.tick();assert.equal(life.current,type);for(let i=0;i<15;i++)await Promise.resolve();assert(agents.some(a=>a.card.st.status==='휴식'));
D.running=true;life.tick();assert.equal(life.current,'');for(const a of agents){assert.equal(a.lifePose||'','');a.card.st={status:'작업 중'};}
for(const finish of timers)finish();for(let i=0;i<15;i++)await Promise.resolve();assert(agents.every(a=>a.card.st.status==='작업 중'));
console.log(type+': 업무 시작 후 이전 휴식 비동기 작업이 상태를 덮지 않음');
}})();
