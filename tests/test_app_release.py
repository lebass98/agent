"""휴대폰 앱 업데이트 API(/api/app/*) · 노션 업무 기록(server/notion.py)."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from conftest import ROOT
from server import notion


# ── 앱 업데이트 ───────────────────────────────────────────
def test_app_update_endpoints(make_client, runs_dir):
    dist = runs_dir.parent / "dist"
    with make_client(access_key="k") as client:
        assert client.get("/api/app/latest").status_code == 401
        h = {"X-Access-Key": "k"}
        assert client.get("/api/app/latest", headers=h).status_code == 404  # 아직 릴리즈 없음
        dist.mkdir()
        (dist / "latest.json").write_text(json.dumps({"versionCode": 3, "versionName": "0.3"}), encoding="utf-8")
        (dist / "agent-office.apk").write_bytes(b"PK\x03\x04apk")
        assert client.get("/api/app/latest", headers=h).json()["versionCode"] == 3
        r = client.get("/api/app/apk", headers=h)
        assert r.status_code == 200 and r.content == b"PK\x03\x04apk"
        assert r.headers["content-type"] == "application/vnd.android.package-archive"


def test_release_bump():
    import importlib.util
    spec = importlib.util.spec_from_file_location("release", ROOT / "scripts" / "release.py")
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    text, code, name = release.bump('versionCode 4\n        versionName "0.9"', None)
    assert (code, name) == (5, "0.10") and 'versionName "0.10"' in text and "versionCode 5" in text
    assert release.bump('versionCode 1\nversionName "0.1"', "1.0")[1:] == (2, "1.0")


# ── 노션 기록 ────────────────────────────────────────────
def test_markdown_blocks():
    md = "# 제목\n\n문단 **굵게** 와 `코드`\n- 항목\n1. 번호\n> 인용\n---\n```py\nprint(1)\n```\n- [x] 끝"
    kinds = [b["type"] for b in notion.markdown_blocks(md)]
    assert kinds == ["heading_1", "paragraph", "bulleted_list_item", "numbered_list_item", "quote", "divider", "code", "to_do"]
    para = notion.markdown_blocks("a **b** `c`")[0]["paragraph"]["rich_text"]
    assert [r.get("annotations") for r in para] == [None, {"bold": True}, None, {"code": True}]
    long = notion.markdown_blocks("x" * 4500)[0]["paragraph"]["rich_text"]
    assert [len(r["text"]["content"]) for r in long] == [2000, 2000, 500]


@pytest.fixture
def fake_notion(monkeypatch):
    got: list[tuple[str, str, dict]] = []

    class H(BaseHTTPRequestHandler):
        def _do(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            got.append((self.command, self.path, body, self.headers["Authorization"]))
            out = json.dumps({"id": "page-1", "url": "https://notion.so/page-1"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        do_POST = do_PATCH = _do  # noqa: N815

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("NOTION_API", f"http://127.0.0.1:{srv.server_port}/v1")
    monkeypatch.setenv("NOTION_TOKEN", "ntn_test")
    monkeypatch.setenv("NOTION_DATABASE_ID", "0250-3172")
    yield got
    srv.shutdown()


def test_notion_records_finished_run(make_client, fake_notion):
    with make_client() as client:
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            run_id = client.post("/api/run", json={"goal": "노션 기록 목표"}).json()["run_id"]
            while ws.receive_json().get("type") != "run_end":
                pass
        for _ in range(60):
            if fake_notion:
                break
            time.sleep(0.05)
        assert client.get("/api/notion").json()["last"]["ok"] is True
    method, path, body, auth = fake_notion[0]
    assert (method, path, auth) == ("POST", "/v1/pages", "Bearer ntn_test")
    assert body["parent"] == {"database_id": "02503172"}
    p = body["properties"]
    assert p["이름"]["title"][0]["text"]["content"] == "노션 기록 목표"
    assert p["상태"]["select"]["name"] == "완료" and p["실행 ID"]["rich_text"][0]["text"]["content"] == run_id
    assert p["담당"]["multi_select"]
    text = json.dumps(body["children"], ensure_ascii=False)
    assert "지시" in text and "최종 보고서" in text and "업무 분담" in text


def test_notion_off_without_token(make_client, monkeypatch, fake_notion):
    monkeypatch.delenv("NOTION_TOKEN")
    with make_client() as client:
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            client.post("/api/run", json={"goal": "끔"})
            while ws.receive_json().get("type") != "run_end":
                pass
        time.sleep(0.2)
        assert client.get("/api/notion").json() == {"enabled": False, "last": None}
    assert fake_notion == []
