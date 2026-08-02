import test from "node:test";
import assert from "node:assert/strict";
import {
  TranslationCacheResultType,
  TRANSLATION_CACHE_PREFIX,
  TRANSLATION_CACHE_VERSION,
  createTranslationCacheKey,
  createSelectionTranslationCacheKey,
  createTranslationCacheRepository,
  hashTranslationSource
} from "../extension/src/shared/translation-cache.mjs";

function createMemoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      if (key === null) {
        return structuredClone(data);
      }
      return { [key]: structuredClone(data[key]) };
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of [keys].flat()) {
        delete data[key];
      }
    }
  };
}

const keyContext = {
  providerId: "provider-1",
  model: "model-a",
  targetLanguage: "zh-CN",
  promptVersion: "prompt-v1",
  responseSchemaVersion: "text-v2",
  formatSchemaVersion: "format-v1",
  formatFingerprint: "format:plain",
  source: "Hello world"
};

test("builds deterministic versioned keys isolated by every context dimension", async () => {
  const key = await createTranslationCacheKey(keyContext);
  assert.equal(key.startsWith(TRANSLATION_CACHE_PREFIX), true);
  assert.equal(key.includes("Hello world"), false);
  assert.equal(await createTranslationCacheKey(keyContext), key);

  for (const [name, value] of [
    ["providerId", "provider-2"],
    ["model", "model-b"],
    ["targetLanguage", "ja"],
    ["promptVersion", "prompt-v2"],
    ["responseSchemaVersion", "text-v3"],
    ["formatSchemaVersion", "format-v2"],
    ["formatFingerprint", "fmt1:abcdef0123456789"],
    ["source", "Different source"]
  ]) {
    assert.notEqual(
      await createTranslationCacheKey({ ...keyContext, [name]: value }),
      key
    );
  }
});

test("hashes normalized source without retaining source text", async () => {
  assert.equal((await hashTranslationSource("Ａ")).length, 64);
  assert.equal(await hashTranslationSource("Ａ"), await hashTranslationSource("A"));
  assert.equal(
    await hashTranslationSource(" Hello \n world "),
    await hashTranslationSource("Hello world")
  );
});

test("stores only verified final translations and clears only cache entries", async () => {
  const storage = createMemoryStorage();
  storage.data.unrelated = { keep: true };
  const repository = createTranslationCacheRepository(storage, {
    now: () => 123
  });
  const key = await createTranslationCacheKey(keyContext);

  await assert.rejects(
    repository.setVerified(key, "partial", { complete: false }),
    /complete, verified/
  );
  await repository.setVerified(key, "你好", {
    sessionId: "s1",
    resultType: TranslationCacheResultType.FORMATTED,
    formatFingerprint: "fmt1:abcdef0123456789"
  });
  assert.deepEqual(await repository.get(key), {
    version: TRANSLATION_CACHE_VERSION,
    translation: "你好",
    resultType: TranslationCacheResultType.FORMATTED,
    formatFingerprint: "fmt1:abcdef0123456789",
    cachedAt: 123,
    sessionId: "s1"
  });
  assert.equal(JSON.stringify(storage.data).includes("Hello world"), false);

  await repository.clear();
  assert.equal(await repository.get(key), null);
  assert.deepEqual(storage.data.unrelated, { keep: true });
});

test("falls back to in-memory session cache when storage is unavailable", async () => {
  const repository = createTranslationCacheRepository({
    async get() {
      throw new Error("unavailable");
    },
    async set() {
      throw new Error("unavailable");
    }
  });
  const key = await createTranslationCacheKey(keyContext);
  await repository.setVerified(key, "你好");
  assert.equal((await repository.get(key)).translation, "你好");
});

test("distinguishes formatted and fallback entries and ignores old schemas", async () => {
  const storage = createMemoryStorage();
  const repository = createTranslationCacheRepository(storage);
  const formattedKey = await createTranslationCacheKey(keyContext);
  const fallbackKey = await createTranslationCacheKey({
    ...keyContext,
    source: "Fallback"
  });

  await repository.setVerified(formattedKey, "格式译文", {
    resultType: TranslationCacheResultType.FORMATTED,
    formatFingerprint: "fmt1:abcdef0123456789"
  });
  await repository.setVerified(fallbackKey, "降级译文", {
    resultType: TranslationCacheResultType.FORMAT_FALLBACK,
    formatFingerprint: "fmt1:abcdef0123456789"
  });

  assert.equal(
    (await repository.get(formattedKey)).resultType,
    TranslationCacheResultType.FORMATTED
  );
  assert.equal(
    (await repository.get(fallbackKey)).resultType,
    TranslationCacheResultType.FORMAT_FALLBACK
  );

  storage.data[formattedKey] = {
    version: TRANSLATION_CACHE_VERSION - 1,
    translation: "旧缓存",
    resultType: TranslationCacheResultType.FORMATTED,
    formatFingerprint: "fmt1:abcdef0123456789"
  };
  const freshRepository = createTranslationCacheRepository(storage);
  assert.equal(await freshRepository.get(formattedKey), null);
});

test("rejects incomplete, unknown, or unsafe cache metadata", async () => {
  const repository = createTranslationCacheRepository();
  const key = await createTranslationCacheKey(keyContext);

  await assert.rejects(
    createTranslationCacheKey({
      ...keyContext,
      formatFingerprint: "https://example.com/private"
    }),
    /fingerprint/
  );
  await assert.rejects(
    repository.setVerified(key, "部分译文", {
      complete: false,
      resultType: TranslationCacheResultType.FORMATTED,
      formatFingerprint: "fmt1:abcdef0123456789"
    }),
    /complete, verified/
  );
  await assert.rejects(
    repository.setVerified(key, "译文", {
      resultType: "stream-partial",
      formatFingerprint: "fmt1:abcdef0123456789"
    }),
    /result type/
  );
  await assert.rejects(
    repository.setVerified(key, "译文", {
      resultType: TranslationCacheResultType.FORMATTED,
      formatFingerprint: "https://example.com/private"
    }),
    /fingerprint/
  );
});

test("isolates selection cache by provider, prompt, selected text, and context", async () => {
  const selectionContext = {
    providerId: "provider-1",
    model: "model-a",
    targetLanguage: "zh-CN",
    promptVersion: "selection-prompt-v1",
    responseSchemaVersion: "selection-text-v1",
    selectionText: "agent",
    contextText: "The agent keeps context."
  };
  const key = await createSelectionTranslationCacheKey(selectionContext);
  assert.equal(key.startsWith(TRANSLATION_CACHE_PREFIX), true);
  assert.equal(key.includes("agent"), false);
  assert.equal(key.includes("The agent keeps context"), false);

  for (const [name, value] of [
    ["providerId", "provider-2"],
    ["model", "model-b"],
    ["targetLanguage", "ja"],
    ["promptVersion", "selection-prompt-v2"],
    ["responseSchemaVersion", "selection-text-v2"],
    ["selectionText", "runtime"],
    ["contextText", "A legal agent represents the client."]
  ]) {
    assert.notEqual(
      await createSelectionTranslationCacheKey({
        ...selectionContext,
        [name]: value
      }),
      key
    );
  }
});

test("normalizes selection cache whitespace without storing source plaintext", async () => {
  const base = {
    providerId: "provider-1",
    model: "model-a",
    targetLanguage: "zh-CN",
    promptVersion: "selection-prompt-v1",
    responseSchemaVersion: "selection-text-v1",
    selectionText: "agent context",
    contextText: "The agent keeps context."
  };
  assert.equal(
    await createSelectionTranslationCacheKey(base),
    await createSelectionTranslationCacheKey({
      ...base,
      selectionText: " agent\n context ",
      contextText: " The agent   keeps\ncontext. "
    })
  );

  const storage = createMemoryStorage();
  const repository = createTranslationCacheRepository(storage);
  const key = await createSelectionTranslationCacheKey(base);
  await repository.setVerified(key, "智能体上下文", { sessionId: "selection-1" });
  assert.equal(JSON.stringify(storage.data).includes(base.selectionText), false);
  assert.equal(JSON.stringify(storage.data).includes(base.contextText), false);
});
