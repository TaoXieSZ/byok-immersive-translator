import test from "node:test";
import assert from "node:assert/strict";
import { createTranslationService } from "../extension/src/background/translation-service.mjs";
import { MessageType } from "../extension/src/shared/messages.mjs";
import { createTranslationCacheRepository } from "../extension/src/shared/translation-cache.mjs";
import {
  createFormatDescriptor,
  serializeFormattedText,
  toRemoteFormatMetadata
} from "../extension/src/shared/translation-format.mjs";

const provider = {
  id: "p1",
  baseUrl: "https://api.example.com",
  apiKey: "secret",
  model: "fast",
  targetLanguage: "简体中文"
};

function createService(overrides = {}) {
  const events = [];
  const calls = [];
  const cache = createTranslationCacheRepository();
  const service = createTranslationService({
    repository: {
      async getSelectedProvider() {
        return provider;
      }
    },
    scheduler: {
      async run({ operation }) {
        return operation({ signal: new AbortController().signal });
      },
      cancelSession() {
        return 1;
      }
    },
    cache,
    requestBatch: async (_provider, items) => {
      calls.push(["batch", items.map((item) => item.id)]);
      return Object.fromEntries(
        items.map((item) => [item.id, `译：${item.text}`])
      );
    },
    requestSingle: async (_provider, text, _language, options) => {
      calls.push(["single", text, options.stream]);
      options.onChunk?.("译：");
      options.onChunk?.(text);
      return `译：${text}`;
    },
    requestSelection: async (
      _provider,
      selectionText,
      contextText,
      _language,
      options
    ) => {
      calls.push(["selection", selectionText, contextText, options.stream]);
      options.onChunk?.("智能");
      options.onChunk?.("体");
      return "智能体";
    },
    requestTerm: async (_provider, term, contextText, targetLanguage) => {
      calls.push(["term", term, contextText, targetLanguage]);
      return `${term} 是一个与当前段落相关的技术术语。`;
    },
    sendToTab: async (tabId, message) => events.push({ tabId, message }),
    timelineFactory: () => ({ mark() {} }),
    ...overrides
  });
  return { service, calls, events };
}

test("batch translation only sends cache misses and merges verified hits", async () => {
  const { service, calls } = createService();
  const message = {
    sessionId: "s1",
    batchIndex: 0,
    targetLanguage: "简体中文",
    items: [
      { id: "a", text: "Hello" },
      { id: "b", text: "World" }
    ]
  };

  const first = await service.translateBatch(message);
  const second = await service.translateBatch(message);

  assert.deepEqual(first.translations, {
    a: "译：Hello",
    b: "译：World"
  });
  assert.equal(second.cacheHits, 2);
  assert.deepEqual(calls, [["batch", ["a", "b"]]]);
});

test("fast lane emits chunks, completion, and then serves a zero-request hit", async () => {
  const { service, calls, events } = createService();
  const message = {
    sessionId: "s2",
    blockId: "b1",
    targetLanguage: "简体中文",
    text: "Hello"
  };

  const first = await service.translateStream(message, 9);
  const second = await service.translateStream(message, 9);

  assert.equal(first.streaming, false);
  assert.equal(second.cacheHit, true);
  assert.deepEqual(calls, [["single", "Hello", false]]);
  assert.deepEqual(
    events.map(({ message: event }) => event.type),
    [
      MessageType.TRANSLATE_STREAM_CHUNK,
      MessageType.TRANSLATE_STREAM_CHUNK,
      MessageType.TRANSLATE_STREAM_COMPLETE,
      MessageType.TRANSLATE_STREAM_COMPLETE
    ]
  );
});

test("stream failure sends a safe error and never writes partial output", async () => {
  let cacheWrites = 0;
  const { service, events } = createService({
    cache: {
      async get() {
        return null;
      },
      async setVerified() {
        cacheWrites += 1;
      }
    },
    requestSingle: async (_provider, _text, _language, options) => {
      options.onChunk("partial");
      throw Object.assign(new Error("offline"), { name: "NetworkError" });
    }
  });

  const result = await service.translateStream(
    {
      sessionId: "s3",
      blockId: "b1",
      targetLanguage: "简体中文",
      text: "Hello"
    },
    4
  );

  assert.equal(result.ok, false);
  assert.equal(
    events.at(-1).message.type,
    MessageType.TRANSLATE_STREAM_ERROR
  );
  assert.equal(cacheWrites, 0);
});

test("formatted batch failures degrade to typed plain cache entries", async () => {
  const { service, calls } = createService({
    requestBatch: async (_provider, items) => {
      calls.push(["batch", items.map((item) => item.id)]);
      return { rich: "可读的降级译文" };
    }
  });
  const message = {
    sessionId: "s-format",
    batchIndex: 0,
    targetLanguage: "简体中文",
    items: [
      {
        id: "rich",
        text: "opaque marked source",
        format: {
          version: 1,
          markIds: ["m0"],
          fingerprint: "fmt1:abcdef0123456789"
        }
      }
    ]
  };

  const first = await service.translateBatch(message);
  const second = await service.translateBatch(message);

  assert.equal(first.translations.rich, "可读的降级译文");
  assert.equal(first.resultTypes.rich, "format-fallback");
  assert.equal(second.resultTypes.rich, "format-fallback");
  assert.equal(second.cacheHits, 1);
  assert.deepEqual(calls, [["batch", ["rich"]]]);
});

test("caches complete validated serialized formatting with its fingerprint", async () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "code", start: 0, end: 4 }
  ]);
  const source = serializeFormattedText("path", descriptor);
  const [open, close] = source.match(/\uE000BYOKF:[^\uE001]+\uE001/gu);
  const translated = `${open}路径${close}`;
  const format = toRemoteFormatMetadata(descriptor);
  const { service, calls } = createService({
    requestBatch: async (_provider, items) => {
      calls.push(["batch", items.map((item) => item.id)]);
      return { rich: translated };
    }
  });
  const message = {
    sessionId: "s-formatted",
    batchIndex: 0,
    targetLanguage: "简体中文",
    items: [{ id: "rich", text: source, format }]
  };

  const first = await service.translateBatch(message);
  const second = await service.translateBatch(message);

  assert.equal(first.translations.rich, translated);
  assert.equal(first.resultTypes.rich, "formatted");
  assert.equal(second.translations.rich, translated);
  assert.equal(second.resultTypes.rich, "formatted");
  assert.equal(second.cacheHits, 1);
  assert.deepEqual(calls, [["batch", ["rich"]]]);
});

test("selection translation streams, caches by context, and serves a zero-request hit", async () => {
  const { service, calls, events } = createService();
  const message = {
    requestId: "selection-1",
    targetLanguage: "简体中文",
    selectionText: "agent",
    contextText: "The agent keeps persistent context."
  };
  const first = await service.translateSelection(message, 9);
  const second = await service.translateSelection(
    { ...message, requestId: "selection-2" },
    9
  );

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.deepEqual(calls, [
    ["selection", "agent", "The agent keeps persistent context.", false]
  ]);
  assert.deepEqual(
    events.map(({ message: event }) => event.type),
    [
      MessageType.TRANSLATE_SELECTION_CHUNK,
      MessageType.TRANSLATE_SELECTION_CHUNK,
      MessageType.TRANSLATE_SELECTION_COMPLETE,
      MessageType.TRANSLATE_SELECTION_COMPLETE
    ]
  );
});

test("selection cache separates context and explicit retranslation bypasses reads", async () => {
  const { service, calls } = createService();
  const base = {
    targetLanguage: "简体中文",
    selectionText: "agent"
  };
  await service.translateSelection(
    { ...base, requestId: "s1", contextText: "The AI agent acts." },
    1
  );
  await service.translateSelection(
    { ...base, requestId: "s2", contextText: "The legal agent acts." },
    1
  );
  await service.translateSelection(
    {
      ...base,
      requestId: "s3",
      contextText: "The AI agent acts.",
      bypassCache: true
    },
    1
  );
  assert.equal(calls.filter(([kind]) => kind === "selection").length, 3);
});

test("selection cancellation suppresses late chunks and completion", async () => {
  let finish;
  let options;
  const { service, events } = createService({
    requestSelection: async (_provider, _selection, _context, _language, value) => {
      options = value;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  });
  const pending = service.translateSelection(
    {
      requestId: "selection-cancel",
      targetLanguage: "中文",
      selectionText: "agent",
      contextText: "The agent acts."
    },
    3
  );
  while (!finish) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(service.cancelSelection("selection-cancel"), 1);
  options.onChunk("迟到");
  finish("迟到译文");
  const result = await pending;
  assert.equal(result.error.code, "REQUEST_CANCELLED");
  assert.deepEqual(events, []);
});

test("selection failures emit safe errors and never write partial cache entries", async () => {
  let cacheWrites = 0;
  const { service, events } = createService({
    cache: {
      async get() {
        return null;
      },
      async setVerified() {
        cacheWrites += 1;
      }
    },
    requestSelection: async (_provider, _selection, _context, _language, options) => {
      options.onChunk("partial");
      throw Object.assign(new Error("offline"), { name: "NetworkError" });
    }
  });
  const result = await service.translateSelection(
    {
      requestId: "selection-fail",
      targetLanguage: "中文",
      selectionText: "agent",
      contextText: "The agent acts."
    },
    4
  );
  assert.equal(result.error.code, "NETWORK_ERROR");
  assert.equal(events.at(-1).message.type, MessageType.TRANSLATE_SELECTION_ERROR);
  assert.equal(cacheWrites, 0);
});

test("selection translation reports missing provider without sending page data", async () => {
  const { service, events } = createService({
    repository: { async getSelectedProvider() { return null; } }
  });
  const result = await service.translateSelection(
    {
      requestId: "selection-no-provider",
      targetLanguage: "中文",
      selectionText: "agent",
      contextText: "The agent acts."
    },
    4
  );
  assert.equal(result.error.code, "NO_PROVIDER");
  assert.deepEqual(events, []);
});

test("term explanation uses the selected provider only after an explicit request", async () => {
  const { service, calls } = createService();
  const result = await service.explainTerm({
    requestId: "term-1",
    term: "REPL",
    contextText: "The REPL pulls messages from the query loop.",
    targetLanguage: "简体中文"
  });
  assert.deepEqual(result, {
    ok: true,
    requestId: "term-1",
    term: "REPL",
    explanation: "REPL 是一个与当前段落相关的技术术语。"
  });
  assert.deepEqual(calls, [
    [
      "term",
      "REPL",
      "The REPL pulls messages from the query loop.",
      "简体中文"
    ]
  ]);
  assert.equal(service.cancelTermExplanation("term-1"), 1);
});
