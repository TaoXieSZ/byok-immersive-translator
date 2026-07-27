import { ErrorCode } from "./messages.mjs";
import { getChatCompletionsUrl } from "./provider-config.mjs";

function stripCodeFence(content) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

export function buildTranslationPrompt(items, targetLanguage) {
  return [
    `Translate every value to ${targetLanguage}.`,
    "Return exactly one JSON object whose keys are the supplied ids.",
    "Every value must be only the translated plain text.",
    "Do not add, remove, rename, reorder, explain, or wrap ids.",
    JSON.stringify(Object.fromEntries(items.map((item) => [item.id, item.text])))
  ].join("\n");
}

export function buildTranslationRequest(provider, items, targetLanguage) {
  const body = {
    model: provider.model,
    messages: [
      {
        role: "system",
        content:
          "You are a precise translation engine. Preserve meaning and tone. Output valid JSON only."
      },
      {
        role: "user",
        content: buildTranslationPrompt(items, targetLanguage)
      }
    ],
    temperature: 0.1,
    stream: false
  };

  if (provider.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  return {
    url: getChatCompletionsUrl(provider.baseUrl),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body)
    }
  };
}

export function extractCompletionContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ProviderError(
      ErrorCode.INVALID_RESPONSE,
      "API 返回内容为空或不符合 Chat Completions 格式。"
    );
  }
  return content;
}

export function parseTranslationMap(content, expectedIds) {
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    throw new ProviderError(
      ErrorCode.INVALID_RESPONSE,
      "翻译结果不是有效 JSON。"
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderError(
      ErrorCode.INVALID_RESPONSE,
      "翻译结果必须是 ID 到译文的 JSON 对象。"
    );
  }

  const expected = new Set(expectedIds);
  const actualKeys = Object.keys(parsed);
  if (
    actualKeys.length !== expected.size ||
    actualKeys.some((key) => !expected.has(key)) ||
    expectedIds.some((id) => typeof parsed[id] !== "string")
  ) {
    throw new ProviderError(
      ErrorCode.INVALID_RESPONSE,
      "翻译结果的 ID 与当前批次不一致。"
    );
  }

  return Object.fromEntries(expectedIds.map((id) => [id, parsed[id]]));
}

export class ProviderError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeProviderError(error) {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message };
  }
  if (error?.name === "AbortError") {
    return {
      code: ErrorCode.REQUEST_CANCELLED,
      message: "翻译请求已取消。"
    };
  }
  return {
    code: ErrorCode.NETWORK_ERROR,
    message: "无法连接翻译服务，请检查网络、Base URL 和服务状态。"
  };
}

function errorForStatus(status) {
  if (status === 401 || status === 403) {
    return new ProviderError(
      ErrorCode.AUTH_FAILED,
      "API Token 无效或没有访问权限。",
      status
    );
  }
  if (status === 404) {
    return new ProviderError(
      ErrorCode.MODEL_NOT_FOUND,
      "接口或模型不存在，请检查 Base URL 和模型名称。",
      status
    );
  }
  if (status === 429) {
    return new ProviderError(
      ErrorCode.RATE_LIMITED,
      "请求过于频繁或额度不足，请稍后重试。",
      status
    );
  }
  return new ProviderError(
    ErrorCode.UNKNOWN_ERROR,
    `翻译服务返回 HTTP ${status}。`,
    status
  );
}

export async function requestTranslations(
  provider,
  items,
  targetLanguage,
  { signal, fetchImpl = fetch } = {}
) {
  const request = buildTranslationRequest(provider, items, targetLanguage);
  const response = await fetchImpl(request.url, {
    ...request.init,
    signal
  });
  if (!response.ok) {
    throw errorForStatus(response.status);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError(
      ErrorCode.INVALID_RESPONSE,
      "API 返回的响应体不是有效 JSON。"
    );
  }
  return parseTranslationMap(
    extractCompletionContent(payload),
    items.map((item) => item.id)
  );
}

export async function testProviderConnection(
  provider,
  { signal, fetchImpl = fetch } = {}
) {
  const translations = await requestTranslations(
    provider,
    [{ id: "connection_test", text: "hello" }],
    provider.targetLanguage,
    { signal, fetchImpl }
  );
  return typeof translations.connection_test === "string";
}
