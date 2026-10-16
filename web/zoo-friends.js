'use strict';
/* 첨부 캐릭터를 구·곡선으로 재구성한 실제 3D rig. +Z가 앞. 팀원 데이터와 분리한 산책 손님. */
window.ZooFriends = (() => {
  const kinds = ['usagi', 'chiikawa', 'hachiware'];
  const names = ['우사기', '치이카와', '하치와레'];
  function build(kind) {
    if (!kinds.includes(kind)) throw new Error(`알 수 없는 친구: ${kind}`);
    const T = THREE, group = new T.Group(), body = new T.Group(); group.add(body);
    const materials = new Map(), geometries = new Set();
    const mat = c => { if (!materials.has(c)) materials.set(c, new T.MeshStandardMaterial({color:new T.Color(c).convertSRGBToLinear(), roughness:.83})); return materials.get(c); };
    const cream = kind === 'usagi' ? 0xffedb3 : 0xfffcf5, blue = 0x75a8bd, ink = 0x242323;
    function mesh(p,g,c,x,y,z) { geometries.add(g); const m=new T.Mesh(g,mat(c)); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; p.add(m); return m; }
    function ball(p,c,x,y,z,sx,sy=sx,sz=sx) {const m=mesh(p,new T.SphereGeometry(1,24,16),c,x,y,z);m.scale.set(sx,sy,sz);return m;}
    function line(p,c,points,r=.018) {return mesh(p,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(v=>new T.Vector3(...v))),20,r,6,false),c,0,0,0);}
    function pivot(p,x,y,z) {const g=new T.Group();g.position.set(x,y,z);p.add(g);return g;}
    // 넓은 볼 → 짧은 허리 → 납작하고 둥근 밑단을 하나의 연속 표면으로 만든다.
    const outline=new T.SplineCurve([
      [0,.08],[.30,.085],[.46,.14],[.55,.27],[.59,.46],[.61,.64],
      [.72,.82],[.81,1.04],[.80,1.25],[.72,1.46],[.55,1.65],[.29,1.77],[0,1.81]
    ].map(([r,y])=>new T.Vector2(r,y)));
    const g=new T.LatheGeometry(outline.getPoints(96),96);
    g.scale(1,1,.69);
    const shell=mesh(body,g,cream,0,0,0);shell.name='friend-silhouette';
    if(kind==='hachiware') {
      const pos=g.attributes.position,colors=[];
      for(let i=0;i<pos.count;i++) {const x=pos.getX(i),y=pos.getY(i);const c=new T.Color(y>1.48+.24*(1-Math.min(1,Math.abs(x)/.65))?blue:cream).convertSRGBToLinear();colors.push(c.r,c.g,c.b);}
      g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
      const m=new T.MeshStandardMaterial({vertexColors:true,roughness:.83});materials.set('fur',m);shell.material=m;
    }
    const head=pivot(body,0,.08,.025);
    const ears=[];
    for(const s of [-1,1]) {
      const e=pivot(body,s*(kind==='usagi'?.29:.48),1.70,-.015); ears.push(e);
      if(kind==='usagi') {e.rotation.z=-s*.12; ball(e,cream,0,.41,0,.15,.56,.13);ball(e,0xf7b3b7,0,.42,.105,.083,.43,.04);}
      else if(kind==='chiikawa') ball(e,cream,0,.05,0,.16,.19,.14);
      else {const shape=new T.Shape();shape.moveTo(-.24,0);shape.quadraticCurveTo(-.14,.32,0,.43);shape.quadraticCurveTo(.12,.48,.23,0);shape.closePath();const geo=new T.ExtrudeGeometry(shape,{depth:.16,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.055,bevelThickness:.065});mesh(e,geo,blue,0,0,-.09);e.rotation.z=-s*.16;}
    }
    const eyes=[];
    for(const s of [-1,1]) {
      eyes.push(ball(head,ink,s*.27,1.13,.505,.071,.09,.037));
      ball(head,0xffffff,s*.27-.017,1.163,.54,.024,.023,.012);
      ball(head,0xffffff,s*.27+.018,1.108,.541,.012,.011,.01);
      ball(head,0xf3a8b5,s*.47,.91,.456,.15,.09,.025);
      for(let i=0;i<3;i++) line(head,0xc46d80,[[s*.47-.065+i*.053,.94,.486],[s*.47-.085+i*.053,.89,.489]],.009);
    }
    line(head,ink,[[-.13,.91,.552],[-.095,.85,.562],[0,.88,.569],[.095,.85,.562],[.13,.91,.552]],.018);
    line(head,ink,[[-.067,.85,.563],[0,.73,.575],[.067,.85,.563]],.017);
    ball(head,0xf3a0af,0,.785,.575,.035,.032,.012);
    if(kind==='usagi') for(const side of [-1,1]) line(head,ink,[[side*.15,1.62,.34],[side*.32,1.60,.39],[side*.48,1.49,.40],[side*.55,1.33,.39]],.018);
    if(kind==='chiikawa') for(const s of [-1,1]) line(head,ink,[[s*.2,1.36,.49],[s*.27,1.38,.48],[s*.32,1.36,.46]],.012);
    const arms=[],legs=[];
    for(const s of [-1,1]) {
      const a=pivot(body,s*.64,.65,0);ball(a,cream,s*.035,-.015,.08,.12,.11,.12);arms.push(a);
      const l=pivot(group,s*.46,.14,0);ball(l,cream,0,-.035,.06,.12,.10,.15);legs.push(l);
    }
    const tail=pivot(body,0,.55,-.48);
    if(kind==='hachiware') line(tail,blue,[[0,0,0],[.2,-.1,-.13],[.4,-.03,-.18],[.43,.15,-.2]],.095);
    else ball(tail,cream,0,0,-.04,.17);
    group.name=`zoo-friend-${kind}`;group.userData.kind=kind;
    function animate(t,moving=true) {
      const step=t*8, a=moving?1:0;
      body.position.y=Math.abs(Math.sin(step))*.045*a+Math.sin(t*2)*.009;
      body.rotation.z=Math.sin(step)*.045*a;
      legs.forEach((l,i)=>l.rotation.x=Math.sin(step+i*Math.PI)*.32*a);
      arms.forEach((l,i)=>{l.rotation.x=-Math.sin(step+i*Math.PI)*.26*a;l.rotation.z=(i?1:-1)*(.13+Math.sin(t*2)*.08);});
      ears.forEach((e,i)=>e.rotation.x=Math.sin(t*5+i)*.09*(moving?1:.3));
      tail.rotation.y=Math.sin(t*4)*.22;
      const blink=t%4.7;eyes.forEach(e=>e.scale.y=.09*(blink>4.52?.12:1));
    }
    const cup=new T.Group();arms[1].add(cup);ball(cup,0xd4b7a4,0,-.18,.18,.09,.12,.09);cup.visible=false;
    return {group,body,head,cup,props:{},preset:{},height:kind==='usagi'?2.8:2.2,seatOffset:.2,setFace(expr){eyes.forEach(e=>e.scale.y=expr==='웃음'?.025:.09);},tick(t){ears.forEach((e,i)=>e.rotation.x=Math.sin(t*4+i)*.05);},ears,arms,legs,animate,dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
  }
  const api={kinds,names,build,list:[]};
  if(window.ZooAnimals) {
    const Z=window.ZooAnimals,oldBuild=Z.build,oldFaces=Z.faces;
    const emoji=['🐰','🐻‍❄️','🐱'];
    kinds.forEach((id,i)=>Z.species.push({id,label:names[i],emoji:emoji[i],color:i===0?0xffedb3:i===1?0xffffff:0x75a8bd}));
    Z.build=(kind,name)=>kinds.includes(kind)?build(kind):oldBuild(kind,name);
    const portraits=new Map();
    Z.faces=kind=>{
      if(!kinds.includes(kind))return oldFaces(kind);
      if(!portraits.has(kind)) {
        const cv=document.createElement('canvas');cv.width=cv.height=128;const c=cv.getContext('2d');
        c.fillStyle=kind==='usagi'?'#ffedb3':'#fffaf4';c.beginPath();c.ellipse(64,72,49,47,0,0,Math.PI*2);c.fill();
        c.fillStyle=kind==='hachiware'?'#75a8bd':c.fillStyle;
        for(const x of [38,90]){c.beginPath();c.ellipse(x,kind==='usagi'?23:30,10,kind==='usagi'?23:13,0,0,Math.PI*2);c.fill();}
        c.fillStyle='#30282a';for(const x of [46,82]){c.beginPath();c.ellipse(x,70,5,7,0,0,Math.PI*2);c.fill();}
        c.fillStyle='#ee9eb4';for(const x of [31,97]){c.beginPath();c.ellipse(x,86,10,6,0,0,Math.PI*2);c.fill();}
        c.strokeStyle='#30282a';c.lineWidth=3;c.beginPath();c.arc(64,86,7,0,Math.PI);c.stroke();
        portraits.set(kind,{src:cv.toDataURL(),n:1,index:()=>0});
      }
      return portraits.get(kind);
    };
  }
  return api;
})();
