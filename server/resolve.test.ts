import assert from "node:assert/strict";

import { test } from "node:test";

import { resolveTask, similarity } from "./resolve.ts";

test("resolves by exact id", () => {
  const tasks = [{ id: "a1", title: "买牛奶", done: false }];
  assert.equal(resolveTask("a1", tasks).status, "matched");
});

test("S4: '牛奶' finds '买牛奶' by substring", () => {
  const tasks = [{ id: "a1", title: "买牛奶", done: false }];
  assert.deepEqual(resolveTask("牛奶", tasks), { status: "matched", task: tasks[0] });
});

test("several substring hits -> ambiguous, never guess", () => {
  const tasks = [
    { id: "a1", title: "买牛奶", done: false },
    { id: "a2", title: "热牛奶", done: false },
  ];
  assert.equal(resolveTask("牛奶", tasks).status, "ambiguous");
});

test("no match -> none", () => {
  assert.equal(resolveTask("xxx", [{ id: "a1", title: "买牛奶", done: false }]).status, "none");
});

test("empty query -> none", () => {
  assert.equal(resolveTask("   ", [{ id: "a1", title: "买牛奶", done: false }]).status, "none");
});

test("fuzzy fallback via normalized Levenshtein", () => {
  const tasks = [{ id: "b1", title: "买牛奶", done: false }];
  // "买牛奶呢" does not exactly contain nor is contained, but is close enough
  assert.equal(resolveTask("买牛奶呢", tasks).status, "matched");
  assert.equal(similarity("买牛奶", "买牛奶"), 1);
  assert.ok(similarity("买牛奶", "买面包") < 0.7);
  assert.equal(similarity("", ""), 1);
});
