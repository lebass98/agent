"""멀티 에이전트 팀 웹 서버

  python serve.py                # http://127.0.0.1:8000 (이 컴퓨터에서만)
  python serve.py --lan          # 같은 Wi-Fi 의 휴대폰에서 접속 (접속 키 + QR 코드)
  python serve.py --mock         # API 호출 없이 모의 실행 (MOCK_DELAY 기본 3초)
  python serve.py --no-dev       # 개발 모드 끄기
  --host H --port 8000 --config team.toml

개발 모드(기본): web/ 파일이 바뀌면 열린 브라우저가 자동 새로고침되고, 정적 파일은 캐시하지 않으며,
서버 코드(*.py, team.toml)가 바뀌면 서버가 자동 재시작된다(진행 중이던 업무는 중단된다).
"""
import argparse
import logging
import os
import secrets
import socket
import sys
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from agentteam import Team
from server import create_app

ROOT = Path(__file__).resolve().parent


def lan_ip() -> str:
    """외부로 나가는 인터페이스의 사설 IP (실제 패킷은 보내지 않는다)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def print_qr(url: str) -> None:
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.print_ascii(invert=True)
    except Exception as e:  # 터미널 인코딩 등 문제로 실패해도 서버는 띄운다
        print(f"   (QR 코드 출력 실패: {e})")


def build_app():
    """uvicorn 이 앱을 만들 때(자동 재시작 포함) 부른다. 설정은 main() 이 환경변수로 넘긴다."""
    load_dotenv(ROOT / ".env")
    team = Team(os.environ.get("AGENT_CONFIG") or str(ROOT / "team.toml"), mock=os.environ.get("AGENT_MOCK") == "1")
    return create_app(team, os.environ.get("AGENT_KEY") or None, ROOT / "runs", ROOT / "web",
                      dev=os.environ.get("AGENT_DEV") == "1")


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)  # 로그 파일로 돌려도 진행 상황이 바로 보이게
    load_dotenv(ROOT / ".env")
    p = argparse.ArgumentParser(description="멀티 에이전트 팀 웹 서버")
    p.add_argument("--mock", action="store_true", help="API 없이 모의 실행")
    p.add_argument("--lan", action="store_true", help="같은 네트워크(휴대폰)에 공개, 접속 키 사용")
    p.add_argument("--host", help="기본 127.0.0.1 (--lan 이면 0.0.0.0)")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--config", default=str(ROOT / "team.toml"))
    p.add_argument("--no-dev", action="store_true", help="자동 새로고침·자동 재시작 끄기")
    args = p.parse_args()

    if args.mock:
        os.environ.setdefault("MOCK_DELAY", "3")
    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    key = (os.getenv("ACCESS_KEY") or secrets.token_urlsafe(12)) if args.lan else None
    query = f"?key={key}" if key else ""
    dev = not args.no_dev

    # 자동 재시작 시 새 프로세스가 같은 설정으로 앱을 만들 수 있게 환경변수로 넘긴다
    os.environ.update(AGENT_CONFIG=args.config, AGENT_MOCK="1" if args.mock else "", AGENT_KEY=key or "",
                      AGENT_DEV="1" if dev else "")

    team = Team(args.config, mock=args.mock)
    web_dir = ROOT / "web"

    print("\n=== 멀티 에이전트 팀 웹 서버 ===")
    print(f"   팀장: {team.leader.name}")
    for m in team.members.values():
        print(f"   - {m.name:<7} [{m.provider}/{m.model}] {m.role}")
    print(f"   모의 실행: {'켜짐 (MOCK_DELAY=' + os.environ['MOCK_DELAY'] + '초)' if args.mock else '꺼짐'}")
    print(f"   개발 모드: {'켜짐 (web/ 변경 → 브라우저 자동 새로고침, 서버 코드 변경 → 자동 재시작)' if dev else '꺼짐'}")
    if not web_dir.is_dir():
        print("   (web/ 폴더가 없어 화면 없이 API 만 제공합니다)")
    print(f"\n   이 컴퓨터: http://127.0.0.1:{args.port}/{query}")
    if args.lan:
        phone = f"http://{lan_ip()}:{args.port}/{query}"
        print(f"   휴대폰:    {phone}")
        print(f"   접속 키:   {key}")
        print("\n   휴대폰 카메라로 QR 코드를 찍으세요 (같은 Wi-Fi 필요)")
        print_qr(phone)
    elif host not in ("127.0.0.1", "localhost", "::1"):
        print(f"   주의: {host} 에 접속 키 없이 공개됩니다. 외부 공개는 --lan 을 쓰세요.")
    print("   종료: Ctrl+C\n")

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    if dev:
        uvicorn.run("serve:build_app", factory=True, host=host, port=args.port, log_level="warning",
                    reload=True, reload_dirs=[str(ROOT / "server"), str(ROOT / "agentteam"), str(ROOT)],
                    reload_includes=["*.py", "team.toml"],
                    reload_excludes=[".venv/*", ".venv-win/*", "web/*", "runs/*", "tests/*", "scripts/*", "node_modules/*"])
    else:
        uvicorn.run(build_app(), host=host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
