'use strict';
/* 동물원 동물 12종(팀원) + 2종(원장·디자인팀장). 구·원뿔·관 등 three.js 기본 도형으로 만든 두 발 마스코트 rig.
   ZooTheme.buildAnimal 과 같은 계약: {group, body, head, legs[2], arms[2], cup, props, preset, height, seatOffset, faceStrip, setFace, dispose}.
   legs 는 group 에, arms·head 는 body 에 붙는다(엉덩이 축 기울기·걷기·타이핑·발표 동작이 그대로 적용). +z 가 얼굴 앞. */
window.ZooAnimals = (() => {
  const species = [
    {id:'fox',label:'여우',emoji:'🦊',color:0xd98039},
    {id:'panda',label:'판다',emoji:'🐼',color:0x3c8781},
    {id:'otter',label:'수달',emoji:'🦦',color:0x8d6247},
    {id:'penguin',label:'펭귄',emoji:'🐧',color:0x2f6fb5},
    {id:'redpanda',label:'레서판다',emoji:'🦝',color:0xb8512c},
    {id:'koala',label:'코알라',emoji:'🐨',color:0x8a939c},
    {id:'monkey',label:'원숭이',emoji:'🐵',color:0x9a6a3c},
    {id:'giraffe',label:'기린',emoji:'🦒',color:0xd9a53c},
    {id:'meerkat',label:'미어캣',emoji:'🐿️',color:0xb8925a},
    {id:'rabbit',label:'토끼',emoji:'🐰',color:0xe58aa0},
    {id:'owl',label:'부엉이',emoji:'🦉',color:0x7a5a3a},
    {id:'capybara',label:'카피바라',emoji:'🦫',color:0xa07a52},
  ];
  const extras = [
    {id:'elephant',label:'코끼리',role:'동물원 원장',emoji:'🐘',color:0x7d8a99},
    {id:'peacock',label:'공작새',role:'디자인팀장',emoji:'🦚',color:0x1f7fa8},
  ];
  const info = new Map([...species, ...extras].map(s => [s.id, s]));
  const kindOf = kind => info.has(String(kind).toLowerCase()) ? String(kind).toLowerCase() : 'fox';
  const portraits = new Map();
  // UI 아바타: 동물 이모지를 그린 캔버스(표정 1칸). 종류별로 한 번만 만든다
  function faces(kind) {
    const id = kindOf(kind);
    if (!portraits.has(id)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.font = '92px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(info.get(id).emoji, 64, 70);
      portraits.set(id, {src:canvas.toDataURL(), n:1, index:() => 0});
    }
    return portraits.get(id);
  }
  // 메쉬·재질은 호출(rig)별로 소유한다. 한 rig 를 dispose 해도 다른 rig 는 멀쩡하다
  function kit() {
    const T = THREE, materials = new Map();
    const material = c => { if (!materials.has(c)) materials.set(c, new T.MeshStandardMaterial({color:c, roughness:.85})); return materials.get(c); };
    function mesh(p,g,c,x=0,y=0,z=0) { const m = new T.Mesh(g, material(c)); m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; p.add(m); return m; }
    const box = (p,c,x,y,z,w,h,d) => mesh(p, new T.BoxGeometry(w,h,d), c, x,y,z);
    function ball(p,c,x,y,z,sx,sy=sx,sz=sx) { const m = mesh(p, new T.SphereGeometry(1,16,12), c, x,y,z); m.scale.set(sx,sy,sz); return m; }
    const cyl = (p,c,x,y,z,r,h,r2=r) => mesh(p, new T.CylinderGeometry(r2,r,h,14), c, x,y,z);
    const cone = (p,c,x,y,z,r,h,seg=10) => mesh(p, new T.ConeGeometry(r,h,seg), c, x,y,z);
    // a→b 를 잇는 막대(r: a 쪽, r2: b 쪽 반지름)
    function beam(p,c,a,b,r,r2=r) {
      const s = new T.Vector3(...a), e = new T.Vector3(...b), d = e.clone().sub(s);
      const m = mesh(p, new T.CylinderGeometry(r2,r,d.length(),12), c, ...s.clone().add(e).multiplyScalar(.5).toArray());
      m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), d.normalize()); return m;
    }
    const tube = (p,c,pts,r) => mesh(p, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(q => new T.Vector3(...q))), 28, r, 8, false), c);
    return {T, materials, mesh, box, ball, cyl, cone, beam, tube};
  }
  const dark = 0x30332e, cream = 0xf2dec0, white = 0xf7f4ee, black = 0x23262b, pink = 0xf2a9b4;
  // 공통 뼈대 기본값 = 기존 여우·판다·수달 비율
  const BASE = {bodyY:.92, body:[.53,.68,.43], bellyZ:.34, bellyS:[.36,.43,.13], headY:1.8, headZ:.04, headS:[.61,.53,.49],
    legX:.28, legY:.4, foot:[0,-.12,.13,.22,.2,.31], armX:.51, armY:1.2, armZ:.02, arm:[.02,-.22,.06,.18,.35,.19], armRot:0,
    eye:[.23,.07,.465,.065], cupY:-.4, height:2.95, seatOffset:.02, scale:1};
  function frame(k,o) {
    const {T, ball} = k;
    const group = new T.Group(), body = new T.Group(), head = new T.Group(); group.add(body); head.position.set(0,o.headY,o.headZ); body.add(head);
    const legs = [], arms = [], eyes = [];
    if (o.body) ball(body, o.c, 0, o.bodyY, 0, ...o.body);
    if (o.belly != null) ball(body, o.belly, 0, o.bodyY+.02, o.bellyZ, ...o.bellyS);
    if (o.headS) ball(head, o.c, 0, 0, 0, ...o.headS);
    // 눈: 기본 크기 s 를 기억해 두고 setFace 가 세로 비율만 바꾼다. 흰 반짝임 포함
    const eye = (p,x,y,z,s,c=0x171f1b) => { eyes.push([ball(p,c,x,y,z,s), s]); ball(p,0xffffff,x-Math.sign(x)*s*.3,y+s*.46,z+s*.72,s*.28); };
    for (const side of [-1,1]) {
      const leg = new T.Group(); leg.position.set(side*o.legX, o.legY, 0); group.add(leg); legs.push(leg);
      if (o.foot) { const [x,y,z,a,b,c] = o.foot; ball(leg, o.footC ?? o.limb ?? o.c, x,y,z, a,b,c); }
      const arm = new T.Group(); arm.position.set(side*o.armX, o.armY, o.armZ); body.add(arm); arms.push(arm);
      if (o.arm) { const [x,y,z,a,b,c] = o.arm; ball(arm, o.armC ?? o.limb ?? o.c, side*x,y,z, a,b,c).rotation.z = side*o.armRot; }
      if (o.eye) eye(head, side*o.eye[0], o.eye[1], o.eye[2], o.eye[3]);
    }
    return {group, body, head, legs, arms, eyes, eye};
  }
  // 조끼·스카프 같은 가슴 장식(팀원 색 구분)
  const badge = (k,ctx,c,y=1.32,z=.36,w=.31) => k.box(ctx.body, c, 0, y, z, w, .16, .15);
  const S = {
    fox: {o:{c:0xd98039, belly:cream, limb:0xd98039}, add(k,{head,body},o) {
      for (const side of [-1,1]) {
        k.mesh(head, new k.T.ConeGeometry(.23,.6,4), o.c, side*.4,.57,-.03).rotation.z = -side*.2;
        k.mesh(head, new k.T.ConeGeometry(.12,.35,3), cream, side*.4,.58,.12).rotation.z = -side*.2;
      }
      k.ball(head,cream,0,-.21,.43,.31,.2,.18); k.ball(head,0x292c26,0,-.12,.6,.09,.065,.07);
      k.ball(body,o.c,.45,.65,-.48,.26,.32,.72).rotation.y = -.65; k.ball(body,cream,.76,.65,-.95,.22,.25,.27);
      k.box(body,0x68865b,0,1.32,.36,.31,.16,.15);
    }},
    panda: {o:{c:0xf2eee0, belly:0xf2eee0, limb:dark}, add(k,{head,body}) {
      for (const side of [-1,1]) { k.ball(head,dark,side*.43,.4,-.04,.22,.22,.14); k.ball(head,dark,side*.24,.03,.404,.18,.21,.07); }
      k.ball(head,cream,0,-.21,.43,.31,.2,.18); k.ball(head,0x292c26,0,-.12,.6,.09,.065,.07);
      k.box(body,0x3c8781,0,1.32,.36,.31,.16,.15);
    }},
    otter: {o:{c:0x8d6247, belly:cream, limb:0x8d6247}, add(k,{head,body},o) {
      for (const side of [-1,1]) k.ball(head,o.c,side*.43,.4,-.04,.22,.22,.14);
      k.ball(head,cream,0,-.21,.43,.31,.2,.18); k.ball(head,0x292c26,0,-.12,.6,.09,.065,.07);
      k.ball(body,o.c,0,.65,-.48,.26,.32,.65);
      k.box(body,0xc6a05b,0,1.32,.36,.31,.16,.15);
    }},
    // 펭귄: 검은 몸·흰 배와 얼굴, 지느러미 팔, 주황 부리·발
    penguin: {o:{c:0x2b3036, bodyY:.95, body:[.6,.82,.5], belly:white, bellyZ:.3, bellyS:[.45,.64,.24], headY:1.9, headS:[.5,.46,.44],
      foot:[0,-.33,.15,.2,.07,.28], footC:0xf0a03a, armX:.56, armY:1.35, arm:[.04,-.32,0,.1,.42,.22], armRot:.15, eye:null, cupY:-.6, height:2.75}, add(k,ctx,o) {
      const {head,body,legs} = ctx;
      k.ball(head,white,0,-.04,.2,.4,.33,.3);
      for (const side of [-1,1]) { ctx.eye(head,side*.16,.05,.44,.055); k.ball(head,pink,side*.27,-.1,.36,.07,.045,.04); }
      k.cone(head,0xf0a03a,0,-.1,.5,.08,.22).rotation.x = Math.PI/2;
      for (const leg of legs) k.ball(leg,o.c,0,-.15,0,.14,.18,.14);
      for (const a of [-.35,0,.35]) k.cone(head,o.c,a*.3,.48,-.02,.05,.18,6).rotation.z = -a;
      k.cone(body,o.c,0,.3,-.48,.14,.3,6).rotation.x = -2.2; // 꼬리 깃
      k.box(body,0x2f6fb5,0,1.62,.34,.4,.12,.18); // 목도리
    }},
    // 레서판다: 붉은 털·짙은 팔다리와 배, 흰 볼, 고리 무늬 꼬리
    redpanda: {o:{c:0xb8512c, belly:0x3b2219, limb:0x3b2219}, add(k,{head,body},o) {
      for (const side of [-1,1]) {
        const ear = k.cone(head,o.c,side*.4,.5,-.05,.2,.38,8); ear.rotation.z = -side*.35;
        const inner = k.cone(head,white,side*.4,.49,.04,.11,.26,8); inner.rotation.z = -side*.35;
        k.ball(head,white,side*.24,.24,.4,.09,.05,.05); // 흰 눈썹
        k.ball(head,0x7a2f17,side*.25,-.12,.42,.05,.12,.04).rotation.z = side*.3; // 눈물 무늬
      }
      k.ball(head,white,0,-.2,.42,.33,.2,.18); k.ball(head,0x292c26,0,-.12,.6,.09,.065,.07);
      for (let i = 0; i < 7; i++) { // 굵은 고리 꼬리: 옆으로 휘며 올라간다
        const t = i/6, r = .25-.05*t;
        k.ball(body, i === 6 ? 0x5a2a17 : i % 2 ? 0xe6b98a : o.c, .5*Math.sin(t*1.4), .48+.7*t*t, -.45-.42*Math.sin(t*Math.PI/2), r, r*.95, r*1.1);
      }
      k.box(body,0x4f8a5b,0,1.32,.36,.31,.16,.15);
    }},
    // 코알라: 회색, 크고 동그란 솜털 귀, 큰 코
    koala: {o:{c:0x9da3a9, belly:0xe9e6df, limb:0x868c93, headS:[.66,.56,.5], eye:[.27,.1,.43,.06]}, add(k,{head,body},o) {
      for (const side of [-1,1]) { k.ball(head,o.c,side*.62,.34,-.06,.32,.32,.15); k.ball(head,0xf3efe9,side*.6,.33,.04,.22,.22,.08); }
      k.ball(head,0x2a2b2e,0,-.08,.48,.13,.19,.11); k.box(head,0x5a5e63,0,-.32,.45,.12,.02,.02);
      k.ball(body,o.c,0,.55,-.38,.16); // 엉덩이 솜털
      k.box(body,0x5d9a63,0,1.32,.36,.31,.16,.15);
      k.ball(body,0x6aa85b,.12,1.36,.45,.09,.035,.05).rotation.z = .4; // 유칼립투스 잎 배지
    }},
    // 원숭이: 갈색 털·살구색 하트 얼굴, 긴 팔, 말린 긴 꼬리
    monkey: {o:{c:0x7b5232, belly:0xe9c39c, limb:0x7b5232, headS:[.58,.52,.47], arm:[.03,-.3,.06,.15,.45,.16], cupY:-.62, eye:[.17,.1,.5,.06]}, add(k,{head,body},o) {
      const face = 0xe9c39c;
      for (const side of [-1,1]) {
        k.ball(head,face,side*.17,.08,.3,.22,.24,.2);
        k.ball(head,o.c,side*.6,.02,-.02,.17,.19,.08); k.ball(head,face,side*.6,.02,.03,.11,.13,.05);
      }
      k.ball(head,face,0,-.2,.38,.3,.2,.16); k.ball(head,0x3a2a1e,0,-.12,.54,.06,.035,.03);
      k.box(head,0x5a3420,0,-.27,.53,.14,.02,.02);
      k.cone(head,o.c,0,.55,0,.1,.22,6).rotation.z = .3;
      k.tube(body,o.c,[[0,.55,-.38],[0,.4,-.8],[.1,.75,-1.15],[.05,1.3,-1.05],[-.1,1.45,-.78],[-.05,1.3,-.66]],.06);
      k.ball(body,o.c,-.05,1.3,-.66,.08);
      k.box(body,0xe0b23a,0,1.32,.36,.31,.16,.15);
    }},
    // 기린: 긴 목(전체 높이 3.6 이하), 무늬, 뿔(오시콘)
    giraffe: {o:{c:0xe7b44d, belly:0xf5e2b5, limb:0xe7b44d, body:[.5,.66,.42], bellyS:[.33,.4,.13], headY:2.62, headZ:.16, headS:[.4,.36,.42],
      footC:0x5a4030, eye:[.2,.08,.35,.055], height:3.5}, add(k,{head,body},o) {
      const spot = 0x9a5a2a;
      k.beam(body,o.c,[0,1.2,.03],[0,2.5,.14],.2,.15);
      for (const [y,a] of [[1.55,.6],[1.8,-.8],[2.05,2.5],[2.25,.1],[1.7,3.6],[2.1,-2.4],[1.45,-2.2]])
        k.ball(body,spot,Math.sin(a)*.16,y,.03+(y-1.2)*.085+Math.cos(a)*.16,.07,.09,.07);
      for (let i = 0; i < 6; i++) k.ball(body,0x7a4520,0,1.45+i*.2,-.12+i*.022,.04,.08,.05); // 갈기
      for (const [x,y,z] of [[.28,.62,.2],[-.3,.66,.18],[.22,1.05,-.3],[-.25,1.18,-.25],[.08,.6,-.38],[-.12,.92,-.38],[.3,.85,-.2],[-.34,.92,-.12]]) { // 몸통 표면 무늬
        const n = Math.hypot(x/.5,(y-.92)/.66,z/.42)/.97; k.ball(body,spot,x/n,.92+(y-.92)/n,z/n,.1,.1,.1);
      }
      k.ball(head,0xf2d38a,0,-.1,.3,.27,.21,.24); k.ball(head,0x7a4520,.08,-.04,.52,.03); k.ball(head,0x7a4520,-.08,-.04,.52,.03);
      for (const side of [-1,1]) {
        k.beam(head,0x9a5a2a,[side*.13,.25,-.05],[side*.18,.58,-.08],.045,.04); k.ball(head,0x5a3420,side*.18,.6,-.08,.07);
        k.cone(head,o.c,side*.42,.16,-.06,.07,.24,8).rotation.z = -side*(Math.PI/2-.35);
      }
      k.beam(body,o.c,[0,.75,-.38],[0,.42,-.56],.035); k.ball(body,0x5a3420,0,.38,-.58,.06,.1,.06);
      const scarf = k.mesh(body,new k.T.TorusGeometry(.19,.06,8,18),0x3f6fae,0,1.45,.07); scarf.rotation.x = Math.PI/2-.1; // 목도리
    }},
    // 미어캣: 가늘고 꼿꼿한 몸, 눈 주위 검은 무늬, 뾰족한 주둥이, 땅까지 닿는 꼬리
    meerkat: {o:{c:0xc8a26e, belly:0xead2a4, limb:0xb38e5c, bodyY:1, body:[.42,.82,.36], bellyZ:.27, bellyS:[.28,.55,.12], headY:2.05, headZ:.06, headS:[.42,.4,.4],
      legX:.2, foot:[0,-.12,.12,.16,.18,.26], armX:.4, armY:1.4, arm:[.02,-.2,.1,.12,.3,.13], armRot:-.1, eye:null, cupY:-.38, height:2.85}, add(k,ctx,o) {
      const {head,body} = ctx;
      for (const side of [-1,1]) {
        k.ball(head,0x3a2c22,side*.17,.06,.31,.11,.09,.07); ctx.eye(head,side*.17,.06,.37,.05);
        k.ball(head,0x3a2c22,side*.38,.08,-.06,.08,.1,.06);
      }
      k.cone(head,0xead2a4,0,-.12,.42,.15,.3,10).rotation.x = Math.PI/2; k.ball(head,0x2a2420,0,-.12,.58,.045);
      k.ball(head,0x9c7a4c,0,.18,-.05,.36,.22,.36); // 정수리 짙은 털
      k.beam(body,o.c,[0,.55,-.3],[0,.04,-.78],.08,.03); k.ball(body,0x3a2c22,0,.04,-.79,.04);
      k.box(body,0xd8653a,0,1.62,.28,.26,.12,.14);
    }},
    // 토끼: 긴 귀(분홍 속), 큰 발, 솜뭉치 꼬리
    rabbit: {o:{c:0xf2ede6, belly:0xffffff, limb:0xf2ede6, headY:1.78, headS:[.58,.52,.48], foot:[0,-.2,.18,.22,.18,.38], eye:[.22,.08,.44,.062], height:3.15}, add(k,{head,body},o) {
      for (const side of [-1,1]) {
        const ear = new k.T.Group(); ear.position.set(side*.2,.42,-.04); ear.rotation.z = -side*.14; head.add(ear);
        k.ball(ear,o.c,0,.38,0,.14,.5,.09); k.ball(ear,pink,0,.36,.06,.08,.38,.04);
        k.ball(head,0xffffff,side*.09,-.2,.4,.14,.12,.12); k.ball(head,pink,side*.33,-.12,.36,.08,.05,.04);
      }
      k.ball(head,pink,0,-.1,.5,.06,.045,.04); k.box(head,0xffffff,0,-.32,.46,.08,.07,.03);
      k.ball(body,0xffffff,0,.55,-.45,.2);
      k.box(body,0x5a86c9,0,1.32,.36,.31,.16,.15);
      k.cone(body,0xf08a3a,.12,1.12,.44,.04,.18,6).rotation.z = .4; // 당근 배지
    }},
    // 부엉이: 큰 머리·안면판, 노란 눈, 날개 팔, 귀깃
    owl: {o:{c:0x8b6a4a, belly:0xe6d3b3, limb:0x6e5238, bodyY:.95, body:[.6,.74,.5], bellyZ:.3, bellyS:[.42,.52,.22], headY:1.82, headS:[.62,.55,.52],
      foot:[0,-.33,.16,.18,.07,.24], footC:0xe0a03a, armX:.58, armY:1.35, arm:[.06,-.35,-.02,.13,.48,.3], armRot:.12, eye:null, cupY:-.62, height:2.75}, add(k,ctx,o) {
      const {head,body,legs} = ctx;
      for (const side of [-1,1]) {
        k.ball(head,0xd9c09a,side*.23,.02,.3,.27,.27,.2);
        k.ball(head,0xf4c13a,side*.23,.04,.47,.13,.13,.05); ctx.eye(head,side*.23,.04,.5,.075);
        k.cone(head,o.c,side*.36,.5,-.06,.09,.3,6).rotation.z = -side*.45;
      }
      k.cone(head,0xe0a03a,0,-.13,.52,.06,.16,6).rotation.x = Math.PI*.85;
      for (const [x,y] of [[-.15,1.05],[.15,1.05],[0,.9],[-.18,.75],[.18,.75],[0,.6]]) k.ball(body,0x9a7a52,x,y,.5,.05,.035,.03);
      for (const leg of legs) k.ball(leg,o.c,0,-.15,0,.15,.18,.15);
      k.box(body,0x6e5238,0,.55,-.5,.36,.3,.1).rotation.x = .35; // 꽁지깃
      k.box(body,0x6a4c8a,0,1.6,.3,.44,.12,.2);
    }},
    // 카피바라: 통통한 몸, 긴 네모난 얼굴·넓은 코, 머리 위 유자
    capybara: {o:{c:0x9b7451, belly:0xb68d66, limb:0x7f5d3f, body:[.64,.7,.52], bellyZ:.42, bellyS:[.42,.45,.13], headY:1.75, headZ:.08, headS:[.56,.48,.58],
      legX:.32, foot:[0,-.12,.13,.24,.2,.32], armX:.6, arm:[.02,-.2,.08,.19,.32,.2], eye:null, height:2.8, seatOffset:.04}, add(k,ctx,o) {
      const {head,body} = ctx;
      k.ball(head,o.c,0,-.1,.38,.42,.32,.32);
      k.ball(head,0x3a2a1e,0,-.04,.68,.2,.1,.05); k.ball(head,0x2a2018,.07,-.04,.71,.03); k.ball(head,0x2a2018,-.07,-.04,.71,.03);
      k.box(head,0x5a4030,0,-.26,.64,.16,.02,.03);
      for (const side of [-1,1]) { ctx.eye(head,side*.3,.18,.42,.05); k.ball(head,0x5a4030,side*.32,.42,-.12,.1,.08,.06); }
      k.ball(head,0xf2a531,0,.55,0,.15); k.ball(head,0x5a9a4a,.06,.7,0,.07,.025,.04).rotation.z = .5; // 유자
      k.ball(body,o.c,0,.6,-.5,.2,.16,.12);
      k.box(body,0x3f8f8a,0,1.32,.48,.34,.16,.15);
    }},
    // 코끼리(동물원 원장): 큰 귀·코·상아, 사파리 모자, 넥타이. 전체를 1.18배
    elephant: {o:{c:0x9aa1a8, belly:0xb3b9bf, limb:0x8b929a, bodyY:.95, body:[.62,.76,.5], bellyZ:.36, bellyS:[.42,.5,.15], headY:1.85, headS:[.6,.55,.52],
      legX:.3, foot:[0,-.14,.1,.24,.24,.28], armX:.6, arm:[.02,-.22,.06,.2,.38,.21], eye:[.25,.12,.45,.058], height:3.4, scale:1.18}, add(k,{head,body},o) {
      for (const side of [-1,1]) {
        const ear = new k.T.Group(); ear.position.set(side*.55,.02,-.12); ear.rotation.y = side*.45; head.add(ear);
        k.ball(ear,o.c,side*.08,0,0,.42,.5,.08); k.ball(ear,0xd9a8a8,side*.08,-.02,.04,.3,.38,.05);
        k.cone(head,0xf6f1e3,side*.2,-.32,.45,.045,.2,8).rotation.x = Math.PI*.7;
      }
      k.tube(head,o.c,[[0,-.05,.42],[0,-.35,.6],[0,-.65,.6],[0,-.85,.68],[0,-.8,.82]],.11);
      k.ball(head,o.c,0,-.79,.83,.11);
      k.cyl(head,0xc8b07a,0,.5,0,.48,.04); k.cyl(head,0xc8b07a,0,.62,0,.3,.22,.26); k.cyl(head,0x6a5a3a,0,.55,0,.305,.06);
      k.beam(body,o.c,[0,.62,-.46],[0,.34,-.6],.035); k.ball(body,0x5c6268,0,.31,-.61,.06,.09,.06);
      k.box(body,0x2c3e66,0,1.4,.44,.12,.22,.06); k.box(body,0x2c3e66,0,1.15,.46,.15,.3,.05);
    }},
    // 공작새(디자인팀장): 파란 몸, 볏, 부채꼴 꼬리깃(눈알 무늬)
    peacock: {o:{c:0x1f5fae, belly:0x2a7fc0, limb:0x2f6e7a, body:[.48,.62,.42], bellyZ:.3, bellyS:[.3,.42,.13], headY:1.92, headZ:.1, headS:[.34,.32,.34],
      foot:null, armX:.46, armY:1.3, arm:[.04,-.3,-.02,.1,.38,.22], armRot:.12, eye:[.15,.05,.29,.05], cupY:-.55, height:2.6}, add(k,{head,body,legs},o) {
      k.beam(body,o.c,[0,1.3,.04],[0,1.85,.1],.17,.13);
      k.cone(head,0xd9b26a,0,-.04,.36,.05,.16,6).rotation.x = Math.PI/2;
      for (const side of [-1,1]) k.ball(head,0xffffff,side*.17,.1,.25,.07,.03,.03);
      for (let i = 0; i < 5; i++) {
        const a = (i-2)*.18, top = [Math.sin(a)*.25, .3+Math.cos(a)*.25, -.04];
        k.beam(head,0x1b4f8f,[0,.28,-.02],top,.012); k.ball(head,0x2fb3a0,...top,.045);
      }
      for (const leg of legs) { k.beam(leg,0x8a8a80,[0,0,0],[0,-.34,.04],.04); k.ball(leg,0x8a8a80,0,-.37,.1,.12,.04,.18); }
      const fan = new k.T.Group(); fan.position.set(0,.8,-.42); fan.rotation.x = -.28; body.add(fan);
      for (let i = 0; i < 11; i++) {
        const f = new k.T.Group(); f.rotation.z = -1.3+2.6*i/10; fan.add(f);
        k.ball(f,0x2f8a4a,0,.72,0,.17,.72,.035);
        k.ball(f,0xd9a531,0,1.22,.03,.13,.15,.025); k.ball(f,0x1b3f8f,0,1.24,.05,.07,.08,.02);
      }
      k.box(body,0xd9a531,0,1.28,.34,.26,.12,.14);
    }},
  };
  function build(kind, name) {
    const id = kindOf(kind), spec = S[id], o = {...BASE, ...spec.o}, k = kit();
    const ctx = frame(k,o); spec.add(k,ctx,o);
    const {group, body, head, legs, arms, eyes} = ctx;
    const cup = new k.T.Group(); arms[1].add(cup); cup.position.set(0,o.cupY,.1); k.cyl(cup,0xf4e7cc,0,0,0,.085,.16); cup.visible = false;
    if (o.scale !== 1) group.scale.setScalar(o.scale);
    group.name = `zoo-agent-${name ?? id}`; group.userData.kind = id;
    // 표정: 눈 세로 비율만 바꾼다(웃음은 실눈, 놀람은 동그랗게)
    const f = {웃음:.025/.065, 놀람:.085/.065};
    return {group, body, head, legs, arms, cup, props:{}, preset:{}, height:o.height, seatOffset:o.seatOffset, faceStrip:faces(id),
      setFace(expr) { for (const [m,s] of eyes) m.scale.y = s*(f[expr] || 1); },
      dispose() { group.traverse(m => m.geometry?.dispose()); for (const m of k.materials.values()) m.dispose(); }};
  }
  return {species, extras, build, faces};
})();
