"""생성된 휴식·차·발표 시트에서 아틀라스/좌표표 추출(Pillow)."""
from pathlib import Path
import json
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
im=Image.open(ROOT/'docs/ref/characters-office-life-v1.png').convert('RGBA')
xs=[0,341,683,1024];ys=[0,512,1024,1536]
meta={'source':'docs/ref/characters-office-life-v1.png','chars':{}}
for row,name in enumerate(['claude','gpt','gemini']):
    atlas=Image.new('RGBA',(1024,512));frames={};x=2
    for col,pose in enumerate(['lounge','tea','present']):
        frame=im.crop((xs[col],ys[row],xs[col+1],ys[row+1]));alpha=frame.getchannel('A');frame.putalpha(alpha.point(lambda v:v if v>64 else 0));frame=frame.crop(frame.getbbox())
        h=1.22 if pose=='lounge' else {'claude':1.72,'gpt':1.78,'gemini':1.68}[name]
        ax=frame.width*(.32 if pose=='lounge' else .5)
        atlas.paste(frame,(x,2));frames[pose]=[x,2,frame.width,frame.height,round(ax,2),round(frame.height/h,4)];x+=frame.width+4
    if x>1024:raise ValueError('atlas overflow')
    atlas.save(ROOT/f'web/sprites/{name}-life.png',optimize=True)
    meta['chars'][name]={'atlas':f'sprites/{name}-life.png','size':[1024,512],'frames':frames}
(ROOT/'web/sprites/office-life.js').write_text('/* scripts/sprites/office-life.py 생성 — 직접 수정 금지 */\nwindow.OFFICE_LIFE_META = '+json.dumps(meta,ensure_ascii=False)+';\n',encoding='utf-8')
