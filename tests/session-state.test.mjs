import test from "node:test";
import assert from "node:assert/strict";
import {
  BlockStatus,
  summarizeBlocks
} from "../extension/src/shared/session-state.mjs";

test("summarizes recoverable translation state", () => {
  const summary = summarizeBlocks(
    [
      { status: BlockStatus.TRANSLATED },
      { status: BlockStatus.FAILED },
      { status: BlockStatus.QUEUED },
      { status: BlockStatus.CANCELLED }
    ],
    "completed-with-errors",
    { code: "RATE_LIMITED", message: "later" }
  );
  assert.deepEqual(summary, {
    status: "completed-with-errors",
    queued: 1,
    translating: 0,
    translated: 1,
    failed: 1,
    cancelled: 1,
    total: 4,
    lastError: { code: "RATE_LIMITED", message: "later" }
  });
});
