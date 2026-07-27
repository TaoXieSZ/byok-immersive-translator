import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTranslationRequest,
  normalizeProviderError,
  parseTranslationMap,
  requestTranslations
} from "../extension/src/shared/openai-adapter.mjs";

const provider = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "secret",
  model: "model-a",
  jsonMode: true
};

test("builds a minimal translation payload", () => {
  const { url, init } = buildTranslationRequest(
    provider,
    [{ id: "b1", text: "Hello" }],
    "简体中文"
  );
  const body = JSON.parse(init.body);
  assert.equal(url, "https://api.example.com/v1/chat/completions");
  assert.equal(init.headers.Authorization, "Bearer secret");
  assert.equal(body.model, "model-a");
  assert.match(body.messages[1].content, /"b1":"Hello"/);
  assert.doesNotMatch(init.body, /cookie|outerHTML|document/iu);
});

test("accepts reordered valid mappings and fenced JSON", () => {
  assert.deepEqual(
    parseTranslationMap('```json\n{"b2":"二","b1":"一"}\n```', ["b1", "b2"]),
    { b1: "一", b2: "二" }
  );
});

test("rejects missing, unknown, and non-string mappings", () => {
  assert.throws(() => parseTranslationMap('{"b1":"一"}', ["b1", "b2"]), /ID/);
  assert.throws(() => parseTranslationMap('{"b1":"一","x":"二"}', ["b1"]), /ID/);
  assert.throws(() => parseTranslationMap('{"b1":1}', ["b1"]), /ID/);
});

test("normalizes authentication and network errors without secrets", async () => {
  await assert.rejects(
    requestTranslations(provider, [{ id: "b1", text: "x" }], "中文", {
      fetchImpl: async () => ({ ok: false, status: 401 })
    }),
    (error) => error.code === "AUTH_FAILED" && !error.message.includes("secret")
  );
  const normalized = normalizeProviderError(new TypeError("secret network"));
  assert.equal(normalized.code, "NETWORK_ERROR");
  assert.equal(normalized.message.includes("secret"), false);
});

test("classifies a non-JSON HTTP success response as invalid", async () => {
  await assert.rejects(
    requestTranslations(provider, [{ id: "b1", text: "x" }], "中文", {
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        }
      })
    }),
    (error) =>
      error.code === "INVALID_RESPONSE" &&
      error.message === "API 返回的响应体不是有效 JSON。"
  );
});
