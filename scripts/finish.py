"""작업 완료 절차 (CLAUDE.md 규칙) — 한 번에 실행
  README 작업 이력 누적 → 클린 커밋 검증 → 한글 커밋 → git pull --rebase → git push

  python scripts/finish.py "feat: 기능 요약" -n "작업 내용 1" -n "작업 내용 2"
  옵션:
    --paths 경로…      지정한 경로만 스테이징 (기본: 변경 전체 `git add -A`)
    --trailer "텍스트"  커밋 메시지 끝에 붙일 줄 (예: Co-Authored-By: …)
    --date YYYY-MM-DD  README 에 기록할 날짜 (기본: 오늘)
    --no-push          커밋·pull 까지만 하고 push 는 생략
"""
import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
SECTION = "## 📝 변경 및 작업 이력"
PREFIX = re.compile(r"^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?!?: ")
FORBIDDEN = re.compile(r"(^|/)(\.env(\.local)?|\.DS_Store|\._[^/]*|Thumbs\.db|[^/]*\.pyc)$|(^|/)(\.venv|\.venv-win|runs|node_modules|__pycache__)/")


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True)
    if check and r.returncode:
        raise SystemExit(f"❌ git {' '.join(args)} 실패\n{(r.stderr or r.stdout).strip()}")
    return r.stdout.strip()


def add_log(day: str, notes: list[str]) -> None:
    """README 맨 아래 작업 이력 섹션의 해당 날짜 블록 끝에 항목을 덧붙인다(날짜·섹션이 없으면 만든다)."""
    lines = README.read_text(encoding="utf-8").splitlines() if README.exists() else ["# Agent Office"]
    if SECTION not in lines:
        lines += ["", "---", "", SECTION]
    head = f"### {day}"
    bullets = [f"- {n}" for n in notes]
    if head in lines:
        i = lines.index(head) + 1
        while i < len(lines) and not lines[i].startswith("### "):
            i += 1
        while i > 0 and not lines[i - 1].strip():  # 블록 끝 빈 줄 앞에 넣는다
            i -= 1
        lines[i:i] = bullets
    else:
        while lines and not lines[-1].strip():
            lines.pop()
        lines += ["", head, *bullets]
    README.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="작업 완료: README 이력 → 커밋 → pull --rebase → push")
    p.add_argument("message", help="한글 커밋 메시지 (Conventional Commits 접두사 필수)")
    p.add_argument("-n", "--note", action="append", default=[], help="README 작업 이력 항목 (여러 번 가능)")
    p.add_argument("--paths", nargs="+", default=None)
    p.add_argument("--trailer", default="")
    p.add_argument("--date", default=date.today().isoformat())
    p.add_argument("--no-push", action="store_true")
    a = p.parse_args()

    if not PREFIX.match(a.message):
        raise SystemExit("❌ 커밋 메시지는 feat:/fix:/docs:/chore:/refactor: 등 접두사로 시작해야 합니다.")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")

    # 1) 클린 커밋 검증: 비밀값·OS 메타데이터·가상환경이 커밋 대상에 섞이면 중단
    changed = [l[3:].split(" -> ")[-1].strip('"') for l in git("status", "--porcelain", "--untracked-files=all").splitlines()]
    bad = [f for f in changed if FORBIDDEN.search(f)]
    if bad:
        raise SystemExit("❌ 커밋하면 안 되는 파일이 있습니다. .gitignore 를 확인하세요:\n   " + "\n   ".join(bad))

    # 2) README 작업 이력 누적
    if a.note:
        add_log(a.date, a.note)
        print(f"📝 README 작업 이력에 {len(a.note)}건 추가 ({a.date})")

    # 3) 스테이징·커밋
    if a.paths:
        git("add", "--", "README.md", *a.paths)
    else:
        git("add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        print("ℹ️  커밋할 변경이 없습니다. 원격 동기화만 진행합니다.")
    else:
        msg = a.message + (f"\n\n{a.trailer}" if a.trailer else "")
        git("commit", "-q", "-m", msg)
        print(f"✅ 커밋: {git('log', '--oneline', '-1')}")

    # 4) 원격 동기화: pull --rebase 뒤 push
    if not git("remote", check=False):
        print("ℹ️  원격 저장소가 없어 push 를 건너뜁니다.")
        return 0
    r = subprocess.run(["git", "pull", "--rebase", "origin", branch], cwd=ROOT, text=True, capture_output=True)
    if r.returncode:
        print(f"❌ pull --rebase 충돌/실패:\n{(r.stderr or r.stdout).strip()}")
        print("   충돌 파일을 고친 뒤:  git add <파일> && git rebase --continue && git push origin " + branch)
        return 1
    if a.no_push:
        print("⏭  --no-push: push 생략")
        return 0
    git("push", "origin", branch)
    print(f"🚀 push 완료 → origin/{branch}\n{git('status', '-sb')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
