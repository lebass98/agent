"""바깥 풍경: 사무실 주소 주변의 건물·도로·공원·물길·철길을 OpenStreetMap 에서 받아 3D 용으로 다듬는다.

- 주소 → 좌표: Nominatim(OpenStreetMap 주소 검색). "37.48, 126.88" 처럼 좌표를 바로 넣어도 된다.
- 지도: Overpass API 로 반경 r 미터 안을 받는다. 받은 원본은 cache/outside/ 에 두어 다음부터는 인터넷 없이 쓴다.
- 결과 좌표는 사무실 기준 미터(사무실 가운데가 원점, x 오른쪽·z 앞쪽). 사무실이 들어 있는 건물(site)의 벽과
  사무실 벽이 나란하도록 지도를 rot 라디안 돌린다(rot=0 이면 +x 동쪽·+z 남쪽). 해 방향도 같은 rot 로 돌려야 맞다.
  회전은 three.js 의 y 축 회전과 같다: x' = x·cos + z·sin, z' = -x·sin + z·cos.
- 지도 데이터 © OpenStreetMap 기여자(ODbL). 화면에 출처를 띄운다.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = "AgentOffice/1.0 (multi-agent office web app)"  # Nominatim·Overpass 이용 정책: 앱을 밝히는 User-Agent
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
ATTRIBUTION = "© OpenStreetMap 기여자"
R_MIN, R_MAX = 100, 600
LEVEL = 3.3  # 층수만 있을 때 한 층 높이(m)


class OutsideError(Exception):
    """지도·주소 서버에 닿지 못했거나 응답이 이상할 때. 메시지는 사용자에게 그대로 보인다."""


def _http(url: str, data: bytes | None = None, timeout: float = 30) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept-Language": "ko"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # 고정된 https 주소만 연다
        return r.read()


# ── 주소 검색 ─────────────────────────────────────

_COORD = re.compile(r"\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?")


def parse_coords(text: str) -> tuple[float, float] | None:
    """'37.4814, 126.8839' 같은 위도·경도 입력이면 (lat, lng)."""
    m = _COORD.fullmatch((text or "").strip())
    if not m:
        return None
    lat, lng = float(m[1]), float(m[2])
    return (lat, lng) if -85 <= lat <= 85 and -180 <= lng <= 180 else None


def _label(x: dict) -> str:
    """Nominatim 결과 → '서울특별시 금천구 벚꽃로 298 (건물 이름)' 처럼 한국식 순서의 짧은 이름."""
    a = x.get("address") or {}
    head = a.get("city") or a.get("province") or a.get("state") or ""
    mid = a.get("borough") or a.get("county") or a.get("city_district") or a.get("town") or ""
    road = " ".join(p for p in (a.get("road"), a.get("house_number")) if p)
    text = " ".join(p for p in (head, mid, road) if p)
    name = x.get("name") or ""
    if name and name not in text:
        text = f"{text} ({name})" if text else name
    return text or str(x.get("display_name") or "")[:120]


def geocode(query: str, http=_http) -> list[dict]:
    """주소·장소 이름 → 후보(최대 5개). 좌표를 넣으면 그 좌표 1개. exact=False 는 도로·지역처럼 넓은 결과."""
    query = (query or "").strip()
    if not query:
        return []
    if c := parse_coords(query):
        return [{"lat": c[0], "lng": c[1], "label": f"{c[0]:.5f}, {c[1]:.5f}", "kind": "coords", "exact": True}]
    url = NOMINATIM + "?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": 5, "addressdetails": 1, "accept-language": "ko"})
    try:
        rows = json.loads(http(url, timeout=15))
    except Exception as e:  # 연결 실패·시간 초과·잘못된 응답
        raise OutsideError("주소 검색 서버(OpenStreetMap)에 연결하지 못했습니다. 인터넷 연결을 확인하세요.") from e
    out = []
    for x in rows if isinstance(rows, list) else []:
        try:
            lat, lng = float(x["lat"]), float(x["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        kind = str(x.get("category") or x.get("class") or "")
        out.append({"lat": round(lat, 6), "lng": round(lng, 6), "label": _label(x), "kind": kind,
                    "exact": kind not in ("highway", "boundary", "place", "landuse")})
    return out


# ── 지도 받기(Overpass) ───────────────────────────

def _mpd(lat: float) -> tuple[float, float]:
    """위도 lat 에서 위도 1도·경도 1도의 길이(m)."""
    p = math.radians(lat)
    return (111132.92 - 559.82 * math.cos(2 * p) + 1.175 * math.cos(4 * p),
            111412.84 * math.cos(p) - 93.5 * math.cos(3 * p))


def overpass_query(lat: float, lng: float, r: float) -> str:
    mlat, mlng = _mpd(lat)
    bb = f"{lat - r / mlat:.6f},{lng - r / mlng:.6f},{lat + r / mlat:.6f},{lng + r / mlng:.6f}"
    sel = (
        'way["building"]', 'relation["building"]["type"="multipolygon"]', 'way["building:part"]',
        'way["highway"]', 'way["railway"~"^(rail|subway|light_rail|tram|narrow_gauge|monorail)$"]',
        'way["natural"~"^(water|wood|scrub|grassland|heath|beach|sand)$"]', 'relation["natural"~"^(water|wood)$"]',
        'way["waterway"="riverbank"]', 'relation["waterway"="riverbank"]',
        'way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|reservoir|basin|cemetery|allotments|orchard|farmland)$"]',
        'relation["landuse"~"^(forest|grass|reservoir)$"]',
        'way["leisure"~"^(park|garden|pitch|playground|golf_course|track)$"]', 'relation["leisure"="park"]',
        'way["amenity"="parking"]', 'way["place"="square"]',
        'node["natural"="tree"]', 'node["highway"="crossing"]',
    )
    body = "".join(f"  {s}({bb});\n" for s in sel)
    return f"[out:json][timeout:90];\n(\n{body});\nout body geom qt;"


def fetch_osm(lat: float, lng: float, r: int, cache_dir: Path, http=_http) -> dict:
    """반경 r 미터의 지도 원본(Overpass JSON). 한 번 받으면 cache_dir 에 두고 다시 쓴다."""
    cache_dir = Path(cache_dir)
    key = hashlib.sha1(f"{lat:.5f},{lng:.5f},{int(r)}".encode()).hexdigest()[:16]
    f = cache_dir / f"osm-{key}.json"
    if f.is_file():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            f.unlink(missing_ok=True)
    data = urllib.parse.urlencode({"data": overpass_query(lat, lng, r)}).encode()
    errors = []
    for url in OVERPASS:  # 첫 서버가 바쁘면 다음 서버
        host = url.split("/")[2]
        try:
            osm = json.loads(http(url, data=data, timeout=120))
        except Exception as e:
            errors.append(f"{host}: {e}")
            continue
        remark = str(osm.get("remark") or "") if isinstance(osm, dict) else ""
        if isinstance(osm, dict) and isinstance(osm.get("elements"), list) and "error" not in remark.lower():
            break
        errors.append(f"{host}: {remark or '잘못된 응답'}")
    else:
        raise OutsideError("지도 서버(OpenStreetMap)에서 데이터를 받지 못했습니다. 잠시 뒤 다시 시도하세요. ("
                           + "; ".join(errors)[:300] + ")")
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(osm, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(f)
    return osm


# ── 사무실 위치(주소) 저장: 여러 기기(휴대폰 등)가 같은 위치를 쓰게 서버에 둔다 ──

def load_place(cache_dir: Path) -> dict | None:
    try:
        p = json.loads((Path(cache_dir) / "place.json").read_text(encoding="utf-8"))
        return p if isinstance(p, dict) else None
    except (OSError, ValueError):
        return None


def save_place(cache_dir: Path, place: dict | None) -> dict | None:
    f = Path(cache_dir) / "place.json"
    if place is None:
        f.unlink(missing_ok=True)
        return None
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(place, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    return place


# ── 기하 도구 (점은 (x, z) 튜플, 고리는 끝점을 되풀이하지 않는 점 목록) ──

def _num(v) -> float | None:
    """'83', '83 m', '12.5m', '40 ft' → 미터. 못 읽으면 None."""
    if v is None:
        return None
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?", str(v))
    if not m:
        return None
    x = float(m[1].replace(",", "."))
    return x * .3048 if m[2] in ("ft", "'") else x


def _area(ring) -> float:
    """부호 있는 넓이. 양수면 바깥 법선이 각 변 (dx, dz) 에 대해 (dz, -dx) 쪽이다."""
    return sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring))) / 2


def _centroid(ring) -> tuple[float, float]:
    a = cx = cz = 0.0
    for i in range(len(ring)):
        (x0, z0), (x1, z1) = ring[i - 1], ring[i]
        k = x0 * z1 - x1 * z0
        a += k
        cx += (x0 + x1) * k
        cz += (z0 + z1) * k
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return cx / (3 * a), cz / (3 * a)


def _inside(x: float, z: float, ring) -> bool:
    hit = False
    for i in range(len(ring)):
        (x0, z0), (x1, z1) = ring[i - 1], ring[i]
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            hit = not hit
    return hit


def _bbox(ring) -> tuple[float, float, float, float]:
    xs, zs = [p[0] for p in ring], [p[1] for p in ring]
    return min(xs), min(zs), max(xs), max(zs)


def _seg_dist(px, pz, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)


def _ring_dist(px, pz, ring) -> float:
    return 0.0 if _inside(px, pz, ring) else min(_seg_dist(px, pz, ring[i - 1], ring[i]) for i in range(len(ring)))


def _cross(a, b, c, d) -> bool:
    """선분 ab 와 cd 가 엇갈리나(끝점이 닿는 경우 포함)."""
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return (v > 1e-12) - (v < -1e-12)
    o1, o2, o3, o4 = o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)
    return o1 != o2 and o3 != o4 or (o1 == o2 == o3 == o4 == 0 and max(a[0], b[0]) >= min(c[0], d[0])
                                     and max(c[0], d[0]) >= min(a[0], b[0]) and max(a[1], b[1]) >= min(c[1], d[1])
                                     and max(c[1], d[1]) >= min(a[1], b[1]))


def _hits_rect(ring, hx: float, hz: float) -> bool:
    """고리가 가운데 직사각형(-hx..hx, -hz..hz)과 겹치나."""
    x0, z0, x1, z1 = _bbox(ring)
    if x1 < -hx or x0 > hx or z1 < -hz or z0 > hz:
        return False
    if any(-hx <= x <= hx and -hz <= z <= hz for x, z in ring):
        return True
    rect = ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz))
    if any(_inside(x, z, ring) for x, z in rect):
        return True
    return any(_cross(ring[i - 1], ring[i], rect[j - 1], rect[j]) for i in range(len(ring)) for j in range(4))


def _orient(ring) -> float:
    """벽들의 주된 방향(라디안, -45°~45°): 변의 각을 4배 해 길이 가중 평균(직각인 벽들이 한 방향으로 모인다)."""
    sx = sy = 0.0
    for i in range(len(ring)):
        dx, dz = ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]
        L = math.hypot(dx, dz)
        if L > 1e-6:
            a = 4 * math.atan2(dz, dx)
            sx += L * math.cos(a)
            sy += L * math.sin(a)
    return math.atan2(sy, sx) / 4


def _clean(pts, closed: bool) -> list:
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > .05 or abs(p[1] - out[-1][1]) > .05:
            out.append(p)
    if closed and len(out) > 1 and abs(out[0][0] - out[-1][0]) <= .05 and abs(out[0][1] - out[-1][1]) <= .05:
        out.pop()
    return out


def _clip_poly(ring, clip) -> list:
    """Sutherland–Hodgman: 볼록 다각형 clip(넓이 양수) 안쪽만 남긴다."""
    out = list(ring)
    for i in range(len(clip)):
        if not out:
            break
        (ax, az), (bx, bz) = clip[i - 1], clip[i]
        side = [(bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax) for p in out]
        nxt = []
        for j in range(len(out)):
            p, q, sp, sq = out[j - 1], out[j], side[j - 1], side[j]
            if (sq >= 0) != (sp >= 0):
                t = sp / (sp - sq)
                nxt.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
            if sq >= 0:
                nxt.append(q)
        out = nxt
    return out if len(out) >= 3 else []


def _clip_line(pts, ids, rc: float) -> list[tuple[list, list]]:
    """원점 중심 반지름 rc 원 안의 구간들로 자른다 → [(점들, 노드 id 들)]. 잘린 끝점의 id 는 None."""
    r2 = rc * rc
    pieces, cur, cid = [], [], []

    def roots(q, p):
        dx, dz = p[0] - q[0], p[1] - q[1]
        a, b, c = dx * dx + dz * dz, 2 * (q[0] * dx + q[1] * dz), q[0] ** 2 + q[1] ** 2 - r2
        disc = b * b - 4 * a * c
        if a == 0 or disc <= 0:
            return None
        s = math.sqrt(disc)
        return (-b - s) / (2 * a), (-b + s) / (2 * a)

    def at(q, p, t):
        return q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t

    for i, p in enumerate(pts):
        pin = p[0] ** 2 + p[1] ** 2 <= r2
        if i == 0:
            if pin:
                cur, cid = [p], [ids[i]]
            continue
        q = pts[i - 1]
        qin = q[0] ** 2 + q[1] ** 2 <= r2
        if qin and pin:
            cur.append(p)
            cid.append(ids[i])
        elif qin:
            t = roots(q, p)
            cur.append(at(q, p, t[1]) if t else p)
            cid.append(None)
            if len(cur) >= 2:
                pieces.append((cur, cid))
            cur, cid = [], []
        elif pin:
            t = roots(q, p)
            cur, cid = [at(q, p, t[0]) if t else q, p], [None, ids[i]]
        else:
            t = roots(q, p)
            if t and 0 < t[0] < t[1] < 1:
                pieces.append(([at(q, p, t[0]), at(q, p, t[1])], [None, None]))
    if len(cur) >= 2:
        pieces.append((cur, cid))
    return pieces


def _join(parts: list[list]) -> list[list]:
    """멀티폴리곤의 길(way) 조각들을 끝점끼리 이어 닫힌 고리로(끝점 되풀이 포함). 닫히지 않는 조각은 버린다."""
    rings, open_ = [], []
    for s in parts:
        if len(s) >= 2:
            (rings if s[0] == s[-1] else open_).append(list(s))
    while open_:
        cur = open_.pop()
        grown = True
        while grown and cur[0] != cur[-1]:
            grown = False
            for i, s in enumerate(open_):
                if cur[-1] == s[0]:
                    cur = cur + s[1:]
                elif cur[-1] == s[-1]:
                    cur = cur + s[-2::-1]
                elif cur[0] == s[-1]:
                    cur = s[:-1] + cur
                elif cur[0] == s[0]:
                    cur = s[:0:-1] + cur
                else:
                    continue
                del open_[i]
                grown = True
                break
        if cur[0] == cur[-1]:
            rings.append(cur)
    return [r for r in rings if len(r) >= 4]


# ── 분류 ──────────────────────────────────────────

_BCLASS = (
    ("r", {"house", "detached", "semidetached_house", "residential", "apartments", "terrace", "dormitory",
           "bungalow", "cabin", "farm", "villa"}),
    ("c", {"commercial", "office", "retail", "hotel", "supermarket", "mall", "kiosk", "shop", "bank"}),
    ("p", {"school", "university", "college", "kindergarten", "hospital", "public", "government", "civic", "church",
           "temple", "shrine", "chapel", "cathedral", "mosque", "train_station", "transportation", "fire_station",
           "police", "townhall", "library", "museum", "sports_hall", "stadium"}),
    ("i", {"industrial", "warehouse", "factory", "manufacture", "garage", "garages", "shed", "service",
           "storage_tank", "hangar", "parking", "carport", "roof", "transformer_tower", "greenhouse"}),
)
_SMALL = {"garage", "garages", "shed", "hut", "kiosk", "carport", "roof", "toilets", "service", "transformer_tower",
          "greenhouse", "container"}


def _levels_guess(kind: str, area: float, seed: int) -> int:
    """층수 정보가 없는 건물: 종류와 바닥 넓이로 그럴듯한 층수(같은 건물은 늘 같은 값)."""
    u = (seed % 1000) / 1000
    if kind in _SMALL:
        return 1
    if kind in ("house", "detached", "semidetached_house", "bungalow", "cabin", "farm"):
        return 1 + (u > .5)
    if kind == "apartments":
        return 4 + int(u * 3) if area < 600 else 12 + int(u * 14)
    if kind in ("church", "temple", "chapel"):
        return 2
    for lim, lo, hi in ((80, 1, 2), (200, 2, 4), (500, 3, 6), (1500, 4, 9), (4000, 6, 14), (math.inf, 8, 20)):
        if area < lim:
            return lo + int(u * (hi - lo + 1))
    return 3


def _building_height(t: dict, area: float, seed: int) -> tuple[float, float, int]:
    """(지붕 높이, 바닥 높이, 층수). 높이 > 층수 > 짐작 순서."""
    kind = t.get("building") if t.get("building") not in (None, "yes") else t.get("building:part") or "yes"
    lv = _num(t.get("building:levels"))
    h = _num(t.get("height"))
    if lv is None and h is not None:
        lv = max(1, round(h / LEVEL))
    if h is None:
        if lv is None:
            lv = _levels_guess(kind, area, seed)
        h = (lv + (_num(t.get("roof:levels")) or 0)) * LEVEL + (.6 if lv > 1 else 0)
    b = _num(t.get("min_height"))
    if b is None and (ml := _num(t.get("building:min_level"))):
        b = ml * LEVEL
    if b is None and kind == "roof":  # 주유소 지붕 같은 차양: 기둥 없이 얇은 판
        b = max(0.0, h - .8)
    h = min(max(h, 2.5), 700.0)
    b = min(max(b or 0.0, 0.0), h - .5)
    return h, b, int(lv or 1)


def _building_class(t: dict) -> str:
    kind = t.get("building") if t.get("building") not in (None, "yes") else t.get("building:part")
    for k, names in _BCLASS:
        if kind in names:
            return k
    return "g"


# 도로 종류: (내보내는 이름, 양방향 기본 폭 m, 차가 다니나)
ROAD = {
    "motorway": ("motorway", 14, 1), "trunk": ("trunk", 16, 1), "primary": ("primary", 14, 1),
    "secondary": ("secondary", 11, 1), "tertiary": ("tertiary", 9, 1),
    "motorway_link": ("link", 6, 1), "trunk_link": ("link", 6, 1), "primary_link": ("link", 6, 1),
    "secondary_link": ("link", 6, 1), "tertiary_link": ("link", 6, 1),
    "unclassified": ("minor", 6, 1), "residential": ("minor", 6, 1), "road": ("minor", 6, 1), "busway": ("minor", 7, 1),
    "living_street": ("living", 5, 1), "service": ("service", 4, 1),
    "pedestrian": ("ped", 5, 0), "footway": ("foot", 2, 0), "path": ("foot", 1.6, 0), "bridleway": ("foot", 2, 0),
    "cycleway": ("cycle", 2, 0), "steps": ("steps", 2, 0), "track": ("track", 3, 0),
}
_DRIVE_SKIP = {"parking_aisle", "driveway", "drive-through", "emergency_access"}


def _area_kind(t: dict) -> str | None:
    n, lu, le = t.get("natural"), t.get("landuse"), t.get("leisure")
    if n == "water" or t.get("waterway") == "riverbank" or lu in ("reservoir", "basin"):
        return "water"
    if n in ("wood", "scrub") or lu == "forest":
        return "wood"
    if le == "pitch":
        return "pitch"
    if le == "track":
        return "track"
    if le in ("park", "garden", "playground", "golf_course") or n in ("grassland", "heath") or lu in (
            "grass", "meadow", "recreation_ground", "village_green", "cemetery", "allotments", "orchard"):
        return "park"
    if n in ("beach", "sand"):
        return "sand"
    if lu == "farmland":
        return "farm"
    if t.get("amenity") == "parking":
        return None if "building" in t or t.get("parking") in ("underground", "multi-storey", "rooftop") else "parking"
    if t.get("place") == "square" or (t.get("highway") in ("pedestrian", "footway") and t.get("area") == "yes"):
        return "plaza"
    return None


def _flat(ring) -> list[float]:
    return [round(v, 1) for p in ring for v in p]


# ── 장면 만들기 ───────────────────────────────────

def build_scene(osm: dict, lat: float, lng: float, r: float, office=(32.0, 22.0), turn: int = 0) -> dict:
    """Overpass 원본 → 사무실 기준 3D 장면 데이터(건물·도로·면·철길·나무·횡단보도). 형식은 web/outside.js 머리말."""
    mlat, mlng = _mpd(lat)

    def proj(g) -> tuple[float, float]:  # 위경도 → 지도 미터(x 동쪽, z 남쪽)
        return (g[1] - lng) * mlng, (lat - g[0]) * mlat

    def geom(el) -> list:
        return [(g["lat"], g["lon"]) for g in el.get("geometry") or () if g]

    def polys(el) -> list[tuple[list, list]]:
        """way·멀티폴리곤 → [(바깥 고리, [구멍...])] (위경도, 끝점 되풀이)"""
        if el["type"] == "way":
            g = geom(el)
            return [(g, [])] if len(g) >= 4 and g[0] == g[-1] else []
        ways = [m for m in el.get("members") or () if m.get("type") == "way"]
        outers = _join([geom(m) for m in ways if m.get("role") in ("outer", "")])
        inners = _join([geom(m) for m in ways if m.get("role") == "inner"])
        out = [(o, []) for o in outers]
        for h in inners:
            for o, holes in out:
                if _inside(h[0][0], h[0][1], o):
                    holes.append(h)
                    break
        return out

    def ring_of(g, sign) -> list:  # 위경도 고리 → 지도 미터 고리(방향 맞춤: 바깥 +1, 구멍 -1)
        ring = _clean([proj(p) for p in g], True)
        if len(ring) >= 3 and _area(ring) * sign < 0:
            ring.reverse()
        return ring if len(ring) >= 3 else []

    # 1) 건물 윤곽·부분(지도 좌표)
    blds = []
    for el in osm.get("elements") or ():
        t = el.get("tags") or {}
        part = "building:part" in t and "building" not in t
        if el["type"] not in ("way", "relation") or not (part or ("building" in t)) or \
                (t.get("building") or t.get("building:part")) in ("no", "construction", "proposed", "demolished", "abandoned", "ruins"):
            continue
        if t.get("location") == "underground" or (_num(t.get("layer")) or 0) < 0 and t.get("building") == "roof":
            continue
        seed = (int(el["id"]) * 2654435761) & 0xFFFFFFFF
        for outer, holes in polys(el):
            o = ring_of(outer, 1)
            if not o:
                continue
            area = _area(o)
            h, b, lv = _building_height(t, area, seed)
            blds.append({"o": o, "i": [x for x in (ring_of(hh, -1) for hh in holes) if x], "h": h, "b": b, "lv": lv,
                         "k": _building_class(t), "s": seed % 997, "part": part, "a": area, "c": _centroid(o),
                         "bb": _bbox(o)})
    # 부분(building:part)이 넓이의 절반 넘게 채운 윤곽은 그리지 않는다(부분들이 대신 높이를 나타낸다)
    parts = [x for x in blds if x["part"]]
    if parts:
        for x in blds:
            if x["part"]:
                continue
            x0, z0, x1, z1 = x["bb"]
            cover = sum(p["a"] for p in parts if x0 <= p["c"][0] <= x1 and z0 <= p["c"][1] <= z1
                        and _inside(p["c"][0], p["c"][1], x["o"]))
            if cover >= .5 * x["a"]:
                x["skip"] = True
    blds = [x for x in blds if not x.get("skip")]

    # 2) 사무실이 들어 있는 건물(site): 주소 점을 품은 가장 작은 윤곽, 없으면 30m 안의 가장 가까운 윤곽
    outlines = [x for x in blds if not x["part"]]
    hits = [x for x in outlines if _inside(0.0, 0.0, x["o"])]
    site = min(hits, key=lambda x: x["a"]) if hits else None
    if site is None:
        near = sorted(((_ring_dist(0.0, 0.0, x["o"]), id(x), x) for x in outlines), key=lambda v: v[:2])
        site = near[0][2] if near and near[0][0] <= 30 else None
    ox, oz = site["c"] if site else (0.0, 0.0)
    rot = 0.0
    if site:
        rot = _orient(site["o"])
        c, s = math.cos(rot), math.sin(rot)
        xs = [(x - ox) * c + (z - oz) * s for x, z in site["o"]]
        zs = [-(x - ox) * s + (z - oz) * c for x, z in site["o"]]
        if max(zs) - min(zs) > (max(xs) - min(xs)) * 1.15:  # 건물의 긴 쪽을 사무실의 긴 쪽(x)에 맞춘다
            rot += -math.pi / 2 if rot > 0 else math.pi / 2
    rot = math.remainder(rot + (turn % 4) * math.pi / 2, 2 * math.pi)
    c, s = math.cos(rot), math.sin(rot)

    def tf(p) -> tuple[float, float]:  # 지도 미터 → 사무실 좌표
        x, z = p[0] - ox, p[1] - oz
        return x * c + z * s, -x * s + z * c

    w, d = office
    hx, hz = w / 2 + .6, d / 2 + .6
    rc = float(r)
    clip = [(rc * 1.03 * math.cos(a), rc * 1.03 * math.sin(a)) for a in (i * math.tau / 64 for i in range(64))]

    # 3) 건물: 사무실 직사각형과 겹치는 것(site 포함)은 빼고, 가운데가 원 안인 것만
    buildings, site_out = [], None
    if site:
        so = [tf(p) for p in site["o"]]
        site_out = {"p": _flat(so), "h": round(site["h"], 1), "lv": site["lv"]}
    for x in blds:
        if x is site:
            continue
        o = [tf(p) for p in x["o"]]
        cx, cz = tf(x["c"])
        if cx * cx + cz * cz > rc * rc or _hits_rect(o, hx, hz):
            continue
        rec = {"h": round(x["h"], 1), "k": x["k"], "s": x["s"], "p": _flat(o)}
        if x["b"] > 0:
            rec["b"] = round(x["b"], 1)
        if x["i"]:
            rec["i"] = [_flat([tf(p) for p in hole]) for hole in x["i"]]
        buildings.append(rec)

    # 4) 도로·철길(선): 사무실 좌표로 옮겨 원 안만. 차 길은 교차점(노드 공유) 번호를 붙인다
    roads, rails, cross_ways, cross_nodes = [], [], [], {}
    for el in osm.get("elements") or ():
        t = el.get("tags") or {}
        if el["type"] != "way":
            continue
        g = el.get("geometry") or []
        ids = el.get("nodes") or [None] * len(g)
        pts_ids = [(tf(proj((p["lat"], p["lon"]))), n) for p, n in zip(g, ids) if p]
        if len(pts_ids) < 2:
            continue
        pts, nids = [p for p, _ in pts_ids], [n for _, n in pts_ids]
        tunnel = t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("indoor") == "yes" \
            or (_num(t.get("level")) or 0) < 0
        if "highway" in t:
            hw = t["highway"]
            if hw not in ROAD or tunnel or t.get("area") == "yes":
                continue
            kind, w0, car = ROAD[hw]
            if hw == "footway" and t.get("footway") == "crossing":
                cross_ways.append((pts, nids))
                continue
            if hw == "footway" and t.get("footway") == "sidewalk":
                kind = "walk"
            ow = t.get("oneway")
            oneway = 1 if ow in ("yes", "true", "1") or t.get("junction") == "roundabout" or (
                hw.startswith("motorway") and ow != "no") else -1 if ow == "-1" else 0
            if hw == "service" and t.get("service") in _DRIVE_SKIP:
                car, w0 = 0, 3.5
            lanes = _num(t.get("lanes"))
            width = _num(t.get("width"))
            if width is None:
                width = lanes * 3.2 + (.5 if oneway else 1) if lanes and car else w0 * (.6 if oneway and car else 1)
            rec = {"k": kind, "w": round(min(max(width, 1.2), 50.0), 1), "o": oneway, "c": car,
                   "l": int(lanes or 0), "y": int(_num(t.get("layer")) or 0) + (1 if t.get("bridge") not in (None, "no") else 0)}
            for piece, pid in _clip_line(pts, nids, rc):
                roads.append({**rec, "p": _flat(piece), "_ids": pid})
        elif "railway" in t:
            if tunnel or (_num(t.get("layer")) or 0) < 0:
                continue
            for piece, _ in _clip_line(pts, nids, rc):
                rails.append({"k": t["railway"], "p": _flat(piece)})

    # 교차점: 둘 이상의 차 길이 함께 쓰는 노드 → 1부터 번호
    uses: dict[int, int] = {}
    for rd in roads:
        if rd["c"]:
            for n in {n for n in rd["_ids"] if n is not None}:
                uses[n] = uses.get(n, 0) + 1
    jid = {n: i + 1 for i, n in enumerate(sorted(n for n, k in uses.items() if k >= 2))}
    where: dict[int, tuple[dict, int]] = {}  # 노드 → (차 길, 점 번호): 횡단보도 방향 계산용
    for rd in roads:
        ids = rd.pop("_ids")
        if not rd["c"]:
            continue
        rd["j"] = [[i, jid[n]] for i, n in enumerate(ids) if n in jid]
        for i, n in enumerate(ids):
            if n is not None and n not in where:
                where[n] = (rd, i)
    roads.sort(key=lambda rd: (rd["y"], rd["c"], rd["w"]))

    # 5) 면(물·공원·숲·운동장·주차장·광장): 원 모양으로 잘라서
    areas = []
    for el in osm.get("elements") or ():
        t = el.get("tags") or {}
        if el["type"] == "node" or "building" in t:
            continue
        kind = _area_kind(t)
        if not kind:
            continue
        for outer, holes in polys(el):
            o = ring_of(outer, 1)
            o = _clip_poly([tf(p) for p in o], clip) if o else []
            if len(o) < 3 or abs(_area(o)) < 4:
                continue
            rec = {"k": kind, "p": _flat(o)}
            hs = [hh for hh in (_clip_poly([tf(p) for p in ring_of(h, -1)][::-1], clip)[::-1] for h in holes) if len(hh) >= 3]
            if hs:
                rec["i"] = [_flat(hh) for hh in hs]
            areas.append(rec)
    order = {"farm": 0, "wood": 1, "park": 2, "sand": 3, "water": 4, "parking": 5, "plaza": 6, "pitch": 7, "track": 8}
    areas.sort(key=lambda a: order[a["k"]])

    # 6) 나무·횡단보도
    trees, crossings, cross_ids = [], [], set()
    for pts, nids in cross_ways:  # 횡단보도 길: 걷는 방향과 길이
        a, b = pts[0], pts[-1]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if 2 < L < 60 and (a[0] ** 2 + a[1] ** 2) <= rc * rc:
            crossings.append([round((a[0] + b[0]) / 2, 1), round((a[1] + b[1]) / 2, 1),
                              round(math.atan2(b[1] - a[1], b[0] - a[0]), 3), round(L, 1)])
            cross_ids.update(n for n in nids if n is not None)
    for el in osm.get("elements") or ():
        if el["type"] != "node":
            continue
        t = el.get("tags") or {}
        x, z = tf(proj((el["lat"], el["lon"])))
        if x * x + z * z > rc * rc:
            continue
        if t.get("natural") == "tree":
            trees += [round(x, 1), round(z, 1)]
        elif t.get("highway") == "crossing" and el["id"] not in cross_ids and el["id"] in where:
            rd, i = where[el["id"]]
            p = rd["p"]
            n = len(p) // 2
            i0, i1 = max(0, i - 1), min(n - 1, i + 1)
            road_dir = math.atan2(p[i1 * 2 + 1] - p[i0 * 2 + 1], p[i1 * 2] - p[i0 * 2])
            crossings.append([round(x, 1), round(z, 1), round(road_dir + math.pi / 2, 3), rd["w"]])

    return {
        "v": 1, "lat": lat, "lng": lng, "r": r, "rot": round(rot, 5), "office": {"w": w, "d": d}, "site": site_out,
        "buildings": buildings, "roads": roads, "areas": areas, "rails": rails, "trees": trees, "crossings": crossings,
        "attribution": ATTRIBUTION,
    }
