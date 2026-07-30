import test from "node:test";
import assert from "node:assert/strict";
import {
  appendStreamChunk,
  createSession,
  createThroughputBatches,
  handleSessionCommand,
  partitionTranslationLanes,
  processQueued,
  resolveTranslationScopeRoot,
  resetStreamFailure,
  restorePage,
  shouldApplyTranslationResponse,
  TranslationScope,
  translateBatches
} from "../extension/src/content/main.mjs";
import { TRANSLATION_CONCURRENCY } from "../extension/src/shared/runtime-limits.mjs";
import { MessageType } from "../extension/src/shared/messages.mjs";
import { BlockStatus } from "../extension/src/shared/session-state.mjs";

test("processQueued drains queued blocks and completes the session", async () => {
  const session = createSession("zh-CN");
  session.blocks.set("a", { id: "a", status: BlockStatus.QUEUED });
  session.blocks.set("b", { id: "b", status: BlockStatus.QUEUED });
  const statuses = [];

  await processQueued(session, {
    isActive: () => !session.stopped,
    prioritize: (blocks) => blocks,
    createBatches: (blocks) => blocks.map((block) => [block]),
    translateFast: async (_session, block) => {
      block.status = BlockStatus.TRANSLATED;
    },
    translate: async (_session, batches) => {
      for (const [block] of batches) {
        block.status = BlockStatus.TRANSLATED;
      }
    },
    onStatus: () => statuses.push(session.status)
  });

  assert.equal(session.processing, false);
  assert.equal(session.status, "completed");
  assert.deepEqual(
    [...session.blocks.values()].map((block) => block.status),
    [BlockStatus.TRANSLATED, BlockStatus.TRANSLATED]
  );
  assert.deepEqual(statuses, ["translating", "completed"]);
});

test("translateBatches runs no more than three workers concurrently", async () => {
  const session = createSession("zh-CN");
  const batches = Array.from({ length: 8 }, (_, index) => [index]);
  let active = 0;
  let maximumActive = 0;
  const visited = [];

  await translateBatches(session, batches, {
    concurrency: TRANSLATION_CONCURRENCY,
    isActive: () => true,
    translate: async (_session, [index]) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      visited.push(index);
      active -= 1;
    }
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(visited.toSorted((left, right) => left - right), [
    0, 1, 2, 3, 4, 5, 6, 7
  ]);
});

test("late responses are rejected when the active session has changed", () => {
  const session = createSession("zh-CN");
  const response = { ok: true, sessionId: session.id };

  assert.equal(
    shouldApplyTranslationResponse(session, response, session.id),
    true
  );
  assert.equal(
    shouldApplyTranslationResponse(session, response, "new-session"),
    false
  );
  session.stopped = true;
  assert.equal(
    shouldApplyTranslationResponse(session, response, session.id),
    false
  );
});

test("restorePage removes translations and source markers idempotently", () => {
  let translationRemovals = 0;
  let markerRemovals = 0;
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-byok-translator]") {
        return [{ remove: () => { translationRemovals += 1; } }];
      }
      return [{
        removeAttribute(name) {
          assert.equal(name, "data-byok-block-id");
          markerRemovals += 1;
        }
      }];
    }
  };

  assert.equal(restorePage(root).status.status, "idle");
  assert.equal(restorePage(root).status.status, "idle");
  assert.equal(translationRemovals, 2);
  assert.equal(markerRemovals, 2);
});

test("partitionTranslationLanes reserves the first queued block for fast lane", () => {
  const blocks = [
    { id: "visible", status: BlockStatus.QUEUED },
    { id: "second", status: BlockStatus.QUEUED },
    { id: "submitted", status: BlockStatus.TRANSLATING }
  ];

  assert.deepEqual(partitionTranslationLanes(blocks), {
    fast: blocks[0],
    batch: [blocks[1]]
  });
});

test("throughput lane keeps 121 background blocks within seven requests", () => {
  const blocks = Array.from({ length: 121 }, (_, index) => ({
    id: `b${index}`,
    text: `Source block ${index}`
  }));

  assert.equal(createThroughputBatches(blocks).length, 7);
});

test("stream error only clears partial state so the caller owns one fallback", () => {
  const block = {
    status: BlockStatus.TRANSLATING,
    streamText: "partial"
  };

  assert.equal(resetStreamFailure(block), block);
  assert.equal(block.status, BlockStatus.QUEUED);
  assert.equal(block.streamText, "");
  assert.equal(block.streamFallbackStarted, undefined);
});

test("formatted stream never exposes markers split across chunks", () => {
  const block = {
    format: {
      marks: [{ id: "m0", type: "strong", start: 0, end: 4 }]
    }
  };

  assert.equal(appendStreamChunk(block, "译文 \uE000BY"), "译文 ");
  assert.equal(
    appendStreamChunk(block, "OKF:m0:o\uE001粗体"),
    "译文 粗体"
  );
  assert.equal(
    appendStreamChunk(block, "\uE000BYOKF:m0:c\uE001 完成"),
    "译文 粗体 完成"
  );
  assert.equal(block.streamSerialized.includes("BYOKF"), true);
  assert.equal(block.streamVisible.includes("BYOKF"), false);
});

test("processQueued starts fast and batch lanes without submitting a block twice", async () => {
  const session = createSession("zh-CN");
  const first = { id: "first", status: BlockStatus.QUEUED };
  const second = { id: "second", status: BlockStatus.QUEUED };
  const third = { id: "third", status: BlockStatus.QUEUED };
  session.blocks.set(first.id, first);
  session.blocks.set(second.id, second);
  session.blocks.set(third.id, third);
  const fastIds = [];
  const batchIds = [];

  await processQueued(session, {
    isActive: () => !session.stopped,
    prioritize: (blocks) => blocks,
    createBatches: (blocks) => [blocks],
    translateFast: async (_session, block) => {
      fastIds.push(block.id);
      block.status = BlockStatus.TRANSLATED;
    },
    translate: async (_session, batches) => {
      for (const block of batches.flat()) {
        batchIds.push(block.id);
        block.status = BlockStatus.TRANSLATED;
      }
    },
    onStatus: () => {}
  });

  assert.deepEqual(fastIds, ["first"]);
  assert.deepEqual(batchIds, ["second", "third"]);
  assert.equal(new Set([...fastIds, ...batchIds]).size, 3);
});

test("main-content scope prefers semantic content and falls back safely", () => {
  const article = { id: "article" };
  const semanticDocument = {
    querySelector(selector) {
      assert.equal(selector, "article,main,[role='main']");
      return article;
    }
  };
  const fallbackDocument = { querySelector: () => null };

  assert.deepEqual(
    resolveTranslationScopeRoot(semanticDocument, TranslationScope.MAIN_CONTENT),
    { root: article, fallback: false }
  );
  assert.deepEqual(
    resolveTranslationScopeRoot(fallbackDocument, TranslationScope.MAIN_CONTENT),
    { root: fallbackDocument, fallback: true }
  );
  assert.deepEqual(
    resolveTranslationScopeRoot(semanticDocument, TranslationScope.FULL_PAGE),
    { root: semanticDocument, fallback: false }
  );
});

test("all page entry points share the command handler and starting is idempotent", async () => {
  let starts = 0;
  let resolveStart;
  const startPromise = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const actions = {
    start: () => {
      starts += 1;
      return startPromise;
    }
  };

  const popup = handleSessionCommand(
    { type: "page:start", scope: TranslationScope.MAIN_CONTENT },
    actions
  );
  const shortcut = handleSessionCommand(
    { type: "page:start", scope: TranslationScope.MAIN_CONTENT },
    actions
  );
  assert.equal(starts, 1);

  resolveStart({ ok: true });
  assert.deepEqual(await popup, { ok: true });
  assert.deepEqual(await shortcut, { ok: true });
});

test("full-page shortcut reuses scope and start command actions", async () => {
  const calls = [];
  const actions = {
    setScope: async (scope) => {
      calls.push(["scope", scope]);
      return { ok: true };
    },
    start: async ({ scope }) => {
      calls.push(["start", scope]);
      return { ok: true };
    }
  };

  assert.deepEqual(
    await handleSessionCommand(
      { type: MessageType.START_FULL_PAGE_TRANSLATION },
      actions
    ),
    { ok: true }
  );
  assert.deepEqual(calls, [
    ["scope", TranslationScope.FULL_PAGE],
    ["start", TranslationScope.FULL_PAGE]
  ]);
});
