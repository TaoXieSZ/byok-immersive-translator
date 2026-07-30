import test from "node:test";
import assert from "node:assert/strict";
import {
  MessageType,
  TranslationScope,
  isPageMessage,
  isTrustedExtensionPageSender,
  validateAppearancePreferenceMessage,
  validateCancelMessage,
  validateGetAppearancePreferenceMessage,
  validateProviderTestMessage,
  validateTranslationBatchMessage,
  validateTranslationScope,
  validateTranslationStreamMessage
} from "../extension/src/shared/messages.mjs";

test("accepts only minimal appearance preference messages", () => {
  assert.equal(
    validateGetAppearancePreferenceMessage({
      type: MessageType.GET_APPEARANCE_PREFERENCE
    }),
    true
  );
  assert.equal(
    validateGetAppearancePreferenceMessage({
      type: MessageType.GET_APPEARANCE_PREFERENCE,
      storageKey: "byokTranslatorState"
    }),
    false
  );
  assert.equal(
    validateAppearancePreferenceMessage({
      type: MessageType.APPEARANCE_PREFERENCE_UPDATED,
      preference: {
        version: 1,
        mode: "custom",
        customFamilies: ["Maple Mono NF CN", "PingFang SC"]
      }
    }),
    true
  );
});

test("rejects appearance messages containing CSS, URLs, paths, or extra fields", () => {
  const base = {
    type: MessageType.APPEARANCE_PREFERENCE_UPDATED,
    preference: {
      version: 1,
      mode: "custom",
      customFamilies: ["Maple Mono NF CN"]
    }
  };

  for (const preference of [
    { ...base.preference, customFamilies: ["url(https://evil.test/a.woff2)"] },
    { ...base.preference, customFamilies: ["Maple Mono; color: red"] },
    { ...base.preference, customFamilies: ["/tmp/font.ttf"] },
    { ...base.preference, customFamilies: ["data:font/woff2;base64,AAAA"] },
    { ...base.preference, apiKey: "secret" },
    { ...base.preference, providerUrl: "https://api.example.com" }
  ]) {
    assert.equal(
      validateAppearancePreferenceMessage({ ...base, preference }),
      false
    );
  }
  assert.equal(
    validateAppearancePreferenceMessage({ ...base, model: "untrusted" }),
    false
  );
});

test("accepts bounded translation messages", () => {
  assert.equal(
    validateTranslationBatchMessage({
      type: MessageType.TRANSLATE_BATCH,
      sessionId: "s1",
      batchIndex: 0,
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
    batchIndex: 0,
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

test("accepts only known translation scopes in page start messages", () => {
  assert.equal(validateTranslationScope(TranslationScope.MAIN_CONTENT), true);
  assert.equal(validateTranslationScope(TranslationScope.FULL_PAGE), true);
  assert.equal(validateTranslationScope("selection"), false);
  assert.equal(
    isPageMessage({
      type: MessageType.START_TRANSLATION,
      scope: TranslationScope.MAIN_CONTENT
    }),
    true
  );
  assert.equal(
    isPageMessage({
      type: MessageType.START_TRANSLATION,
      scope: "selection"
    }),
    false
  );
  assert.equal(
    isPageMessage({
      type: MessageType.START_TRANSLATION,
      scope: TranslationScope.FULL_PAGE,
      model: "untrusted"
    }),
    false
  );
});

test("validates shared scope, toggle, and full-page commands", () => {
  assert.equal(
    isPageMessage({
      type: MessageType.SET_TRANSLATION_SCOPE,
      scope: TranslationScope.FULL_PAGE
    }),
    true
  );
  assert.equal(
    isPageMessage({ type: MessageType.TOGGLE_TRANSLATION }),
    true
  );
  assert.equal(
    isPageMessage({ type: MessageType.START_FULL_PAGE_TRANSLATION }),
    true
  );
  assert.equal(
    isPageMessage({
      type: MessageType.START_FULL_PAGE_TRANSLATION,
      scope: TranslationScope.FULL_PAGE
    }),
    false
  );
});

test("validates single-block stream start, chunk, complete, and error messages", () => {
  assert.equal(
    validateTranslationStreamMessage({
      type: MessageType.TRANSLATE_STREAM_START,
      sessionId: "s1",
      blockId: "b1",
      targetLanguage: "简体中文",
      text: "Hello"
    }),
    true
  );
  assert.equal(
    validateTranslationStreamMessage({
      type: MessageType.TRANSLATE_STREAM_CHUNK,
      sessionId: "s1",
      blockId: "b1",
      chunk: "你"
    }),
    true
  );
  assert.equal(
    validateTranslationStreamMessage({
      type: MessageType.TRANSLATE_STREAM_COMPLETE,
      sessionId: "s1",
      blockId: "b1",
      text: "你好"
    }),
    true
  );
  assert.equal(
    validateTranslationStreamMessage({
      type: MessageType.TRANSLATE_STREAM_ERROR,
      sessionId: "s1",
      blockId: "b1",
      error: {
        code: "NETWORK_ERROR",
        message: "网络错误"
      }
    }),
    true
  );
});

test("rejects stream messages with untrusted request or scheduling overrides", () => {
  const start = {
    type: MessageType.TRANSLATE_STREAM_START,
    sessionId: "s1",
    blockId: "b1",
    targetLanguage: "简体中文",
    text: "Hello"
  };

  for (const override of [
    { url: "https://evil.test" },
    { model: "untrusted" },
    { apiKey: "secret" },
    { headers: { Authorization: "secret" } },
    { concurrency: 12 },
    { stream: false },
    { performanceProfile: { maxConcurrency: 12 } }
  ]) {
    assert.equal(
      validateTranslationStreamMessage({ ...start, ...override }),
      false
    );
  }
});

test("accepts only remote-safe format metadata on batch and stream requests", () => {
  const format = {
    version: 1,
    markIds: ["m0", "m1"],
    fingerprint: "fmt1:abcdef0123456789"
  };
  assert.equal(
    validateTranslationBatchMessage({
      type: MessageType.TRANSLATE_BATCH,
      sessionId: "s-format",
      batchIndex: 1,
      targetLanguage: "简体中文",
      items: [
        {
          id: "b1",
          text: "Hello [[marker sequence]]",
          format
        }
      ]
    }),
    true
  );
  assert.equal(
    validateTranslationStreamMessage({
      type: MessageType.TRANSLATE_STREAM_START,
      sessionId: "s-format",
      blockId: "b1",
      targetLanguage: "简体中文",
      text: "Hello [[marker sequence]]",
      format
    }),
    true
  );
});

test("rejects format metadata containing DOM, URL, style, or request overrides", () => {
  const baseFormat = {
    version: 1,
    markIds: ["m0"],
    fingerprint: "fmt1:abcdef0123456789"
  };
  const base = {
    type: MessageType.TRANSLATE_STREAM_START,
    sessionId: "s-format",
    blockId: "b1",
    targetLanguage: "简体中文",
    text: "Hello"
  };

  for (const unsafe of [
    { tags: ["strong"] },
    { html: "<strong>Hello</strong>" },
    { attrs: { class: "site-class" } },
    { url: "https://example.com/private" },
    { href: "javascript:alert(1)" },
    { style: "color:red" },
    { model: "untrusted" },
    { headers: { Authorization: "secret" } },
    { concurrency: 12 },
    { stream: false }
  ]) {
    assert.equal(
      validateTranslationStreamMessage({
        ...base,
        format: { ...baseFormat, ...unsafe }
      }),
      false
    );
  }

  for (const invalidFormat of [
    { ...baseFormat, markIds: ["m0", "m0"] },
    { ...baseFormat, markIds: ["strong"] },
    { ...baseFormat, version: 999 },
    { ...baseFormat, fingerprint: "https://example.com/private" }
  ]) {
    assert.equal(
      validateTranslationStreamMessage({ ...base, format: invalidFormat }),
      false
    );
  }
});
