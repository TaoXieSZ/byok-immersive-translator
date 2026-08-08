export const FLOATING_CONTROL_SCHEMA_VERSION = 1;
export const FLOATING_CONTROL_STORAGE_KEY = "byokTranslatorFloatingControl";

export const FloatingControlEdge = Object.freeze({
  LEFT: "left",
  RIGHT: "right"
});

export const DEFAULT_FLOATING_CONTROL_PREFERENCE = Object.freeze({
  version: FLOATING_CONTROL_SCHEMA_VERSION,
  edge: FloatingControlEdge.RIGHT,
  verticalRatio: 1
});

const ALLOWED_KEYS = new Set(["version", "edge", "verticalRatio"]);
const VALID_EDGES = new Set(Object.values(FloatingControlEdge));

function copyPreference(preference) {
  return {
    version: preference.version,
    edge: preference.edge,
    verticalRatio: preference.verticalRatio
  };
}

function fallbackOrThrow(strict, message) {
  if (strict) {
    throw new Error(message);
  }
  return copyPreference(DEFAULT_FLOATING_CONTROL_PREFERENCE);
}

export function normalizeFloatingControlPreference(
  input,
  { strict = false } = {}
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fallbackOrThrow(strict, "悬浮按钮位置必须是结构化对象。");
  }
  if (Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) {
    return fallbackOrThrow(strict, "悬浮按钮位置包含不支持的字段。");
  }
  if (input.version !== FLOATING_CONTROL_SCHEMA_VERSION) {
    return fallbackOrThrow(strict, "悬浮按钮位置版本不受支持。");
  }
  if (!VALID_EDGES.has(input.edge)) {
    return fallbackOrThrow(strict, "悬浮按钮必须停靠在左侧或右侧。");
  }
  if (
    !Number.isFinite(input.verticalRatio) ||
    input.verticalRatio < 0 ||
    input.verticalRatio > 1
  ) {
    return fallbackOrThrow(strict, "悬浮按钮垂直位置必须在可见范围内。");
  }
  return copyPreference(input);
}

export function validateFloatingControlPreference(input) {
  return normalizeFloatingControlPreference(input, { strict: true });
}

export function toPublicFloatingControlPreference(preference) {
  return copyPreference(normalizeFloatingControlPreference(preference));
}

export function createFloatingControlRepository(storageArea) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new Error("A compatible local storage area is required.");
  }

  return {
    async getPreference() {
      const stored = await storageArea.get(FLOATING_CONTROL_STORAGE_KEY);
      return normalizeFloatingControlPreference(
        stored?.[FLOATING_CONTROL_STORAGE_KEY]
      );
    },

    async savePreference(preference) {
      const normalized = validateFloatingControlPreference(preference);
      await storageArea.set({
        [FLOATING_CONTROL_STORAGE_KEY]: copyPreference(normalized)
      });
      return copyPreference(normalized);
    }
  };
}

export function createChromeFloatingControlRepository() {
  return createFloatingControlRepository(chrome.storage.local);
}
