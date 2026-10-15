const assert=require('assert/strict');
const d=require('../web/decor.js');
assert.deepEqual([d.OW,d.OD],[40,40]);
const desks=d.slots(17);assert.equal(desks.length,17);
assert(!desks.some(p=>p.row===5&&p.col===2),'탕비실 앞줄 오른쪽은 비워 둔다');
for(const first of [0,2,4]){
 const back=desks.filter(p=>p.row===first),front=desks.filter(p=>p.row===first+1);
 assert(back.every(p=>p.facing===Math.PI));assert(front.every(p=>p.facing===0));
 assert.equal(back.length,3);assert.equal(front.length,first===4?2:3);
}
assert.equal(d.rooms.pantry.door.x,d.rooms.pantry.x1);
assert.equal(d.rooms.pantry.door.axis,'z');
assert.equal(d.rooms.meeting.label,'회의실 1');assert.equal(d.rooms.exec.label,'회의실 2');
d.nav.build(d.navRects(17));
for(const p of [...d.spots(17).map(s=>s.seat),...d.MEET_SEATS,...d.COFFEE,d.LIFE.window]){
 const start=d.nav.nearest(d.ENTRANCE),end=d.nav.nearest(p);assert(start&&end&&d.nav.astar(start,end),`A* 경로 없음: ${JSON.stringify(p)}`);
 const route=d.nav.route(d.ENTRANCE,p);assert(route&&route.length,`이동 경로 없음: ${JSON.stringify(p)}`);
}
console.log('40×40 평면·마주 보는 두 줄·17석·비운 자리·탕비실 우측 문·회의실 2개·전 구역 이동 경로 통과');
