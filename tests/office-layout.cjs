const assert=require('assert/strict');
const d=require('../web/decor.js');
const kit=require('../web/theme-kit.js');
assert.deepEqual([d.OW,d.OD],[40,40]);
// 공간 테마 규격(theme-kit.js): 작업석 12(0번 = 팀장실 팀장 책상) · 회의 의자 12 · 커피 자리 12 · 방 7 · 조연 장소
assert.deepEqual(kit.check(d,{need3d:false}),[],'사무실 지도가 공통 규격을 지킨다');
const desks=d.slots(17);assert.equal(desks.length,12,'자리는 12석까지만');
const [lead,...work]=desks,inRoom=(p,r)=>p.x>r.x0&&p.x<r.x1&&p.z>r.z0&&p.z<r.z1;
assert(lead.exec&&inRoom(lead,d.rooms.exec),'0번 자리는 팀장실 팀장 책상');
assert.equal(work.length,11);assert(work.every(p=>inRoom(p,d.rooms.work)),'나머지 11석은 업무 공간');
assert(!work.some(p=>p.row===0&&p.col===2),'뒤쪽 줄 오른쪽은 비워 둔다');
for(const first of [0,2]){
 const back=work.filter(p=>p.row===first),front=work.filter(p=>p.row===first+1);
 assert(back.every(p=>p.facing===Math.PI));assert(front.every(p=>p.facing===0));
 assert.equal(back.length,first===0?2:3);assert.equal(front.length,3);
}
assert.equal(d.rooms.pantry.door.x,d.rooms.pantry.x1);
assert.equal(d.rooms.pantry.door.axis,'z');
assert.equal(d.rooms.meeting.label,'회의실 1');assert.equal(d.rooms.exec.label,'팀장실');
assert(inRoom(d.PRESENT_SPOT,d.rooms.meeting),'발표 자리는 회의실 1 안(TV 옆)');
assert(inRoom(d.REPORT_SPOT,d.rooms.exec)&&inRoom(d.NPC.headSeat,d.rooms.exec),'검수 보고 자리·본부장 자리는 팀장실');
d.nav.build(d.navRects(12));
for(const p of [...d.spots(12).map(s=>s.seat),...d.MEET_SEATS,...d.COFFEE,d.LIFE.window,d.PRESENT_SPOT,d.REPORT_SPOT,d.NPC.headSeat,...d.NPC.back,...d.NPC.wander,...d.NPC.duckSpots,d.NPC.meetingDoor]){
 const start=d.nav.nearest(d.ENTRANCE),end=d.nav.nearest(p);assert(start&&end&&d.nav.astar(start,end),`A* 경로 없음: ${JSON.stringify(p)}`);
 const route=d.nav.route(d.ENTRANCE,p);assert(route&&route.length,`이동 경로 없음: ${JSON.stringify(p)}`);
}
console.log('40×40 평면·공통 규격(12석·회의 12·커피 12·방 7·조연 장소)·팀장실·마주 보는 두 줄·탕비실 우측 문·발표 자리·전 구역 이동 경로 통과');
