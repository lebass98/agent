// NODE_PATH=/tmp/agent-office-assets/node_modules node scripts/assets/build-glb.cjs
// 패키지: npm install --prefix /tmp/agent-office-assets @napi-rs/canvas@0.1.80
const fs=require('fs'),path=require('path'),vm=require('vm');
const canvas=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../..'),T=require(path.join(root,'web/vendor/three.min.js'));
class FileReader {
  readAsArrayBuffer(b){b.arrayBuffer().then(a=>{this.result=a;this.onloadend?.();});}
  readAsDataURL(b){b.arrayBuffer().then(a=>{this.result='data:'+b.type+';base64,'+Buffer.from(a).toString('base64');this.onloadend?.();});}
}
const element=()=>({style:{},dataset:{},classList:{add(){}},appendChild(){},prepend(){}});
const window={THREE:T,TextEncoder,FileReader,dispatchEvent(){}};
const sandbox={window,THREE:T,ModelKit:null,AppleAssets:null,Characters:null,Blob,TextEncoder,FileReader,Event:class{},HTMLCanvasElement:canvas.createCanvas(1,1).constructor,ImageData:canvas.ImageData,Float32Array,Uint32Array,Uint16Array,Uint8Array,console,Math,document:{createElement:n=>n==='canvas'?canvas.createCanvas(1,1):element(),getElementById:()=>element(),body:element()}};
vm.createContext(sandbox);
for(const name of ['model-kit.js','apple-assets.js','characters.js','decor.js','vendor/GLTFExporter.js']){vm.runInContext(fs.readFileSync(path.join(root,'web',name),'utf8'),sandbox);sandbox.ModelKit=window.ModelKit;sandbox.AppleAssets=window.AppleAssets;sandbox.Characters=window.Characters;}
const out=path.join(root,'web/assets/3d');
async function save(group,name){group.updateMatrixWorld(true);const data=await new Promise(resolve=>new T.GLTFExporter().parse(group,resolve,{binary:true}));fs.writeFileSync(path.join(out,name+'.glb'),Buffer.from(data));console.log(name,data.byteLength,'bytes');}
(async()=>{
  const charsGroup=new T.Group();charsGroup.name='Agent Office 3D Characters';
  const colors={claude:0xd97757,gpt:0x10a37f,gemini:0x4f7cf7};
  for(const [i,name] of ['claude','gpt','gemini'].entries()){
    const rig=window.Characters.build({color:colors[name]},name);
    await save(rig.group,name);
    const rigPose=window.Characters.build({color:colors[name]},name);
    rigPose.setPose(['lounge','tea','present'][i]);
    rigPose.group.position.set((i-1)*1.15,0,0);
    charsGroup.add(rigPose.group);
  }
  await save(charsGroup,'characters');
  const apple=new T.Group();apple.name='Apple product collection';
  for(const [i,name] of ['Studio Display','Mac mini','Magic Keyboard','Magic Mouse','MacBook','iPad','Apple TV','HomePod mini'].entries()){const a=window.AppleAssets.build(name).group;a.position.set((i%4)*.8,0,Math.floor(i/4)*.7);apple.add(a);}
  await save(apple,'apple');
  const office=new T.Group();office.name='Agent Office';window.Decor.build(office,{small:true});
  for(const [i,p] of window.Decor.spots(3).entries())window.Decor.deskSet(office,{...p.desk,exec:i===0,mats:[new T.MeshStandardMaterial({color:0x162434}),new T.MeshStandardMaterial({color:0x162434})]});
  await save(office,'office');
})().catch(e=>{console.error(e);process.exitCode=1;});
