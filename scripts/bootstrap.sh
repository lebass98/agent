#!/usr/bin/env bash
# Agent Office 실행 준비 (macOS / Linux 공용): Python 확인 → 가상환경 → 패키지 설치 → 실행 도우미
cd "$(dirname "$0")/.." || exit 1

pause_exit() {
  echo
  read -r -p "엔터를 누르면 창을 닫습니다…" _
  exit "${1:-1}"
}

echo "=================================="
echo "   Agent Office 로컬 서버"
echo "=================================="

if [ ! -x .venv/bin/python ]; then
  PY=""
  for c in python3.14 python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1 &&
       "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
      PY="$c"; break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Python 3.11 이상이 필요합니다."
    echo "https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요."
    pause_exit 1
  fi
  echo "▶ 가상환경을 만드는 중… ($PY)"
  "$PY" -m venv .venv || pause_exit 1
fi

if ! cmp -s requirements.txt .venv/.requirements.installed; then
  echo "▶ 패키지 설치 중… (처음 한 번은 1~2분 걸립니다)"
  .venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt || pause_exit 1
  cp requirements.txt .venv/.requirements.installed
fi

.venv/bin/python scripts/launch.py "$@"
code=$?
[ "$code" -ne 0 ] && pause_exit "$code"
exit 0
