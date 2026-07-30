import test from "node:test";
import assert from "node:assert/strict";
import {
  createStartPageMessage,
  isSupportedPageUrl
} from "../extension/src/popup/popup-actions.mjs";
import {
  MessageType,
  TranslationScope
} from "../extension/src/shared/messages.mjs";

test("popup builds the same scoped start command used by page controls", () => {
  assert.deepEqual(createStartPageMessage(), {
    type: MessageType.START_TRANSLATION,
    scope: TranslationScope.MAIN_CONTENT
  });
  assert.deepEqual(createStartPageMessage(TranslationScope.FULL_PAGE), {
    type: MessageType.START_TRANSLATION,
    scope: TranslationScope.FULL_PAGE
  });
  assert.throws(() => createStartPageMessage("sidebar-only"));
});

test("popup only attempts injection on ordinary web pages", () => {
  assert.equal(isSupportedPageUrl("https://example.com/a"), true);
  assert.equal(isSupportedPageUrl("http://localhost:8080/a"), true);
  assert.equal(isSupportedPageUrl("chrome://extensions"), false);
  assert.equal(
    isSupportedPageUrl("https-extension://malformed.example"),
    false
  );
});
