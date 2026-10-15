"""신규 인물별 4열×5행 시트를 투명 행동 아틀라스로 분리한다.
python3 scripts/sprites/people.py (Pillow, numpy 필요)
원본 알파를 유지하며 생성물 people.js 및 PNG를 직접 수정하지 않는다.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/sprites/people'
SOURCE = ROOT / 'docs/ref/people'
NAMES = ['기본', '웃음', '집중', '놀람', '생각', '측면']


def power(n):
    return 2 ** (n - 1).bit_length()


def tiles(image):
    """모델이 행 높이를 조금 달리 그려도 행 사이 알파 골짜기로 나눈다."""
    alpha = np.array(image.getchannel('A'))
    projection = (alpha > 32).sum(axis=1)
    smooth = np.convolve(projection, np.ones(7)/7, mode='same')
    h, w = alpha.shape
    rows = [0]
    for r in range(1, 5):
        lo, hi = int(h*(r/5-.035)), int(h*(r/5+.035))
        rows.append(lo + int(np.argmin(smooth[lo:hi])))
    rows.append(h)
    result = []
    for row in range(5):
        for col in range(4):
            tile = image.crop((col*w//4, rows[row], (col+1)*w//4, rows[row+1]))
            mask = tile.getchannel('A').point(lambda v: 255 if v > 24 else 0)
            box = mask.getbbox()
            if not box:
                raise ValueError(f'빈 프레임: {row}, {col}')
            result.append(tile.crop(box))
    return result


def pack(key, suffix, frames, heights):
    width = power(sum(im.width+4 for im in frames.values())+4)
    height = power(max(im.height for im in frames.values())+4)
    atlas = Image.new('RGBA', (width, height))
    coords, x = {}, 2
    for name, im in frames.items():
        atlas.paste(im, (x, 2))
        coords[name] = [x, 2, im.width, im.height, round(im.width/2, 3), round(im.height/heights[name], 4)]
        x += im.width+4
    path = OUT / f'{key}{suffix}.png'
    atlas.save(path, optimize=True)
    return {'atlas': str(path.relative_to(ROOT/'web')), 'size': [width, height], 'frames': coords}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    body, work, life = {}, {}, {}
    prompts = json.loads((Path(__file__).with_name('people-prompts.json')).read_text())
    for person in prompts['people']:
        key = person['id']
        source = SOURCE / f'{key}.png'
        im = Image.open(source).convert('RGBA')
        t = tiles(im)
        frames = dict(zip(['stand.front','stand.sideL','stand.sideR','stand.back','walk.front','walk.sideR','walk.back','rise.middle','sit.front','sit.sideR','sit.back'], t[:11]))
        frames['rise.before'] = t[9]; frames['rise.after'] = t[2]
        heights = {n: 1.46 if n.startswith('sit.') else 1.5 if n == 'rise.middle' else 1.75 for n in frames}
        body[key] = pack(key, '', frames, heights)
        wf = dict(zip(['work.front','work.sideR','work.back'], t[8:11]))
        work[key] = pack(key, '-work', wf, {n:1.46 for n in wf})
        lf = dict(zip(['lounge','tea','present'], t[11:14]))
        life[key] = pack(key, '-life', lf, {'lounge':1.4,'tea':1.75,'present':1.75})
        faces = Image.new('RGBA', (128*6,128))
        for i, face in enumerate(t[14:20]):
            face.thumbnail((128,128), Image.Resampling.LANCZOS)
            faces.paste(face, (i*128+(128-face.width)//2, (128-face.height)//2))
        faces.save(OUT/f'{key}-faces.png', optimize=True)
        body[key]['faces'] = {'src':f'sprites/people/{key}-faces.png','size':128,'names':NAMES}
    js = '/* scripts/sprites/people.py 생성 — 직접 수정 금지 */\n'
    for var, data in [('SPRITE_META',body),('WORK_SEATED_META',work),('OFFICE_LIFE_META',life)]:
        js += f'Object.assign(window.{var}.chars, {json.dumps(data,ensure_ascii=False)});\n'
    (OUT.parent/'people.js').write_text(js)
    print(f'{len(body)}명: 행동·업무·휴식·표정 아틀라스 생성 완료')

if __name__ == '__main__':
    main()
