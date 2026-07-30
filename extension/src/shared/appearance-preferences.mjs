export const APPEARANCE_SCHEMA_VERSION = 1;
export const APPEARANCE_STORAGE_KEY = "byokTranslatorAppearance";

export const AppearanceMode = Object.freeze({
  DEFAULT: "default",
  MAPLE_MONO: "maple-mono",
  CUSTOM: "custom"
});

export const DEFAULT_APPEARANCE = Object.freeze({
  version: APPEARANCE_SCHEMA_VERSION,
  mode: AppearanceMode.DEFAULT,
  customFamilies: Object.freeze([])
});

const ALLOWED_KEYS = new Set(["version", "mode", "customFamilies"]);
const VALID_MODES = new Set(Object.values(AppearanceMode));
const MAX_CUSTOM_FAMILIES = 4;
const MAX_FAMILY_LENGTH = 80;
const MAX_FAMILIES_TOTAL_LENGTH = 240;
const SAFE_FAMILY_CHARACTERS = /^[\p{L}\p{M}\p{N} ._+\-()'"]+$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const CSS_FUNCTION = /(?:^|[^\p{L}\p{N}_-])[\p{L}_-][\p{L}\p{N}_-]*\s*\(/iu;
const FORBIDDEN_CONTENT =
  /(?:@font-face|https?:|file:|data:|javascript:|base64|[;{}\\/]|(?:^|[^\p{L}\p{N}_])url\s*\()/iu;

const BODY_SYSTEM_FALLBACKS = [
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei"
];
const MONO_SYSTEM_FALLBACKS = [
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas"
];
const MAPLE_MONO_FAMILIES = [
  "Maple Mono NF CN",
  "Maple Mono",
  "Maple Mono NF",
  "Maple Mono CN"
];

function copyPreference(preference) {
  return {
    version: preference.version,
    mode: preference.mode,
    customFamilies: [...preference.customFamilies]
  };
}

function fallbackOrThrow(strict, message) {
  if (strict) {
    throw new Error(message);
  }
  return copyPreference(DEFAULT_APPEARANCE);
}

function normalizeFamily(family, strict) {
  if (typeof family !== "string") {
    return fallbackOrThrow(strict, "字体名称必须是文本。");
  }
  if (CONTROL_CHARACTERS.test(family)) {
    return fallbackOrThrow(strict, "字体名称不能包含控制字符。");
  }

  const normalized = family.trim().replace(/\s+/gu, " ");
  if (!normalized) {
    return fallbackOrThrow(strict, "字体名称不能为空。");
  }
  if (normalized.length > MAX_FAMILY_LENGTH) {
    return fallbackOrThrow(
      strict,
      `单个字体名称不能超过 ${MAX_FAMILY_LENGTH} 个字符。`
    );
  }
  if (
    FORBIDDEN_CONTENT.test(normalized) ||
    CSS_FUNCTION.test(normalized) ||
    !SAFE_FAMILY_CHARACTERS.test(normalized)
  ) {
    return fallbackOrThrow(
      strict,
      "字体名称只能填写本机 family 名称，不能包含 URL、CSS、文件路径或 Base64 数据。"
    );
  }
  return normalized;
}

function quoteFontFamily(family) {
  return `"${family.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function createFontStack(families, fallbacks, genericFamily) {
  return [
    ...families.map(quoteFontFamily),
    ...fallbacks.map(quoteFontFamily),
    genericFamily
  ].join(", ");
}

export function normalizeAppearancePreference(
  input,
  { strict = false } = {}
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fallbackOrThrow(strict, "字体偏好必须是结构化对象。");
  }
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) {
    return fallbackOrThrow(strict, "字体偏好包含不支持的字段。");
  }
  if (input.version !== APPEARANCE_SCHEMA_VERSION) {
    return fallbackOrThrow(strict, "字体偏好版本不受支持。");
  }
  if (!VALID_MODES.has(input.mode)) {
    return fallbackOrThrow(strict, "字体模式不受支持。");
  }

  const suppliedFamilies =
    input.customFamilies === undefined ? [] : input.customFamilies;
  if (!Array.isArray(suppliedFamilies)) {
    return fallbackOrThrow(strict, "自定义字体必须使用 family 列表。");
  }
  if (suppliedFamilies.length > MAX_CUSTOM_FAMILIES) {
    return fallbackOrThrow(
      strict,
      `自定义字体最多只能填写 ${MAX_CUSTOM_FAMILIES} 个 family。`
    );
  }

  if (input.mode !== AppearanceMode.CUSTOM) {
    if (suppliedFamilies.length > 0) {
      return fallbackOrThrow(strict, "当前字体模式不能携带自定义 family。");
    }
    return {
      version: APPEARANCE_SCHEMA_VERSION,
      mode: input.mode,
      customFamilies: []
    };
  }
  if (suppliedFamilies.length === 0) {
    return fallbackOrThrow(strict, "自定义模式至少需要一个字体 family。");
  }

  const customFamilies = [];
  const seenFamilies = new Set();
  for (const family of suppliedFamilies) {
    const normalized = normalizeFamily(family, strict);
    if (typeof normalized !== "string") {
      return normalized;
    }
    const comparisonKey = normalized.toLocaleLowerCase("en-US");
    if (!seenFamilies.has(comparisonKey)) {
      seenFamilies.add(comparisonKey);
      customFamilies.push(normalized);
    }
  }

  if (
    customFamilies.length === 0 ||
    customFamilies.reduce((total, family) => total + family.length, 0) >
      MAX_FAMILIES_TOTAL_LENGTH
  ) {
    return fallbackOrThrow(
      strict,
      `自定义字体名称总长度不能超过 ${MAX_FAMILIES_TOTAL_LENGTH} 个字符。`
    );
  }

  return {
    version: APPEARANCE_SCHEMA_VERSION,
    mode: AppearanceMode.CUSTOM,
    customFamilies
  };
}

export function validateAppearancePreference(input) {
  return normalizeAppearancePreference(input, { strict: true });
}

export function resolveFontStacks(preference) {
  const normalized = normalizeAppearancePreference(preference);
  if (normalized.mode === AppearanceMode.DEFAULT) {
    return { body: null, mono: null };
  }

  const families =
    normalized.mode === AppearanceMode.MAPLE_MONO
      ? MAPLE_MONO_FAMILIES
      : normalized.customFamilies;
  return {
    body: createFontStack(families, BODY_SYSTEM_FALLBACKS, "sans-serif"),
    mono: createFontStack(families, MONO_SYSTEM_FALLBACKS, "monospace")
  };
}

export function toPublicAppearancePreference(preference) {
  return copyPreference(normalizeAppearancePreference(preference));
}

export function createAppearanceRepository(storageArea) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new Error("A compatible local storage area is required.");
  }

  return {
    async getPreference() {
      const stored = await storageArea.get(APPEARANCE_STORAGE_KEY);
      return normalizeAppearancePreference(stored?.[APPEARANCE_STORAGE_KEY]);
    },

    async savePreference(preference) {
      const normalized = validateAppearancePreference(preference);
      await storageArea.set({
        [APPEARANCE_STORAGE_KEY]: copyPreference(normalized)
      });
      return copyPreference(normalized);
    }
  };
}

export function createChromeAppearanceRepository() {
  return createAppearanceRepository(globalThis.chrome?.storage?.local);
}
