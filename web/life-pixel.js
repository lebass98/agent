'use strict';
/* Same three NPC roles and three guests as the other spaces, with pixel sprites. */
(function(){
  const kit=window.ThemeKit,office=kit?.life?.office;if(!office)return;
  const zoo=kit.life.zoo||{};
  const adapt=value=>typeof value==='string'?value.replaceAll('동물원','픽셀 스튜디오').replaceAll('원장님','본부장님').replaceAll('코끼리','본부장').replaceAll('판다','디자인팀장').replaceAll('오리','경리팀장').replaceAll('대나무','간식'):Array.isArray(value)?value.map(adapt):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,adapt(v)])):value;
  kit.life.pixel={...office,
    duck:adapt(zoo.duck||office.duck),replies:adapt(zoo.replies||office.replies),talks:adapt(zoo.talks||office.talks),
    npcs:office.npcs.map(n=>({...n,kind:n.key==='duck'?'finance':n.key})),
    guests:office.guests.map((n,i)=>({...n,kind:['visitor','courier','intern'][i]})),
    words:{head:'본부장님',org:'픽셀 스튜디오'},
    lookOk:()=>true,ambient:(scene,T,talk)=>{
      const eden=window.PixelEden?.create(scene,T,talk);
      return (t,dt)=>{window.PixelTheme?.stepAmbient(t);eden?.(t,dt);};
    },
    lines:{...office.lines,...adapt(zoo.lines||{}),
      design:[...adapt(zoo.lines?.design||[]),'이 민트색, 도트 팔레트에 잘 어울리네요.','한 픽셀씩 맞추다 보면 균형이 보여요.','작은 화면에도 여백은 필요하죠.'],
      coffee:[...adapt(zoo.lines?.coffee||[]),'커피 한 잔으로 에너지 한 칸 충전!','잠깐 쉬었다가 다음 스테이지로 가 볼까요?'],
      cheer:[...adapt(zoo.lines?.cheer||[]),'좋아요! 경험치가 쌓이고 있어요.','작은 한 걸음도 소중한 진척이죠.'],
    },
  };
})();
