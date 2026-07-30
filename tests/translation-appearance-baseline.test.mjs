import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MessageType, validateTranslationBatchMessage } from "../extension/src/shared/messages.mjs";
import { createTranslationCacheKey } from "../extension/src/shared/translation-cache.mjs";

const root = new URL("../", import.meta.url);

test("translation typography stays scoped to extension-owned output", async () => {
  const [css, contentMain, manifestText] = await Promise.all([
    readFile(new URL("extension/src/content/content.css", root), "utf8"),
    readFile(new URL("extension/src/content/main.mjs", root), "utf8"),
    readFile(new URL("extension/manifest.json", root), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(css, /\.byok-translator__translation/u);
  assert.match(
    css,
    /\.byok-translator__translation\[data-byok-translator\] code,\s*\.byok-translator__translation\[data-byok-translator\] kbd/u
  );
  assert.doesNotMatch(contentMain, /chrome\.storage\.local/u);
  assert.equal(manifest.permissions?.includes("fontSettings"), false);
});

test("appearance data cannot override translation request boundaries", () => {
  const message = {
    type: MessageType.TRANSLATE_BATCH,
    sessionId: "s1",
    batchIndex: 0,
    targetLanguage: "简体中文",
    items: [{ id: "b1", text: "Hello" }]
  };

  assert.equal(validateTranslationBatchMessage(message), true);
  assert.equal(
    validateTranslationBatchMessage({
      ...message,
      appearance: { fontFamily: "https://evil.example/font.woff2" }
    }),
    false
  );
});

test("appearance-only changes do not invalidate translation cache keys", async () => {
  const context = {
    providerId: "provider-1",
    model: "model-a",
    targetLanguage: "zh-CN",
    promptVersion: "prompt-v1",
    responseSchemaVersion: "text-v2",
    formatSchemaVersion: "format-v1",
    formatFingerprint: "format:plain",
    source: "Hello world"
  };
  const original = await createTranslationCacheKey(context);
  const withAppearance = await createTranslationCacheKey({
    ...context,
    appearance: {
      mode: "maple-mono"
    }
  });

  assert.equal(withAppearance, original);
});
