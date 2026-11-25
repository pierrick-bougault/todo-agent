import assert from "node:assert/strict";

import { mkdtemp, rm } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { test, type TestContext } from "node:test";

import type { ChatMessage } from "../shared/chat.ts";

import type { CallModel, ModelMessage, ModelTurn, ToolCall } from "./agent.ts";

import { createAgent } from "./agent.ts";

import { createJsonTaskStore, type TaskStore } from "./task-store.ts";

import { executeTool } from "./tools.ts";

async function tempStore(t: TestContext): Promise<TaskStore> {
  const dir = await mkdtemp(join(tmpdir(), "agent-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createJsonTaskStore(join(dir, "tasks.json"));
}

// Script helper: each fake-model call consumes the next prepared turn.
function scriptTurns(turns: ModelTurn[], log: ModelMessage[][]): CallModel {
  let i = 0;
  return async (messages: ModelMessage[]) => {
    log.push(messages);
    const turn = turns[i++];
    if (!turn) throw new Error("model called more times than scripted");
    return turn;
  };
}

function toolCall(id: string, name: string, args: unknown): ToolCall {
  return { id, name, args };
}

function lastToolObservation(messages: ModelMessage[]): Record<string, unknown> {
  const lastTool = [...messages].reverse().find((m) => m.role === "tool");
  return JSON.parse(lastTool && lastTool.role === "tool" ? lastTool.content : "{}") as Record<
    string,
    unknown
  >;
}

test("no model configured -> welcome message (README behavior)", async (t) => {
  const tasks = await tempStore(t);
  const reply = createAgent({ tasks });
  assert.equal(await reply([{ role: "user", content: "你好" }]), "你好，欢迎使用小明智能体");
});

test("S1: create in 2 model turns, with real effect on the store", async (t) => {
  const tasks = await tempStore(t);
  const log: ModelMessage[][] = [];
  const callModel = scriptTurns(
    [
      { content: null, toolCalls: [toolCall("c1", "create_task", { title: "买牛奶" })] },
      { content: "已记录「买牛奶」✓", toolCalls: [] },
    ],
    log,
  );
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "帮我记一下买牛奶" }]);

  assert.equal(answer, "已记录「买牛奶」✓");
  assert.deepEqual(
    tasks.list().map((x) => x.title),
    ["买牛奶"],
  );

  // DeepSeek ordering: system first, then assistant(tool_calls), then tool observation
  const secondTurn = log[1];
  assert.equal(secondTurn[0].role, "system");
  const assistantMsg = secondTurn[secondTurn.length - 2];
  const toolMsg = secondTurn[secondTurn.length - 1];
  assert.equal(assistantMsg.role, "assistant");
  assert.equal(toolMsg.role, "tool");
  assert.ok(toolMsg.role === "tool" && toolMsg.content.includes('"ok":true'));
});

test("S3: list_tasks then summarize with statuses, store unchanged", async (t) => {
  const tasks = await tempStore(t);
  tasks.create("买牛奶");
  tasks.create("取快递");
  const callModel = scriptTurns(
    [
      { content: null, toolCalls: [toolCall("c1", "list_tasks", {})] },
      { content: "1. ⬜ 买牛奶 2. ⬜ 取快递", toolCalls: [] },
    ],
    [],
  );
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "我有哪些任务？" }]);
  assert.ok(answer.includes("买牛奶") && answer.includes("取快递"));
  assert.equal(tasks.list().length, 2);
});

test("S4: '牛奶买好了' -> search -> id -> update, other task untouched", async (t) => {
  const tasks = await tempStore(t);
  tasks.create("买牛奶");
  tasks.create("取快递");
  // Reactive fake: reads the last tool observation to decide the next turn,
  // exactly the search-then-ID pattern expected from the real model.
  const callModel: CallModel = async (messages) => {
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");
    if (!lastTool)
      return { content: null, toolCalls: [toolCall("c1", "search_tasks", { keyword: "牛奶" })] };
    const result = lastToolObservation(messages);
    const hits = result.tasks as { id: string }[] | undefined;
    if (hits?.length === 1) {
      return {
        content: null,
        toolCalls: [toolCall("c2", "update_task", { task: hits[0].id, done: true })],
      };
    }
    return { content: "已完成。", toolCalls: [] };
  };
  const reply = createAgent({ tasks, callModel });
  await reply([{ role: "user", content: "牛奶买好了" }]);
  const list = tasks.list();
  assert.equal(list.find((x) => x.title === "买牛奶")?.done, true);
  assert.equal(list.find((x) => x.title === "取快递")?.done, false);
});

test("S5+S6: delete then re-list reflects the real state", async (t) => {
  const tasks = await tempStore(t);
  tasks.create("买牛奶");
  const take = tasks.create("取快递");
  const callModel = scriptTurns(
    [
      { content: null, toolCalls: [toolCall("c1", "delete_task", { task: take.id })] },
      { content: "好的，已删除「取快递」。", toolCalls: [] },
      { content: null, toolCalls: [toolCall("c2", "list_tasks", {})] },
      { content: "只剩「买牛奶」了。", toolCalls: [] },
    ],
    [],
  );
  const reply = createAgent({ tasks, callModel });
  await reply([{ role: "user", content: "取快递这条删掉吧" }]);
  const answer = await reply([
    { role: "user", content: "取快递这条删掉吧" },
    { role: "assistant", content: "好的，已删除「取快递」。" },
    { role: "user", content: "再给我看看清单" },
  ]);
  assert.ok(answer.includes("买牛奶"));
  assert.deepEqual(
    tasks.list().map((x) => x.title),
    ["买牛奶"],
  );
});

test("ambiguity: candidates -> question to the user, no write happens", async (t) => {
  const tasks = await tempStore(t);
  tasks.create("买牛奶");
  tasks.create("热牛奶");
  const callModel: CallModel = async (messages) => {
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");
    if (!lastTool)
      return {
        content: null,
        toolCalls: [toolCall("c1", "update_task", { task: "牛奶", done: true })],
      };
    const result = lastToolObservation(messages);
    if (result.ok === false) {
      return {
        content: `有几条匹配：${(result.candidates as string[]).join("、")}，请问是哪一条？`,
        toolCalls: [],
      };
    }
    return { content: "ok", toolCalls: [] };
  };
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "牛奶做好了" }]);
  assert.ok(answer.includes("哪一条"));
  assert.ok(tasks.list().every((x) => !x.done)); // never guess
});

test("multi-action: one message creates two tasks (parallel tool calls)", async (t) => {
  const tasks = await tempStore(t);
  const log: ModelMessage[][] = [];
  const callModel = scriptTurns(
    [
      {
        content: null,
        toolCalls: [
          toolCall("c1", "create_task", { title: "买牛奶" }),
          toolCall("c2", "create_task", { title: "洗衣服" }),
        ],
      },
      { content: "两条都记好了。", toolCalls: [] },
    ],
    log,
  );
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "帮我记一下买牛奶和洗衣服" }]);
  assert.equal(answer, "两条都记好了。");
  const titles = tasks.list().map((x) => x.title);
  assert.equal(titles.length, 2);
  assert.ok(titles.includes("买牛奶") && titles.includes("洗衣服"));
  // both observations were pushed before the second model call
  const secondTurn = log[1];
  const tail = secondTurn.slice(-2);
  assert.ok(tail.every((m) => m.role === "tool"));
});

test("tool failure is an observation, the loop recovers", async (t) => {
  const tasks = await tempStore(t); // empty store
  const log: ModelMessage[][] = [];
  const callModel = scriptTurns(
    [
      { content: null, toolCalls: [toolCall("c1", "update_task", { task: "牛奶", done: true })] },
      { content: "清单里没有这条任务。", toolCalls: [] },
    ],
    log,
  );
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "牛奶买好了" }]);
  assert.equal(answer, "清单里没有这条任务。");
  const toolMsg = log[1][log[1].length - 1];
  assert.ok(toolMsg.role === "tool" && toolMsg.content.includes('"ok":false'));
});

test("step cap: 6 model calls max, then friendly guard message", async (t) => {
  const tasks = await tempStore(t);
  let calls = 0;
  const callModel: CallModel = async () => {
    calls++;
    return {
      content: null,
      toolCalls: [toolCall(`c${calls}`, "create_task", { title: `t${calls}` })],
    };
  };
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "一直加" }]);
  assert.equal(calls, 6);
  assert.ok(answer.trim().length > 0);
  assert.equal(tasks.list().length, 6); // side effects up to the cap are kept, no corruption
});

test("model outage (429/500) -> friendly message, never an exception", async (t) => {
  const tasks = await tempStore(t);
  const callModel: CallModel = async () => {
    throw new Error("429 rate limit");
  };
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "你好" }]);
  assert.equal(answer, "服务暂时不可用，请稍后再试。");
});

test("history is windowed to the last 20 messages", async (t) => {
  const tasks = await tempStore(t);
  const log: ModelMessage[][] = [];
  const callModel = scriptTurns([{ content: "ok", toolCalls: [] }], log);
  const reply = createAgent({ tasks, callModel });
  const messages: ChatMessage[] = [];
  for (let i = 0; i < 25; i++) {
    messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` });
  }
  await reply(messages);
  assert.equal(log[0].length, 21); // system + 20 windowed messages
  assert.equal(log[0][1].content, "m5");
});

test("empty final content -> non-empty fallback reply", async (t) => {
  const tasks = await tempStore(t);
  const callModel = scriptTurns([{ content: "   ", toolCalls: [] }], []);
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "你好" }]);
  assert.ok(answer.trim().length > 0);
});

test("extension: '今天有哪些任务到期？' -> list_tasks_due_today, date logic in code", async (t) => {
  const tasks = await tempStore(t);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  executeTool("create_task", { title: "今天交报告", dueDate: today }, tasks);
  executeTool("create_task", { title: "明天买菜", dueDate: "2999-01-01" }, tasks);
  const log: ModelMessage[][] = [];
  const callModel = scriptTurns(
    [
      { content: null, toolCalls: [toolCall("c1", "list_tasks_due_today", {})] },
      { content: "今天到期：⬜ 今天交报告", toolCalls: [] },
    ],
    log,
  );
  const reply = createAgent({ tasks, callModel });
  const answer = await reply([{ role: "user", content: "今天有哪些任务到期？" }]);
  assert.ok(answer.includes("今天交报告"));
  assert.ok(!answer.includes("明天买菜"));
  const obs = log[1][log[1].length - 1];
  assert.ok(obs.role === "tool" && obs.content.includes("今天交报告"));
});
