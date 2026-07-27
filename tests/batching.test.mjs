import test from "node:test";
import assert from "node:assert/strict";
import {
  createBatches,
  createProgressiveBatches
} from "../extension/src/shared/batching.mjs";

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

test("uses a small first batch before switching to throughput batches", () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: `b${index}`,
    text: "xx"
  }));

  const batches = createProgressiveBatches(items, {
    firstMaxItems: 2,
    firstMaxCharacters: 10,
    maxItems: 3,
    maxCharacters: 20
  });

  assert.deepEqual(
    batches.map((batch) => batch.map((item) => item.id)),
    [["b0", "b1"], ["b2", "b3", "b4"], ["b5", "b6"]]
  );
});

test("keeps an oversized first block intact in the fast batch", () => {
  const first = { id: "first", text: "x".repeat(100) };
  const second = { id: "second", text: "small" };

  assert.deepEqual(
    createProgressiveBatches([first, second], {
      firstMaxCharacters: 10,
      maxCharacters: 20
    }),
    [[first], [second]]
  );
});
