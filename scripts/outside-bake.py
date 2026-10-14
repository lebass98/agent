"""서버 없는 배포본(예: Vercel 정적 배포)에 바깥 풍경 지도를 넣는다.

  python scripts/outside-bake.py 배포폴더/web

cache/outside/place.json(설정의 '사무실 위치')과 받아 둔 지도로 <web>/outside/baked.json 을 만든다.
web/outside.js 는 서버가 없을 때(데모 모드) 이 파일을 읽는다. 실제 주소가 들어가므로 저장소의 web/ 에는 만들지 말 것(공개 저장소).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import outside  # noqa: E402

DEFAULT_W, DEFAULT_D = 32.0, 22.0  # web/decor.js 의 사무실 가로·세로(OW·OD)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    web = Path(sys.argv[1]).resolve()
    if web == (ROOT / "web").resolve():
        raise SystemExit("❌ 저장소의 web/ 에는 만들지 않습니다(실제 주소가 공개 저장소에 올라감). 배포용 복사본을 지정하세요.")
    cache = ROOT / "cache" / "outside"
    place = outside.load_place(cache)
    if not place:
        raise SystemExit("❌ 사무실 위치가 없습니다. 설정 '사무실 위치'에서 먼저 주소를 정하세요.")
    osm = outside.fetch_osm(place["lat"], place["lng"], place.get("r", 350), cache)
    scene = outside.build_scene(osm, place["lat"], place["lng"], place.get("r", 350), (DEFAULT_W, DEFAULT_D), place.get("turn", 0))
    out = web / "outside" / "baked.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"place": place, "map": scene}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✅ {out} ({out.stat().st_size // 1024} KB) — {place.get('label', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
