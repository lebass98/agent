"""휴대폰 앱(APK) 릴리즈: 버전 올리기 → 빌드 → dist/ 에 APK·latest.json → (선택) Google Drive 복사.

    python scripts/release.py -n "변경 내용 1" -n "변경 내용 2"          # 0.1 → 0.2
    python scripts/release.py 1.0 -n "정식 버전"                         # 버전 이름 직접 지정
    python scripts/release.py --no-drive -n "..."                        # Drive 복사 생략

- 버전의 기준은 android/app/build.gradle 의 versionCode·versionName (커밋 대상), 변경 내역은 android/CHANGELOG.md 에 쌓인다.
- 휴대폰 앱은 서버의 /api/app/latest(dist/latest.json)를 보고 새 버전이면 /api/app/apk 를 받아 설치한다.
- APK 에는 접속 키가 들어 있으므로 dist/ 는 Git 제외. Drive 는 개인 폴더(내 드라이브/Agent)에만 둔다.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
GRADLE_FILE = ANDROID / "app" / "build.gradle"
APK_OUT = ANDROID / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DIST = ROOT / "dist"
CHANGELOG = ANDROID / "CHANGELOG.md"
DRIVE = Path.home() / "Library/CloudStorage/GoogleDrive-dongbookro@gmail.com/내 드라이브/Agent"


def java_home() -> str | None:
    for p in ("/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
              "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"):
        if Path(p).is_dir():
            return p
    return os.environ.get("JAVA_HOME")


def bump(text: str, name: str | None) -> tuple[str, int, str]:
    code = int(re.search(r"versionCode (\d+)", text).group(1)) + 1
    old = re.search(r'versionName "([^"]+)"', text).group(1)
    if not name:
        parts = old.split(".")
        parts[-1] = str(int(parts[-1]) + 1)
        name = ".".join(parts)
    text = re.sub(r"versionCode \d+", f"versionCode {code}", text)
    text = re.sub(r'versionName "[^"]+"', f'versionName "{name}"', text)
    return text, code, name


def drive_id(path: Path, wait: int = 90) -> str | None:
    """Drive 데스크톱 앱이 올리면 붙이는 확장 속성(item-id)을 기다린다."""
    end = time.time() + wait
    while time.time() < end:
        for attr in ("com.google.drivefs.item-id#S", "com.google.drivefs.item-id"):
            r = subprocess.run(["xattr", "-p", attr, str(path)], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        time.sleep(3)
    return None


def main() -> int:
    p = argparse.ArgumentParser(description="휴대폰 앱 릴리즈")
    p.add_argument("version", nargs="?", help="버전 이름(기본: 끝자리 +1)")
    p.add_argument("-n", "--note", action="append", default=[], help="변경 내용(여러 번)")
    p.add_argument("--no-drive", action="store_true", help="Google Drive 복사 생략")
    a = p.parse_args()

    old_text = GRADLE_FILE.read_text(encoding="utf-8")
    text, code, name = bump(old_text, a.version)
    GRADLE_FILE.write_text(text, encoding="utf-8")
    print(f"📦 버전 {name} (versionCode {code}) 빌드 중…")

    env = dict(os.environ)
    if jh := java_home():
        env["JAVA_HOME"] = jh
    gradlew = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    r = subprocess.run([str(gradlew), "assembleDebug", "-q"], cwd=ANDROID, env=env)
    if r.returncode != 0 or not APK_OUT.exists():
        GRADLE_FILE.write_text(old_text, encoding="utf-8")  # 실패하면 버전 되돌림
        print("❌ 빌드 실패 — 버전을 되돌렸습니다.")
        return 1

    DIST.mkdir(exist_ok=True)
    data = APK_OUT.read_bytes()
    shutil.copyfile(APK_OUT, DIST / f"agent-office-{name}.apk")
    tmp = DIST / "agent-office.apk.tmp"
    shutil.copyfile(APK_OUT, tmp)
    os.replace(tmp, DIST / "agent-office.apk")
    notes = "\n".join(f"- {n}" for n in a.note)
    latest = {"versionCode": code, "versionName": name, "notes": notes, "size": len(data),
              "sha256": hashlib.sha256(data).hexdigest(), "released_at": datetime.now().isoformat(timespec="seconds")}
    (DIST / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    head = "# 휴대폰 앱 변경 내역\n"
    body = CHANGELOG.read_text(encoding="utf-8").removeprefix(head) if CHANGELOG.exists() else ""
    entry = f"\n## {name} ({datetime.now():%Y-%m-%d})\n{notes or '- (내용 없음)'}\n"
    CHANGELOG.write_text(head + entry + body, encoding="utf-8")
    print(f"✅ dist/agent-office.apk ({len(data) / 1e6:.1f}MB) · dist/latest.json — 휴대폰 앱이 다음에 열릴 때 업데이트를 안내합니다.")

    if not a.no_drive and DRIVE.parent.is_dir():
        DRIVE.mkdir(exist_ok=True)
        target = DRIVE / "agent-office.apk"
        shutil.copyfile(APK_OUT, target)
        item = drive_id(target)
        print(f"☁️  Google Drive: https://drive.google.com/file/d/{item}/view" if item
              else "☁️  Google Drive 에 복사했습니다(동기화 대기 중).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
