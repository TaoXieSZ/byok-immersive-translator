export const TRANSLATION_CONCURRENCY = 3;

export const DEEPSEEK_PROVIDER_PROFILE = Object.freeze({
  stream: true,
  initialConcurrency: 6,
  minConcurrency: 2,
  maxConcurrency: 8
});

export const CUSTOM_PROVIDER_PROFILE = Object.freeze({
  stream: false,
  initialConcurrency: TRANSLATION_CONCURRENCY,
  minConcurrency: 1,
  maxConcurrency: TRANSLATION_CONCURRENCY
});

const MAX_PROVIDER_CONCURRENCY = 16;
const PROFILE_KEYS = new Set([
  "stream",
  "initialConcurrency",
  "minConcurrency",
  "maxConcurrency"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidConcurrency(value) {
  return (
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_PROVIDER_CONCURRENCY
  );
}

export function validateProviderProfile(profile) {
  if (
    !isPlainObject(profile) ||
    !Object.keys(profile).every((key) => PROFILE_KEYS.has(key))
  ) {
    throw new Error("Provider 性能画像格式无效。");
  }
  if (typeof profile.stream !== "boolean") {
    throw new Error("Provider 流式能力必须是布尔值。");
  }

  const { initialConcurrency, minConcurrency, maxConcurrency } = profile;
  if (
    !isValidConcurrency(initialConcurrency) ||
    !isValidConcurrency(minConcurrency) ||
    !isValidConcurrency(maxConcurrency) ||
    minConcurrency > initialConcurrency ||
    initialConcurrency > maxConcurrency
  ) {
    throw new Error("Provider 并发范围无效。");
  }

  return {
    stream: profile.stream,
    initialConcurrency,
    minConcurrency,
    maxConcurrency
  };
}
