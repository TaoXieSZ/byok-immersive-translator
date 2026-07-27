import test from "node:test";
import assert from "node:assert/strict";
import {
  MessageType,
  isTrustedExtensionPageSender,
  validateCancelMessage,
  validateProviderTestMessage,
  validateTranslationBatchMessage
} from "../extension/src/shared/messages.mjs";

test("accepts bounded translation messages", () => {
  assert.equal(
    validateTranslationBatchMessage({
      type: MessageType.TRANSLATE_BATCH,
      sessionId: "s1",
      targetLanguage: "简体中文",
      items: [{ id: "b1", text: "Hello" }]
    }),
    true
  );
});

test("rejects arbitrary URLs, headers, duplicate ids, and oversized input", () => {
  const base = {
    type: MessageType.TRANSLATE_BATCH,
    sessionId: "s1",
    targetLanguage: "简体中文",
    items: [{ id: "b1", text: "Hello" }]
  };
  assert.equal(validateTranslationBatchMessage({ ...base, url: "https://evil.test" }), false);
  assert.equal(validateTranslationBatchMessage({ ...base, Authorization: "secret" }), false);
  assert.equal(
    validateTranslationBatchMessage({
      ...base,
      items: [
        { id: "b1", text: "one" },
        { id: "b1", text: "two" }
      ]
    }),
    false
  );
  assert.equal(
    validateTranslationBatchMessage({
      ...base,
      items: [{ id: "b1", text: "x".repeat(20_001) }]
    }),
    false
  );
});

test("separates cancel and trusted provider test message shapes", () => {
  assert.equal(
    validateCancelMessage({ type: MessageType.CANCEL_SESSION, sessionId: "s1" }),
    true
  );
  assert.equal(
    validateProviderTestMessage({
      type: MessageType.TEST_PROVIDER,
      provider: {
        id: "p1",
        name: "Demo",
        baseUrl: "https://api.example.com",
        apiKey: "secret",
        model: "a",
        targetLanguage: "中文",
        jsonMode: false
      }
    }),
    true
  );
});

test("trusts extension pages opened in tabs but rejects web pages", () => {
  const extensionBase = "chrome-extension://abc/";
  assert.equal(
    isTrustedExtensionPageSender(
      {
        id: "abc",
        url: `${extensionBase}src/options/options.html`,
        tab: { id: 12 }
      },
      "abc",
      extensionBase
    ),
    true
  );
  assert.equal(
    isTrustedExtensionPageSender(
      { id: "abc", url: "https://example.com/", tab: { id: 12 } },
      "abc",
      extensionBase
    ),
    false
  );
});
