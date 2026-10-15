"""프로젝트(폴더 접근): 사용자가 고른 로컬 폴더를 등록하고, 팀 업무를 그 폴더 안에서 실행하게 한다.

- 등록 목록은 저장소 루트의 projects.json(Git 제외, 로컬 경로가 들어 있다)에 둔다.
  [{id, name, path, granted_at, access: "full"}]
- 폴더 고르기용 목록(list_dirs)은 하위 폴더 이름만 돌려준다. 파일 이름·내용은 절대 내보내지 않는다.
- 등록 전 check_path 로 위험한 경로(시스템·홈 자체·자격 증명 폴더·이 앱의 가상환경)를 거부한다.
"""
import json
import os
import secrets
import threading
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NAME_LIMIT = 80
LIST_LIMIT = 500  # 폴더 고르기 화면에 보여 줄 하위 폴더 최대 개수

# 등록하면 안 되는 시스템 폴더(그 자체와 그 안 전부)
SYSTEM_DIRS = ("/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/tmp",
               "/Applications", "/opt", "/dev", "/cores", "/Network")
# 그 자체만 막는 폴더(안쪽 하위 폴더는 허용)
EXACT_DIRS = ("/", "/Volumes", "/Users", "/home")
# 경로 어디에든 이 이름이 있으면 거부(자격 증명·키·클라우드 설정)
SECRET_PARTS = {".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config", ".password-store",
                ".netrc", ".git-credentials", "keychains", ".claude", ".codex", ".gemini", ".antigravity"}
# 홈 아래에서 막는 폴더
HOME_DIRS = ("Library", ".Trash")


class ProjectError(ValueError):
    """사용자에게 그대로 보여 줄 한국어 사유."""


def _home() -> Path:
    return Path(os.path.expanduser("~")).resolve()


def _inside(p: Path, root: Path) -> bool:
    return p == root or root in p.parents


def _temp_workspace(p: Path) -> bool:
    """임시 폴더 안의 작업 폴더(/tmp/이름, macOS 사용자 임시 폴더 안쪽)는 시스템 폴더 검사에서 뺀다."""
    for tmp in (Path("/tmp"), Path("/private/tmp")):
        if p != tmp and _inside(p, tmp):
            return True
    folders = Path("/private/var/folders")
    return _inside(p, folders) and len(p.relative_to(folders).parts) > 3


def check_path(raw: str, repo: Path = REPO) -> Path:
    """등록할 수 있는 폴더면 실제 경로(심볼릭 링크 해석)를 돌려주고, 아니면 ProjectError."""
    raw = (raw or "").strip()
    if not raw:
        raise ProjectError("폴더 경로를 입력하세요.")
    if "\x00" in raw:
        raise ProjectError("폴더 경로가 올바르지 않습니다.")
    p = Path(os.path.expanduser(raw))
    if not p.is_absolute():
        raise ProjectError("폴더 경로는 절대 경로(/ 로 시작)여야 합니다.")
    if not p.exists():
        raise ProjectError("폴더가 없습니다.")
    p = p.resolve()  # 심볼릭 링크를 따라가 실제 위치로 검사한다(/tmp → /private/tmp 등)
    if not p.is_dir():
        raise ProjectError("폴더가 아닙니다. 파일이 아닌 폴더를 고르세요.")
    home = _home()
    if str(p) in EXACT_DIRS or p == home or p == Path(p.anchor):
        raise ProjectError("디스크 최상위·홈 폴더 전체는 등록할 수 없습니다. 작업할 하위 폴더를 고르세요.")
    if not _temp_workspace(p):
        for d in SYSTEM_DIRS:
            root = Path(d)
            if _inside(p, root) or (root.exists() and _inside(p, root.resolve())):
                raise ProjectError(f"시스템 폴더({d})는 등록할 수 없습니다.")
    for d in HOME_DIRS:
        if _inside(p, home / d):
            raise ProjectError(f"홈의 {d} 폴더는 앱 설정·비밀 정보가 있어 등록할 수 없습니다.")
    parts = {s.lower() for s in p.parts}
    if parts & SECRET_PARTS:
        raise ProjectError("비밀번호·키 같은 자격 증명이 들어 있는 폴더(.ssh 등)는 등록할 수 없습니다.")
    for venv in (".venv", ".venv-win"):
        if _inside(p, (repo / venv).resolve()):
            raise ProjectError("이 앱의 가상환경(.venv) 폴더는 등록할 수 없습니다.")
    return p


# ── 폴더 고르기 ───────────────────────────────────────
def quick_roots() -> list[dict]:
    home = _home()
    items = [("홈", home), ("데스크탑", home / "Desktop"), ("문서", home / "Documents"), ("다운로드", home / "Downloads")]
    return [{"name": n, "path": str(p)} for n, p in items if p.is_dir()]


def list_dirs(raw: str | None, hidden: bool = False) -> dict:
    """하위 폴더 목록. 파일은 보여 주지 않는다. path 가 비면 홈에서 시작한다."""
    p = Path(os.path.expanduser(raw.strip())) if raw and raw.strip() else _home()
    if not p.is_absolute():
        raise ProjectError("폴더 경로는 절대 경로여야 합니다.")
    try:
        p = p.resolve()
    except OSError:
        raise ProjectError("폴더를 열 수 없습니다.")
    if not p.is_dir():
        raise ProjectError("폴더가 없습니다.")
    dirs = []
    try:
        entries = sorted(os.scandir(p), key=lambda e: e.name.lower())
    except PermissionError:
        raise ProjectError("이 폴더를 볼 권한이 없습니다.")
    except OSError:
        raise ProjectError("폴더를 열 수 없습니다.")
    for e in entries:
        if not hidden and e.name.startswith("."):
            continue
        try:
            if not e.is_dir():  # 폴더를 가리키는 심볼릭 링크도 폴더로 본다
                continue
        except OSError:
            continue
        dirs.append({"name": e.name, "path": os.path.join(str(p), e.name), "has_children": _has_children(e.path, hidden)})
        if len(dirs) >= LIST_LIMIT:
            break
    parent = str(p.parent) if p.parent != p else None
    try:
        check_path(str(p))
        selectable, reason = True, ""
    except ProjectError as err:
        selectable, reason = False, str(err)
    roots = quick_roots()
    if parent:
        roots.append({"name": "상위 폴더", "path": parent})
    return {"path": str(p), "parent": parent, "dirs": dirs, "truncated": len(dirs) >= LIST_LIMIT,
            "roots": roots, "selectable": selectable, "reason": reason}


def _has_children(path: str, hidden: bool) -> bool:
    try:
        with os.scandir(path) as it:
            for e in it:
                if (hidden or not e.name.startswith(".")) and e.is_dir():
                    return True
    except OSError:
        pass
    return False


# ── 등록 목록(projects.json) ───────────────────────────
class Store:
    def __init__(self, file: Path, repo: Path = REPO):
        self.file, self.repo = Path(file), repo
        self.lock = threading.Lock()

    def load(self) -> list[dict]:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [p for p in data if isinstance(p, dict) and {"id", "name", "path"} <= p.keys()] if isinstance(data, list) else []

    def _save(self, items: list[dict]) -> None:
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.file)

    def get(self, pid: str) -> dict | None:
        return next((p for p in self.load() if p["id"] == pid), None)

    def add(self, raw_path: str, name: str | None = None) -> dict:
        path = check_path(raw_path, self.repo)
        name = _name(name) or path.name
        with self.lock:
            items = self.load()
            for p in items:
                if p["path"] == str(path):  # 같은 폴더는 다시 허락받은 것으로 보고 갱신
                    p.update(name=name, granted_at=_now(), access="full")
                    self._save(items)
                    return p
            item = {"id": secrets.token_hex(6), "name": name, "path": str(path), "granted_at": _now(), "access": "full"}
            items.append(item)
            self._save(items)
            return item

    def rename(self, pid: str, name: str) -> dict | None:
        name = _name(name)
        if not name:
            raise ProjectError(f"이름을 1~{NAME_LIMIT}자로 입력하세요.")
        with self.lock:
            items = self.load()
            for p in items:
                if p["id"] == pid:
                    p["name"] = name
                    self._save(items)
                    return p
        return None

    def remove(self, pid: str) -> bool:
        with self.lock:
            items = self.load()
            left = [p for p in items if p["id"] != pid]
            if len(left) == len(items):
                return False
            self._save(left)
            return True

    def usable(self, pid: str) -> dict:
        """업무 실행 직전 다시 검사한다(등록 뒤 폴더가 지워지거나 링크가 바뀐 경우)."""
        p = self.get(pid)
        if not p:
            raise LookupError("프로젝트를 찾을 수 없습니다. 목록에서 다시 고르세요.")
        real = check_path(p["path"], self.repo)
        if str(real) != p["path"]:
            raise ProjectError("프로젝트 폴더 위치가 바뀌었습니다. 다시 등록하세요.")
        return p


def _name(name: str | None) -> str:
    name = " ".join((name or "").split())
    return name[:NAME_LIMIT]


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
