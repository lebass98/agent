'use strict';
/* 모바일은 바닥의 두 축을 화면 가로·세로에 맞춘다. 월드 좌표와 길 찾기는 공유한다. */
(() => {
  const media=matchMedia('(max-width:760px)');
  const originalFrame=frame,originalArea=visibleArea;
  let active=null,desktop=null,lastSize="";
  function align(){
    if(!HAS3D||!camera||!controls)return;
    const mobile=media.matches;
    const size=innerWidth+":"+innerHeight;
    if(active===mobile&&(!mobile||lastSize===size))return;
    lastSize=size;
    if(!desktop)desktop={offset:CAM_OFF.clone(),rotate:controls.enableRotate,min:controls.minAzimuthAngle,max:controls.maxAzimuthAngle};
    active=mobile;
    const r=document.getElementById('officeFrame').getBoundingClientRect();
    const elevation=Math.max(.3,Math.min(.8,Math.max(60,r.height-134)/Math.max(1,r.width-32)*(Decor.OW/Decor.OD)));
    CAM_OFF.copy(mobile?new THREE.Vector3(0,32*elevation/Math.sqrt(1-elevation*elevation),32):desktop.offset);
    camera.position.copy(controls.target).add(CAM_OFF);
    controls.enableRotate=mobile?false:desktop.rotate;
    controls.minAzimuthAngle=mobile?0:desktop.min;
    controls.maxAzimuthAngle=mobile?0:desktop.max;
    camera.lookAt(controls.target);camera.updateMatrixWorld();controls.update();
  }
  frame=function(animate,zoom,points){
    align();
    if(!media.matches||!HAS3D)return originalFrame(animate,zoom,points);
    const area=visibleArea(),pts=points?.length?points:area.pts;
    const fwd=controls.target.clone().sub(camera.position).normalize();
    const right=new THREE.Vector3().crossVectors(fwd,camera.up).normalize(),up=new THREE.Vector3().crossVectors(right,fwd);
    const xs=pts.map(p=>p.dot(right)),ys=pts.map(p=>p.dot(up));
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const scale=(x1-x0)/Math.max(1,area.right-area.left);
    const tx=(x0+x1)/2-((area.left+area.right)/2-innerWidth/2)*scale;
    const ty=(y0+y1)/2+((area.top+area.bottom)/2-innerHeight/2)*scale;
    const base=right.multiplyScalar(tx).addScaledVector(up,ty);
    setView(innerHeight*scale,base.addScaledVector(fwd,-base.y/fwd.y),animate,zoom??camera.zoom);
  };
  visibleArea=function(){
    const area=originalArea();
    if(media.matches){const r=document.getElementById('officeFrame').getBoundingClientRect();area.top=r.top+70;area.bottom=Math.max(area.top+16,r.bottom-64);}
    return area;
  };
  const host=document.getElementById('officeFrame'),tools=host.querySelector('.office-tools');
  tools.id='mobileCameraTools';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='camera-toggle';
  toggle.setAttribute('aria-controls',tools.id);toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-map"/></svg><span>화면 조작</span>';
  const close=()=>{host.classList.remove('camera-tools-open');toggle.setAttribute('aria-expanded','false');tools.inert=media.matches;};
  toggle.onclick=()=>{const open=!host.classList.contains('camera-tools-open');host.classList.toggle('camera-tools-open',open);toggle.setAttribute('aria-expanded',String(open));tools.inert=!open&&media.matches;};
  host.append(toggle);
  media.addEventListener('change',()=>{close();resize();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  close();align();resize();
})();
