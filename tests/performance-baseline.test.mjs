import test from "node:test";
import assert from "node:assert/strict";
import { createProgressiveBatches } from "../extension/src/shared/batching.mjs";
import { LONG_ARTICLE_BLOCKS } from "./fixtures/long-article-122.mjs";
import {
  RICH_TEXT_PERFORMANCE_BLOCKS,
  RICH_TEXT_VIEWPORT_BLOCKS
} from "./fixtures/rich-text-performance.mjs";
import {
  createDeterministicClock,
  createNonStreamingProviderStub,
  createStreamingProviderStub
} from "./helpers/performance-harness.mjs";

test("122-block fixture records the pre-optimization batching baseline", () => {
  assert.equal(LONG_ARTICLE_BLOCKS.length, 122);
  const batches = createProgressiveBatches(LONG_ARTICLE_BLOCKS);

  assert.equal(batches[0].length, 3);
  assert.equal(batches.length, 13);
});

test("rich-text fixture preserves the plain-page baseline shape", () => {
  assert.equal(RICH_TEXT_PERFORMANCE_BLOCKS.length, LONG_ARTICLE_BLOCKS.length);
  assert.equal(RICH_TEXT_VIEWPORT_BLOCKS.length, 8);
  assert.equal(
    RICH_TEXT_PERFORMANCE_BLOCKS.filter((block) => block.viewport).length,
    LONG_ARTICLE_BLOCKS.filter((block) => block.viewport).length
  );

  const plainBatches = createProgressiveBatches(LONG_ARTICLE_BLOCKS);
  assert.equal(plainBatches[0].length, 3);
  assert.equal(plainBatches.length, 13);
});

test("rich-text fixture covers representative bounded inline semantics", () => {
  const markTypes = new Set(
    RICH_TEXT_VIEWPORT_BLOCKS.flatMap((block) =>
      block.format.marks.map((mark) => mark.type)
    )
  );
  assert.deepEqual(
    [...markTypes].sort(),
    ["break", "code", "em", "kbd", "link", "mark", "strong", "sub", "sup"]
  );
  assert.match(RICH_TEXT_VIEWPORT_BLOCKS[0].text, /5\. Memory/u);
  const links = RICH_TEXT_VIEWPORT_BLOCKS.flatMap((block) =>
    block.format.marks.filter((mark) => mark.type === "link")
  );
  assert.equal(links[0].link.href, "https://example.com/reference");
  assert.equal(links[1].link.href, "javascript:alert(1)");
});

test("deterministic clock records extension milestones without wall time", () => {
  const clock = createDeterministicClock(10);
  const click = clock.now();
  const loading = clock.advance(24);
  const request = clock.advance(31);

  assert.deepEqual(
    { click, loading: loading - click, request: request - click },
    { click: 10, loading: 24, request: 55 }
  );
});

test("provider stubs expose deterministic non-streaming and SSE responses", async () => {
  const nonStreaming = createNonStreamingProviderStub({ latency: 0 });
  const batchResponse = await nonStreaming.fetch("https://api.test", {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "Translate.",
            JSON.stringify({ a: "Hello" })
          ].join("\n")
        }
      ]
    })
  });
  const batchPayload = await batchResponse.json();
  assert.match(batchPayload.choices[0].message.content, /译：Hello/u);

  const streaming = createStreamingProviderStub({
    chunks: ["你", "好"],
    firstChunkDelay: 0,
    chunkDelay: 0
  });
  const streamResponse = await streaming.fetch("https://api.test", {
    body: "{}"
  });
  assert.match(await streamResponse.text(), /data: \[DONE\]/u);
  assert.equal(streaming.requests.length, 1);
});
