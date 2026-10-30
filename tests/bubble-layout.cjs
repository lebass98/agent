const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const labels={querySelectorAll:()=>[]},frame={getBoundingClientRect:()=>({left:0,right:320,top:70,bottom:570,height:500}),querySelectorAll:()=>[]};
const s={window:{},document:{getElementById:id=>id==='labels'?labels:frame},declutter(){},renderer:null,innerWidth:320,innerHeight:700,Math,parseFloat,parseInt};
vm.createContext(s);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../web/bubble-layout.js'),'utf8'),s);
const {place}=s.window.BubbleLayout,b={left:10,right:310,top:100,bottom:500};
for(const p of [{left:-50,top:50},{left:280,top:490},{left:50,top:120}]){
 const obstacle={left:50,right:140,top:110,bottom:140};
 const r=place({...p,width:150,height:90},b,[obstacle]);
 assert(r);assert(r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom);
 assert(r.right<=obstacle.left-5||r.left>=obstacle.right+5||r.bottom<=obstacle.top-5||r.top>=obstacle.bottom+5);
}
assert.equal(place({left:10,top:100,width:150,height:90},b,[{left:0,right:320,top:0,bottom:700}]),null,'no room means hide, never cover a name');
console.log('말풍선 경계·이름표 회피·공간 부족 시 숨김 검증 통과');
