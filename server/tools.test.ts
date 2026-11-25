import assert from "node:assert/strict";

import { mkdtemp, rm } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { test, type TestContext } from "node:test";

import { createJsonTaskStore, type TaskStore } from "./task-store.ts";

import { executeTool } from "./tools.ts";

async function tempStore(t: TestContext): Promise<TaskStore> {
  const dir = await mkdtemp(join(tmpdir(), "tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createJsonTaskStore(join(dir, "tasks.json"));
}

test("create_task trims and stores the task", async (t) => {
  const tasks = await tempStore(t);
  const result = executeTool("create_task", { title: " 买牛奶 " }, tasks);
  assert.equal(result.ok, true);
  assert.equal(tasks.list()[0].title, "买牛奶");
});

test("list_tasks and search_tasks return JSON observations", async (t) => {
  const tasks = await tempStore(t);
  executeTool("create_task", { title: "买牛奶" }, tasks);
  executeTool("create_task", { title: "取快递" }, tasks);
  const all = executeTool("list_tasks", {}, tasks);
  assert.equal((all.tasks as unknown[]).length, 2);
  const hits = executeTool("search_tasks", { keyword: "牛奶" }, tasks);
  assert.equal((hits.tasks as unknown[]).length, 1);
  const none = executeTool("search_tasks", { keyword: "洗衣服" }, tasks);
  assert.deepEqual(none, { ok: true, tasks: [] }); // empty is valid, not an error
});

test("update_task resolves a fuzzy mention to the right task", async (t) => {
  const tasks = await tempStore(t);
  executeTool("create_task", { title: "买牛奶" }, tasks);
  executeTool("create_task", { title: "取快递" }, tasks);
  const result = executeTool("update_task", { task: "牛奶", done: true }, tasks);
  assert.equal(result.ok, true);
  const list = tasks.list();
  assert.equal(list.find((x) => x.title === "买牛奶")?.done, true);
  assert.equal(list.find((x) => x.title === "取快递")?.done, false);
});

test("ambiguous update returns candidates and changes nothing", async (t) => {
  const tasks = await tempStore(t);
  executeTool("create_task", { title: "买牛奶" }, tasks);
  executeTool("create_task", { title: "热牛奶" }, tasks);
  const result = executeTool("update_task", { task: "牛奶", done: true }, tasks);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.candidates));
  assert.ok(tasks.list().every((x) => !x.done));
});

test("update with no change field is a JSON error", async (t) => {
  const tasks = await tempStore(t);
  const result = executeTool("update_task", { task: "买牛奶" }, tasks);
  assert.equal(result.ok, false);
});

test("invalid args produce a JSON error, never throw", async (t) => {
  const tasks = await tempStore(t);
  const result = executeTool("create_task", { title: "   " }, tasks);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  const unknown = executeTool("nope", {}, tasks);
  assert.equal(unknown.ok, false);
});

test("delete_task removes the resolved task", async (t) => {
  const tasks = await tempStore(t);
  executeTool("create_task", { title: "取快递" }, tasks);
  const result = executeTool("delete_task", { task: "取快递" }, tasks);
  assert.deepEqual(result, { ok: true, deleted: "取快递" });
  assert.equal(tasks.list().length, 0);
});

test("delete on empty store is a JSON error, not a crash", async (t) => {
  const tasks = await tempStore(t);
  const result = executeTool("delete_task", { task: "anything" }, tasks);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
});

test("create_task accepts dueDate/priority/parentId and they persist", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tools-ext-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "tasks.json");
  const tasks = createJsonTaskStore(file);
  const result = executeTool(
    "create_task",
    { title: "交房租", dueDate: "2026-11-30", priority: "大" },
    tasks,
  );
  assert.equal(result.ok, true);
  // round-trip through a fresh store on the same file
  const reloaded = createJsonTaskStore(file).list();
  assert.equal(reloaded[0].dueDate, "2026-11-30");
  assert.equal(reloaded[0].priority, "大");
});

test("update_task rejects an invalid dueDate as a JSON error", async (t) => {
  const tasks = await tempStore(t);
  executeTool("create_task", { title: "买牛奶" }, tasks);
  const result = executeTool("update_task", { task: "买牛奶", dueDate: "30/11/2026" }, tasks);
  assert.equal(result.ok, false);
});

test("list_tasks_due_today returns only open tasks due today", async (t) => {
  const tasks = await tempStore(t);
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  executeTool("create_task", { title: "今天的事", dueDate: iso }, tasks);
  executeTool("create_task", { title: "明天的事", dueDate: tomorrow }, tasks);
  const result = executeTool("list_tasks_due_today", {}, tasks);
  assert.equal(result.ok, true);
  const hits = result.tasks as { title: string }[];
  assert.deepEqual(
    hits.map((x) => x.title),
    ["今天的事"],
  );
});

test("completing the last subtask auto-completes the parent", async (t) => {
  const tasks = await tempStore(t);
  const parent = executeTool("create_task", { title: "装修" }, tasks).task as { id: string };
  executeTool("create_task", { title: "买油漆", parentId: parent.id }, tasks);
  const paint = tasks.list().find((x) => x.title === "买油漆")!;
  executeTool("update_task", { task: paint.id, done: true }, tasks);
  assert.equal(tasks.list().find((x) => x.id === parent.id)?.done, true);
});
