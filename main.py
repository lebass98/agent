"""멀티 에이전트 팀 실행기

  python main.py run "목표"            # 팀장이 분배 → 팀원 병렬 수행 → 검수 보고
  python main.py ask gpt "업무 내용"    # 특정 팀원에게 직접 지시
  python main.py team                  # 팀 구성 확인
  --mock                               # API 호출 없이 흐름만 점검
  -f 파일                               # 목표/업무 내용을 파일에서 읽기
"""
import argparse
import asyncio
from pathlib import Path

from dotenv import load_dotenv

from agentteam import Team
from agentteam.providers import has_key


def main() -> None:
    load_dotenv()
    p = argparse.ArgumentParser(description="GPT·Claude·Gemini 멀티 에이전트 팀")
    p.add_argument("--mock", action="store_true", help="API 없이 모의 실행")
    p.add_argument("--config", default="team.toml")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="팀 단위 업무")
    r.add_argument("goal", nargs="?")
    r.add_argument("-f", "--file")

    a = sub.add_parser("ask", help="팀원 개별 지시")
    a.add_argument("member")
    a.add_argument("prompt", nargs="?")
    a.add_argument("-f", "--file")

    sub.add_parser("team", help="팀 구성 보기")
    args = p.parse_args()

    team = Team(args.config, mock=args.mock)

    if args.cmd == "team":
        print(f"팀장: {team.leader.name}")
        for m in team.members.values():
            key = "키 ✓" if m.provider == "mock" or has_key(m) else "키 없음"
            print(f"- {m.name:<7} [{m.provider}/{m.model}] ({key}) {m.role}")
        return

    if args.file:
        path = Path(args.file).expanduser()
        if not path.is_file():
            raise SystemExit(f"❌ 파일을 찾을 수 없습니다: {path.resolve()}")
        text = path.read_text(encoding="utf-8")
    else:
        text = args.goal if args.cmd == "run" else args.prompt
    if not text:
        p.error("업무 내용을 인자 또는 -f 파일로 전달하세요.")

    try:
        if args.cmd == "run":
            out = asyncio.run(team.run(text))
            print(f"\n📁 결과: {out}/report.md")
        else:
            print(asyncio.run(team.ask(args.member, text)))
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as e:
        raise SystemExit(f"\n❌ 실패: {e}")


if __name__ == "__main__":
    main()
