import test from "node:test";
import assert from "node:assert/strict";
import { createProgressiveBatches } from "../extension/src/shared/batching.mjs";
import {
  createFormatDescriptor,
  parseFormattedTranslation,
  serializeFormattedText
} from "../extension/src/shared/translation-format.mjs";
import {
  nodesFromParsedTranslation,
  replaceWithFormattedTranslation
} from "../extension/src/content/translation-renderer.mjs";
import {
  evaluatePerformanceBudget,
  LONG_ARTICLE_REQUEST_BUDGET
} from "../extension/src/shared/performance-budget.mjs";
import { LONG_ARTICLE_BLOCKS } from "./fixtures/long-article-122.mjs";
import {
  RICH_TEXT_VIEWPORT_BLOCKS
} from "./fixtures/rich-text-performance.mjs";
import {
  createDeterministicStageHarness,
  createInstrumentedDocument
} from "./helpers/performance-harness.mjs";

const FORMAT_OVERHEAD_BUDGET_MS = Object.freeze({
  serialization: 20,
  parsing: 25,
  domUpgrade: 5,
  total: 45
});

function descriptorFor(block) {
  return createFormatDescriptor(block.format.marks);
}

test("plain blocks keep the existing protocol and batching request count", () => {
  const serialized = LONG_ARTICLE_BLOCKS.map((block) => ({
    ...block,
    text: serializeFormattedText(block.text, null)
  }));
  const before = createProgressiveBatches(LONG_ARTICLE_BLOCKS);
  const after = createProgressiveBatches(serialized);

  assert.deepEqual(
    serialized.map((block) => block.text),
    LONG_ARTICLE_BLOCKS.map((block) => block.text)
  );
  assert.equal(after.length, before.length);
  assert.deepEqual(
    after.map((batch) => batch.length),
    before.map((batch) => batch.length)
  );
});

test("rich serialization, parsing, and final DOM upgrade stay within deterministic overhead", () => {
  const harness = createDeterministicStageHarness({ unitCostMs: 0.01 });
  const formatted = RICH_TEXT_VIEWPORT_BLOCKS.map((block) => ({
    block,
    descriptor: descriptorFor(block)
  }));

  const serialized = harness.run(
    "serialization",
    formatted.reduce(
      (units, { block, descriptor }) =>
        units + block.text.length + descriptor.marks.length * 24,
      0
    ),
    () =>
      formatted.map(({ block, descriptor }) => ({
        block,
        descriptor,
        value: serializeFormattedText(block.text, descriptor)
      }))
  );

  const parsed = harness.run(
    "parsing",
    serialized.reduce((units, item) => units + item.value.length, 0),
    () =>
      serialized.map((item) => ({
        ...item,
        parsed: parseFormattedTranslation(item.value, item.descriptor)
      }))
  );

  const dom = createInstrumentedDocument();
  harness.run(
    "domUpgrade",
    ({ operations }) => operations,
    () => {
      const before = dom.operationCount();
      for (const item of parsed) {
        replaceWithFormattedTranslation(
          dom.createContainer(),
          nodesFromParsedTranslation(item.parsed),
          item.descriptor,
          { documentLike: dom.documentLike }
        );
      }
      return { operations: dom.operationCount() - before };
    }
  );

  const report = harness.report();
  assert.ok(
    report.stages.serialization <= FORMAT_OVERHEAD_BUDGET_MS.serialization
  );
  assert.ok(report.stages.parsing <= FORMAT_OVERHEAD_BUDGET_MS.parsing);
  assert.ok(report.stages.domUpgrade <= FORMAT_OVERHEAD_BUDGET_MS.domUpgrade);
  assert.ok(report.elapsed <= FORMAT_OVERHEAD_BUDGET_MS.total);
  assert.ok(dom.documentLike.metrics.createdElements > 0);
  assert.ok(dom.documentLike.metrics.createdTextNodes > 0);

  const performance = evaluatePerformanceBudget(
    {
      loading: 80,
      firstRequest: 120 + report.stages.serialization,
      firstToken: 1_800 + report.stages.serialization,
      viewportComplete: 4_200 + report.elapsed
    },
    {
      requestCount: LONG_ARTICLE_REQUEST_BUDGET,
      blockCount: LONG_ARTICLE_BLOCKS.length
    }
  );
  assert.equal(performance.ok, true);
  assert.equal(performance.checks.loading, true);
  assert.equal(performance.checks.firstToken, true);
  assert.equal(performance.checks.viewportComplete, true);
});
