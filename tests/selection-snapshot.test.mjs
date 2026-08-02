import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SELECTION_CONTEXT_CHARACTERS,
  createBoundedSelectionContext,
  createSelectionSnapshot,
  isMeaningfulSelectionText,
  normalizeSelectionText
} from "../extension/src/content/selection-snapshot.mjs";
import { createSelectionArticleFixture } from "./fixtures/selection-article.mjs";

test("normalizes selection text and enforces meaningful 1-2000 character bounds", () => {
  assert.equal(normalizeSelectionText(" agent\n  context "), "agent context");
  assert.equal(isMeaningfulSelectionText("A"), true);
  assert.equal(isMeaningfulSelectionText("智能体"), true);
  assert.equal(isMeaningfulSelectionText("... ——"), false);
  assert.equal(isMeaningfulSelectionText("x".repeat(2_000)), true);
  assert.equal(isMeaningfulSelectionText("x".repeat(2_001)), false);
});

test("creates deterministic snapshots for paragraph, list, and heading selections", () => {
  const fixture = createSelectionArticleFixture();
  assert.deepEqual(createSelectionSnapshot(fixture.paragraph), {
    selectionText: "agent",
    contextText: "The agent keeps persistent context across sessions.",
    anchorRect: {
      left: 100,
      top: 120,
      right: 260,
      bottom: 144,
      width: 160,
      height: 24
    }
  });
  assert.equal(createSelectionSnapshot(fixture.list).selectionText, "deterministic tool");
  assert.equal(createSelectionSnapshot(fixture.heading).contextText, "Memory and context");
});

test("rejects cross-container and excluded selections", () => {
  const fixture = createSelectionArticleFixture();
  for (const name of [
    "crossContainer",
    "code",
    "pre",
    "input",
    "editable",
    "translation",
    "magicLens"
  ]) {
    assert.equal(createSelectionSnapshot(fixture[name]), null, name);
  }
});

test("keeps the selected phrase inside a normalized 4000-character context window", () => {
  const fixture = createSelectionArticleFixture();
  const snapshot = createSelectionSnapshot(fixture.longParagraph);
  assert.equal(snapshot.contextText.length, MAX_SELECTION_CONTEXT_CHARACTERS);
  assert.equal(snapshot.contextText.includes("selected phrase"), true);
  assert.equal(/\s{2,}/u.test(snapshot.contextText), false);
});

test("falls back to selection when context is unsafe or cannot locate the selection", () => {
  assert.equal(
    createBoundedSelectionContext("unrelated paragraph", "selected phrase"),
    "selected phrase"
  );
  assert.throws(
    () => createBoundedSelectionContext("context", "selection", 0),
    /positive context/u
  );
});
