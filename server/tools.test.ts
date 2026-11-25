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
