/* 사진 3장의 가시 요소로 만든 별도 공간 스케치. 실제 앱의 사무실은 변경하지 않는다. */
(() => {
  'use strict';
  const host=document.getElementById('scene');
  if(!window.THREE){document.getElementById('fallback').hidden=false;return;}
  const T=THREE, scene=new T.Scene(), wallGroup=new T.Group(), peopleGroup=new T.Group();
  scene.add(wallGroup,peopleGroup);
  let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});}catch{document.getElementById('fallback').hidden=false;return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;host.append(renderer.domElement);
  const camera=new T.PerspectiveCamera(38,1,.1,100);camera.position.set(17,17,21);
  const controls=new T.OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.minDistance=5;controls.maxDistance=64;controls.maxPolarAngle=Math.PI*.49;
  const ambient=new T.HemisphereLight(0xf4f8ff,0x8696ab,.85);scene.add(ambient);
  const sun=new T.DirectionalLight(0xfff5e5,1.3);sun.position.set(-8,18,-10);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13});sun.shadow.bias=-.0003;scene.add(sun);
  const fill=new T.DirectionalLight(0xc7dcff,.55);fill.position.set(9,8,10);scene.add(fill);
  const materials={};
  function mat(color,rough=.7){return materials[color]||(materials[color]=new T.MeshStandardMaterial({color:new T.Color(color).convertSRGBToLinear(),roughness:rough}));}
  function box(w,h,d,x,y,z,color,parent=scene){const o=new T.Mesh(new T.BoxGeometry(w,h,d),typeof color==='object'?color:mat(color));o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function cyl(r1,r2,h,x,y,z,color,parent=scene){const o=new T.Mesh(new T.CylinderGeometry(r1,r2,h,24),mat(color));o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  const floor=box(13,.22,15,0,-.14,0,'#d4d7d8');box(13.25,.12,15.25,0,-.29,0,'#e4e9ef');
  // 회색 정사각 타일과 파란 유리 복도를 사진의 주요 축으로 배치.
  const lines=new T.Group();scene.add(lines);
  for(let x=-6;x<=6;x+=1)box(.012,.004,15,x,-.023,0,'#c3c8cc',lines);
  for(let z=-7;z<=7;z+=1)box(13,.004,.012,0,-.022,z,'#c3c8cc',lines);
  const blue='#24539c', white='#f1f1ed', metal='#9faab3', wood='#c8ad85', fabric='#b8b9ad';
  box(.16,2.8,15,-6.5,1.4,0,white,wallGroup);
  box(13, .2,.14,0,.1,-7.5,white,wallGroup);
  // 창가: 긴 창, 수직 창틀, 위쪽 롤 블라인드와 얇은 직물 결.
  const windowMat=new T.MeshStandardMaterial({color:'#c7e2ec',transparent:true,opacity:.32,roughness:.15,depthWrite:false});
  box(12.6,2.45,.04,0,1.55,-7.48,windowMat,wallGroup);
  for(let x=-6.4;x<=6.5;x+=1.6){box(.045,2.9,.13,x,1.45,-7.43,'#a9b4bb',wallGroup);box(1.55,.65,.07,x+.79,2.55,-7.35,'#deded6',wallGroup);}
  for(let y=2.26;y<2.88;y+=.09)box(13,.014,.085,0,y,-7.3,'#c4c7c4',wallGroup);
  // 창 너머 베란다: 실내와 연결되는 긴 바닥, 유리 난간과 손잡이.
  box(13,.18,1.9,0,-.12,-8.45,'#c4cbc9');
  box(13.16,.1,2.02,0,-.26,-8.45,'#dce3e6');
  for(let x=-6.4;x<=6.5;x+=1.6){
    box(.045,1.15,.045,x,.56,-9.4,metal,wallGroup);
    box(1.5,.95,.025,x+.77,.52,-9.4,windowMat,wallGroup);
  }
  box(13.05,.05,.065,0,1.15,-9.4,metal,wallGroup);
  for(const x of [-6.5,6.5]){
    box(.045,1.15,.045,x,.56,-7.5,metal,wallGroup);
    box(.045,.05,1.9,x,1.15,-8.45,metal,wallGroup);
    box(.025,.95,1.9,x,.52,-8.45,windowMat,wallGroup);
  }
  for(let x=-6;x<=6;x++)box(.012,.005,1.9,x,-.023,-8.45,'#aebcbe');
  box(.035,.3,.035,-1.35,1.18,-7.35,metal,wallGroup);
  // 실제 주소 대신 추상적인 건물로 창밖 풍경을 표현한다.
  for(let i=0;i<11;i++){const h=1.1+(i*7%9)*.2;box(.8,h,.35,-5.8+i*1.2,h/2-.3,-11.6,'#c7d4df');}
  // 오른쪽 개별실과 긴 복도: 파란 수직 프레임, 투명 유리와 중간 높이의 반투명 필름.
  const glass=new T.MeshStandardMaterial({color:'#bdd8df',transparent:true,opacity:.23,roughness:.18,depthWrite:false,side:T.DoubleSide});
  const frost=new T.MeshStandardMaterial({color:'#e1e9e8',transparent:true,opacity:.73,roughness:.85,depthWrite:false,side:T.DoubleSide});
  for(let z=-7.4;z<=3.6;z+=1.1){box(.095,2.8,.075,2.8,1.4,z,blue,wallGroup);box(.045,2.7,1.03,2.8,1.4,z+.55,glass,wallGroup);box(.05,1.1,1.03,2.79,1.22,z+.55,frost,wallGroup);}
  box(.12,.12,11.2,2.8,2.8,-1.9,blue,wallGroup);box(.13,.1,11.2,2.8,.05,-1.9,blue,wallGroup);
  for(const z of [-7.4,-1.9,3.6]){box(3.7,2.8,.1,4.65,1.4,z,white,wallGroup);}
  box(.13,2.8,11.1,6.5,1.4,-1.9,white,wallGroup);
  for(const z of [-4.65,.85]){box(.055,.3,.045,2.64,1.2,z,'#b9c3cb',wallGroup);}
  function chair(x,z,rot=0,parent=scene){const g=new T.Group();g.position.set(x,0,z);g.rotation.y=rot;parent.add(g);box(.55,.1,.55,0,.5,0,'#525c62',g);box(.55,.62,.09,0,.86,.25,'#6c7478',g);cyl(.045,.055,.42,0,.25,0,'#9da4a9',g);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const leg=box(.035,.035,.48,Math.sin(a)*.13,.07,Math.cos(a)*.13,'#566069',g);leg.rotation.y=a;cyl(.055,.055,.045,Math.sin(a)*.32,.04,Math.cos(a)*.32,'#37424b',g).rotation.z=Math.PI/2;}return g;}
  function monitor(x,z,rot=0,parent=scene){const g=new T.Group();g.position.set(x,.78,z);g.rotation.y=rot;parent.add(g);box(.66,.43,.045,0,.34,0,'#313b47',g);box(.605,.366,.009,0,.34,.028,'#9fbacb',g);box(.018,.29,.01,-.23,.34,.035,'#6f91bb',g);box(.35,.018,.012,.04,.44,.035,'#e6edf2',g);box(.21,.018,.012,-.03,.38,.035,'#b9cedf',g);box(.29,.018,.012,.01,.32,.035,'#b9cedf',g);box(.05,.16,.04,0,.07,0,metal,g);box(.25,.025,.16,0,.015,.02,metal,g);return g;}
  const seats=[];
  // 가로 3석씩 배치한 마주 보는 책상 3묶음(18석). 오른쪽 복도는 비운다.
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const x=-4.9+col*2.85,z=-4.7+row*3.15;
    box(2.5,.075,1.55,x,.76,z,wood);for(const dx of [-1.14,1.14])for(const dz of [-.65,.65])box(.045,.74,.045,x+dx,.37,z+dz,'#d9dddb');
    box(2.54,.8,.055,x,1.02,z,fabric);box(2.57,.035,.07,x,1.43,z,metal);
    for(const dx of [-1.26,1.26]){box(.055,1.42,2.3,x+dx,.71,z,fabric);box(.075,.035,2.3,x+dx,1.43,z,metal);}
    for(const side of [-1,1]){
      const rotation=side===1?0:Math.PI;monitor(x-.28,z+side*.38,rotation);monitor(x+.42,z+side*.38,rotation);
      box(.52,.018,.17,x,.815,z+side*.64,'#e0e3e1');cyl(.047,.047,.105,x+.93,.85,z+side*.56,'#e8ddd0');
      const cz=z+side*1.12;const c=chair(x,cz,side===1?0:Math.PI);seats.push({x,z:cz,rotation:side===1?Math.PI:0,chair:c});
    }
  }
  // 사진 오른쪽 유리 공간: 회의실 2개.
  for(const z of [-4.65,.85]){box(1.7,.07,1.05,4.7,.74,z,wood);box(.08,.71,.08,4.7,.36,z,white);chair(4.7,z+.83);chair(4.7,z-.83,Math.PI);monitor(4.7,z-.2);}

  // 입구 기준 왼쪽 모서리의 탕비실. 출입구는 중앙 통로 쪽으로 연다.
  box(1.9,2.8,.12,-5.55,1.4,4.3,white,wallGroup);
  box(.4,2.8,.12,-3.2,1.4,4.3,white,wallGroup);
  box(1.2,.45,.12,-4,2.575,4.3,white,wallGroup);
  box(.12,2.8,3.2,-3,1.4,5.85,white,wallGroup);
  box(.075,2.3,1.1,-3.4,1.15,4.85,white,wallGroup);
  box(1.1,1.9,.75,-5.9,.95,6.8,'#eaeeeb');
  box(1.08,.025,.77,-5.9,1.25,6.8,'#bdc5c5');
  box(.035,.35,.035,-5.43,1.49,6.39,'#b2bcc1');
  const cloth=new T.CanvasTexture((()=>{const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#8c5963';ctx.fillRect(0,0,128,128);for(let i=0;i<128;i+=16){ctx.fillStyle='#273a5a';ctx.fillRect(i,0,6,128);ctx.fillRect(0,i,128,6);ctx.fillStyle='#c5a0a0';ctx.fillRect(i+8,0,1,128);ctx.fillRect(0,i+8,128,1);}return c;})());cloth.encoding=T.sRGBEncoding;
  box(1,.08,.65,-2.1,.75,6.4,new T.MeshStandardMaterial({map:cloth,roughness:1}));for(const x of [-2.52,-1.68])box(.04,.72,.04,x,.36,6.4,'#38434a');
  cyl(.15,.13,.15,-2.3,.87,6.4,'#f0eee4');cyl(.11,.11,.09,-2.3,.94,6.4,'#5d483c');
  box(.56,.8,.58,-4.8,.4,4.7,'#eeeeea');cyl(.24,.24,.42,-4.8,1.05,4.7,'#9bbfd8');box(.17,.12,.02,-4.8,.69,5.005,'#4f6b85');
  box(.75,.7,.65,-2.15,.35,4.75,'#d0d7d8');box(.77,.36,.67,-2.15,.88,4.75,'#303b48');box(.5,.025,.45,-2.15,1.08,4.75,'#1f2b38');
  for(const y of [1.68,2.15])box(1,.04,.23,-5,y,4.3,'#fbfaf5',wallGroup);
  box(1.3,2.5,.06,-1,1.25,7.45,glass,wallGroup);box(1.3,1.1,.065,-1,1.2,7.44,frost,wallGroup);for(const x of [-1.66,-.34])box(.06,2.6,.08,x,1.3,7.45,metal,wallGroup);for(const x of [-1.15,-.85])box(.025,.65,.03,x,1.25,7.36,metal,wallGroup);
  // 복도 끝의 옷걸이와 창가 식물.
  function plant(x,z){cyl(.19,.13,.3,x,.15,z,'#efe9dd');for(let i=0;i<9;i++){const a=i*2.4;const leaf=new T.Mesh(new T.SphereGeometry(.18,10,8),mat('#60836a'));leaf.scale.set(.5,1.6,.7);leaf.position.set(x+Math.sin(a)*.16,.5+(i%3)*.16,z+Math.cos(a)*.16);scene.add(leaf);}}
  plant(-5.8,-6.7);plant(1.6,-6.8);plant(-5.8,-8.5);plant(5.8,-8.5);box(.04,1.8,.04,1.75,.9,-5.9,metal);box(.9,.04,.04,1.75,1.8,-5.9,metal);for(const dx of [-.25,.25])box(.34,.7,.07,1.75+dx,1.35,-5.9,'#343d48');
  // 기존 한국인 에셋의 앉은 자세를 재사용한다. 사진 속 인물의 신원은 재현하지 않는다.
  const agents=[];const ids=['claude','gpt','gemini','hana','jun','sora','min','doyoon','jiyu','hyunwoo','seojin','taeho','sungwoo'];
  window.Decor={chairNear(x,z){return seats.find(s=>Math.hypot(s.x-x,s.z-z)<.15)?{mesh:seats.find(s=>Math.hypot(s.x-x,s.z-z)<.15).chair}:null;}};
  for(let i=0;i<seats.length;i++){const s=seats[i];const rig=window.SpriteChars?.build({},ids[i]);if(!rig)continue;s.occupied=true;rig.group.position.set(s.x,0,s.z);rig.group.rotation.y=s.rotation;peopleGroup.add(rig.group);agents.push({rig,mode:'type',act:'typing',targetRot:s.rotation,path:[],group:rig.group});}
  const labelSpecs=[['업무 공간',-3,.25,0],['유리 복도',2.25,.2,-2.2],['회의실 1',4.7,.9,-4.65],['회의실 2',4.7,.9,.85],['입구',-1,.1,7.1],['탕비실',-4.8,1,5.8],['창가',-.5,2,-7.3],['베란다',0,.4,-8.55]];
  const labelRoot=document.getElementById('roomLabels');const labels=labelSpecs.map(([text,x,y,z])=>{const node=document.createElement('span');node.className='room-label';node.textContent=text;labelRoot.append(node);return{node,pos:new T.Vector3(x,y,z)};});
  const views={whole:{pos:[17,17,21],target:[0,0,0],title:'함께 일하는 공간의 형태',desc:'창가의 빛, 파란 유리 프레임, 그리고 나란히 놓인 책상들.'},work:{pos:[-8,9,9],target:[-2.5,.6,-1.8],title:'낮은 칸막이 너머, 함께 일하기',desc:'밝은 우드 책상과 패브릭 파티션으로 이어지는 공용 업무 공간.'},corridor:{pos:[-.3,3.8,6.5],target:[2.8,1,-4],title:'파란 프레임을 따라 이어지는 길',desc:'사진 속 긴 유리 벽과 중간 높이의 반투명 시트지를 반영했습니다.'},entry:{pos:[-10,9,12],target:[-3.7,.8,5.6],title:'출근의 시작과 작은 휴식',desc:'유리 출입문, 체크 테이블, 프린터와 왼쪽 모서리의 탕비실.'},balcony:{pos:[11,9,-14],target:[0,.6,-7.8],title:'창가 너머 이어지는 베란다',desc:'긴 창 너머에 베란다 바닥과 유리 난간을 배치했습니다. 폭과 출입문 위치는 추정입니다.'},plan:{pos:[0,26,.02],target:[0,0,0],title:'위에서 살펴보는 공간 배치',desc:'왼쪽 업무 공간 · 오른쪽 유리 복도와 회의실 2개 · 왼쪽 모서리 탕비실 · 창가 너머 베란다.'}};
  let transition=null,night=false,labelsOn=true,activeView="whole";
  function view(id){activeView=id;const v=views[id],target=new T.Vector3(...v.target),fit=Math.max(1,.95/camera.aspect),position=new T.Vector3(...v.pos).sub(target).multiplyScalar(fit).add(target);transition={from:camera.position.clone(),to:position,start:performance.now(),old:controls.target.clone(),target:new T.Vector3(...v.target)};document.getElementById('viewTitle').textContent=v.title;document.getElementById('viewDesc').textContent=v.desc;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===id));}
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));document.getElementById('reset').onclick=()=>view('whole');
  document.getElementById('people').onchange=e=>{peopleGroup.visible=e.target.checked;seats.forEach(s=>s.chair.visible=!e.target.checked||!s.occupied);};
  document.getElementById('walls').onchange=e=>wallGroup.visible=e.target.checked;
  document.getElementById('labels').onchange=e=>{labelsOn=e.target.checked;labelRoot.hidden=!labelsOn;};
  document.getElementById('light').onclick=e=>{night=!night;sun.intensity=night?.25:1.3;ambient.intensity=night?.6:.85;fill.intensity=night?.9:.55;renderer.toneMappingExposure=night?1:1.22;window.SpriteChars?.theme(night);e.currentTarget.textContent=night?'☾ 저녁 조명':'☀ 낮 조명';e.currentTarget.setAttribute('aria-pressed',String(night));};
  controls.addEventListener('start',()=>transition=null);
  new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();view(activeView);}).observe(host);
  const clock=new T.Clock();const projected=new T.Vector3();
  function animate(){requestAnimationFrame(animate);const dt=Math.min(.05,clock.getDelta());if(transition){const t=Math.min(1,(performance.now()-transition.start)/800),ease=t*t*(3-2*t);camera.position.lerpVectors(transition.from,transition.to,ease);controls.target.lerpVectors(transition.old,transition.target,ease);if(t===1)transition=null;}controls.update();for(const a of agents)if(peopleGroup.visible)a.rig.sprite.update(a,dt,true,camera);renderer.render(scene,camera);if(labelsOn)for(const l of labels){projected.copy(l.pos).project(camera);l.node.hidden=projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;l.node.style.left=((projected.x*.5+.5)*host.clientWidth)+'px';l.node.style.top=((-projected.y*.5+.5)*host.clientHeight)+'px';}}
  animate();
})();
