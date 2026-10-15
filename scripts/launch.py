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


def yes(answer: str) -> bool:
    """y / yes / ㅛ(한글 자판의 y) 를 예로 본다."""
    return answer.strip().lower()[:1] in ("y", "ㅛ")


API_KEY_OF = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "google": "GEMINI_API_KEY"}


def check_team() -> bool:
    """실제 실행 전 점검: API provider 는 .env 키, CLI provider 는 설치 여부. 아무 팀원도 동작할 수 없을 때만 중단한다."""
    import tomllib

    sys.path.insert(0, str(ROOT))
    from agentteam import cli

    if not (ROOT / ".env").exists():
        (ROOT / ".env").write_text((ROOT / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
    try:
        members = tomllib.loads((ROOT / "team.toml").read_text(encoding="utf-8"))["members"]
    except (OSError, KeyError, ValueError) as e:
        print(f"\n  team.toml 을 읽을 수 없습니다: {e}")
        return False
    keys, problems, ok = env_file(), [], 0
    for name, m in members.items():
        prov = m.get("provider", "")
        if prov in cli.BINS:
            if cli.installed(prov):
                ok += 1
            else:
                problems.append(f"{name}: '{cli.BINS[prov]}' CLI 없음 — {cli.INSTALL[cli.BINS[prov]]}")
        elif prov in API_KEY_OF:
            if keys.get(API_KEY_OF[prov]) or (prov == "google" and keys.get("GOOGLE_API_KEY")):
                ok += 1
            else:
                problems.append(f"{name}: .env 의 {API_KEY_OF[prov]} 가 비어 있음")
        else:
            ok += 1  # mock 등
    for p in problems:
        print(f"\n  참고: {p} → 이 팀원의 업무는 실패로 표시됩니다.")
    if not ok:
        print("\n  동작할 수 있는 팀원이 없습니다. 위 안내대로 키를 넣거나 CLI 를 설치·로그인한 뒤 다시 실행하세요.")
        print("  (AI 호출 없이 화면만 보려면 모의 실행을 선택하세요)")
        if any(".env" in p for p in problems):
            open_file(ROOT / ".env")
        return False
    return True


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

    # 명령줄에 없는 것만 묻는다 (--lan 을 줬으면 휴대폰 접속은 묻지 않는다)
    if not (args.mock or args.real):
        print("\n  실행 방식을 고르세요")
        print("  1) 모의 실행 — AI 호출 없이 화면과 흐름만 확인")
        print("  2) 실제 실행 — 팀원별 연결(구독 로그인 CLI 또는 .env 의 API 키, team.toml 설정)로 호출")
        args.mock = ask("  선택 [1]: ", "1") != "2"
    if not args.lan and not (args.mock and args.real):
        args.lan = yes(ask("\n  휴대폰에서도 접속할까요? 같은 Wi-Fi 필요 [y/N]: "))

    if not args.mock and not check_team():
        return 1

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
