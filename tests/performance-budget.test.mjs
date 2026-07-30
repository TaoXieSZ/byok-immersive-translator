import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePerformanceBudget,
  LONG_ARTICLE_REQUEST_BUDGET,
  PERFORMANCE_BUDGET_MS
} from "../extension/src/shared/performance-budget.mjs";
import { LONG_ARTICLE_BLOCKS } from "./fixtures/long-article-122.mjs";
import { RICH_TEXT_VIEWPORT_BLOCKS } from "./fixtures/rich-text-performance.mjs";
import { measureCachedViewport } from "./helpers/performance-harness.mjs";

test("cold-start performance budget covers the 122-block fixture", () => {
  const result = evaluatePerformanceBudget(
    {
      loading: 80,
      firstRequest: 120,
      firstToken: 1_800,
      viewportComplete: 4_200
    },
    {
      requestCount: LONG_ARTICLE_REQUEST_BUDGET,
      blockCount: LONG_ARTICLE_BLOCKS.length
    }
  );

  assert.equal(result.ok, true);
  assert.equal(PERFORMANCE_BUDGET_MS.loading, 100);
  assert.equal(PERFORMANCE_BUDGET_MS.firstRequest, 200);
});

test("cache budget requires a zero-request viewport under 300ms", () => {
  assert.equal(
    evaluatePerformanceBudget(
      { loading: 20, viewportComplete: 240 },
      { cached: true, requestCount: 0, blockCount: 8 }
    ).ok,
    true
  );
  assert.equal(
    evaluatePerformanceBudget(
      { loading: 20, viewportComplete: 240 },
      { cached: true, requestCount: 1, blockCount: 8 }
    ).ok,
    false
  );
});

test("formatted and fallback cache hits keep the rich viewport at zero requests", async () => {
  const cached = new Map(
    RICH_TEXT_VIEWPORT_BLOCKS.map((block, index) => [
      block.id,
      {
        translation: `cached:${block.id}`,
        resultType: index % 2 === 0 ? "formatted" : "format-fallback"
      }
    ])
  );
  const measurement = await measureCachedViewport(
    RICH_TEXT_VIEWPORT_BLOCKS,
    async (block) => cached.get(block.id)
  );
  const result = evaluatePerformanceBudget(
    {
      loading: 20,
      viewportComplete: measurement.viewportComplete
    },
    {
      cached: true,
      requestCount: measurement.requestCount,
      blockCount: RICH_TEXT_VIEWPORT_BLOCKS.length
    }
  );

  assert.equal(measurement.requestCount, 0);
  assert.equal(result.ok, true);
});

test("budget reports each failed milestone instead of hiding provider delay", () => {
  const result = evaluatePerformanceBudget(
    {
      loading: 101,
      firstRequest: 201,
      firstToken: 2_501,
      viewportComplete: 5_001
    },
    { requestCount: 9, blockCount: 122 }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.checks, {
    loading: false,
    firstRequest: false,
    firstToken: false,
    viewportComplete: false,
    requestCount: false
  });
});
