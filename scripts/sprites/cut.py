"""캐릭터 시트(docs/ref/character-sheet-v2.png)를 포즈별 투명 PNG 로 잘라 web/sprites/ 에 저장한다.

  python3 scripts/sprites/cut.py      # Pillow·numpy·scipy 필요, macOS 14 이상(Vision 피사체 분리)

1) 칸(패널)마다 macOS Vision 으로 전경 마스크를 뽑아 합치고
2) 세로 투영의 골짜기로 칸을 나누고, 머리·몸통을 씨앗으로 이어진 픽셀을 따라 인물을 가른 뒤(표정은 같은 폭의 카드)
3) 인물마다 큰 덩어리만 남기고(옆 인물의 신발 조각 제거), 가장자리에 섞인 배경색을 빼고(어두운 장면의 흰 테두리 방지)
4) 몸 프레임은 캐릭터별 아틀라스(web/sprites/<이름>.png, 2의 거듭제곱 크기)로,
   표정은 아바타용 정사각형 띠(web/sprites/<이름>-faces.png)로 저장하고
5) 좌표표를 web/sprites/sprites.js(window.SPRITE_META) 로 쓴다.
   프레임 값: [x, y, w, h, ax(발 중심 x, px), ppu(월드 1 단위당 px)]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SHEET = ROOT / "docs/ref/character-sheet-v2.png"
OUT = ROOT / "web/sprites"
HERE = Path(__file__).resolve().parent

PPU = 225 / 1.75  # 서 있는 정면(약 225px)이 키 1.75 가 되게. 1·2번째 줄(서기·걷기·앉기·일어나기)은 같은 배율로 그려져 있다
COLS = {"claude": 0, "gpt": 512, "gemini": 1024}  # 캐릭터 열의 왼쪽 x (시트 1536px 기준)
# 칸: (종류, x0, y0, x1, y1 — 열 기준, 인물 이름들). 이름 끝 R/L 은 인물이 화면에서 바라보는 쪽. face 는 같은 폭의 카드
PANELS = [
    ("stand", 14, 92, 292, 334, ["front", "sideL", "sideR", "back"]),
    ("walk", 300, 92, 504, 334, ["front", "sideR", "back"]),
    ("sit", 14, 398, 282, 592, ["front", "sideR", "back"]),
    ("rise", 290, 398, 504, 592, ["before", "middle", "after"]),
    ("face", 14, 868, 506, 992, ["기본", "웃음", "집중", "놀람", "생각", "측면"]),
]
# '다양한 행동 포즈' 칸은 허벅지에서 잘려 있고 흰 스티커 외곽선이 있어 3D 에 쓰지 않는다
# 자동으로 떼어지지 않는 조각(옆 사람과 맞닿은 신발 끝)을 지울 사각형: 프레임 bbox 기준 (x0, y0, x1, y1) px
ERASE = {("claude", "stand.sideL"): [(60, 190, 80, 216)]}


def vmask_bin() -> Path:
    exe = Path(tempfile.gettempdir()) / "agent-vmask"
    src = HERE / "vmask.swift"
    if not exe.exists() or exe.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["swiftc", "-O", str(src), "-o", str(exe)], check=True)
    return exe


def fg_mask(img: Image.Image, tmp: Path) -> np.ndarray:
    """Vision 인스턴스 마스크를 모두 합친 전경 알파(0~255)."""
    src, md = tmp / "panel.png", tmp / "m"
    img.save(src)
    for f in md.glob("*.png"):
        f.unlink()
    subprocess.run([str(vmask_bin()), str(src), str(md)], check=True, capture_output=True)
    acc = np.zeros((img.height, img.width), np.uint8)
    for f in md.glob("mask_*.png"):
        acc = np.maximum(acc, np.array(Image.open(f).convert("L")))
    return acc


def valley_edges(alpha: np.ndarray, n: int) -> list:
    """세로 투영에서 인물 n 명 사이의 가장 얕은 골짜기 n-1 개로 x 경계를 정한다."""
    a = np.convolve((alpha > 96).sum(axis=0).astype(float), np.ones(5) / 5, mode="same")
    xs = np.nonzero(a > 0)[0]
    lo, hi = int(xs[0]), int(xs[-1])
    w = (hi - lo) / n
    cuts = [int(lo + w * i - w * .35) + int(np.argmin(a[int(lo + w * i - w * .35):int(lo + w * i + w * .35)])) for i in range(1, n)]
    return [lo] + cuts + [hi + 1]


def split_geodesic(alpha: np.ndarray, edges, seed_frac: float = .55) -> np.ndarray:
    """인물 라벨 지도(0 = 버림). 칸마다 머리·몸통(위 55%, 가운데 70% 폭)을 씨앗으로 두고 전경을 따라 4방향으로 넓힌다.
    세로선으로 자르면 옆 사람과 겹친 신발 끝이 따라오지만, 이어진 길을 따라가면 원래 주인에게 붙는다."""
    fg = alpha > 40
    h, w = fg.shape
    lab = np.zeros((h, w), np.int32)
    top = int(h * seed_frac)
    bands = []
    for i in range(len(edges) - 1):
        a0, a1 = int(edges[i]), int(edges[i + 1])
        m = int((a1 - a0) * .15)
        bands.append((a0 + m, a1 - m))
        band = np.zeros_like(fg)
        band[:top, a0 + m:a1 - m] = True
        lab[band & fg] = i + 1
    while True:
        free = fg & (lab == 0)
        grown = lab.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = np.zeros_like(lab)  # 한 칸 민 라벨(가장자리는 0 — np.roll 처럼 반대편으로 넘어가지 않게)
            nb[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = lab[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
            take = free & (grown == 0) & (nb > 0)
            grown[take] = nb[take]
        if (grown == lab).all():
            break
        lab = grown
    # 옅은 가장자리(전경 문턱 아래)와 아주 가까운 떨어진 조각은 가장 가까운 라벨로, 먼 조각은 버린다
    soft = (alpha > 8) & (lab == 0)
    if (lab > 0).any():
        dist, (iy, ix) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
        near = soft & (dist <= 6)
        lab[near] = lab[iy[near], ix[near]]
    # 몸통 띠 밖에 따로 떨어진 작은 조각(가장 큰 덩어리의 25% 미만)은 옆 사람 것이다 → 버린다
    for i, (b0, b1) in enumerate(bands):
        comp, n = ndimage.label(lab == i + 1, structure=np.ones((3, 3)))
        if n <= 1:
            continue
        sizes = ndimage.sum(np.ones_like(comp), comp, range(1, n + 1))
        for j in range(n):
            if sizes[j] < sizes.max() * .25:
                cx = np.nonzero(comp == j + 1)[1].mean()
                if not b0 <= cx <= b1:
                    lab[comp == j + 1] = 0
    return lab


def keep_main(alpha: np.ndarray) -> np.ndarray:
    """큰 덩어리(가장 큰 것의 5% 이상)만 남긴다 — 따로 떨어진 부스러기 제거."""
    lab, n = ndimage.label(alpha > 40)
    if n <= 1:
        return alpha
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * .05])
    keep = ndimage.binary_dilation(keep, iterations=2)  # 덩어리 둘레의 옅은 가장자리는 살린다
    return np.where(keep, alpha, 0).astype(np.uint8)


def local_bg(rgb: np.ndarray, alpha: np.ndarray, sigma: float = 6) -> np.ndarray:
    """픽셀마다 주변 배경색(전경이 아닌 곳의 가중 평균). 카드·패널마다 배경색이 달라도 가장자리 색을 정확히 뺀다."""
    w = (alpha < 8).astype(float)
    num = np.dstack([ndimage.gaussian_filter(rgb[..., c].astype(float) * w, sigma) for c in range(3)])
    den = ndimage.gaussian_filter(w, sigma)[..., None]
    glob = np.median(rgb[alpha < 8], axis=0) if (alpha < 8).any() else np.array([240, 238, 236])
    return np.where(den > 1e-3, num / np.maximum(den, 1e-3), glob)


def clean_rgba(rgb: np.ndarray, alpha: np.ndarray, bg: np.ndarray) -> np.ndarray:  # bg: 픽셀별 배경색(h, w, 3)
    """가장자리에 섞인 배경색을 없앤다(어두운 장면에서 흰 테두리·점무늬 방지).
    알파는 살짝 깎고 부드럽게 한 뒤, α ≥ .5 는 관측 = α·전경 + (1-α)·배경 으로 전경을 되살리고(오차 증폭 2배 이하),
    더 옅은 가장자리와 투명 영역은 가장 가까운 불투명 픽셀 색을 쓴다(필터링 시 검은·흰 테두리 방지)."""
    a = ndimage.gaussian_filter(alpha.astype(float) / 255, .5)
    a = np.clip((a - .12) / .88, 0, 1)
    f = rgb.astype(float)
    fa = np.maximum(a, .5)[..., None]
    fg = np.where((a > .98)[..., None], f, np.clip((f - (1 - fa) * bg) / fa, 0, 255))
    solid = a > .5
    if solid.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        fg = np.where(solid[..., None], fg, fg[iy, ix])
    return np.dstack([fg, a * 255]).round().astype(np.uint8)


def pack(frames, width):
    """프레임들을 한 장에 줄 단위로 놓는다. 높이는 2의 거듭제곱으로 올린다."""
    pad, x, y, rowh, pos = 2, 0, 0, 0, {}
    for key, img in frames:
        if x + img.width + pad > width:
            x, y, rowh = 0, y + rowh + pad, 0
        pos[key] = (x, y)
        x += img.width + pad
        rowh = max(rowh, img.height)
    h = 1
    while h < y + rowh:
        h *= 2
    atlas = Image.new("RGBA", (width, h), (0, 0, 0, 0))
    for key, img in frames:
        atlas.paste(img, pos[key])
    return atlas, pos


def main():
    sheet = Image.open(SHEET).convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"source": f"docs/ref/{SHEET.name}", "ppu": PPU, "chars": {}}
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for who, cx in COLS.items():
            body, faces, info = [], [], {}
            for kind, x0, y0, x1, y1, names in PANELS:
                panel = sheet.crop((cx + x0, y0, cx + x1, y1))
                rgb = np.array(panel)
                if kind == "face":  # 카드 가운데 위쪽의 정사각형(머리~턱) — 둥근 아바타용
                    edges = np.linspace(0, panel.width, len(names) + 1).astype(int)
                    for i, name in enumerate(names):
                        a0, a1 = int(edges[i]) + 3, int(edges[i + 1]) - 3
                        side = int((a1 - a0) * .9)
                        fx, fy = a0 + (a1 - a0 - side) // 2, int(panel.height * .1)
                        faces.append((name, panel.crop((fx, fy, fx + side, fy + side))))
                    continue
                alpha = fg_mask(panel, tmp)
                lab = split_geodesic(alpha, valley_edges(alpha, len(names)))
                bg = local_bg(rgb, alpha)
                for i, name in enumerate(names):
                    key = f"{kind}.{name}"
                    al = keep_main(np.where(lab == i + 1, alpha, 0).astype(np.uint8))
                    ys, xs = np.nonzero(al > 8)
                    if not len(xs):
                        print("빈 인물:", who, key, file=sys.stderr)
                        continue
                    for ex0, ey0, ex1, ey1 in ERASE.get((who, key), []):
                        al[ys.min() + ey0:ys.min() + ey1, xs.min() + ex0:xs.min() + ex1] = 0
                    ys, xs = np.nonzero(al > 8)
                    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
                    rgba = clean_rgba(rgb[by0:by1, bx0:bx1], al[by0:by1, bx0:bx1], bg[by0:by1, bx0:bx1])
                    img = Image.fromarray(rgba, "RGBA")
                    # 발(바닥에 닿는 부분) 중심: 아래 6% 줄의 알파 무게중심
                    foot = rgba[int(img.height * .94):, :, 3].astype(float)
                    ax = float((foot.sum(axis=0) * np.arange(img.width)).sum() / max(1, foot.sum()))
                    body.append((key, img))
                    info[key] = [round(ax, 1), round(PPU, 3)]
            atlas, pos = pack(body, 1024)
            atlas.save(OUT / f"{who}.png", optimize=True)
            fw = min(f.width for _, f in faces)
            strip = Image.new("RGB", (fw * len(faces), fw), (255, 255, 255))
            for i, (_, f) in enumerate(faces):
                strip.paste(f.resize((fw, fw), Image.LANCZOS), (i * fw, 0))
            strip.save(OUT / f"{who}-faces.png", optimize=True)
            meta["chars"][who] = {
                "atlas": f"sprites/{who}.png", "size": list(atlas.size),
                "frames": {k: [*pos[k], img.width, img.height, *info[k]] for k, img in body},
                "faces": {"src": f"sprites/{who}-faces.png", "size": fw, "names": [n for n, _ in faces]},
            }
            print(who, f"몸 {len(body)}장 {atlas.size}, 표정 {len(faces)}장")
    js = "/* scripts/sprites/cut.py 가 만든 파일 — 직접 고치지 말 것 */\nwindow.SPRITE_META = " + json.dumps(meta, ensure_ascii=False) + ";\n"
    (OUT / "sprites.js").write_text(js)
    old = OUT / "sprites.json"
    if old.exists():
        old.unlink()


if __name__ == "__main__":
    main()
