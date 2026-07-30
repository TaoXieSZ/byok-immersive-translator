export const TRANSLATION_CACHE_VERSION = 2;
export const TRANSLATION_CACHE_PREFIX =
  `byokTranslationCache:v${TRANSLATION_CACHE_VERSION}:`;

export const TranslationCacheResultType = Object.freeze({
  PLAIN: "plain",
  FORMATTED: "formatted",
  FORMAT_FALLBACK: "format-fallback"
});

const CACHE_RESULT_TYPES = new Set(Object.values(TranslationCacheResultType));
const PLAIN_FORMAT_FINGERPRINT = "format:plain";
const SAFE_FORMAT_FINGERPRINT = /^fmt1:[a-f0-9]{16}$/u;

function normalizeKeyPart(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required.`);
  }
  return value.trim();
}

function normalizeFormatFingerprint(value) {
  const fingerprint = normalizeKeyPart(value, "formatFingerprint");
  if (
    fingerprint !== PLAIN_FORMAT_FINGERPRINT &&
    !SAFE_FORMAT_FINGERPRINT.test(fingerprint)
  ) {
    throw new TypeError("A safe format fingerprint is required.");
  }
  return fingerprint;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashTranslationSource(source, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) {
    throw new Error("SHA-256 is not available in this context.");
  }
  const normalized = String(source ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const bytes = new TextEncoder().encode(normalized);
  return bytesToHex(await cryptoImpl.subtle.digest("SHA-256", bytes));
}

export async function createTranslationCacheKey(
  {
    providerId,
    model,
    targetLanguage,
    promptVersion,
    responseSchemaVersion,
    formatSchemaVersion,
    formatFingerprint,
    source,
    sourceHash
  },
  { cryptoImpl = globalThis.crypto } = {}
) {
  const dimensions = {
    providerId: normalizeKeyPart(providerId, "providerId"),
    model: normalizeKeyPart(model, "model"),
    targetLanguage: normalizeKeyPart(targetLanguage, "targetLanguage"),
    promptVersion: normalizeKeyPart(promptVersion, "promptVersion"),
    responseSchemaVersion: normalizeKeyPart(
      responseSchemaVersion,
      "responseSchemaVersion"
    ),
    formatSchemaVersion: normalizeKeyPart(
      formatSchemaVersion,
      "formatSchemaVersion"
    ),
    formatFingerprint: normalizeFormatFingerprint(formatFingerprint),
    sourceHash:
      typeof sourceHash === "string" && /^[a-f0-9]{64}$/iu.test(sourceHash)
        ? sourceHash.toLowerCase()
        : await hashTranslationSource(source, cryptoImpl)
  };
  const digest = await hashTranslationSource(
    JSON.stringify(dimensions),
    cryptoImpl
  );
  return `${TRANSLATION_CACHE_PREFIX}${digest}`;
}

function isCacheKey(key) {
  return (
    typeof key === "string" &&
    key.startsWith(TRANSLATION_CACHE_PREFIX)
  );
}

function copyEntry(entry) {
  if (
    !entry ||
    entry.version !== TRANSLATION_CACHE_VERSION ||
    typeof entry.translation !== "string" ||
    entry.translation.length === 0 ||
    !CACHE_RESULT_TYPES.has(entry.resultType) ||
    (entry.formatFingerprint !== PLAIN_FORMAT_FINGERPRINT &&
      !SAFE_FORMAT_FINGERPRINT.test(entry.formatFingerprint)) ||
    (entry.resultType === TranslationCacheResultType.PLAIN) !==
      (entry.formatFingerprint === PLAIN_FORMAT_FINGERPRINT)
  ) {
    return null;
  }
  return {
    version: entry.version,
    translation: entry.translation,
    resultType: entry.resultType,
    formatFingerprint: entry.formatFingerprint,
    cachedAt: entry.cachedAt,
    sessionId: entry.sessionId ?? null
  };
}

export function createTranslationCacheRepository(
  storageArea,
  {
    memory = new Map(),
    now = () => Date.now()
  } = {}
) {
  async function readStorage(key) {
    if (!storageArea?.get) {
      return null;
    }
    try {
      const stored = await storageArea.get(key);
      return copyEntry(stored?.[key]);
    } catch {
      return null;
    }
  }

  return {
    async get(key) {
      if (!isCacheKey(key)) {
        return null;
      }
      const stored = await readStorage(key);
      if (stored) {
        memory.set(key, stored);
        return { ...stored };
      }
      return copyEntry(memory.get(key));
    },

    async setVerified(
      key,
      translation,
      {
        sessionId = null,
        complete = true,
        verified = true,
        resultType = TranslationCacheResultType.PLAIN,
        formatFingerprint = PLAIN_FORMAT_FINGERPRINT
      } = {}
    ) {
      if (!isCacheKey(key)) {
        throw new TypeError("A versioned translation cache key is required.");
      }
      if (
        complete !== true ||
        verified !== true ||
        typeof translation !== "string" ||
        translation.length === 0
      ) {
        throw new TypeError(
          "Only complete, verified translation text can be cached."
        );
      }
      if (!CACHE_RESULT_TYPES.has(resultType)) {
        throw new TypeError("A supported translation cache result type is required.");
      }
      if (
        typeof formatFingerprint !== "string" ||
        (formatFingerprint !== PLAIN_FORMAT_FINGERPRINT &&
          !SAFE_FORMAT_FINGERPRINT.test(formatFingerprint)) ||
        (resultType === TranslationCacheResultType.PLAIN &&
          formatFingerprint !== PLAIN_FORMAT_FINGERPRINT) ||
        (resultType !== TranslationCacheResultType.PLAIN &&
          !SAFE_FORMAT_FINGERPRINT.test(formatFingerprint))
      ) {
        throw new TypeError("A safe format fingerprint is required.");
      }
      const entry = {
        version: TRANSLATION_CACHE_VERSION,
        translation,
        resultType,
        formatFingerprint,
        cachedAt: now(),
        sessionId:
          typeof sessionId === "string" && sessionId.length > 0
            ? sessionId
            : null
      };
      memory.set(key, entry);
      if (storageArea?.set) {
        try {
          await storageArea.set({ [key]: entry });
        } catch {
          // Service Worker memory remains the session-scoped fallback.
        }
      }
      return { ...entry };
    },

    async delete(key) {
      memory.delete(key);
      if (storageArea?.remove) {
        try {
          await storageArea.remove(key);
        } catch {
          // The memory fallback has still been cleared.
        }
      }
    },

    async clear() {
      memory.clear();
      if (!storageArea?.get || !storageArea?.remove) {
        return;
      }
      try {
        const stored = await storageArea.get(null);
        const keys = Object.keys(stored ?? {}).filter(isCacheKey);
        if (keys.length > 0) {
          await storageArea.remove(keys);
        }
      } catch {
        // The storage area is optional; clearing memory is sufficient fallback.
      }
    }
  };
}

export function createChromeTranslationCacheRepository(options) {
  return createTranslationCacheRepository(
    globalThis.chrome?.storage?.session,
    options
  );
}
