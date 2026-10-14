"""바깥 풍경(server/outside.py): 주소 검색 · 지도 받기(캐시·예비 서버) · 장면 다듬기 · API."""
import json
import math

import pytest

from server import outside

LAT, LNG = 37.5665, 126.978  # 시험용 공공 좌표(서울시청 부근). 건물·길은 모두 가짜
MLAT, MLNG = outside._mpd(LAT)


def ll(x: float, z: float) -> dict:
    """지도 미터(x 동쪽·z 남쪽) → Overpass geometry 점"""
    return {"lat": LAT - z / MLAT, "lon": LNG + x / MLNG}


def way(id_: int, tags: dict, pts: list, nodes: list | None = None) -> dict:
    return {"type": "way", "id": id_, "tags": tags, "nodes": nodes or [id_ * 100 + i for i in range(len(pts))],
            "geometry": [ll(x, z) for x, z in pts]}


def rect(cx, cz, w, d, ang=0.0) -> list:
    c, s = math.cos(ang), math.sin(ang)
    pts = [(cx + a * c - b * s, cz + a * s + b * c) for a, b in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    return pts + pts[:1]


def sample_osm() -> dict:
    return {"elements": [
        way(1, {"building": "office", "building:levels": "10"}, rect(0, 0, 60, 30, .3)),       # 사무실이 든 건물(30°쯤 돌아감)
        way(2, {"building": "yes", "height": "12 m"}, rect(80, 0, 20, 20)),                    # 이웃
        way(3, {"building": "yes"}, rect(5, 3, 4, 4)),                                          # 사무실 자리와 겹침 → 뺀다
        way(4, {"building": "yes"}, rect(500, 0, 10, 10)),                                      # 반경 밖 → 뺀다
        way(5, {"highway": "residential"}, [(-150, 40), (-50, 40), (0, 40), (150, 40)], [11, 12, 13, 14]),
        way(6, {"highway": "tertiary", "oneway": "yes", "lanes": "2"}, [(0, 40), (0, 150)], [13, 15]),
        way(7, {"highway": "primary", "tunnel": "yes"}, [(-100, -30), (100, -30)]),           # 지하 → 뺀다
        way(8, {"leisure": "park"}, rect(-80, -80, 40, 40)),
        way(9, {"railway": "rail"}, [(-400, -100), (400, -100)]),
        {"type": "node", "id": 12, "lat": ll(-50, 40)["lat"], "lon": ll(-50, 40)["lon"], "tags": {"highway": "crossing"}},
        {"type": "node", "id": 99, "lat": ll(30, -60)["lat"], "lon": ll(30, -60)["lon"], "tags": {"natural": "tree"}},
    ]}


def test_parse_coords():
    assert outside.parse_coords("37.4814, 126.8839") == (37.4814, 126.8839)
    assert outside.parse_coords("(37.5 127)") == (37.5, 127.0)
    assert outside.parse_coords("서울 중구 세종대로 110") is None
    assert outside.parse_coords("95, 10") is None


def test_geocode_labels_and_coords():
    seen = []

    def http(url, data=None, timeout=0):
        seen.append(url)
        return json.dumps([
            {"lat": "37.5", "lon": "127.0", "category": "building", "name": "시험타워",
             "address": {"city": "서울특별시", "borough": "중구", "road": "세종대로", "house_number": "110"}},
            {"lat": "37.6", "lon": "127.1", "category": "highway", "address": {"road": "세종대로"}},
            {"lat": "x", "lon": "1"},
        ]).encode()

    hits = outside.geocode("세종대로 110", http=http)
    assert [h["label"] for h in hits] == ["서울특별시 중구 세종대로 110 (시험타워)", "세종대로"]
    assert hits[0]["exact"] is True and hits[1]["exact"] is False
    assert "accept-language=ko" in seen[0]
    # 좌표 입력은 인터넷 없이 그대로
    assert outside.geocode("37.5, 127", http=lambda *a, **k: pytest.fail("검색하면 안 된다"))[0]["lat"] == 37.5


def test_geocode_error():
    def down(*a, **k):
        raise OSError("down")
    with pytest.raises(outside.OutsideError):
        outside.geocode("세종대로", http=down)


def test_fetch_osm_falls_back_and_caches(tmp_path):
    seen = []

    def http(url, data=None, timeout=0):
        seen.append(url)
        if len(seen) == 1:
            raise OSError("504 Gateway Timeout")
        if len(seen) == 2:
            return b'{"elements": [], "remark": "runtime error: Query timed out"}'
        return b'{"elements": [{"type": "node", "id": 1}]}'

    a = outside.fetch_osm(LAT, LNG, 200, tmp_path, http=http)
    assert a["elements"] and seen == list(outside.OVERPASS)
    b = outside.fetch_osm(LAT, LNG, 200, tmp_path, http=lambda *x, **k: pytest.fail("캐시를 써야 한다"))
    assert b == a


def test_fetch_osm_all_fail(tmp_path):
    def down(*a, **k):
        raise OSError("down")
    with pytest.raises(outside.OutsideError, match="지도 서버"):
        outside.fetch_osm(LAT, LNG, 200, tmp_path, http=down)
    assert not list(tmp_path.glob("osm-*.json"))


def test_build_scene():
    sc = outside.build_scene(sample_osm(), LAT, LNG, 200)
    # 사무실이 든 건물: 높이(10층)와 방향(벽이 사무실 축에 나란하게 30° 돌린다)
    assert sc["site"]["lv"] == 10 and sc["site"]["h"] == pytest.approx(33.6)
    assert sc["rot"] == pytest.approx(.3, abs=1e-3)
    xs, zs = sc["site"]["p"][0::2], sc["site"]["p"][1::2]
    assert max(xs) - min(xs) == pytest.approx(60, abs=.3) and max(zs) - min(zs) == pytest.approx(30, abs=.3)
    # 건물: 겹치는 것·반경 밖은 빼고 이웃만, 바깥 고리는 넓이 양수
    assert [(b["h"], b["k"]) for b in sc["buildings"]] == [(12.0, "g")]
    p = sc["buildings"][0]["p"]
    assert outside._area(list(zip(p[0::2], p[1::2]))) > 0
    # 길: 지하는 빼고, 교차점(노드 13)은 두 길이 같은 번호를 쓴다
    roads = {r["k"]: r for r in sc["roads"]}
    assert set(roads) == {"minor", "tertiary"}
    assert roads["tertiary"]["o"] == 1 and roads["tertiary"]["w"] == pytest.approx(6.9)
    ja = {j for _, j in roads["minor"]["j"]}
    assert ja and ja == {j for _, j in roads["tertiary"]["j"]}
    # 횡단보도(노드 12): 지도 (-50, 40) 을 사무실 좌표로 옮긴 자리. 걷는 방향은 길(지도에서 동쪽 → 사무실에서 -0.3)에 수직, 길이는 길 폭
    (cx, cz, ang, L), = sc["crossings"]
    c, s = math.cos(.3), math.sin(.3)
    assert (cx, cz) == (pytest.approx(-50 * c + 40 * s, abs=.15), pytest.approx(50 * s + 40 * c, abs=.15))
    assert abs(math.sin(ang - (math.pi / 2 - .3))) < .02 and L == roads["minor"]["w"] == 6
    assert len(sc["trees"]) == 2 and [a["k"] for a in sc["areas"]] == ["park"]
    # 철길은 반경 안으로 잘린다
    (rail,) = sc["rails"]
    assert all(math.hypot(x, z) <= 200.5 for x, z in zip(rail["p"][0::2], rail["p"][1::2]))
    assert sc["attribution"].startswith("©")


def test_build_scene_turn_and_no_site():
    base = outside.build_scene(sample_osm(), LAT, LNG, 200)
    turned = outside.build_scene(sample_osm(), LAT, LNG, 200, turn=1)
    assert turned["rot"] == pytest.approx(math.remainder(base["rot"] + math.pi / 2, math.tau), abs=1e-4)
    empty = outside.build_scene({"elements": []}, LAT, LNG, 200)
    assert empty["site"] is None and empty["rot"] == 0 and empty["buildings"] == []


def test_outside_api(make_client, monkeypatch):
    monkeypatch.setattr(outside, "fetch_osm", lambda lat, lng, r, cache_dir, http=None: sample_osm())
    monkeypatch.setattr(outside, "geocode", lambda q, http=None: [{"lat": LAT, "lng": LNG, "label": q, "kind": "building", "exact": True}])
    with make_client() as c:
        assert c.get("/api/outside/geocode", params={"q": "  "}).status_code == 400
        assert c.get("/api/outside/geocode", params={"q": "세종대로 110"}).json()["results"][0]["label"] == "세종대로 110"
        r = c.get("/api/outside/map", params={"lat": LAT, "lng": LNG, "r": 200})
        assert r.status_code == 200 and r.json()["site"] and len(r.json()["buildings"]) == 1
        assert c.get("/api/outside/map", params={"lat": 100, "lng": 0}).status_code == 400
        assert c.get("/api/outside/map", params={"lat": LAT, "lng": LNG, "r": 5000}).status_code == 400
        # 사무실 위치: 저장·읽기·지우기
        assert c.get("/api/outside/place").json() == {"place": None}
        body = {"lat": LAT, "lng": LNG, "label": "시험 위치", "floor": 3, "show": True}
        assert c.put("/api/outside/place", json=body).json()["place"]["floor"] == 3
        assert c.get("/api/outside/place").json()["place"]["label"] == "시험 위치"
        assert c.put("/api/outside/place", json={**body, "floor": 0}).status_code == 422
        assert c.delete("/api/outside/place").json() == {"place": None}
        assert c.get("/api/outside/place").json() == {"place": None}


def test_outside_api_upstream_error(make_client, monkeypatch):
    def fail(*a, **k):
        raise outside.OutsideError("지도 서버(OpenStreetMap)에서 데이터를 받지 못했습니다.")
    monkeypatch.setattr(outside, "fetch_osm", fail)
    monkeypatch.setattr(outside, "geocode", fail)
    with make_client() as c:
        r = c.get("/api/outside/map", params={"lat": LAT, "lng": LNG})
        assert r.status_code == 502 and "OpenStreetMap" in r.json()["detail"]
        assert c.get("/api/outside/geocode", params={"q": "세종대로"}).status_code == 502


def test_outside_api_needs_key(make_client):
    with make_client(access_key="s3cret") as c:
        assert c.get("/api/outside/place").status_code == 401
        assert c.get("/api/outside/place", headers={"X-Access-Key": "s3cret"}).status_code == 200
