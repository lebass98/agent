const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('web/space-theme.js','utf8');
function page({query='',saved='office',busy=false,blocked=false,enter=null}={}) {
  const local=new Map([['agentOffice.spaceTheme',saved]]),session=new Map(enter?[['agentOffice.enterSpace',enter]]:[]),events={};
  const storage=map=>({getItem:k=>{if(blocked)throw Error('blocked');return map.get(k)||null},setItem:(k,v)=>{if(blocked)throw Error('blocked');map.set(k,v)},removeItem:k=>map.delete(k)});
  const buttons=['office','zoo'].map(space=>({dataset:{space},attrs:{},setAttribute(k,v){this.attrs[k]=v}}));
  const status={textContent:''},goal={value:'미전송 업무',dispatchEvent(){}};
  const dialog={open:false,querySelector:()=>status,querySelectorAll:()=>buttons,setAttribute(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false}};
  const location={search:query,href:'http://localhost/'+query,replace(url){this.changed=url}};
  const document={documentElement:{dataset:{}},activeElement:{focus(){}},body:{append(){}},createElement:()=>dialog,
    addEventListener:(n,fn)=>events[n]=fn,getElementById:id=>id==='goal'?goal:null,querySelector:()=>null,querySelectorAll:()=>[]};
  const s={window:{},document,location,localStorage:storage(local),sessionStorage:storage(session),URL,URLSearchParams,Event,D:{running:busy},UI:{submitting:false},console};
  vm.createContext(s);vm.runInContext(source,s);events.DOMContentLoaded();
  return {theme:s.window.SpaceTheme,local,session,dialog,status,buttons,location};
}
let p=page({saved:'zoo'});assert(p.theme.isZoo);assert(p.dialog.open);assert.equal(p.buttons[1].attrs['aria-pressed'],'true');
p.buttons[1].onclick();assert(!p.dialog.open);assert(!p.location.changed);
p=page({saved:'broken'});assert.equal(p.theme.current,'office');
p=page({query:'?space=zoo',saved:'office'});assert(p.theme.isZoo);
p=page({query:'?space=invalid',saved:'zoo'});assert(p.theme.isZoo);
p=page({blocked:true});assert.equal(p.theme.current,'office');assert(p.dialog.open);
p=page({saved:'zoo',busy:true});p.buttons[0].onclick();assert(!p.location.changed);assert(p.status.textContent.includes('끝나면'));assert(p.dialog.open);
p=page({saved:'office'});p.buttons[1].onclick();assert(new URL(p.location.changed).searchParams.get('space')==='zoo');assert.equal(p.local.get('agentOffice.spaceTheme'),'zoo');assert.equal(p.session.get('agentOffice.spaceDraft'),'미전송 업무');
p=page({saved:'zoo',enter:'zoo'});assert(!p.dialog.open);assert(!p.session.has('agentOffice.enterSpace'));
p=page({saved:'zoo'});assert(p.dialog.open,'다음 진입에서는 선택창을 다시 표시');
console.log('공간 선택 기억·진입 선택·유효값 검증·저장소 차단·업무 중 전환 방지·문구 복원 검증 통과');
