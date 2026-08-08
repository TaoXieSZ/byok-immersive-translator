import {
  FORMAT_RESULT_TYPE,
  FORMAT_SCHEMA_VERSION,
  MAX_FORMAT_MARKS,
  MAX_SERIALIZED_FORMAT_LENGTH
} from "./translation-format.mjs";
import {
  APPEARANCE_SCHEMA_VERSION,
  AppearanceMode,
  validateAppearancePreference
} from "./appearance-preferences.mjs";
import {
  FLOATING_CONTROL_SCHEMA_VERSION,
  FloatingControlEdge,
  validateFloatingControlPreference
} from "./floating-control-preferences.mjs";

export const MessageType = Object.freeze({
  GET_APPEARANCE_PREFERENCE: "appearance:get-preference",
  APPEARANCE_PREFERENCE_UPDATED: "appearance:preference-updated",
  GET_FLOATING_CONTROL_PREFERENCE: "floating-control:get-preference",
  SAVE_FLOATING_CONTROL_PREFERENCE: "floating-control:save-preference",
  GET_PROVIDER_STATUS: "provider:get-status",
  TEST_PROVIDER: "provider:test",
  TRANSLATE_BATCH: "translation:batch",
  TRANSLATE_STREAM_START: "translation:stream:start",
  TRANSLATE_STREAM_CHUNK: "translation:stream:chunk",
  TRANSLATE_STREAM_COMPLETE: "translation:stream:complete",
  TRANSLATE_STREAM_ERROR: "translation:stream:error",
  TRANSLATE_SELECTION_START: "selection:translate:start",
  TRANSLATE_SELECTION_CHUNK: "selection:translate:chunk",
  TRANSLATE_SELECTION_COMPLETE: "selection:translate:complete",
  TRANSLATE_SELECTION_ERROR: "selection:translate:error",
  CANCEL_SELECTION: "selection:translate:cancel",
  EXPLAIN_TERM: "term:explain",
  CANCEL_TERM_EXPLANATION: "term:explain:cancel",
  CANCEL_SESSION: "translation:cancel",
  GET_PAGE_STATUS: "page:get-status",
  START_TRANSLATION: "page:start",
  SET_TRANSLATION_SCOPE: "page:set-scope",
  TOGGLE_TRANSLATION: "page:toggle",
  START_FULL_PAGE_TRANSLATION: "page:start-full-page",
  STOP_TRANSLATION: "page:stop",
  RETRY_TRANSLATION: "page:retry",
  RESTORE_PAGE: "page:restore"
});

export const TranslationScope = Object.freeze({
  MAIN_CONTENT: "main-content",
  FULL_PAGE: "full-page"
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
  MessageType.SET_TRANSLATION_SCOPE,
  MessageType.TOGGLE_TRANSLATION,
  MessageType.START_FULL_PAGE_TRANSLATION,
  MessageType.STOP_TRANSLATION,
  MessageType.RETRY_TRANSLATION,
  MessageType.RESTORE_PAGE
]);
const TRANSLATION_STREAM_TYPES = new Set([
  MessageType.TRANSLATE_STREAM_START,
  MessageType.TRANSLATE_STREAM_CHUNK,
  MessageType.TRANSLATE_STREAM_COMPLETE,
  MessageType.TRANSLATE_STREAM_ERROR
]);
const SELECTION_MESSAGE_TYPES = new Set([
  MessageType.TRANSLATE_SELECTION_START,
  MessageType.TRANSLATE_SELECTION_CHUNK,
  MessageType.TRANSLATE_SELECTION_COMPLETE,
  MessageType.TRANSLATE_SELECTION_ERROR,
  MessageType.CANCEL_SELECTION
]);
const ERROR_CODES = new Set(Object.values(ErrorCode));
const FORMAT_RESULT_TYPES = new Set(Object.values(FORMAT_RESULT_TYPE));
const APPEARANCE_MODES = new Set(Object.values(AppearanceMode));
const PUBLIC_APPEARANCE_KEYS = new Set([
  "version",
  "mode",
  "customFamilies"
]);
const PUBLIC_FLOATING_CONTROL_KEYS = new Set([
  "version",
  "edge",
  "verticalRatio"
]);
const FLOATING_CONTROL_EDGES = new Set(Object.values(FloatingControlEdge));
const REMOTE_FORMAT_KEYS = new Set(["version", "markIds", "fingerprint"]);
const SAFE_FORMAT_FINGERPRINT = /^fmt1:[a-f0-9]{16}$/u;
const SAFE_MARK_ID = /^m\d{1,3}$/u;
const TYPE_ONLY_PAGE_MESSAGES = new Set([
  MessageType.GET_PAGE_STATUS,
  MessageType.START_FULL_PAGE_TRANSLATION,
  MessageType.STOP_TRANSLATION,
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

export function validateRemoteFormatMetadata(format) {
  if (
    !isPlainObject(format) ||
    !hasOnlyKeys(format, REMOTE_FORMAT_KEYS) ||
    format.version !== FORMAT_SCHEMA_VERSION ||
    typeof format.fingerprint !== "string" ||
    !SAFE_FORMAT_FINGERPRINT.test(format.fingerprint) ||
    !Array.isArray(format.markIds) ||
    format.markIds.length < 1 ||
    format.markIds.length > MAX_FORMAT_MARKS
  ) {
    return false;
  }
  const markIds = new Set(format.markIds);
  return (
    markIds.size === format.markIds.length &&
    format.markIds.every((markId) => SAFE_MARK_ID.test(markId))
  );
}

export function isPageMessage(message) {
  if (!isPlainObject(message) || !PAGE_MESSAGE_TYPES.has(message.type)) {
    return false;
  }
  if (TYPE_ONLY_PAGE_MESSAGES.has(message.type)) {
    return hasOnlyKeys(message, new Set(["type"]));
  }
  if (message.type === MessageType.SET_TRANSLATION_SCOPE) {
    return (
      hasOnlyKeys(message, new Set(["type", "scope"])) &&
      validateTranslationScope(message.scope)
    );
  }
  return (
    hasOnlyKeys(message, new Set(["type", "scope"])) &&
    (message.scope === undefined || validateTranslationScope(message.scope))
  );
}

export function validateTranslationScope(scope) {
  return Object.values(TranslationScope).includes(scope);
}

export function validateGetAppearancePreferenceMessage(message) {
  return (
    isPlainObject(message) &&
    hasOnlyKeys(message, new Set(["type"])) &&
    message.type === MessageType.GET_APPEARANCE_PREFERENCE
  );
}

export function validateAppearancePreferenceMessage(message) {
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(["type", "preference"])) ||
    message.type !== MessageType.APPEARANCE_PREFERENCE_UPDATED ||
    !isPlainObject(message.preference) ||
    !hasOnlyKeys(message.preference, PUBLIC_APPEARANCE_KEYS) ||
    message.preference.version !== APPEARANCE_SCHEMA_VERSION ||
    !APPEARANCE_MODES.has(message.preference.mode) ||
    !Array.isArray(message.preference.customFamilies)
  ) {
    return false;
  }

  try {
    const preference = validateAppearancePreference(message.preference);
    return (
      preference.version === message.preference.version &&
      preference.mode === message.preference.mode &&
      preference.customFamilies.length ===
        message.preference.customFamilies.length &&
      preference.customFamilies.every(
        (family, index) => family === message.preference.customFamilies[index]
      )
    );
  } catch {
    return false;
  }
}

export function validateGetFloatingControlPreferenceMessage(message) {
  return (
    isPlainObject(message) &&
    hasOnlyKeys(message, new Set(["type"])) &&
    message.type === MessageType.GET_FLOATING_CONTROL_PREFERENCE
  );
}

export function validateSaveFloatingControlPreferenceMessage(message) {
  if (
    !isPlainObject(message) ||
    !hasOnlyKeys(message, new Set(["type", "preference"])) ||
    message.type !== MessageType.SAVE_FLOATING_CONTROL_PREFERENCE ||
    !isPlainObject(message.preference) ||
    !hasOnlyKeys(message.preference, PUBLIC_FLOATING_CONTROL_KEYS) ||
    message.preference.version !== FLOATING_CONTROL_SCHEMA_VERSION ||
    !FLOATING_CONTROL_EDGES.has(message.preference.edge)
  ) {
    return false;
  }

  try {
    const preference = validateFloatingControlPreference(message.preference);
    return (
      preference.version === message.preference.version &&
      preference.edge === message.preference.edge &&
      preference.verticalRatio === message.preference.verticalRatio
    );
  } catch {
    return false;
  }
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

  const allowedKeys = new Set([
    "type",
    "sessionId",
    "batchIndex",
    "targetLanguage",
    "items"
  ]);
  if (
    message.type !== MessageType.TRANSLATE_BATCH ||
    !hasOnlyKeys(message, allowedKeys) ||
    !isSafeIdentifier(message.sessionId) ||
    !Number.isSafeInteger(message.batchIndex) ||
    message.batchIndex < 0 ||
    message.batchIndex > 1_000_000 ||
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
      !hasOnlyKeys(item, new Set(["id", "text", "format"])) ||
      !isSafeIdentifier(item.id) ||
      seenIds.has(item.id) ||
      typeof item.text !== "string" ||
      item.text.length < 1 ||
      item.text.length >
        (item.format ? MAX_SERIALIZED_FORMAT_LENGTH : 20_000) ||
      (item.format !== undefined &&
        !validateRemoteFormatMetadata(item.format))
    ) {
      return false;
    }
    seenIds.add(item.id);
    totalCharacters += item.text.length;
  }

  return totalCharacters <= 40_000;
}

export function validateTranslationStreamMessage(message) {
  if (
    !isPlainObject(message) ||
    !TRANSLATION_STREAM_TYPES.has(message.type) ||
    !isSafeIdentifier(message.sessionId) ||
    !isSafeIdentifier(message.blockId)
  ) {
    return false;
  }

  switch (message.type) {
    case MessageType.TRANSLATE_STREAM_START:
      return (
        hasOnlyKeys(
          message,
          new Set([
            "type",
            "sessionId",
            "blockId",
            "targetLanguage",
            "text",
            "format"
          ])
        ) &&
        typeof message.targetLanguage === "string" &&
        message.targetLanguage.length >= 1 &&
        message.targetLanguage.length <= 80 &&
        typeof message.text === "string" &&
        message.text.length >= 1 &&
        message.text.length <=
          (message.format ? MAX_SERIALIZED_FORMAT_LENGTH : 20_000) &&
        (message.format === undefined ||
          validateRemoteFormatMetadata(message.format))
      );
    case MessageType.TRANSLATE_STREAM_CHUNK:
      return (
        hasOnlyKeys(
          message,
          new Set(["type", "sessionId", "blockId", "chunk"])
        ) &&
        typeof message.chunk === "string" &&
        message.chunk.length >= 1 &&
        message.chunk.length <= 20_000
      );
    case MessageType.TRANSLATE_STREAM_COMPLETE:
      return (
        hasOnlyKeys(
          message,
          new Set(["type", "sessionId", "blockId", "text", "resultType"])
        ) &&
        typeof message.text === "string" &&
        message.text.length >= 1 &&
        message.text.length <= MAX_SERIALIZED_FORMAT_LENGTH &&
        (message.resultType === undefined ||
          FORMAT_RESULT_TYPES.has(message.resultType))
      );
    case MessageType.TRANSLATE_STREAM_ERROR:
      return (
        hasOnlyKeys(
          message,
          new Set(["type", "sessionId", "blockId", "error"])
        ) &&
        isPlainObject(message.error) &&
        hasOnlyKeys(message.error, new Set(["code", "message"])) &&
        ERROR_CODES.has(message.error.code) &&
        typeof message.error.message === "string" &&
        message.error.message.length >= 1 &&
        message.error.message.length <= 500
      );
    default:
      return false;
  }
}

export function validateCancelMessage(message) {
  return (
    isPlainObject(message) &&
    hasOnlyKeys(message, new Set(["type", "sessionId"])) &&
    message.type === MessageType.CANCEL_SESSION &&
    isSafeIdentifier(message.sessionId)
  );
}

export function validateSelectionMessage(message) {
  if (
    !isPlainObject(message) ||
    !SELECTION_MESSAGE_TYPES.has(message.type) ||
    !isSafeIdentifier(message.requestId)
  ) {
    return false;
  }

  switch (message.type) {
    case MessageType.TRANSLATE_SELECTION_START:
      return (
        hasOnlyKeys(
          message,
          new Set([
            "type",
            "requestId",
            "targetLanguage",
            "selectionText",
            "contextText",
            "bypassCache"
          ])
        ) &&
        typeof message.targetLanguage === "string" &&
        message.targetLanguage.length >= 1 &&
        message.targetLanguage.length <= 80 &&
        typeof message.selectionText === "string" &&
        message.selectionText.length >= 1 &&
        message.selectionText.length <= 2_000 &&
        typeof message.contextText === "string" &&
        message.contextText.length >= 1 &&
        message.contextText.length <= 4_000 &&
        (message.bypassCache === undefined ||
          typeof message.bypassCache === "boolean")
      );
    case MessageType.TRANSLATE_SELECTION_CHUNK:
      return (
        hasOnlyKeys(message, new Set(["type", "requestId", "chunk"])) &&
        typeof message.chunk === "string" &&
        message.chunk.length >= 1 &&
        message.chunk.length <= 20_000
      );
    case MessageType.TRANSLATE_SELECTION_COMPLETE:
      return (
        hasOnlyKeys(
          message,
          new Set(["type", "requestId", "text", "cacheHit"])
        ) &&
        typeof message.text === "string" &&
        message.text.length >= 1 &&
        message.text.length <= 20_000 &&
        (message.cacheHit === undefined ||
          typeof message.cacheHit === "boolean")
      );
    case MessageType.TRANSLATE_SELECTION_ERROR:
      return (
        hasOnlyKeys(message, new Set(["type", "requestId", "error"])) &&
        isPlainObject(message.error) &&
        hasOnlyKeys(message.error, new Set(["code", "message"])) &&
        ERROR_CODES.has(message.error.code) &&
        typeof message.error.message === "string" &&
        message.error.message.length >= 1 &&
        message.error.message.length <= 500
      );
    case MessageType.CANCEL_SELECTION:
      return hasOnlyKeys(message, new Set(["type", "requestId"]));
    default:
      return false;
  }
}

export function validateTermExplanationMessage(message) {
  if (
    !isPlainObject(message) ||
    ![MessageType.EXPLAIN_TERM, MessageType.CANCEL_TERM_EXPLANATION].includes(
      message.type
    ) ||
    !isSafeIdentifier(message.requestId)
  ) {
    return false;
  }
  if (message.type === MessageType.CANCEL_TERM_EXPLANATION) {
    return hasOnlyKeys(message, new Set(["type", "requestId"]));
  }
  return (
    hasOnlyKeys(
      message,
      new Set([
        "type",
        "requestId",
        "term",
        "contextText",
        "targetLanguage"
      ])
    ) &&
    typeof message.term === "string" &&
    message.term.length >= 2 &&
    message.term.length <= 60 &&
    typeof message.contextText === "string" &&
    message.contextText.length >= 1 &&
    message.contextText.length <= 4_000 &&
    typeof message.targetLanguage === "string" &&
    message.targetLanguage.length >= 1 &&
    message.targetLanguage.length <= 80
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
    "jsonMode",
    "performanceProfile"
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
