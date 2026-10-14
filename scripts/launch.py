"""Agent Office 실행 도우미 — 모든 OS 공용. start-*.command/.bat/.sh 가 가상환경 준비 후 호출한다.

  인자 없이 실행하면 메뉴를 띄우고, 인자를 주면 메뉴 없이 바로 실행한다.
  예) --mock --lan --port 8000 --no-browser
"""
import argparse
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_NAMES = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")


def ask(prompt: str, default: str = "") -> str:
    try:
        return input(prompt).strip() or default
    except EOFError:
        return default


def free_port(start: int) -> int:
    for port in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"{start}~{start + 49} 포트가 모두 사용 중입니다.")


def open_file(path: Path) -> None:
    try:
        if sys.platform == "win32":
            subprocess.Popen(["notepad", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-t", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        pass


def env_file() -> dict[str, str]:
    """.env 의 '이름=값' (주석·빈 값 제외)."""
    env = ROOT / ".env"
    if not env.exists():
        return {}
    found = {}
    for line in env.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        name, value = name.strip(), value.strip().strip('"').strip("'")
        if name and not name.startswith("#") and value:
            found[name] = value
    return found


def configured_keys() -> list[str]:
    return [k for k in env_file() if k in KEY_NAMES]


def open_when_ready(url: str, port: int) -> None:
    for _ in range(60):
        time.sleep(0.5)
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                webbrowser.open(url)
                return


def main() -> int:
    os.chdir(ROOT)
    p = argparse.ArgumentParser(description="Agent Office 실행")
    p.add_argument("--mock", action="store_true", help="API 키 없이 모의 실행")
    p.add_argument("--real", action="store_true", help="실제 API 로 실행")
    p.add_argument("--lan", action="store_true", help="같은 Wi-Fi 의 휴대폰에서도 접속")
    p.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args()

    if not (ROOT / "serve.py").exists():
        print("serve.py 가 없습니다. 프로젝트 폴더가 온전한지 확인하세요.")
        return 1

    interactive = not (args.mock or args.real)
    if interactive:
        print("\n  실행 방식을 고르세요")
        print("  1) 모의 실행 — API 키 없이 화면과 흐름만 확인")
        print("  2) 실제 실행 — .env 의 API 키로 GPT·Claude·Gemini 호출")
        args.mock = ask("  선택 [1]: ", "1") != "2"
        args.lan = ask("\n  휴대폰에서도 접속할까요? 같은 Wi-Fi 필요 [y/N]: ").lower().startswith("y")

    if not args.mock:
        if not (ROOT / ".env").exists():
            (ROOT / ".env").write_text((ROOT / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
        keys = configured_keys()
        if not keys:
            print("\n  .env 에 API 키가 없습니다. 메모장에서 키를 입력·저장한 뒤 다시 실행하세요.")
            print("  (키 없이 보려면 모의 실행을 선택하세요)")
            open_file(ROOT / ".env")
            return 1
        missing = [k for k in KEY_NAMES if k not in keys]
        if missing:
            print(f"\n  참고: {', '.join(missing)} 가 비어 있어 해당 팀원 업무는 실패로 표시됩니다.")

    port = free_port(args.port)
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    url = f"http://127.0.0.1:{port}/"
    if args.lan:
        # .env 의 ACCESS_KEY 가 있으면 그대로 쓴다(브라우저 주소와 서버 키가 같아야 하므로 여기서 정해 넘긴다)
        env["ACCESS_KEY"] = env.get("ACCESS_KEY") or env_file().get("ACCESS_KEY") or secrets.token_urlsafe(12)
        url += f"?key={env['ACCESS_KEY']}"

    cmd = [sys.executable, "serve.py", "--port", str(port)]
    if args.mock:
        cmd.append("--mock")
    if args.lan:
        cmd.append("--lan")

    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url, port), daemon=True).start()
    print("\n  서버를 시작합니다. 끄려면 이 창에서 Ctrl+C 를 누르세요.\n")
    try:
        return subprocess.call(cmd, env=env)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
