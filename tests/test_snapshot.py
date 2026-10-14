import copy

from server import Hub, apply_event

TASKS = [{"id": 1, "assignee": "gemini", "title": "분석", "instruction": "...", "depends_on": []},
         {"id": 2, "assignee": "gpt", "title": "구현", "instruction": "...", "depends_on": [1]}]


def run(events, snap=None):
    for e in events:
        snap = apply_event(snap, e)
    return snap


def test_full_sequence():
    snap = run([{"type": "run_start", "run_id": "20261014-160000", "goal": "목표"}])
    assert snap == {"run_id": "20261014-160000", "goal": "목표", "phase": "plan", "summary": "",
                    "tasks": [], "report": None, "ok": None, "error": None}

    snap = run([{"type": "plan_start", "leader": "claude"},
                {"type": "plan", "summary": "요약", "tasks": TASKS}], snap)
    assert snap["phase"] == "work" and snap["summary"] == "요약"
    assert [(t["id"], t["state"], t["result"]) for t in snap["tasks"]] == [(1, "todo", None), (2, "todo", None)]

    snap = run([{"type": "task_start", "id": 1, "assignee": "gemini"},
                {"type": "task_done", "id": 1, "assignee": "gemini", "ok": True, "result": "끝"},
                {"type": "task_start", "id": 2, "assignee": "gpt"}], snap)
    assert [(t["state"], t["result"]) for t in snap["tasks"]] == [("done", "끝"), ("doing", None)]

    snap = run([{"type": "task_done", "id": 2, "assignee": "gpt", "ok": False, "result": "(실패: x)"},
                {"type": "review_start", "leader": "claude"}], snap)
    assert snap["tasks"][1]["state"] == "failed" and snap["phase"] == "review"

    snap = run([{"type": "report", "report": "# 보고", "dir": "runs/x"},
                {"type": "run_end", "run_id": "20261014-160000", "ok": True}], snap)
    assert snap["report"] == "# 보고" and snap["phase"] == "done" and snap["ok"] is True


def test_error_run():
    snap = run([{"type": "run_start", "run_id": "r", "goal": "g"},
                {"type": "run_error", "message": "계획 JSON 오류"},
                {"type": "run_end", "run_id": "r", "ok": False}])
    assert snap["error"] == "계획 JSON 오류" and snap["phase"] == "done" and snap["ok"] is False


def test_pure_and_ignores_unknown():
    snap = run([{"type": "run_start", "run_id": "r", "goal": "g"},
                {"type": "plan", "summary": "", "tasks": TASKS}])
    before = copy.deepcopy(snap)
    after = apply_event(snap, {"type": "task_start", "id": 1, "assignee": "gemini"})
    assert snap == before and after is not snap and after["tasks"][0]["state"] == "doing"
    assert apply_event(snap, {"type": "whatever"}) is snap
    assert apply_event(None, {"type": "plan", "tasks": TASKS}) is None
    # 새 run_start 는 이전 스냅샷을 대체한다
    assert run([{"type": "run_start", "run_id": "r2", "goal": "g2"}], snap)["tasks"] == []


def test_hub_drops_backlogged_client():
    hub = Hub(limit=3)
    slow = hub.connect({"type": "hello"})
    for _ in range(5):  # 실행은 막히지 않고, 밀린 접속만 끊긴다
        hub.publish({"type": "plan_start", "leader": "claude"})
    assert slow not in hub.clients and slow.get_nowait() is None
    hub.publish({"type": "run_start", "run_id": "r", "goal": "g"})
    assert hub.snapshot["run_id"] == "r"
