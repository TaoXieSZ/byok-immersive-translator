import test from "node:test";
import assert from "node:assert/strict";
import {
  isCandidateTag,
  isMeaningfulText,
  normalizeText
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
