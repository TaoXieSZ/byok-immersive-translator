import test from "node:test";
import assert from "node:assert/strict";
import {
  MessageType,
  validateAppearancePreferenceMessage
} from "../extension/src/shared/messages.mjs";
import { APPEARANCE_STORAGE_KEY } from "../extension/src/shared/appearance-preferences.mjs";

function eventTarget() {
  return { addListener() {} };
}

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(key) {
      if (key === null) return structuredClone(data);
      if (typeof key === "string") {
        return { [key]: structuredClone(data[key]) };
      }
      return structuredClone(data);
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of [keys].flat()) delete data[key];
    },
    async setAccessLevel() {}
  };
}

test("service worker composes trusted handlers without exposing provider fields", async () => {
  const previousChrome = globalThis.chrome;
  const sentMessages = [];
  let storageChangeListener;
  globalThis.chrome = {
    runtime: {
      id: "extension-id",
      getURL: (path) => `chrome-extension://extension-id/${path}`,
      onMessage: eventTarget(),
      onInstalled: eventTarget(),
      onStartup: eventTarget()
    },
    commands: { onCommand: eventTarget() },
    permissions: {
      onAdded: eventTarget(),
      onRemoved: eventTarget(),
      async contains() {
        return false;
      }
    },
    scripting: {
      async getRegisteredContentScripts() {
        return [];
      },
      async registerContentScripts() {},
      async unregisterContentScripts() {},
      async insertCSS() {},
      async executeScript() {}
    },
    tabs: {
      async query(query) {
        if (Object.keys(query).length === 0) {
          return [
            { id: 2, url: "https://example.com/article" },
            { id: 3, url: "chrome://extensions/" },
            { id: 4, url: "http://example.test/" },
            {
              id: 5,
              url: "https://chromewebstore.google.com/detail/example"
            }
          ];
        }
        return [];
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message: structuredClone(message) });
        if (tabId === 4) {
          throw new Error("no receiver");
        }
      }
    },
    storage: {
      local: storageArea({
        byokTranslatorState: {
          providers: [
            {
              id: "private-provider",
              baseUrl: "https://api.private.example",
              apiKey: "private-secret"
            }
          ],
          selectedProviderId: "private-provider"
        },
        [APPEARANCE_STORAGE_KEY]: {
          version: 1,
          mode: "maple-mono",
          customFamilies: []
        }
      }),
      session: storageArea(),
      onChanged: {
        addListener(listener) {
          storageChangeListener = listener;
        }
      }
    }
  };

  try {
    const { handleAppearanceStorageChange, handleMessage } = await import(
      `../extension/src/background/service-worker.mjs?test=${Date.now()}`
    );
    assert.equal(typeof storageChangeListener, "function");
    const providerStatus = await handleMessage(
      { type: MessageType.GET_PROVIDER_STATUS },
      { id: "extension-id" }
    );
    assert.equal(providerStatus.ok, true);
    assert.equal(providerStatus.configured, true);
    assert.equal(JSON.stringify(providerStatus).includes("private-secret"), false);
    assert.equal(
      JSON.stringify(providerStatus).includes("api.private.example"),
      false
    );
    assert.equal(
      (
        await handleMessage(
          {
            type: MessageType.TRANSLATE_STREAM_START,
            sessionId: "s1",
            blockId: "b1",
            targetLanguage: "中文",
            text: "Hello",
            url: "https://evil.example"
          },
          { id: "extension-id", tab: { id: 1 } }
        )
      ).error.code,
      "INVALID_MESSAGE"
    );
    assert.deepEqual(
      await handleMessage(
        { type: MessageType.CANCEL_SESSION, sessionId: "s1" },
        { id: "extension-id", tab: { id: 1 } }
      ),
      { ok: true }
    );
    assert.deepEqual(
      await handleMessage(
        { type: MessageType.GET_APPEARANCE_PREFERENCE },
        {
          id: "extension-id",
          tab: { id: 2, url: "https://example.com/article" }
        }
      ),
      {
        ok: true,
        preference: {
          version: 1,
          mode: "maple-mono",
          customFamilies: []
        }
      }
    );
    assert.equal(
      (
        await handleMessage(
          {
            type: MessageType.GET_APPEARANCE_PREFERENCE,
            storageKey: "byokTranslatorState"
          },
          { id: "extension-id", tab: { id: 2 } }
        )
      ).error.code,
      "INVALID_MESSAGE"
    );
    assert.equal(
      (
        await handleMessage(
          { type: MessageType.GET_APPEARANCE_PREFERENCE },
          {
            id: "different-extension",
            tab: { id: 2, url: "https://example.com/article" }
          }
        )
      ).error.code,
      "INVALID_MESSAGE"
    );
    assert.equal(
      (
        await handleMessage(
          { type: MessageType.GET_APPEARANCE_PREFERENCE },
          {
            id: "extension-id",
            url: "chrome-extension://extension-id/src/options/options.html",
            tab: {
              id: 8,
              url: "chrome-extension://extension-id/src/options/options.html"
            }
          }
        )
      ).error.code,
      "INVALID_MESSAGE"
    );

    await handleAppearanceStorageChange(
      {
        [APPEARANCE_STORAGE_KEY]: {
          oldValue: undefined,
          newValue: {
            version: 1,
            mode: "maple-mono",
            customFamilies: []
          }
        }
      },
      "local"
    );
    assert.deepEqual(
      sentMessages.map(({ tabId }) => tabId),
      [2, 4]
    );
    for (const { message } of sentMessages) {
      assert.equal(validateAppearancePreferenceMessage(message), true);
      assert.equal(JSON.stringify(message).includes("private-secret"), false);
      assert.equal(
        JSON.stringify(message).includes("api.private.example"),
        false
      );
    }

    sentMessages.length = 0;
    await handleAppearanceStorageChange(
      { [APPEARANCE_STORAGE_KEY]: { newValue: {} } },
      "sync"
    );
    await handleAppearanceStorageChange(
      { unrelated: { newValue: {} } },
      "local"
    );
    assert.deepEqual(sentMessages, []);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
