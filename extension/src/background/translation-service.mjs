import {
  ErrorCode,
  MessageType,
  publicError
} from "../shared/messages.mjs";
import {
  normalizeProviderError,
  requestSelectionTranslation,
  requestSingleTranslation,
  requestTranslations
} from "../shared/openai-adapter.mjs";
import { resolveProviderProfile } from "../shared/provider-config.mjs";
import {
  TranslationCacheResultType,
  createSelectionTranslationCacheKey,
  createTranslationCacheKey
} from "../shared/translation-cache.mjs";
import {
  FORMAT_RESULT_TYPE,
  FORMAT_SCHEMA_VERSION,
  validateFormattedTranslationOrFallback
} from "../shared/translation-format.mjs";
import {
  createPerformanceTimeline,
  toSafeLogError
} from "../shared/translation-log.mjs";

export const TRANSLATION_PROMPT_VERSION = "translation-v3-format-v1";
export const BATCH_RESPONSE_SCHEMA_VERSION = "batch-json-v2";
export const SINGLE_RESPONSE_SCHEMA_VERSION = "single-text-v2";
export const SELECTION_PROMPT_VERSION = "selection-context-v1";
export const SELECTION_RESPONSE_SCHEMA_VERSION = "selection-text-v1";
const PLAIN_FORMAT_FINGERPRINT = "format:plain";

function cacheContext(
  provider,
  targetLanguage,
  source,
  responseSchemaVersion,
  format
) {
  return {
    providerId: provider.id,
    model: provider.model,
    targetLanguage,
    promptVersion: TRANSLATION_PROMPT_VERSION,
    responseSchemaVersion,
    formatSchemaVersion: `format-v${format?.version ?? FORMAT_SCHEMA_VERSION}`,
    formatFingerprint: format?.fingerprint ?? PLAIN_FORMAT_FINGERPRINT,
    source
  };
}

async function readCached(cache, context) {
  const key = await createTranslationCacheKey(context);
  return { key, entry: await cache.get(key) };
}

function validateRemoteResult(text, format) {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("Translation result must be non-empty text.");
  }
  if (!format) {
    return {
      text,
      resultType: FORMAT_RESULT_TYPE.PLAIN
    };
  }
  const result = validateFormattedTranslationOrFallback(text, format);
  return {
    text:
      result.resultType === FORMAT_RESULT_TYPE.FORMATTED
        ? text
        : result.text,
    resultType: result.resultType
  };
}

function normalizeBatchResults(remoteResult, items) {
  const rawTranslations =
    remoteResult?.translations &&
    typeof remoteResult.translations === "object" &&
    !Array.isArray(remoteResult.translations)
      ? remoteResult.translations
      : remoteResult;
  const translations = {};
  const resultTypes = {};
  for (const item of items) {
    const result = validateRemoteResult(rawTranslations?.[item.id], item.format);
    translations[item.id] = result.text;
    resultTypes[item.id] = result.resultType;
  }
  return { translations, resultTypes };
}

export function createTranslationService({
  repository,
  scheduler,
  cache,
  requestBatch = requestTranslations,
  requestSingle = requestSingleTranslation,
  requestSelection = requestSelectionTranslation,
  sendToTab = async () => {},
  timelineFactory = createPerformanceTimeline
}) {
  if (!repository || !scheduler || !cache) {
    throw new Error("Translation service dependencies are required.");
  }
  const selectionTokens = new Map();

  async function selectedProvider() {
    return repository.getSelectedProvider();
  }

  async function translateBatch(message) {
    const provider = await selectedProvider();
    if (!provider) {
      return publicError(ErrorCode.NO_PROVIDER, "请先配置并选择翻译服务。");
    }

    const timeline = timelineFactory({
      sessionId: message.sessionId,
      context: "background"
    });
    const cachedTranslations = {};
    const cachedResultTypes = {};
    const misses = [];
    const keys = new Map();

    for (const item of message.items) {
      const { key, entry } = await readCached(
        cache,
        cacheContext(
          provider,
          message.targetLanguage,
          item.text,
          BATCH_RESPONSE_SCHEMA_VERSION,
          item.format
        )
      );
      keys.set(item.id, key);
      if (entry) {
        cachedTranslations[item.id] = entry.translation;
        cachedResultTypes[item.id] = entry.resultType;
      } else {
        misses.push(item);
      }
    }

    timeline.mark("cache-lookup", {
      channel: "batch",
      batchIndex: message.batchIndex,
      cacheHits: message.items.length - misses.length,
      itemCount: message.items.length
    });

    let remoteTranslations = {};
    const remoteResultTypes = {};
    if (misses.length > 0) {
      const profile = resolveProviderProfile(provider);
      try {
        const remoteResult = await scheduler.run({
          providerId: provider.id,
          profile,
          sessionId: message.sessionId,
          operation: ({ signal }) =>
            requestBatch(
              provider,
              misses,
              message.targetLanguage,
              { signal, includeResultMetadata: true }
            )
        });
        const normalized = normalizeBatchResults(remoteResult, misses);
        remoteTranslations = normalized.translations;
        Object.assign(remoteResultTypes, normalized.resultTypes);
      } catch (error) {
        const normalized = normalizeProviderError(error);
        timeline.mark(
          "batch-failed",
          {
            channel: "batch",
            batchIndex: message.batchIndex,
            error: toSafeLogError(normalized)
          },
          "error"
        );
        return publicError(normalized.code, normalized.message);
      }

      await Promise.all(
        misses.map((item) =>
          cache.setVerified(keys.get(item.id), remoteTranslations[item.id], {
            sessionId: message.sessionId,
            resultType:
              remoteResultTypes[item.id] ?? TranslationCacheResultType.PLAIN,
            formatFingerprint:
              item.format?.fingerprint ?? PLAIN_FORMAT_FINGERPRINT
          })
        )
      );
    }

    timeline.mark("batch-complete", {
      channel: "batch",
      batchIndex: message.batchIndex,
      cacheHits: message.items.length - misses.length,
      itemCount: message.items.length
    });
    return {
      ok: true,
      sessionId: message.sessionId,
      translations: {
        ...cachedTranslations,
        ...remoteTranslations
      },
      resultTypes: {
        ...cachedResultTypes,
        ...remoteResultTypes
      },
      cacheHits: message.items.length - misses.length
    };
  }

  async function translateStream(message, tabId) {
    const provider = await selectedProvider();
    if (!provider) {
      return publicError(ErrorCode.NO_PROVIDER, "请先配置并选择翻译服务。");
    }

    const profile = resolveProviderProfile(provider);
    const timeline = timelineFactory({
      sessionId: message.sessionId,
      context: "background"
    });
    const { key, entry } = await readCached(
      cache,
      cacheContext(
        provider,
        message.targetLanguage,
        message.text,
        SINGLE_RESPONSE_SCHEMA_VERSION,
        message.format
      )
    );
    if (entry) {
      await sendToTab(tabId, {
        type: MessageType.TRANSLATE_STREAM_COMPLETE,
        sessionId: message.sessionId,
        blockId: message.blockId,
        text: entry.translation,
        resultType: entry.resultType
      });
      timeline.mark("cache-hit", {
        channel: "fast",
        blockIndex: 0
      });
      return {
        ok: true,
        sessionId: message.sessionId,
        blockId: message.blockId,
        text: entry.translation,
        resultType: entry.resultType,
        cacheHit: true
      };
    }

    let sawFirstChunk = false;
    try {
      const remoteResult = await scheduler.run({
        providerId: provider.id,
        profile,
        sessionId: message.sessionId,
        maxRetries: 0,
        operation: ({ signal }) =>
          requestSingle(
            provider,
            message.text,
            message.targetLanguage,
            {
              signal,
              stream: profile.stream,
              format: message.format,
              includeResultMetadata: true,
              onChunk: (chunk) => {
                if (!sawFirstChunk) {
                  sawFirstChunk = true;
                  timeline.mark("first-token", {
                    channel: "fast",
                    blockIndex: 0
                  });
                }
                void sendToTab(tabId, {
                  type: MessageType.TRANSLATE_STREAM_CHUNK,
                  sessionId: message.sessionId,
                  blockId: message.blockId,
                  chunk
                });
              }
            }
          )
      });
      const normalized = validateRemoteResult(
        typeof remoteResult === "string" ? remoteResult : remoteResult?.text,
        message.format
      );
      const text = normalized.text;
      const resultType = normalized.resultType;
      await cache.setVerified(key, text, {
        sessionId: message.sessionId,
        resultType,
        formatFingerprint:
          message.format?.fingerprint ?? PLAIN_FORMAT_FINGERPRINT
      });
      await sendToTab(tabId, {
        type: MessageType.TRANSLATE_STREAM_COMPLETE,
        sessionId: message.sessionId,
        blockId: message.blockId,
        text,
        resultType
      });
      timeline.mark("stream-complete", {
        channel: "fast",
        blockIndex: 0,
        resultType,
        transport: profile.stream ? "stream" : "single"
      });
      return {
        ok: true,
        sessionId: message.sessionId,
        blockId: message.blockId,
        text,
        resultType,
        streaming: profile.stream,
        cacheHit: false
      };
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await sendToTab(tabId, {
        type: MessageType.TRANSLATE_STREAM_ERROR,
        sessionId: message.sessionId,
        blockId: message.blockId,
        error: {
          code: normalized.code,
          message: normalized.message
        }
      });
      timeline.mark(
        "stream-failed",
        {
          channel: "fast",
          blockIndex: 0,
          error: toSafeLogError(normalized)
        },
        "error"
      );
      return publicError(normalized.code, normalized.message);
    }
  }

  async function translateSelection(message, tabId) {
    const provider = await selectedProvider();
    if (!provider) {
      return publicError(ErrorCode.NO_PROVIDER, "请先配置并选择翻译服务。");
    }
    const token = Symbol(message.requestId);
    selectionTokens.set(message.requestId, token);
    const isCurrent = () => selectionTokens.get(message.requestId) === token;
    const key = await createSelectionTranslationCacheKey({
      providerId: provider.id,
      model: provider.model,
      targetLanguage: message.targetLanguage,
      promptVersion: SELECTION_PROMPT_VERSION,
      responseSchemaVersion: SELECTION_RESPONSE_SCHEMA_VERSION,
      selectionText: message.selectionText,
      contextText: message.contextText
    });
    const timeline = timelineFactory({
      sessionId: message.requestId,
      context: "selection"
    });

    if (message.bypassCache !== true) {
      const entry = await cache.get(key);
      if (entry && isCurrent()) {
        await sendToTab(tabId, {
          type: MessageType.TRANSLATE_SELECTION_COMPLETE,
          requestId: message.requestId,
          text: entry.translation,
          cacheHit: true
        });
        selectionTokens.delete(message.requestId);
        timeline.mark("cache-hit", { channel: "selection" });
        return {
          ok: true,
          requestId: message.requestId,
          text: entry.translation,
          cacheHit: true
        };
      }
    }

    const profile = resolveProviderProfile(provider);
    try {
      const text = await scheduler.run({
        providerId: provider.id,
        profile,
        sessionId: message.requestId,
        maxRetries: 0,
        operation: ({ signal }) =>
          requestSelection(
            provider,
            message.selectionText,
            message.contextText,
            message.targetLanguage,
            {
              signal,
              stream: profile.stream,
              onChunk: (chunk) => {
                if (!isCurrent()) return;
                void sendToTab(tabId, {
                  type: MessageType.TRANSLATE_SELECTION_CHUNK,
                  requestId: message.requestId,
                  chunk
                });
              }
            }
          )
      });
      if (!isCurrent()) {
        return publicError(ErrorCode.REQUEST_CANCELLED, "翻译请求已取消。");
      }
      await cache.setVerified(key, text, {
        sessionId: message.requestId,
        resultType: TranslationCacheResultType.PLAIN,
        formatFingerprint: PLAIN_FORMAT_FINGERPRINT
      });
      await sendToTab(tabId, {
        type: MessageType.TRANSLATE_SELECTION_COMPLETE,
        requestId: message.requestId,
        text,
        cacheHit: false
      });
      selectionTokens.delete(message.requestId);
      timeline.mark("selection-complete", {
        channel: "selection",
        transport: profile.stream ? "stream" : "single"
      });
      return {
        ok: true,
        requestId: message.requestId,
        text,
        cacheHit: false
      };
    } catch (error) {
      const normalized = normalizeProviderError(error);
      if (isCurrent()) {
        await sendToTab(tabId, {
          type: MessageType.TRANSLATE_SELECTION_ERROR,
          requestId: message.requestId,
          error: {
            code: normalized.code,
            message: normalized.message
          }
        });
        selectionTokens.delete(message.requestId);
      }
      timeline.mark(
        "selection-failed",
        {
          channel: "selection",
          error: toSafeLogError(normalized)
        },
        "error"
      );
      return publicError(normalized.code, normalized.message);
    }
  }

  return {
    translateBatch,
    translateStream,
    translateSelection,
    cancelSelection(requestId) {
      selectionTokens.delete(requestId);
      return scheduler.cancelSession(requestId);
    },
    cancelSession(sessionId) {
      return scheduler.cancelSession(sessionId);
    }
  };
}
