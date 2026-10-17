"""개발 모드: 정적 파일 캐시 금지, livereload 스크립트 삽입, web/ 변경 → reload 신호."""
import asyncio

from server.app import DevReload


def test_dev_mode_off_by_default(make_client):
    with make_client() as c:
        r = c.get("/")
        assert "livereload" not in r.text
        assert r.headers.get("cache-control") != "no-store"
        assert c.get("/__dev/livereload.js").status_code == 404


def test_non_dev_static_files_revalidate(make_client, tmp_path):
    """개발 모드가 아니면 web/ 정적 파일은 no-cache(매번 재검증, 그대로면 304). API 는 건드리지 않는다."""
    (tmp_path / "web" / "app.js").write_text("// v1", encoding="utf-8")
    with make_client() as c:
        for path in ("/", "/index.html", "/app.js"):
            r = c.get(path)
            assert r.status_code == 200
            assert r.headers["cache-control"] == "no-cache"
        r = c.get("/app.js")
        assert r.headers.get("etag") and r.headers.get("last-modified")
        again = c.get("/app.js", headers={"If-None-Match": r.headers["etag"]})
        assert again.status_code == 304
        assert again.headers["cache-control"] == "no-cache"
        assert "cache-control" not in c.get("/api/team").headers


def test_dev_index_injects_script_and_no_store(make_client, tmp_path):
    (tmp_path / "web" / "app.js").write_text("// v1", encoding="utf-8")
    with make_client(dev=True) as c:
        r = c.get("/")
        assert r.status_code == 200
        assert '<script src="/__dev/livereload.js"></script>' in r.text
        assert r.headers["cache-control"] == "no-store"
        assert c.get("/index.html").text == r.text
        js = c.get("/__dev/livereload.js")
        assert js.status_code == 200 and "/__dev/ws" in js.text
        assert c.get("/app.js").headers["cache-control"] == "no-store"  # 정적 파일도 캐시 금지(no-cache 를 덮어씀)
        assert c.get("/api/team").headers["cache-control"] == "no-store"


def test_dev_ws_hello_and_reload(make_client):
    with make_client(dev=True) as c:
        with c.websocket_connect("/__dev/ws") as ws:  # 접속 키가 있어도 개발 채널은 키 없이 열린다
            hello = ws.receive_json()
            assert hello["type"] == "hello" and len(hello["boot"]) == 8
            c.app.state.dev.notify(["app.js", "style.css"])
            assert ws.receive_json() == {"type": "reload", "files": ["app.js", "style.css"]}


def test_dev_ws_without_key(make_client):
    with make_client(access_key="k") as c:
        assert c.get("/api/team").status_code == 401  # 일반 API 는 키 필요
    with make_client(access_key="k", dev=True) as c:
        with c.websocket_connect("/__dev/ws") as ws:
            assert ws.receive_json()["type"] == "hello"


def test_watcher_detects_file_change(tmp_path):
    """실제 파일 감시: web/ 안의 파일을 쓰면 5초 안에 reload 가 온다."""
    web = tmp_path / "web"
    web.mkdir()

    async def run():
        dev = DevReload()
        q = dev.connect()
        assert (await q.get()).startswith('{"type": "hello"')
        task = asyncio.create_task(dev.watch(web))
        try:
            await asyncio.sleep(0.5)  # 감시 시작 대기
            (web / "app.js").write_text("changed", encoding="utf-8")
            msg = await asyncio.wait_for(q.get(), 5)
            assert msg.startswith('{"type": "reload"')  # macOS 는 첫 배치에 폴더 변경만 올 수도 있어 파일명은 검사하지 않는다
        finally:
            task.cancel()

    asyncio.run(run())
