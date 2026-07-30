import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSingleTranslationRequest,
  buildTranslationRequest,
  normalizeProviderError,
  parseRetryAfter,
  parseTranslationMap,
  parseTranslationResults,
  requestSingleTranslation,
  requestTranslations
} from "../extension/src/shared/openai-adapter.mjs";
import {
  createFormatDescriptor,
  serializeFormattedText,
  toRemoteFormatMetadata
} from "../extension/src/shared/translation-format.mjs";

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

test("requires opaque format markers without exposing DOM metadata", () => {
  const format = {
    version: 1,
    markIds: ["m0"],
    fingerprint: "fmt1:abcdef0123456789"
  };
  const { init } = buildTranslationRequest(
    provider,
    [{ id: "b1", text: "opaque marked source", format }],
    "简体中文"
  );
  const body = JSON.parse(init.body);
  assert.match(body.messages[1].content, /byte-for-byte/iu);
  assert.match(body.messages[1].content, /"markIds":\["m0"\]/u);
  assert.doesNotMatch(
    body.messages[1].content,
    /https?:|href|site-class|<strong>/iu
  );

  const single = buildSingleTranslationRequest(
    provider,
    "opaque marked source",
    "简体中文",
    { stream: true, format }
  );
  const singleBody = JSON.parse(single.init.body);
  assert.match(singleBody.messages[1].content, /byte-for-byte/iu);
  assert.match(singleBody.messages[1].content, /"m0"/u);
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

test("keeps plain model HTML as text and safely types malformed format output", () => {
  assert.deepEqual(
    parseTranslationResults('{"plain":"<strong>译文</strong>"}', [
      { id: "plain", text: "source" }
    ]),
    {
      translations: { plain: "<strong>译文</strong>" },
      resultTypes: { plain: "plain" }
    }
  );

  assert.deepEqual(
    parseTranslationResults('{"rich":"缺少扩展标记的可读译文"}', [
      {
        id: "rich",
        text: "opaque marked source",
        format: {
          version: 1,
          markIds: ["m0"],
          fingerprint: "fmt1:abcdef0123456789"
        }
      }
    ]),
    {
      translations: { rich: "缺少扩展标记的可读译文" },
      resultTypes: { rich: "format-fallback" }
    }
  );
});

test("accepts moved complete marker pairs and preserves the serialized result", async () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 6 },
    { id: "m1", type: "code", start: 7, end: 11 }
  ]);
  const source = serializeFormattedText("Memory path", descriptor);
  const [openStrong, closeStrong, openCode, closeCode] =
    source.match(/\uE000BYOKF:[^\uE001]+\uE001/gu);
  const translated =
    `${openCode}路径${closeCode}中的${openStrong}记忆${closeStrong}`;
  const item = {
    id: "rich",
    text: source,
    format: toRemoteFormatMetadata(descriptor)
  };

  assert.deepEqual(
    parseTranslationResults(JSON.stringify({ rich: translated }), [item]),
    {
      translations: { rich: translated },
      resultTypes: { rich: "formatted" }
    }
  );

  const result = await requestSingleTranslation(
    provider,
    source,
    "简体中文",
    {
      stream: false,
      format: item.format,
      includeResultMetadata: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: translated } }]
        })
      })
    }
  );
  assert.deepEqual(result, {
    text: translated,
    resultType: "formatted"
  });
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

function streamResponse(parts) {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(new TextEncoder().encode(part));
        }
        controller.close();
      }
    })
  };
}

test("builds a pure-text single-segment request", () => {
  const request = buildSingleTranslationRequest(
    provider,
    "Hello",
    "简体中文",
    { stream: true }
  );
  const body = JSON.parse(request.init.body);
  assert.equal(body.stream, true);
  assert.equal(body.response_format, undefined);
  assert.match(body.messages[1].content, /Hello/u);
  assert.match(body.messages[0].content, /plain text/u);
});

test("parses split SSE data frames and emits only text chunks", async () => {
  const chunks = [];
  const result = await requestSingleTranslation(
    provider,
    "Hello",
    "简体中文",
    {
      onChunk: (chunk) => chunks.push(chunk),
      fetchImpl: async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\r\n\r\n',
          'data: {"choices":[{"delta":{}}]}\n\ndata: {"choices":[{"delta":{"cont',
          'ent":"好"}}]}\n\ndata: [DONE]\r\r'
        ])
    }
  );
  assert.equal(result, "你好");
  assert.deepEqual(chunks, ["你", "好"]);
});

test("completes at the DONE frame without waiting for transport close", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n'
        )
      );
    },
    cancel() {
      cancelled = true;
    }
  });
  const result = await requestSingleTranslation(provider, "Done", "中文", {
    fetchImpl: async () => ({ ok: true, body })
  });
  assert.equal(result, "完成");
  assert.equal(cancelled, true);
});

test("rejects malformed and interrupted SSE without confirming partial text", async () => {
  await assert.rejects(
    requestSingleTranslation(provider, "Hello", "中文", {
      fetchImpl: async () => streamResponse(["data: {bad}\n\n"]),
      onChunk: () => {}
    }),
    (error) => error.code === "INVALID_RESPONSE" && /SSE/u.test(error.message)
  );
  await assert.rejects(
    requestSingleTranslation(provider, "Hello", "中文", {
      fetchImpl: async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"部"}}]}\n\n'
        ])
    }),
    (error) => error.code === "INVALID_RESPONSE" && /中断/u.test(error.message)
  );
});

test("supports a non-streaming single-segment fallback", async () => {
  const result = await requestSingleTranslation(provider, "Hello", "中文", {
    stream: false,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "你好" } }]
      })
    })
  });
  assert.equal(result, "你好");
});

test("exposes only safe status and Retry-After scheduling metadata", async () => {
  await assert.rejects(
    requestSingleTranslation(provider, "Hello", "中文", {
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "2" })
      })
    }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 2000);
      assert.deepEqual(normalizeProviderError(error), {
        code: "RATE_LIMITED",
        message: "请求过于频繁或额度不足，请稍后重试。",
        status: 429,
        retryAfter: 2000
      });
      return true;
    }
  );
  assert.equal(parseRetryAfter("invalid"), null);
  assert.equal(parseRetryAfter("1.5"), null);
  assert.equal(
    parseRetryAfter(
      "Wed, 21 Oct 2015 07:28:00 GMT",
      Date.parse("Wed, 21 Oct 2015 07:27:59 GMT")
    ),
    1000
  );
});
