"""웰시코기·비글 4열×3행 투명 동작 시트 → 아틀라스/좌표표.
실행: python scripts/sprites/dogs.py (Pillow, numpy 필요).
원본은 docs/ref/dogs, 생성물은 web/sprites/dogs에 보관한다.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
POSES = ['stand.sideR', 'walk.sideR.0', 'walk.sideR.1', 'stand.sideL',
         'stand.front', 'walk.front.0', 'walk.front.1', 'stand.back',
         'walk.back.0', 'walk.back.1', 'sit', 'sniff']


def main():
    out = ROOT / 'web/sprites/dogs'
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for key, height in [('corgi', .52), ('beagle', .68)]:
        source = ROOT / f'docs/ref/dogs/{key}.png'
        image = Image.open(source).convert('RGBA')
        if image.getchannel('A').getextrema()[0] == 255:
            raise ValueError(f'{key}: 투명 배경이 필요합니다')
        frames = {}
        # 포즈가 칸 경계를 조금 넘어도 코·꼬리가 잘리지 않도록 전신 연결 영역을 분리한다.
        alpha = np.array(image.getchannel('A'))
        remaining = Image.fromarray((alpha > 128).astype('uint8') * 255).copy()
        for i, pose in enumerate(POSES):
            col, row = i % 4, i // 4
            x0, y0 = col*image.width//4, row*image.height//3
            region = np.array(remaining)[y0:(row+1)*image.height//3, x0:(col+1)*image.width//4]
            ys, xs = np.nonzero(region == 255)
            if not len(xs):
                raise ValueError(f'{key}: {pose} 빈 프레임')
            seed = int(np.argmin((xs-image.width/8)**2 + (ys-image.height/6)**2))
            ImageDraw.floodfill(remaining, (int(xs[seed]+x0), int(ys[seed]+y0)), 128)
            main = np.array(remaining) == 128
            silhouette = Image.fromarray(main.astype('uint8')*255).filter(ImageFilter.MaxFilter(5))
            clean_alpha = alpha.copy()
            clean_alpha[np.array(silhouette) == 0] = 0
            tile = image.copy()
            tile.putalpha(Image.fromarray(clean_alpha))
            bbox = tile.getchannel('A').getbbox()
            if not bbox or bbox[2]-bbox[0] > image.width*.4 or bbox[3]-bbox[1] > image.height*.4:
                raise ValueError(f'{key}: {pose} 자세가 이웃 칸과 연결됨')
            frames[pose] = tile.crop(bbox)
            rest = np.array(remaining)
            rest[main] = 0
            remaining = Image.fromarray(rest).copy()
        # 자세 교대 시 개별 프레임 높이로 재조정하지 않아 몸 크기가 펄떡이지 않는다.
        scales = {view: frames[f'stand.{view}'].height / height for view in ['sideR', 'sideL', 'front', 'back']}
        width = 2 ** (sum(t.width+4 for t in frames.values())+4-1).bit_length()
        atlas_height = 2 ** (max(t.height for t in frames.values())+4-1).bit_length()
        atlas = Image.new('RGBA', (width, atlas_height))
        coords, x = {}, 2
        for pose, tile in frames.items():
            alpha = np.array(tile.getchannel('A'))
            ys, xs = np.nonzero(alpha[int(tile.height*.3):int(tile.height*.65)] > 64)
            anchor = float(xs.mean()) if len(xs) else tile.width/2
            view = pose.split('.')[1] if '.' in pose else 'sideR'
            atlas.paste(tile, (x, 2))
            coords[pose] = [x, 2, tile.width, tile.height, round(anchor, 3), round(scales[view], 4)]
            x += tile.width+4
        atlas.save(out/f'{key}.png', optimize=True)
        meta[key] = {'atlas': f'sprites/dogs/{key}.png', 'size': [width, atlas_height], 'height': height, 'frames': coords}
    (out/'dogs.js').write_text('/* scripts/sprites/dogs.py 생성 — 직접 수정 금지 */\nwindow.OFFICE_DOG_META = '+json.dumps(meta, ensure_ascii=False)+';\n')
    print('웰시코기·비글 각 12개 동작 프레임 생성 완료')


if __name__ == '__main__':
    main()
