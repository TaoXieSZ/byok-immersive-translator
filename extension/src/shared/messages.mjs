export const MessageType = Object.freeze({
  GET_PROVIDER_STATUS: "provider:get-status",
  TEST_PROVIDER: "provider:test",
  TRANSLATE_BATCH: "translation:batch",
  CANCEL_SESSION: "translation:cancel",
  GET_PAGE_STATUS: "page:get-status",
  START_TRANSLATION: "page:start",
  STOP_TRANSLATION: "page:stop",
  RETRY_TRANSLATION: "page:retry",
  RESTORE_PAGE: "page:restore"
});

export const ErrorCode = Object.freeze({
  INVALID_MESSAGE: "INVALID_MESSAGE",
  NO_PROVIDER: "NO_PROVIDER",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  AUTH_FAILED: "AUTH_FAILED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  PAGE_UNAVAILABLE: "PAGE_UNAVAILABLE",
  NO_TRANSLATABLE_TEXT: "NO_TRANSLATABLE_TEXT",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
});

const PAGE_MESSAGE_TYPES = new Set([
  MessageType.GET_PAGE_STATUS,
  MessageType.START_TRANSLATION,
  MessageType.STOP_TRANSLATION,
  MessageType.RETRY_TRANSLATION,
  MessageType.RESTORE_PAGE
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSafeIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 160;
}

export function isPageMessage(message) {
  return isPlainObject(message) && PAGE_MESSAGE_TYPES.has(message.type);
}

export function isTrustedExtensionPageSender(
  sender,
  extensionId,
  extensionBaseUrl
) {
  return (
    sender?.id === extensionId &&
    typeof sender.url === "string" &&
    sender.url.startsWith(extensionBaseUrl)
  );
}

export function validateTranslationBatchMessage(message) {
  if (!isPlainObject(message)) {
    return false;
  }

  const allowedKeys = new Set(["type", "sessionId", "targetLanguage", "items"]);
  if (
    message.type !== MessageType.TRANSLATE_BATCH ||
    !hasOnlyKeys(message, allowedKeys) ||
    !isSafeIdentifier(message.sessionId) ||
    typeof message.targetLanguage !== "string" ||
    message.targetLanguage.length < 1 ||
    message.targetLanguage.length > 80 ||
    !Array.isArray(message.items) ||
    message.items.length < 1 ||
    message.items.length > 50
  ) {
    return false;
  }

  let totalCharacters = 0;
  const seenIds = new Set();
  for (const item of message.items) {
    if (
      !isPlainObject(item) ||
      !hasOnlyKeys(item, new Set(["id", "text"])) ||
      !isSafeIdentifier(item.id) ||
      seenIds.has(item.id) ||
      typeof item.text !== "string" ||
      item.text.length < 1 ||
      item.text.length > 20_000
    ) {
      return false;
    }
    seenIds.add(item.id);
    totalCharacters += item.text.length;
  }

  return totalCharacters <= 40_000;
}

export function validateCancelMessage(message) {
  return (
    isPlainObject(message) &&
    hasOnlyKeys(message, new Set(["type", "sessionId"])) &&
    message.type === MessageType.CANCEL_SESSION &&
    isSafeIdentifier(message.sessionId)
  );
}

export function validateProviderTestMessage(message) {
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(["type", "provider"])) ||
    message.type !== MessageType.TEST_PROVIDER ||
    !isPlainObject(message.provider)
  ) {
    return false;
  }

  const allowedProviderKeys = new Set([
    "id",
    "name",
    "baseUrl",
    "apiKey",
    "model",
    "targetLanguage",
    "jsonMode"
  ]);

  return (
    hasOnlyKeys(message.provider, allowedProviderKeys) &&
    typeof message.provider.baseUrl === "string" &&
    typeof message.provider.apiKey === "string" &&
    typeof message.provider.model === "string" &&
    typeof message.provider.targetLanguage === "string"
  );
}

export function publicError(code, message) {
  return { ok: false, error: { code, message } };
}
