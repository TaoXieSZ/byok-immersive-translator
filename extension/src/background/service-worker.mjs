import {
  ErrorCode,
  MessageType,
  TranslationScope,
  isTrustedExtensionPageSender,
  publicError,
  validateGetAppearancePreferenceMessage,
  validateCancelMessage,
  validateProviderTestMessage,
  validateTranslationBatchMessage,
  validateTranslationStreamMessage
} from "../shared/messages.mjs";
import {
  normalizeProviderError,
  testProviderConnection
} from "../shared/openai-adapter.mjs";
import {
  createChromeProviderRepository,
  restrictStorageToTrustedContexts
} from "../shared/provider-store.mjs";
import {
  APPEARANCE_STORAGE_KEY,
  createChromeAppearanceRepository,
  toPublicAppearancePreference
} from "../shared/appearance-preferences.mjs";
import {
  resolveProviderProfile,
  toPublicProviderStatus,
  validateProviderDraft
} from "../shared/provider-config.mjs";
import { createAdaptiveScheduler } from "../shared/adaptive-scheduler.mjs";
import { createChromeTranslationCacheRepository } from "../shared/translation-cache.mjs";
import { syncPersistentContentScript } from "../shared/content-script-registration.mjs";
import { isSupportedPageUrl } from "../shared/permissions.mjs";
import {
  logTranslationEvent,
  toSafeLogError
} from "../shared/translation-log.mjs";
import { createTranslationService } from "./translation-service.mjs";

const repository = createChromeProviderRepository();
const appearanceRepository = createChromeAppearanceRepository();
const scheduler = createAdaptiveScheduler();
const cache = createChromeTranslationCacheRepository();

async function sendToTab(tabId, message) {
  if (!Number.isInteger(tabId)) {
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

const translationService = createTranslationService({
  repository,
  scheduler,
  cache,
  sendToTab
});

function isExtensionPageSender(sender) {
  return isTrustedExtensionPageSender(
    sender,
    chrome.runtime.id,
    chrome.runtime.getURL("")
  );
}

function isContentScriptSender(sender) {
  return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id);
}

function isWebContentScriptSender(sender) {
  return (
    isContentScriptSender(sender) &&
    isSupportedPageUrl(sender.url ?? sender.tab?.url)
  );
}

async function handleProviderStatus() {
  return {
    ok: true,
    ...(toPublicProviderStatus(await repository.getState()))
  };
}

async function handleAppearancePreference(message, sender) {
  if (
    !isWebContentScriptSender(sender) ||
    !validateGetAppearancePreferenceMessage(message)
  ) {
    return publicError(ErrorCode.INVALID_MESSAGE, "无效的字体偏好请求。");
  }
  return {
    ok: true,
    preference: toPublicAppearancePreference(
      await appearanceRepository.getPreference()
    )
  };
}

async function handleProviderTest(message, sender) {
  if (!isExtensionPageSender(sender) || !validateProviderTestMessage(message)) {
    return publicError(ErrorCode.INVALID_MESSAGE, "无效的连接测试请求。");
  }

  try {
    const provider = validateProviderDraft(message.provider);
    await scheduler.run({
      providerId: provider.id || `provider-test:${new URL(provider.baseUrl).origin}`,
      profile: resolveProviderProfile(provider),
      sessionId: `provider-test:${crypto.randomUUID()}`,
      maxRetries: 0,
      operation: ({ signal }) => testProviderConnection(provider, { signal })
    });
    return { ok: true };
  } catch (error) {
    const normalized = normalizeProviderError(error);
    if (normalized.code === ErrorCode.NETWORK_ERROR && error instanceof Error) {
      return publicError(ErrorCode.INVALID_MESSAGE, error.message);
    }
    return publicError(normalized.code, normalized.message);
  }
}

async function handleTranslationBatch(message, sender) {
  if (
    !isContentScriptSender(sender) ||
    !validateTranslationBatchMessage(message)
  ) {
    return publicError(
      ErrorCode.INVALID_MESSAGE,
      "翻译请求包含无效或越权字段。"
    );
  }
  return translationService.translateBatch(message);
}

async function handleTranslationStream(message, sender) {
  if (
    !isContentScriptSender(sender) ||
    message?.type !== MessageType.TRANSLATE_STREAM_START ||
    !validateTranslationStreamMessage(message)
  ) {
    return publicError(
      ErrorCode.INVALID_MESSAGE,
      "流式翻译请求包含无效或越权字段。"
    );
  }
  return translationService.translateStream(message, sender.tab.id);
}

export async function handleMessage(message, sender) {
  switch (message?.type) {
    case MessageType.GET_APPEARANCE_PREFERENCE:
      return handleAppearancePreference(message, sender);
    case MessageType.GET_PROVIDER_STATUS:
      if (sender.id !== chrome.runtime.id) {
        return publicError(ErrorCode.INVALID_MESSAGE, "无效的状态请求。");
      }
      return handleProviderStatus();
    case MessageType.TEST_PROVIDER:
      return handleProviderTest(message, sender);
    case MessageType.TRANSLATE_BATCH:
      return handleTranslationBatch(message, sender);
    case MessageType.TRANSLATE_STREAM_START:
      return handleTranslationStream(message, sender);
    case MessageType.CANCEL_SESSION:
      if (!isContentScriptSender(sender) || !validateCancelMessage(message)) {
        return publicError(ErrorCode.INVALID_MESSAGE, "无效的取消请求。");
      }
      translationService.cancelSession(message.sessionId);
      return { ok: true };
    default:
      return publicError(ErrorCode.INVALID_MESSAGE, "未知扩展消息。");
  }
}

export async function handleAppearanceStorageChange(changes, areaName) {
  if (
    areaName !== "local" ||
    !Object.prototype.hasOwnProperty.call(changes ?? {}, APPEARANCE_STORAGE_KEY)
  ) {
    return;
  }

  const preference = toPublicAppearancePreference(
    await appearanceRepository.getPreference()
  );
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter(
        (tab) => Number.isInteger(tab?.id) && isSupportedPageUrl(tab.url)
      )
      .map((tab) =>
        sendToTab(tab.id, {
          type: MessageType.APPEARANCE_PREFERENCE_UPDATED,
          preference
        })
      )
  );
}

async function ensureContentController(tabId) {
  const status = await sendToTab(tabId, {
    type: MessageType.GET_PAGE_STATUS
  });
  if (status) {
    return;
  }
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content/content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/bootstrap.js"]
  });
}

async function handleCommand(command) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!Number.isInteger(tab?.id) || !isSupportedPageUrl(tab.url)) {
    return;
  }

  await ensureContentController(tab.id);
  const message =
    command === "translate-whole-page"
      ? { type: MessageType.START_FULL_PAGE_TRANSLATION }
      : {
          type: MessageType.TOGGLE_TRANSLATION,
          scope: TranslationScope.MAIN_CONTENT
        };
  await sendToTab(tab.id, message);
}

async function syncExtensionRuntime() {
  await restrictStorageToTrustedContexts();
  if (chrome.storage.session?.setAccessLevel) {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS"
    });
  }
  await syncPersistentContentScript();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      logTranslationEvent("error", "background.message.failed", {
        error: toSafeLogError(error)
      });
      sendResponse(
        publicError(ErrorCode.UNKNOWN_ERROR, "扩展后台处理请求时发生错误。")
      );
    });
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  void handleCommand(command).catch((error) =>
    logTranslationEvent("error", "background.command.failed", {
      command,
      error: toSafeLogError(error)
    })
  );
});

chrome.runtime.onInstalled.addListener(() => {
  void syncExtensionRuntime();
});
chrome.runtime.onStartup.addListener(() => {
  void syncExtensionRuntime();
});
chrome.permissions.onAdded.addListener(() => {
  void syncPersistentContentScript();
});
chrome.permissions.onRemoved.addListener(() => {
  void syncPersistentContentScript();
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  void handleAppearanceStorageChange(changes, areaName).catch((error) =>
    logTranslationEvent("error", "background.appearance.broadcast-failed", {
      error: toSafeLogError(error)
    })
  );
});
void syncExtensionRuntime();
