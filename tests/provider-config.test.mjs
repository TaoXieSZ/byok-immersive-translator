import test from "node:test";
import assert from "node:assert/strict";
import {
  DEEPSEEK_PRESET,
  getChatCompletionsUrl,
  getProviderOriginPattern,
  normalizeBaseUrl,
  resolveProviderProfile,
  toPublicProviderStatus,
  validateProviderDraft
} from "../extension/src/shared/provider-config.mjs";

test("ships a working DeepSeek chat preset", () => {
  assert.equal(DEEPSEEK_PRESET.baseUrl, "https://api.deepseek.com");
  assert.equal(DEEPSEEK_PRESET.model, "deepseek-v4-flash");
  assert.equal(DEEPSEEK_PRESET.jsonMode, true);
  assert.deepEqual(DEEPSEEK_PRESET.performanceProfile, {
    stream: true,
    initialConcurrency: 6,
    minConcurrency: 2,
    maxConcurrency: 8
  });
});

test("normalizes secure and loopback base URLs", () => {
  assert.equal(normalizeBaseUrl(" https://api.deepseek.com/ "), "https://api.deepseek.com");
  assert.equal(normalizeBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  assert.equal(getProviderOriginPattern("https://api.example.com/v1"), "https://api.example.com/*");
});

test("rejects insecure remote and decorated URLs", () => {
  assert.throws(() => normalizeBaseUrl("http://api.example.com"), /HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://api.example.com?token=x"), /查询参数/);
  assert.throws(() => normalizeBaseUrl("file:///tmp/api"), /HTTP/);
});

test("builds chat completions endpoint without duplication", () => {
  assert.equal(
    getChatCompletionsUrl("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions"
  );
  assert.equal(
    getChatCompletionsUrl("https://api.example.com/v1/chat/completions"),
    "https://api.example.com/v1/chat/completions"
  );
});

test("validates provider fields and strips secrets from public status", () => {
  const provider = validateProviderDraft({
    id: "p1",
    name: " Demo ",
    baseUrl: "https://api.example.com/v1/",
    apiKey: " secret ",
    model: " model-a ",
    targetLanguage: " 简体中文 ",
    jsonMode: true
  });
  const status = toPublicProviderStatus({
    providers: [provider],
    selectedProviderId: "p1"
  });

  assert.equal(provider.apiKey, "secret");
  assert.equal(status.provider.model, "model-a");
  assert.equal("apiKey" in status.provider, false);
  assert.equal("baseUrl" in status.provider, false);
});

test("adds conservative performance defaults to custom providers", () => {
  const provider = validateProviderDraft({
    id: "custom",
    name: "Custom",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "model-a",
    targetLanguage: "简体中文",
    jsonMode: false
  });

  assert.deepEqual(provider.performanceProfile, {
    stream: false,
    initialConcurrency: 3,
    minConcurrency: 1,
    maxConcurrency: 3
  });
});

test("fills legacy DeepSeek performance defaults without changing its model", () => {
  const legacy = {
    id: "legacy",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "secret",
    model: "deepseek-chat",
    targetLanguage: "简体中文",
    jsonMode: true
  };

  const provider = validateProviderDraft(legacy);
  assert.equal(provider.model, "deepseek-chat");
  assert.deepEqual(
    provider.performanceProfile,
    DEEPSEEK_PRESET.performanceProfile
  );
  assert.deepEqual(
    resolveProviderProfile(legacy),
    DEEPSEEK_PRESET.performanceProfile
  );
});

test("validates explicitly saved custom provider profiles", () => {
  const provider = validateProviderDraft({
    id: "custom",
    name: "Custom",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "model-a",
    targetLanguage: "简体中文",
    jsonMode: false,
    performanceProfile: {
      stream: true,
      initialConcurrency: 4,
      minConcurrency: 2,
      maxConcurrency: 5
    }
  });

  assert.deepEqual(provider.performanceProfile, {
    stream: true,
    initialConcurrency: 4,
    minConcurrency: 2,
    maxConcurrency: 5
  });
});
