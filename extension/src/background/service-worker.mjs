import {
  ErrorCode,
  MessageType,
  publicError,
  isTrustedExtensionPageSender,
  validateCancelMessage,
  validateProviderTestMessage,
  validateTranslationBatchMessage
} from "../shared/messages.mjs";
import {
  normalizeProviderError,
  requestTranslations,
  testProviderConnection
} from "../shared/openai-adapter.mjs";
import {
  createChromeProviderRepository,
  restrictStorageToTrustedContexts
} from "../shared/provider-store.mjs";
import {
  toPublicProviderStatus,
  validateProviderDraft
} from "../shared/provider-config.mjs";

const repository = createChromeProviderRepository();
const activeRequests = new Map();
const waiters = [];
let availablePermits = 3;

async function withPermit(operation) {
  if (availablePermits === 0) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  availablePermits -= 1;
  try {
    return await operation();
  } finally {
    availablePermits += 1;
    waiters.shift()?.();
  }
}

function addController(sessionId, controller) {
  const controllers = activeRequests.get(sessionId) ?? new Set();
  controllers.add(controller);
  activeRequests.set(sessionId, controllers);
}

function removeController(sessionId, controller) {
  const controllers = activeRequests.get(sessionId);
  controllers?.delete(controller);
  if (controllers?.size === 0) {
    activeRequests.delete(sessionId);
  }
}

function cancelSession(sessionId) {
  const controllers = activeRequests.get(sessionId);
  for (const controller of controllers ?? []) {
    controller.abort();
  }
  activeRequests.delete(sessionId);
}

function isExtensionPageSender(sender) {
  return isTrustedExtensionPageSender(
    sender,
    chrome.runtime.id,
    chrome.runtime.getURL("")
  );
}

function isContentScriptSender(sender) {
  return sender.id === chrome.runtime.id && Boolean(sender.tab?.id);
}

async function handleProviderStatus() {
  return {
    ok: true,
    ...(toPublicProviderStatus(await repository.getState()))
  };
}

async function handleProviderTest(message, sender) {
  if (!isExtensionPageSender(sender) || !validateProviderTestMessage(message)) {
    return publicError(ErrorCode.INVALID_MESSAGE, "无效的连接测试请求。");
  }

  try {
    const provider = validateProviderDraft(message.provider);
    await withPermit(() => testProviderConnection(provider));
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
  if (!isContentScriptSender(sender) || !validateTranslationBatchMessage(message)) {
    return publicError(
      ErrorCode.INVALID_MESSAGE,
      "翻译请求包含无效或越权字段。"
    );
  }

  const provider = await repository.getSelectedProvider();
  if (!provider) {
    return publicError(ErrorCode.NO_PROVIDER, "请先配置并选择翻译服务。");
  }

  const controller = new AbortController();
  addController(message.sessionId, controller);
  try {
    const translations = await withPermit(() =>
      requestTranslations(provider, message.items, message.targetLanguage, {
        signal: controller.signal
      })
    );
    return {
      ok: true,
      sessionId: message.sessionId,
      translations
    };
  } catch (error) {
    const normalized = normalizeProviderError(error);
    return publicError(normalized.code, normalized.message);
  } finally {
    removeController(message.sessionId, controller);
  }
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case MessageType.GET_PROVIDER_STATUS:
      if (sender.id !== chrome.runtime.id) {
        return publicError(ErrorCode.INVALID_MESSAGE, "无效的状态请求。");
      }
      return handleProviderStatus();
    case MessageType.TEST_PROVIDER:
      return handleProviderTest(message, sender);
    case MessageType.TRANSLATE_BATCH:
      return handleTranslationBatch(message, sender);
    case MessageType.CANCEL_SESSION:
      if (!isContentScriptSender(sender) || !validateCancelMessage(message)) {
        return publicError(ErrorCode.INVALID_MESSAGE, "无效的取消请求。");
      }
      cancelSession(message.sessionId);
      return { ok: true };
    default:
      return publicError(ErrorCode.INVALID_MESSAGE, "未知扩展消息。");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(() =>
      sendResponse(
        publicError(ErrorCode.UNKNOWN_ERROR, "扩展后台处理请求时发生错误。")
      )
    );
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void restrictStorageToTrustedContexts();
});
chrome.runtime.onStartup.addListener(() => {
  void restrictStorageToTrustedContexts();
});
void restrictStorageToTrustedContexts();
