import assert from "node:assert/strict";

import { mkdtemp, rm } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { test, type TestContext } from "node:test";

import {
  autoCompleteParent,
  formatTaskList,
  tasksDueToday,
  todayShanghaiDate,
} from "./task-utils.ts";

import { createJsonTaskStore, type Task, type TaskStore } from "./task-store.ts";

async function tempStore(t: TestContext): Promise<TaskStore> {
  const dir = await mkdtemp(join(tmpdir(), "utils-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createJsonTaskStore(join(dir, "tasks.json"));
}

test("todayShanghaiDate returns YYYY-MM-DD in Asia/Shanghai", () => {
  // 2026-11-25 00:30 UTC = 2026-11-25 08:30 Shanghai -> same day
  assert.equal(todayShanghaiDate(new Date("2026-11-25T00:30:00Z")), "2026-11-25");
  // 2026-11-25 17:30 UTC = 2026-11-26 01:30 Shanghai -> next day
  assert.equal(todayShanghaiDate(new Date("2026-11-25T17:30:00Z")), "2026-11-26");
  assert.match(todayShanghaiDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("tasksDueToday keeps only open tasks due today", () => {
  const tasks: Task[] = [
    { id: "1", title: "今天的", done: false, dueDate: "2026-11-25" },
    { id: "2", title: "明天的", done: false, dueDate: "2026-11-26" },
    { id: "3", title: "无日期", done: false },
    { id: "4", title: "今天但已完成", done: true, dueDate: "2026-11-25" },
  ];
  const due = tasksDueToday(tasks, "2026-11-25");
  assert.deepEqual(
    due.map((t) => t.id),
    ["1"],
  );
});

test("formatTaskList groups open/done with marks, priority and due date", () => {
  const tasks: Task[] = [
    { id: "1", title: "买牛奶", done: false, priority: "大", dueDate: "2026-11-25" },
    { id: "2", title: "取快递", done: false },
    { id: "3", title: "洗衣服", done: true },
  ];
  const text = formatTaskList(tasks);
  assert.ok(text.includes("待办："));
  assert.ok(text.includes("已完成："));
  assert.ok(text.indexOf("买牛奶") < text.indexOf("取快递")); // 大 priority first
  assert.ok(text.includes("⬜ 买牛奶 [优先级 大] 截止 2026-11-25"));
  assert.ok(text.includes("✅ 洗衣服"));
  assert.equal(formatTaskList([]), "（当前没有任务）");
});

test("autoCompleteParent marks the parent done when all children are done", async (t) => {
  const tasks = await tempStore(t);
  const parent = tasks.create("装修房子");
  const a = tasks.create("买油漆");
  const b = tasks.create("请工人");
  tasks.update(a.id, { parentId: parent.id, done: true });
  tasks.update(b.id, { parentId: parent.id });
  autoCompleteParent(tasks, parent.id);
  assert.equal(tasks.list().find((x) => x.id === parent.id)?.done, false); // b still open
  tasks.update(b.id, { done: true });
  autoCompleteParent(tasks, parent.id);
  assert.equal(tasks.list().find((x) => x.id === parent.id)?.done, true);
});

test("autoCompleteParent does nothing without children or when parent already done", async (t) => {
  const tasks = await tempStore(t);
  const parent = tasks.create("独立任务");
  autoCompleteParent(tasks, parent.id);
  assert.equal(tasks.list()[0].done, false);
  tasks.update(parent.id, { done: true });
  autoCompleteParent(tasks, parent.id); // idempotent
  assert.equal(tasks.list()[0].done, true);
});
