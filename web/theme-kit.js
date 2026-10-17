'use strict';
/* theme-kit.js — 공간 테마 공통 규격(docs/space-themes.md). 동물원 구조를 기준으로 모든 테마가 같은 뼈대를 쓴다.
   테마마다 다른 것은 '모양'(3D 모델·이름·대사 말투)뿐이고, 아래 숫자·방 역할·조연 역할·Decor 계약은 같다.
   - 자리: 팀원 작업석 12(0번 = 팀장, exec 구역) · 회의 의자 12 · 커피 자리 12
   - 방 7개: 키와 역할이 테마마다 같다(이름표만 다르다)
   - 조연 3명(design·head·duck) + 산책 손님 3명 + 배경 생물(ambient) — 공통 엔진 life.js 가 움직이고, 테마는 모양·대사·장소만 준다
   - 테마 목록(THEMES)은 공간 고르기 창·상단 경로 단추가 그대로 쓴다. 새 테마는 여기에 한 줄 + Decor·life 내용만 더하면 된다
   space-theme.js 보다 먼저 읽는다(노드 테스트에서도 require 할 수 있다). */
(function () {
  const THEMES = [
    { id: 'office', label: '사무실', icon: '🏢', blurb: '익숙한 작업 공간과 사람 팀원', brand: 'WordNCode Agent Office', title: 'WordNCode Agent Office', picture: '🏢' },
    { id: 'zoo', label: '동물원', icon: '🦊', blurb: '동물 팀원과 서식지 마을 5곳이 있는 넓은 동물원', brand: 'WordNCode Agent Zoo', title: 'WordNCode Agent · 동물원', picture: '🦊 🐼 🦦 🐧' },
    { id: 'pixel', label: '픽셀 스튜디오', icon: '▦', blurb: '도트 캐릭터가 함께 일하는 따뜻한 2D 픽셀아트 사무실', brand: 'WordNCode Pixel Studio', title: 'WordNCode Agent · 픽셀 스튜디오', picture: 'PIXEL STUDIO' },
  ];
  const SEATS = 12, MEET_SEATS = 12, COFFEE_SPOTS = 12, GUESTS = 3;
  // 방 키 → 역할(모든 테마 공통). 이름(label)은 테마의 Decor.rooms 에서 온다
  const ROOMS = {
    lobby: '입구(출근·손님 맞이)', pantry: '간식·커피', work: '팀원 작업 공간', exec: '팀장 자리(본부장도 근처에 앉는다)',
    meeting: '회의·발표(팀장이 화면 옆에서 발표)', lounge: '쉼터(소파·잔디)', balcony: '바깥 쪽 휴식(창가·호숫가)',
  };
  const NPC_ROLES = {
    design: '디자인팀장 — 쉬지 않고 돌아다니며 가끔 혼잣말, 쉬는 팀원에게 말을 건다',
    head: '본부장 — 자기 자리·회의실·카페·팀원 옆을 오가며 응원·위로·명언. 발표 때는 회의실 뒤에서 듣는다',
    duck: '경리팀장 — 가장 말이 많다. 곳곳을 돌며 비용·간식 잔소리, 팀원 지적, 본부장 결재 독촉',
  };
  // Decor(테마 지도)가 꼭 내놓아야 하는 것. app.js·life.js 는 이것만 읽는다
  const DECOR_3D = ['build', 'deskSet', 'theme']; // 3D(three.js)가 있을 때만 붙는 것
  const DECOR_KEYS = ['OW', 'OD', 'PART_H', 'SEATS', 'rooms', 'nav', 'sun', 'spots', 'spareDesks', 'navRects', 'walkable', ...DECOR_3D,
    'TABLE', 'PRESENT_SPOT', 'WHITEBOARD', 'BOARD_FACE', 'COUNTER', 'PANTRY_TABLE', 'COFFEE', 'ENTRANCE', 'LOBBY_DOOR', 'REPORT_SPOT', 'LIFE', 'NPC'];
  const NPC_KEYS = ['headSeat', 'headFace', 'back', 'wander', 'duckSpots', 'meetingDoor'];

  const ids = THEMES.map(t => t.id);
  const valid = id => ids.includes(id);
  const get = id => THEMES.find(t => t.id === id) || THEMES[0];
  /** 테마 지도가 규격을 지키는지 검사한다. 문제 목록(한국어)을 돌려준다 — 노드 테스트와 개발 중 콘솔 경고에 쓴다 */
  function check(decor, { need3d = true } = {}) {
    const out = [];
    if (!decor) return ['Decor 가 없어요'];
    for (const k of DECOR_KEYS) if (decor[k] === undefined && (need3d || !DECOR_3D.includes(k))) out.push(`Decor.${k} 가 없어요`);
    for (const k of Object.keys(ROOMS)) if (!decor.rooms?.[k]?.label) out.push(`방 ${k} 이(가) 없거나 이름이 없어요`);
    if (decor.SEATS !== SEATS) out.push(`작업석이 ${decor.SEATS}개예요(규격 ${SEATS})`);
    if (typeof decor.spots === 'function') {
      const s = decor.spots(SEATS);
      if (s.length !== SEATS) out.push(`spots(${SEATS}) 가 ${s.length}개예요`);
      const meet = new Set(s.map(p => `${p.meet.x},${p.meet.z}`));
      if (meet.size !== MEET_SEATS) out.push(`회의 의자가 ${meet.size}개예요(규격 ${MEET_SEATS})`);
      if (decor.spots(SEATS + 3).length > SEATS) out.push('작업석보다 많은 자리를 내줘요');
    }
    if (Array.isArray(decor.COFFEE) && decor.COFFEE.length !== COFFEE_SPOTS) out.push(`커피 자리가 ${decor.COFFEE.length}개예요(규격 ${COFFEE_SPOTS})`);
    for (const k of NPC_KEYS) if (decor.NPC && decor.NPC[k] === undefined) out.push(`Decor.NPC.${k} 가 없어요`);
    return out;
  }
  const kit = { THEMES, ids, valid, get, SEATS, MEET_SEATS, COFFEE_SPOTS, GUESTS, ROOMS, NPC_ROLES, DECOR_KEYS, DECOR_3D, NPC_KEYS, check,
    /** 지금 공간(space-theme.js 가 정한 값). 노드에서는 office */
    current() { try { return get(window.SpaceTheme?.current); } catch { return THEMES[0]; } } };
  if (typeof window !== 'undefined') window.ThemeKit = kit;
  if (typeof module !== 'undefined') module.exports = kit;
})();
