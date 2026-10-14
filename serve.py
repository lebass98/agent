"""멀티 에이전트 팀 웹 서버

  python serve.py                # http://127.0.0.1:8000 (이 컴퓨터에서만)
  python serve.py --lan          # 같은 Wi-Fi 의 휴대폰에서 접속 (접속 키 + QR 코드)
  python serve.py --mock         # API 호출 없이 모의 실행 (MOCK_DELAY 기본 3초)
  --host H --port 8000 --config team.toml
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


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)  # 로그 파일로 돌려도 진행 상황이 바로 보이게
    load_dotenv()
    p = argparse.ArgumentParser(description="멀티 에이전트 팀 웹 서버")
    p.add_argument("--mock", action="store_true", help="API 없이 모의 실행")
    p.add_argument("--lan", action="store_true", help="같은 네트워크(휴대폰)에 공개, 접속 키 사용")
    p.add_argument("--host", help="기본 127.0.0.1 (--lan 이면 0.0.0.0)")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--config", default=str(ROOT / "team.toml"))
    args = p.parse_args()

    if args.mock:
        os.environ.setdefault("MOCK_DELAY", "3")
    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    key = (os.getenv("ACCESS_KEY") or secrets.token_urlsafe(12)) if args.lan else None
    query = f"?key={key}" if key else ""

    team = Team(args.config, mock=args.mock)
    web_dir = ROOT / "web"
    app = create_app(team, key, ROOT / "runs", web_dir)

    print("\n=== 멀티 에이전트 팀 웹 서버 ===")
    print(f"   팀장: {team.leader.name}")
    for m in team.members.values():
        print(f"   - {m.name:<7} [{m.provider}/{m.model}] {m.role}")
    print(f"   모의 실행: {'켜짐 (MOCK_DELAY=' + os.environ['MOCK_DELAY'] + '초)' if args.mock else '꺼짐'}")
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
    uvicorn.run(app, host=host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
