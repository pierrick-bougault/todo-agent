import assert from "node:assert/strict";

import { mkdtemp, rm } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { test } from "node:test";

import type { ChatMessage } from "../shared/chat.ts";

import { createAgent } from "./agent.ts";

import { createDeepSeekCallModel } from "./model.ts";

import { createJsonTaskStore } from "./task-store.ts";

// Real-model smoke test: skipped unless DEEPSEEK_API_KEY is set, so `npm test`
// stays free and replayable in CI. Run it with:
//   node --env-file-if-exists=.env --test server/smoke.test.ts
test(
  "real DeepSeek smoke: full acceptance dialogue S1-S6",
  { skip: !process.env.DEEPSEEK_API_KEY, timeout: 120_000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "smoke-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const tasks = createJsonTaskStore(join(dir, "tasks.json"));
    const reply = createAgent({ tasks, callModel: createDeepSeekCallModel() });

    const dialogue = [
      "帮我记一下买牛奶",
      "再记一条取快递",
      "我有哪些任务？",
      "牛奶买好了",
      "取快递这条删掉吧",
      "再给我看看清单",
    ];
    const history: ChatMessage[] = [];
    for (const content of dialogue) {
      history.push({ role: "user", content });
      const answer = await reply([...history]);
      assert.ok(answer.trim().length > 0, `empty reply for: ${content}`);
      history.push({ role: "assistant", content: answer });
    }

    const list = tasks.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "买牛奶");
    assert.equal(list[0].done, true);
  },
);
