"use strict";
/* 대기 중 사무실 연출. 업무 이벤트와 분리한 취소 가능한 상태기계이며 API를 호출하지 않는다. */
window.OfficeLife=(()=>{
  let generation=0,active=false,next=0,previous='',sceneName='';
  const participants=new Set();
  const places=window.Decor?.LIFE;
  const lines={
    walk:['잠깐 걸으면서 생각을 정리할게요.','어깨 좀 풀고 올게요.','한 바퀴 돌고 오니 아이디어가 떠오르네요.'],
    tea:['오늘은 따뜻한 차로 시작할까요?','향이 좋네요. 잠깐 숨 돌릴게요.','커피 대신 차 한 잔도 괜찮네요.'],
    sofa:['소파에서 잠깐 쉬어 갈게요.','잠깐 쉬고 나면 더 잘 보일 때가 있죠.','이 자리, 생각 정리하기 좋네요.'],
    window:['창밖을 보니 눈이 좀 편해지네요.','멀리 한 번 보고, 다시 집중해 볼까요?','차 한 잔 마시며 잠깐 바깥을 볼게요.'],
    pantryChat:[['차 한 잔 같이 마실까요?','좋아요. 잠깐 쉬어 가죠.'],['요즘 어떤 작업이 재미있어요?','복잡한 걸 간단하게 만드는 일이요.'],['잠깐 쉬니까 생각이 정리되네요.','맞아요. 여유가 도움이 될 때가 있어요.'],['다음엔 어떤 아이디어를 해볼까요?','작게 시작해서 같이 다듬어 봐요.']]
  };
  const sleepLife=ms=>new Promise(resolve=>setTimeout(resolve,ms/Math.max(1,SPEED)));
  const valid=g=>g===generation&&!D.running&&!document.hidden;
  function interrupt(){
    if(!active)return;
    generation++;active=false;next=performance.now()+18000;
    for(const a of participants){a.lifePose='';a.lifeSeatY=0;a.presenting=false;clearTimeout(a._bt);a.bubble?.classList.remove('show','covered');a.teleport({x:a.group.position.x,z:a.group.position.z});a.mode='stand';if(a.card)setMember(a.name,{...IDLE});}
    participants.clear();sceneName='';
  }
  async function travel(a,p,g){const ok=await a.walkTo(p);return ok&&valid(g);}
  function rest(a,pose,face,seatY=0){a.lifePose=pose;a.lifeSeatY=seatY;a.mode=['lounge','seatedTea'].includes(pose)?'sit':'coffee';a.face(face);}
  async function episode(type,people,g){
    const a=people[0],b=people[1];
    if(type==='walk'){
      a.say(pick(lines.walk),3300);
      for(const p of places?.walk||[{x:1.8,z:7},{x:3.2,z:4},{x:1.8,z:1}])if(!await travel(a,p,g))return;
      a.mode='stand';await sleepLife(4000);
    }else if(type==='tea'){
      if(!await travel(a,a.coffee,g))return;
      rest(a,'tea',coffeeFace(a.coffee));a.say(pick(lines.tea),4200);await sleepLife(14000);
    }else if(type==='window'){
      const p=places?.window||{x:2.6,z:-9.65};if(!await travel(a,p,g))return;
      rest(a,'tea',places?.windowFace||{x:2.6,z:-12});a.say(pick(lines.window),4600);await sleepLife(15000);
    }else if(type==='sofa'){
      // 길 찾기는 소파 앞에서 끝내고, 마지막 0.5m만 좌판으로 들어간다.
      if(!await travel(a,places?.sofaApproach||{x:12,z:9.35},g))return;
      if(!await travel(a,places?.sofa||{x:12,z:8.65},g))return;
      rest(a,'lounge',places?.sofaFace||{x:12,z:11},-.05);a.say(pick(lines.sofa),4500);await sleepLife(17000);
    }else if(type==='pantryChat'&&b){
      const chatPlaces=places?.chat||[{x:-12.95,z:-7.6},{x:-10.25,z:-7.6}];
      const arrived=await Promise.all(people.map((p,i)=>travel(p,chatPlaces[i],g)));if(!arrived.every(Boolean)||!valid(g))return;
      rest(a,'seatedTea',chatPlaces[1]);rest(b,'seatedTea',chatPlaces[0]);
      const exchange=pick(lines.pantryChat);a.say(exchange[0],4800);await sleepLife(5200);if(!valid(g))return;b.say(exchange[1],4800);await sleepLife(9000);
    }
    if(!valid(g))return;
    for(const person of people){person.lifePose='';person.lifeSeatY=0;}
    await Promise.all(people.map(async person=>{if(await travel(person,person.seat,g)){person.sitDesk();setMember(person.name,{...IDLE});}}));
  }
  function tick(){
    if(D.running||document.hidden||mqReduce.matches||window.CharacterChat?.isOpen){interrupt();return;}
    if(!HAS3D||!D.greeted||D.stage.n||active)return;
    const now=performance.now();if(!next){next=now+12000;return;}if(now<next)return;
    const free=D.names.map(A).filter(a=>!a.ghost&&!a.hidden&&a.mode!=='walk'&&!BUSY.includes(a.card?.st.status));if(!free.length)return;
    const types=['walk','tea','sofa','window',...(free.length>1?['pantryChat']:[])].filter(x=>x!==previous),type=pick(types);
    const a=pick(free),people=type==='pantryChat'?[a,pick(free.filter(b=>b!==a))]:[a];
    active=true;sceneName=type;previous=type;const g=++generation;
    for(const person of people){participants.add(person);setMember(person.name,{...IDLE,status:'휴식',task:{walk:'사무실 산책',tea:'탕비실에서 차 한 잔',sofa:'라운지 소파에서 휴식',window:'창가에서 잠깐 쉬는 중',pantryChat:'탕비실에서 담소'}[type]});}
    episode(type,people,g).catch(e=>console.error('사무실 휴식 연출:',e)).finally(()=>{if(g===generation){active=false;sceneName='';participants.clear();next=performance.now()+18000+Math.random()*18000;}});
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();});
  return {tick,interrupt,get current(){return sceneName;}};
})();
