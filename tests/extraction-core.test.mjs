import test from "node:test";
import assert from "node:assert/strict";
import {
  createProgressiveChunks,
  groupCanonicalBlocks,
  isCandidateTag,
  isMeaningfulText,
  normalizeText,
  partitionBlocksByViewport,
  prioritizeBlocksForViewport,
  reorderQueuedBlocks,
  scanProgressiveChunks,
  selectExtractionRoots
} from "../extension/src/content/extraction.mjs";
import {
  createRichTextArticleFixture,
  element,
  text
} from "./fixtures/rich-text-article.mjs";

test("recognizes semantic text blocks", () => {
  for (const tag of ["p", "H1", "li", "blockquote", "figcaption", "td"]) {
    assert.equal(isCandidateTag(tag), true);
  }
  for (const tag of ["script", "style", "code", "input", "div"]) {
    assert.equal(isCandidateTag(tag), false);
  }
});

test("normalizes whitespace and excludes punctuation-only content", () => {
  assert.equal(normalizeText(" Hello \n world "), "Hello world");
  assert.equal(isMeaningfulText("... ——"), false);
  assert.equal(isMeaningfulText("你好"), true);
  assert.equal(isMeaningfulText("A1"), true);
});

function positionedBlock(id, rect, container = "other") {
  return {
    id,
    element: {
      getBoundingClientRect: () => rect,
      closest: (selector) => {
        if (selector === "article,[role='main']") {
          return container === "article" ? {} : null;
        }
        if (selector === "main") {
          return ["article", "main"].includes(container) ? {} : null;
        }
        return null;
      }
    }
  };
}

test("prioritizes visible reading content before sidebars and offscreen blocks", () => {
  const blocks = [
    positionedBlock(
      "sidebar",
      { top: 120, bottom: 180, left: 20, right: 220 },
      "other"
    ),
    positionedBlock(
      "below",
      { top: 900, bottom: 960, left: 320, right: 680 },
      "article"
    ),
    positionedBlock(
      "visible-article",
      { top: 200, bottom: 320, left: 300, right: 700 },
      "article"
    ),
    positionedBlock(
      "above",
      { top: -300, bottom: -220, left: 300, right: 700 },
      "article"
    )
  ];

  assert.deepEqual(
    prioritizeBlocksForViewport(blocks, {
      viewportWidth: 1_000,
      viewportHeight: 800
    }).map((block) => block.id),
    ["visible-article", "sidebar", "below", "above"]
  );
});

test("keeps stable order when layout information is unavailable", () => {
  const blocks = [
    { id: "a", element: {} },
    { id: "b", element: {} }
  ];

  assert.deepEqual(
    prioritizeBlocksForViewport(blocks).map((block) => block.id),
    ["a", "b"]
  );
});

test("groups normalized duplicate text under one canonical block", () => {
  const blocks = [
    { id: "a", text: " Read  more ", formatFingerprint: "fmt1:plain" },
    { id: "b", text: "Read\nmore", formatFingerprint: "fmt1:plain" },
    { id: "c", text: "Different" }
  ];
  const { canonicalBlocks, groups } = groupCanonicalBlocks(blocks);

  assert.deepEqual(canonicalBlocks.map(({ id }) => id), ["a", "c"]);
  assert.deepEqual(groups.get("a").map(({ id }) => id), ["a", "b"]);
});

test("canonical grouping separates equal text with different format structures", () => {
  const blocks = [
    { id: "plain", text: "Same text", formatFingerprint: "fmt1:plain" },
    { id: "strong", text: "Same text", formatFingerprint: "fmt1:strong" },
    { id: "strong-copy", text: "Same text", formatFingerprint: "fmt1:strong" }
  ];
  const { canonicalBlocks, groups } = groupCanonicalBlocks(blocks);

  assert.deepEqual(canonicalBlocks.map(({ id }) => id), ["plain", "strong"]);
  assert.deepEqual(
    groups.get("strong").map(({ id }) => id),
    ["strong", "strong-copy"]
  );
});

test("extractTextAndFormat retains rich semantics without exposing link URLs remotely", async () => {
  const { extractTextAndFormat } =
    await import("../extension/src/content/extraction.mjs");
  const { heading, paragraph } = createRichTextArticleFixture();
  const headingResult = extractTextAndFormat(heading);
  const paragraphResult = extractTextAndFormat(paragraph);

  assert.equal(headingResult.text, "5. Memory");
  assert.equal(headingResult.format.marks[0].type, "strong");
  assert.match(paragraphResult.formattedText, /BYOKF:1/);
  assert.equal(
    JSON.stringify(paragraphResult.formatMetadata).includes("example.com"),
    false
  );
});

test("unsupported element attributes never enter the format model", async () => {
  const { extractTextAndFormat } =
    await import("../extension/src/content/extraction.mjs");
  const root = element("p", {}, [
    text("before "),
    element("custom-card", {
      class: "secret",
      style: "display:block",
      onclick: "run()",
      "data-token": "credential"
    }, [text("visible")]),
    text(" after")
  ]);
  const result = extractTextAndFormat(root);

  assert.equal(result.text, "before visible after");
  assert.equal(result.format, null);
  assert.equal(JSON.stringify(result).includes("credential"), false);
});

test("partitions visible blocks before progressive background chunks", () => {
  const blocks = [
    positionedBlock("visible", { top: 10, bottom: 20, left: 10, right: 20 }),
    positionedBlock("below", { top: 900, bottom: 920, left: 10, right: 20 }),
    positionedBlock("above", { top: -40, bottom: -20, left: 10, right: 20 })
  ];
  const { visible, remaining } = partitionBlocksByViewport(blocks, {
    viewportWidth: 1_000,
    viewportHeight: 800
  });

  assert.deepEqual(visible.map(({ id }) => id), ["visible"]);
  assert.deepEqual(
    createProgressiveChunks(remaining, { chunkSize: 1 }).map((chunk) =>
      chunk.map(({ id }) => id)
    ),
    [["below"], ["above"]]
  );
});

test("reorders only queued entries when viewport priority changes", () => {
  const blocks = [
    {
      ...positionedBlock("queued-below", {
        top: 900, bottom: 920, left: 10, right: 20
      }),
      status: "queued"
    },
    {
      ...positionedBlock("submitted", {
        top: 900, bottom: 920, left: 10, right: 20
      }),
      status: "translating"
    },
    {
      ...positionedBlock("queued-visible", {
        top: 10, bottom: 20, left: 10, right: 20
      }),
      status: "queued"
    }
  ];

  assert.deepEqual(
    reorderQueuedBlocks(blocks, {
      viewportWidth: 1_000,
      viewportHeight: 800
    }).map(({ id }) => id),
    ["queued-visible", "submitted", "queued-below"]
  );
});

test("selects explicit main content and falls back safely", () => {
  const article = {};
  const mainRoot = {
    matches: () => false,
    querySelectorAll: (selector) =>
      selector === "article,main,[role='main']" ? [article] : []
  };
  assert.deepEqual(selectExtractionRoots(mainRoot), {
    roots: [article],
    scope: "main",
    fallback: false
  });

  const plainRoot = {
    matches: () => false,
    querySelectorAll: () => []
  };
  assert.deepEqual(selectExtractionRoots(plainRoot), {
    roots: [plainRoot],
    scope: "main",
    fallback: true
  });
  assert.deepEqual(selectExtractionRoots(plainRoot, { scope: "all" }), {
    roots: [plainRoot],
    scope: "all",
    fallback: false
  });
});

test("stops progressive scanning after cancellation", async () => {
  const controller = new AbortController();
  const visited = [];
  for await (const chunk of scanProgressiveChunks([1, 2, 3, 4], {
    chunkSize: 2,
    signal: controller.signal
  })) {
    visited.push(chunk);
    controller.abort();
  }
  assert.deepEqual(visited, [[1, 2]]);
});
