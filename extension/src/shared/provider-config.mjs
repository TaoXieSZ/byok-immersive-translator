import {
  CUSTOM_PROVIDER_PROFILE,
  DEEPSEEK_PROVIDER_PROFILE,
  validateProviderProfile
} from "./runtime-limits.mjs";

export const DEEPSEEK_PRESET = Object.freeze({
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  targetLanguage: "简体中文",
  jsonMode: true,
  performanceProfile: DEEPSEEK_PROVIDER_PROFILE
});

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

export function normalizeBaseUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("请输入 API Base URL。");
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("API Base URL 格式无效。");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("API Base URL 只能使用 HTTP 或 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API Base URL 不能包含账号、查询参数或片段。");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("远程 API 必须使用 HTTPS，HTTP 仅允许本机 loopback 地址。");
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${cleanPath === "/" ? "" : cleanPath}`;
}

export function getProviderOriginPattern(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${new URL(normalized).origin}/*`;
}

export function getChatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function isDeepSeekProvider(provider) {
  try {
    return (
      new URL(normalizeBaseUrl(provider?.baseUrl)).hostname ===
      "api.deepseek.com"
    );
  } catch {
    return false;
  }
}

export function resolveProviderProfile(provider) {
  if (provider?.performanceProfile !== undefined) {
    return validateProviderProfile(provider.performanceProfile);
  }
  return {
    ...(isDeepSeekProvider(provider)
      ? DEEPSEEK_PROVIDER_PROFILE
      : CUSTOM_PROVIDER_PROFILE)
  };
}

export function validateProviderDraft(draft) {
  const provider = {
    id: typeof draft?.id === "string" ? draft.id : "",
    name: typeof draft?.name === "string" ? draft.name.trim() : "",
    baseUrl: normalizeBaseUrl(draft?.baseUrl),
    apiKey: typeof draft?.apiKey === "string" ? draft.apiKey.trim() : "",
    model: typeof draft?.model === "string" ? draft.model.trim() : "",
    targetLanguage:
      typeof draft?.targetLanguage === "string"
        ? draft.targetLanguage.trim()
        : "",
    jsonMode: Boolean(draft?.jsonMode),
    performanceProfile: resolveProviderProfile(draft)
  };

  if (!provider.name) {
    throw new Error("请输入服务名称。");
  }
  if (!provider.apiKey) {
    throw new Error("请输入 API Key。");
  }
  if (!provider.model) {
    throw new Error("请输入模型名称。");
  }
  if (!provider.targetLanguage) {
    throw new Error("请输入目标语言。");
  }

  return provider;
}

export function toPublicProviderStatus(state) {
  const selected = state.providers.find(
    (provider) => provider.id === state.selectedProviderId
  );

  if (!selected) {
    return { configured: false };
  }

  return {
    configured: true,
    provider: {
      id: selected.id,
      name: selected.name,
      model: selected.model,
      targetLanguage: selected.targetLanguage,
      performanceProfile: resolveProviderProfile(selected)
    }
  };
}
