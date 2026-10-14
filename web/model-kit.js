"use strict";
/* 정밀 메시 제작 공통 도구. 1 단위=1m, 외부 에셋/네트워크 없음. */
(function(){
  const T=window.THREE;if(!T)return;
  function roundedBox(w,h,d,r=Math.min(w,h,d)*.18){
    r=Math.min(r,w/2,h/2,d/2);
    const g=new T.BoxGeometry(w,h,d,4,4,4),p=g.attributes.position,n=g.attributes.normal;
    const v=new T.Vector3(),q=new T.Vector3(),inner=new T.Vector3(w/2-r,h/2-r,d/2-r);
    for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);q.set(Math.max(-inner.x,Math.min(inner.x,v.x)),Math.max(-inner.y,Math.min(inner.y,v.y)),Math.max(-inner.z,Math.min(inner.z,v.z)));
      v.sub(q).normalize();n.setXYZ(i,v.x,v.y,v.z);v.multiplyScalar(r).add(q);p.setXYZ(i,v.x,v.y,v.z);
    }
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  function merge(geometries){
    const out=new T.BufferGeometry(),attrs={position:[],normal:[],uv:[]};
    for(const original of geometries){const g=original.index?original.toNonIndexed():original;for(const k in attrs)attrs[k].push(...g.attributes[k].array);if(g!==original)g.dispose();original.dispose();}
    for(const k in attrs)out.setAttribute(k,new T.Float32BufferAttribute(attrs[k],k==='uv'?2:3));return out;
  }
  function surface(kind,size=256){
    const cv=document.createElement('canvas');cv.width=cv.height=size;const c=cv.getContext('2d');
    let seed=17;const rnd=()=>((seed=seed*16807%2147483647)-1)/2147483646;
    c.fillStyle='#888';c.fillRect(0,0,size,size);
    if(kind==='wood'){
      for(let y=0;y<size;y++){c.strokeStyle=`rgba(25,12,4,${.03+rnd()*.16})`;c.beginPath();for(let x=0;x<=size;x+=8){const yy=y+Math.sin(x*.035+y*.11)*1.3;x?c.lineTo(x,yy):c.moveTo(x,yy);}c.stroke();}
    }else{
      for(let y=0;y<size;y+=2){c.fillStyle=y%4?'#999':'#777';c.fillRect(0,y,size,1);}
      for(let x=0;x<size;x+=2){c.fillStyle='rgba(40,40,40,.18)';c.fillRect(x,0,1,size);}
    }
    const t=new T.CanvasTexture(cv);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;return t;
  }
  function mesh(g,m,parent,x=0,y=0,z=0,name='') {const o=new T.Mesh(g,m);o.position.set(x,y,z);o.name=name;o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
  function environment(renderer) {
    const room=new T.Scene();
    const shell=new T.Mesh(new T.BoxGeometry(16,10,16),new T.MeshBasicMaterial({color:0x434957,side:T.BackSide}));room.add(shell);
    for(const [w,h,x,y,z] of [[7,3,0,2,-7.8],[3,2,7.8,1,0]]){
      const card=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:0xdde4ef,side:T.DoubleSide}));card.position.set(x,y,z);if(x)card.rotation.y=Math.PI/2;room.add(card);
    }
    const pmrem=new T.PMREMGenerator(renderer);const target=pmrem.fromScene(room,.02);pmrem.dispose();room.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return target;
  }
  window.ModelKit={roundedBox,merge,surface,mesh,environment};
})();
