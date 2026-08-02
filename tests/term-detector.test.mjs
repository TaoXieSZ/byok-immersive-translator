import test from "node:test";
import assert from "node:assert/strict";
import { detectTechnicalTerms } from "../extension/src/content/term-detector.mjs";

test("detects abbreviations and proper names without ordinary sentence words", () => {
  assert.deepEqual(
    detectTechnicalTerms(
      "The REPL sends an LLM request through an API. Claude Code is Anthropic's TypeScript application."
    ),
    ["REPL", "LLM", "API", "Claude Code", "Anthropic", "TypeScript"]
  );
});

test("deduplicates terms, recognizes mixed-case brands, and applies a hard limit", () => {
  assert.deepEqual(
    detectTechnicalTerms(
      "BrowserOS hosts DeepSeek and ChatGPT. BrowserOS can expose MCP through JSON and HTTP.",
      { maxTerms: 4 }
    ),
    ["BrowserOS", "DeepSeek", "ChatGPT", "MCP"]
  );
});

test("returns no noisy candidates for ordinary prose and rejects unsafe limits", () => {
  assert.deepEqual(
    detectTechnicalTerms("This paragraph explains how the process works."),
    []
  );
  assert.throws(
    () => detectTechnicalTerms("REPL", { maxTerms: 0 }),
    /between 1 and 12/u
  );
});
