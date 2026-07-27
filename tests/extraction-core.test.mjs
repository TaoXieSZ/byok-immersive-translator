import test from "node:test";
import assert from "node:assert/strict";
import {
  isCandidateTag,
  isMeaningfulText,
  normalizeText,
  prioritizeBlocksForViewport
} from "../extension/src/content/extraction.mjs";

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
