import type { Task, TaskStore } from "./task-store.ts";

// All date logic lives in code (never in the model), on Asia/Shanghai time.
// Shanghai is UTC+8 year-round (no DST), so a fixed offset is exact.
export function todayShanghaiDate(now = new Date()): string {
  // Asia/Shanghai is UTC+8 year-round (no DST): shift from UTC, not from local time.
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

export function tasksDueToday(tasks: Task[], today = todayShanghaiDate()): Task[] {
  return tasks.filter((t) => !t.done && t.dueDate === today);
}

const PRIORITY_ORDER: Record<string, number> = { 大: 0, 中: 1, 小: 2 };

// Pure formatter used both in the system-prompt snapshot and in tests.
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "（当前没有任务）";
  const line = (t: Task) => {
    const mark = t.done ? "✅" : "⬜";
    const priority = t.priority ? ` [优先级 ${t.priority}]` : "";
    const due = t.dueDate ? ` 截止 ${t.dueDate}` : "";
    const indent = t.parentId ? "    " : "";
    return `${indent}${mark} ${t.title}${priority}${due}`;
  };
  const open = tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority ?? "小"] ?? 2) - (PRIORITY_ORDER[b.priority ?? "小"] ?? 2),
    );
  const done = tasks.filter((t) => t.done);
  const parts: string[] = [];
  if (open.length > 0) parts.push("待办：\n" + open.map(line).join("\n"));
  if (done.length > 0) parts.push("已完成：\n" + done.map(line).join("\n"));
  return parts.join("\n");
}

// Business rule: when every subtask of a parent is done, the parent is done.
export function autoCompleteParent(tasks: TaskStore, parentId: string): void {
  const all = tasks.list();
  const parent = all.find((t) => t.id === parentId);
  if (!parent || parent.done) return;
  const children = all.filter((t) => t.parentId === parentId);
  if (children.length > 0 && children.every((c) => c.done)) tasks.update(parentId, { done: true });
}
