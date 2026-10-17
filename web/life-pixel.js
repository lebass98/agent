'use strict';
/* Same three NPC roles and three guests as the other spaces, with pixel sprites. */
(function(){
  const kit=window.ThemeKit,office=kit?.life?.office;if(!office)return;
  kit.life.pixel={...office,
    npcs:office.npcs.map(n=>({...n,kind:n.key==='duck'?'finance':n.key})),
    guests:office.guests.map((n,i)=>({...n,kind:['visitor','courier','intern'][i]})),
    words:{head:'본부장님',org:'픽셀 스튜디오'},
    lookOk:()=>true,ambient:()=>t=>window.PixelTheme?.stepAmbient(t),
    lines:{...office.lines,
      design:['이 민트색, 도트 팔레트에 잘 어울리네요.','한 픽셀씩 맞추다 보면 균형이 보여요.','작은 화면에도 여백은 필요하죠.'],
      coffee:['커피 한 잔으로 에너지 한 칸 충전!','잠깐 쉬었다가 다음 스테이지로 가 볼까요?'],
      cheer:['좋아요! 경험치가 쌓이고 있어요.','작은 한 걸음도 소중한 진척이죠.'],
    },
  };
})();
