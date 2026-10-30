/* 생성 원본을 보존하고 투명 영역 자르기·최근접 배율로 아틀라스를 만든다. */
const fs=require('fs'),path=require('path'),{PNG}=require('pngjs');
const root=path.resolve(__dirname,'../../web/pixel/v3');
const ids=['claude','gpt','gemini','design','head','finance','intern','courier','visitor'];
const poses=['stand.front','stand.side','stand.back','portrait','walk.front.0','walk.front.1','walk.back.0','walk.back.1','walk.side.0','walk.side.1','sit.front','sit.side','sit.back','tea.front','tea.side','present.front'];
const read=n=>PNG.sync.read(fs.readFileSync(path.join(root,'sources',n+'.png')));
const walk=read('walk'),actions=read('actions'),back=read('back');
const bb=[[12,200],[204,396],[399,596],[600,802],[808,1001],[1007,1201],[1209,1400],[1405,1597],[1605,1794],[1802,1966]];
function rear(row,col){const b=cell(back,col,bb[row],4),neutral=cell(back,0,bb[row],4);b.scale=48/neutral.h;return b;}
const wb=[[11,141],[150,283],[290,432],[443,580],[588,728],[737,874],[886,1026],[1034,1171],[1177,1317]];
const ab=[[19,147],[151,284],[285,427],[437,571],[576,708],[717,851],[857,986],[991,1118],[1122,1216],[1216,1316]];
function cell(im,col,band,cols=8){let x0=Math.round(col*im.width/cols),x1=Math.round((col+1)*im.width/cols),left=x1,right=x0,top=band[1],bottom=band[0];for(let y=band[0];y<band[1];y++)for(let x=x0;x<x1;x++)if(im.data[(y*im.width+x)*4+3]>128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}if(right<=left||bottom<=top)throw Error('Empty cell');return {im,x:left,y:top,w:right-left+1,h:bottom-top+1};}
function draw(src,dst,dx,dy,w,h){for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=src.x+Math.min(src.w-1,Math.floor((x+.5)*src.w/w)),sy=src.y+Math.min(src.h-1,Math.floor((y+.5)*src.h/h)),i=(sy*src.im.width+sx)*4,j=((dy+y)*dst.width+dx+x)*4;src.im.data.copy(dst.data,j,i,i+4);}}
function save(file,png){const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,PNG.sync.write(png));return 'pixel/v3/'+file;}
const out={version:3,characters:{}};
function pack(id,cells){const atlas=new PNG({width:256,height:256}),frames={};cells.forEach((b,i)=>{const h=b.scale?Math.min(56,Math.round(b.h*b.scale)):i>=10&&i<=12?34:48,w=Math.min(56,Math.round(b.w*h/b.h)),x=i%4*64+Math.floor((64-w)/2),y=Math.floor(i/4)*64+60-h;draw(b,atlas,x,y,w,h);frames[poses[i]]={x,y,w,h};});const portrait=new PNG({width:48,height:48}),b=cells[0],head={...b,h:Math.round(b.h*.48)},w=Math.min(46,Math.round(head.w*44/head.h));draw(head,portrait,Math.floor((48-w)/2),2,w,44);out.characters[id]={label:id,src:save('characters/'+id+'.png',atlas),portrait:save('portraits/'+id+'.png',portrait),frames};}
ids.forEach((id,row)=>{const w=c=>cell(walk,c,wb[row]),a=c=>cell(actions,c,ab[row]);pack(id,[w(0),w(3),rear(row,0),w(0),w(1),w(2),rear(row,1),rear(row,2),w(4),w(5),a(0),a(1),a(2),a(3),a(4),a(5)]);});
if(fs.existsSync(path.join(root,'sources/eden.png'))){const im=read('eden');const cells=poses.map((_,i)=>cell(im,i%4,[Math.round(Math.floor(i/4)*im.height/4),Math.round((Math.floor(i/4)+1)*im.height/4)],4));cells[2]=rear(9,0);cells[6]=rear(9,1);cells[7]=rear(9,2);pack('eden',cells);}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(out,null,2)+'\n');fs.writeFileSync(path.join(root,'assets.js'),'/* scripts/pixel/pack.cjs가 생성. */\nwindow.PIXEL_ASSETS_V3='+JSON.stringify(out)+';\n');
console.log(Object.keys(out.characters).length+' pixel characters packed');
