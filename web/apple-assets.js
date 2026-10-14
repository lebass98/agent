"use strict";
/* Apple 제품을 참고해 직접 제작한 미터 기준 모델(공식 CAD 아님).
   Studio Display/Mac mini/Magic Keyboard 외곽 치수: docs/assets-3d.md 출처. */
(function(){
  const T=window.THREE,K=window.ModelKit;if(!T||!K)return;
  function build(kind,options={}){
    const g=new T.Group();g.name=kind;g.userData={product:kind,units:'meters',authored:true};
    const metal=new T.MeshStandardMaterial({color:0xc9cdd2,metalness:.78,roughness:.29});
    const black=new T.MeshStandardMaterial({color:0x14161a,roughness:.35});
    const white=new T.MeshStandardMaterial({color:0xf4f4f2,roughness:.28});
    const glass=new T.MeshStandardMaterial({color:0x101b2c,roughness:.2,metalness:.05,emissive:0x142842,emissiveIntensity:.28});
    const box=(w,h,d,m,x,y,z,name)=>K.mesh(K.roundedBox(w,h,d),m,g,x,y,z,name);
    const ell=(rx,ry,rz,m,x,y,z)=>{const o=K.mesh(new T.SphereGeometry(1,24,16),m,g,x,y,z);o.scale.set(rx,ry,rz);return o;};
    function logo(x,y,z,s,rot=0){
      const shape=new T.Shape();shape.moveTo(0,.3);shape.bezierCurveTo(-.7,.8,-1,.1,-.78,-.48);shape.bezierCurveTo(-.5,-1.2,-.2,-.85,0,-.83);shape.bezierCurveTo(.3,-.85,.5,-1.05,.76,-.42);shape.bezierCurveTo(.38,-.3,.4,.14,.77,.28);shape.bezierCurveTo(.5,.7,.2,.5,0,.3);
      const o=K.mesh(new T.ShapeGeometry(shape,16),black,g,x,y,z,'Apple mark');o.scale.setScalar(s);o.rotation.x=rot;
      const leaf=ell(s*.22,s*.4,s*.035,black,x+s*.18,y+s*.7,z);leaf.rotation.z=-.6;if(rot){leaf.rotation.x=rot;leaf.position.set(x+s*.18,y,z-s*.7);}
    }
    let screen=null;
    if(kind==='Studio Display'){
      const lift=Math.max(0,Math.min(.10,options.lift||0));
      box(.623,.362,.031,metal,0,.297+lift,-.014,'Aluminium enclosure');box(.612,.351,.004,black,0,.297+lift,.003,'Black bezel');
      screen=K.mesh(new T.PlaneGeometry(.594,.334),options.material||glass,g,0,.297+lift,.0055,'Retina display');screen.castShadow=false;
      box(.095,.186+lift,.021,metal,0,.101+lift/2,-.052,'Tilt stand');box(.18,.012,.168,metal,0,.006,-.012,'Stand foot');
      ell(.0025,.0025,.001,black,0,.469+lift,.006);logo(0,.302+lift,-.031,.025,Math.PI);
      for(let i=0;i<4;i++)box(.006,.003,.002,black,.14+i*.014,.142,-.031,'USB-C port');
      g.userData.dimensions={width:.623,height:.478+lift,depth:.168};
    }else if(kind==='Magic Keyboard'){
      box(.2789,.009,.1149,metal,0,.0045,0,'Keyboard chassis');
      const keys=[];for(let row=0;row<5;row++)for(let col=0;col<14;col++){if(row===4&&col>2&&col<9)continue;const geo=K.roundedBox(row===4&&col===2?.12:.016,row===0?.0015:.0025,.015,.001);geo.translate(-.125+col*.019,row===0?.010:.011,-.044+row*.021);keys.push(geo);}
      K.mesh(K.merge(keys),white,g,0,0,0,'Individual keycaps');
      g.userData.dimensions={width:.2789,height:.013,depth:.1149};
    }else if(kind==='Magic Mouse'){
      box(.051,.008,.106,metal,0,.005,0,'Mouse base');ell(.028,.018,.056,white,0,.013,0);logo(0,.032,.025,.007,-Math.PI/2);
    }else if(kind==='Mac mini'){
      box(.127,.05,.127,metal,0,.025,0,'Mac mini enclosure');box(.11,.005,.11,black,0,.0025,0,'Ventilated foot');
      logo(0,.0505,0,.013,-Math.PI/2);for(const x of [-.025,.01])box(.012,.004,.002,black,x,.024,.064,'Front USB-C');ell(.001,.001,.001,white,.05,.025,.064);
      g.userData.dimensions={width:.127,height:.05,depth:.127};
    }else if(kind==='MacBook'){
      box(.313,.014,.221,metal,0,.007,0,'MacBook base');box(.286,.002,.092,black,0,.015,-.038,'Keyboard bed');box(.118,.001,.071,metal,0,.015,.052,'Trackpad');
      const keys=[];for(let row=0;row<5;row++)for(let col=0;col<13;col++){const geo=new T.BoxGeometry(.018,.001,.014);geo.translate(-.126+col*.021,.016,-.074+row*.016);keys.push(geo);}K.mesh(K.merge(keys),black,g,0,0,0,'MacBook keys');
      const lid=new T.Group();lid.name='MacBook lid';lid.position.set(0,.014,-.105);g.add(lid);
      if(options.open!==false){lid.rotation.x=-.18;K.mesh(K.roundedBox(.313,.202,.005),metal,lid,0,.101,0);screen=K.mesh(new T.PlaneGeometry(.292,.18),glass,lid,0,.104,.003,'Liquid Retina display');}
      else{lid.rotation.x=Math.PI/2;K.mesh(K.roundedBox(.313,.221,.005),metal,lid,0,.1105,0);}
      // Apple mark on the rear panel (separate geometry, no billboards).
      logo(0,options.open===false?.020:.12,options.open===false?0:-.108,.017,options.open===false?-Math.PI/2:Math.PI);
      g.userData.dimensions={width:.313,depth:.221};
    }else if(kind==='iPad'){
      box(.178,.25,.006,metal,0,0,0,'iPad aluminium body');box(.171,.243,.002,black,0,0,.003,'iPad bezel');screen=K.mesh(new T.PlaneGeometry(.158,.225),glass,g,0,0,.0045,'iPad display');logo(0,0,-.0035,.016,Math.PI);ell(.006,.006,.002,black,-.07,.107,-.005);
    }else if(kind==='Apple TV'){
      box(.093,.031,.093,black,0,.0155,0,'Apple TV box');logo(0,.0315,0,.011,-Math.PI/2);box(.035,.009,.136,metal,.12,.0045,0,'Siri Remote');ell(.011,.001,.011,black,.12,.01,-.033);
    }else if(kind==='HomePod mini'){
      const fabric=new T.MeshStandardMaterial({color:0xe2e3df,roughness:1,bumpMap:K.surface('fabric'),bumpScale:.0005});ell(.049,.042,.049,fabric,0,.042,0);ell(.028,.003,.028,black,0,.079,0);
    }
    g.userData.screen=!!screen;
    return {group:g,screen};
  }
  function desktop(parent,{x=0,y=0,z=0,mats=[]}={}){
    const group=new T.Group();group.name='Apple workstation';group.position.set(x,y,z);parent.add(group);
    const screens=[-.337,.337].map((dx,i)=>{const a=build('Studio Display',{material:mats[i],lift:.08});a.group.position.set(dx,0,-.25);a.group.rotation.y=i?-.10:.10;group.add(a.group);return a.screen;});
    for(const [name,px,pz] of [['Magic Keyboard',-.025,.32],['Magic Mouse',.218,.33],['Mac mini',.84,-.15]]){const a=build(name);a.group.position.set(px,0,pz);group.add(a.group);}
    return {group,screens};
  }
  window.AppleAssets={build,desktop};
})();
