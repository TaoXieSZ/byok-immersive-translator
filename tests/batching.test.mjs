import test from "node:test";
import assert from "node:assert/strict";
import { createBatches } from "../extension/src/shared/batching.mjs";

test("preserves order while enforcing item and character budgets", () => {
  const items = [
    { id: "a", text: "1234" },
    { id: "b", text: "5678" },
    { id: "c", text: "90" }
  ];
  assert.deepEqual(
    createBatches(items, { maxItems: 2, maxCharacters: 6 }),
    [[items[0]], [items[1], items[2]]]
  );
});

test("keeps a single oversized block intact", () => {
  const item = { id: "large", text: "x".repeat(100) };
  assert.deepEqual(createBatches([item], { maxCharacters: 10 }), [[item]]);
});

test("rejects malformed items and budgets", () => {
  assert.throws(() => createBatches([{ id: "", text: "x" }]));
  assert.throws(() => createBatches([], { maxItems: 0 }));
});
