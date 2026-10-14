"""새 착석 시트의 아틀라스/좌표 생성. 원본 sprites.js와 기존 걷기·서기 프레임은 보존한다.
사용: python scripts/sprites/seat-work.py (Pillow, numpy)
"""
from pathlib import Path
import json
from collections import deque
from PIL import Image, ImageFilter, ImageChops
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'docs/ref/characters-seated-work-v1.png'
out=ROOT/'web/sprites'
im=Image.open(source).convert('RGBA')
# 생성 시트의 실제 열/행 간격. 모든 프레임에 사람+의자만 있고 노트북/책상이 없다.
xs=[0,435,850,1278]; ys=[0,414,828,1230]
meta={'source':str(source.relative_to(ROOT)),'seatedHeight':1.46,'chars':{}}
for row,name in enumerate(['claude','gpt','gemini']):
    frames=[]
    for col,view in enumerate(['front','sideR','back']):
        cell=im.crop((xs[col],ys[row],xs[col+1],ys[row+1]))
        alpha=np.array(cell.getchannel('A'));seen=np.zeros(alpha.shape,bool);components=[]
        for yy,xx in zip(*np.nonzero(alpha>96)):
            if seen[yy,xx]:continue
            stack=[(int(yy),int(xx))];seen[yy,xx]=True;points=[]
            while stack:
                y,x=stack.pop();points.append((y,x))
                for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:
                    ny,nx=y+dy,x+dx
                    if 0<=ny<alpha.shape[0] and 0<=nx<alpha.shape[1] and alpha[ny,nx]>96 and not seen[ny,nx]:seen[ny,nx]=True;stack.append((ny,nx))
            components.append(points)
        biggest=max(map(len,components));mask=np.zeros(alpha.shape,np.uint8)
        for comp in components:
            if len(comp)>=biggest*.004:
                y,x=zip(*comp);mask[y,x]=255
        mask=Image.fromarray(mask).filter(ImageFilter.MaxFilter(3));cell.putalpha(ImageChops.multiply(cell.getchannel('A'),mask))
        bbox=cell.getbbox();cell=cell.crop(bbox);frames.append((view,cell))
    atlas=Image.new('RGBA',(1024,512));x=2;records={}
    for view,frame in frames:
        # 축은 발끝이 아닌 의자 중심. 측면은 등받이~발끝 폭의 38% 지점.
        ax=frame.width*(.38 if view=='sideR' else .5)
        atlas.paste(frame,(x,2));records['work.'+view]=[x,2,frame.width,frame.height,round(ax,2),round(frame.height/1.46,4)];x+=frame.width+4
    if x>1024:raise ValueError('atlas overflow')
    atlas.save(out/f'{name}-work.png',optimize=True)
    meta['chars'][name]={'atlas':f'sprites/{name}-work.png','size':[1024,512],'frames':records}
    print(name,records)
(out/'work-seated.js').write_text('/* scripts/sprites/seat-work.py 생성 — 직접 수정 금지 */\nwindow.WORK_SEATED_META = '+json.dumps(meta,ensure_ascii=False)+';\n',encoding='utf-8')
