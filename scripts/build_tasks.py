# -*- coding: utf-8 -*-
"""合并任务数据、校验一致性并导出 tasks.json（docx 与 xlsx 共用单一数据源）"""
import json, os, sys, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pl_phases, pl_tasks_a, pl_tasks_b

PHASES = pl_phases.PHASES
TASKS = pl_tasks_a.TASKS_A + pl_tasks_b.TASKS_B

def main():
    errors = []
    # 基本结构校验
    ids = set()
    for t in TASKS:
        for k in ("id", "phase", "title", "detail", "priority", "due", "deps"):
            if k not in t or t[k] in (None, ""):
                if k != "deps":
                    errors.append(f"{t.get('id','?')}: 缺少字段 {k}")
        if t["id"] in ids:
            errors.append(f"重复任务ID: {t['id']}")
        ids.add(t["id"])
        if t["priority"] not in ("P0", "P1", "P2"):
            errors.append(f"{t['id']}: 非法优先级 {t['priority']}")
        if not (0 <= t["phase"] <= 12):
            errors.append(f"{t['id']}: 非法阶段 {t['phase']}")
    # 依赖必须存在
    for t in TASKS:
        if t["deps"]:
            for d in [x.strip() for x in str(t["deps"]).split(",") if x.strip()]:
                if d not in ids:
                    errors.append(f"{t['id']}: 依赖不存在 {d}")
    # 阶段覆盖校验：每个阶段都有任务
    phase_ids = {p["num"] for p in PHASES}
    task_phases = {t["phase"] for t in TASKS}
    if phase_ids != task_phases:
        errors.append(f"阶段与任务不匹配: 仅任务 {task_phases} / 仅阶段 {phase_ids}")
    # 依赖阶段不得晚于本阶段太多（软校验，只提示）
    phase_of = {t["id"]: t["phase"] for t in TASKS}
    for t in TASKS:
        if t["deps"]:
            for d in [x.strip() for x in str(t["deps"]).split(",") if x.strip()]:
                if phase_of.get(d, 99) > t["phase"]:
                    errors.append(f"{t['id']}: 依赖 {d} 位于更晚阶段")

    if errors:
        print("校验失败:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    data = {
        "meta": {
            "product": "PROOFLOOM",
            "deadline_utc": "2026-12-18T01:00:00Z",
            "deadline_nairobi": "2026-12-18 04:00 (UTC+3)",
            "deadline_beijing": "2026-12-18 09:00 (UTC+8)",
            "start_date": "2026-11-27",
            "generated": datetime.date.today().isoformat(),
            "task_count": len(TASKS),
            "phase_count": len(PHASES),
        },
        "phases": PHASES,
        "tasks": TASKS,
    }
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    # 统计
    from collections import Counter
    pc = Counter(t["phase"] for t in TASKS)
    pr = Counter(t["priority"] for t in TASKS)
    print(f"OK tasks={len(TASKS)} phases={len(PHASES)}")
    print("按阶段:", dict(sorted(pc.items())))
    print("按优先级:", dict(sorted(pr.items())))
    print("导出:", out)

if __name__ == "__main__":
    main()
