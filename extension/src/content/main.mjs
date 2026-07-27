import { createBatches } from "../shared/batching.mjs";
import { extractBlocks } from "./extraction.mjs";
import { MessageType } from "../shared/messages.mjs";
import {
  BlockStatus,
  summarizeBlocks
} from "../shared/session-state.mjs";

let currentSession = null;
let mutationTimer = null;

function createSession(targetLanguage) {
  return {
    id: crypto.randomUUID(),
    targetLanguage,
    status: "translating",
    blocks: new Map(),
    nextIndex: 0,
    stopped: false,
    processing: false,
    observer: null,
    lastError: null
  };
}

function getStatus() {
  if (!currentSession) {
    return summarizeBlocks([], "idle");
  }
  return summarizeBlocks(
    [...currentSession.blocks.values()],
    currentSession.status,
    currentSession.lastError
  );
}

function addExtractedBlocks(session, root) {
  const { blocks, nextIndex } = extractBlocks(root, {
    sessionId: session.id,
    startIndex: session.nextIndex
  });
  session.nextIndex = nextIndex;
  for (const block of blocks) {
    session.blocks.set(block.id, {
      ...block,
      status: BlockStatus.QUEUED,
      retries: 0
    });
  }
  return blocks.length;
}

function renderTranslation(block, translation) {
  const selector = `[data-byok-translator][data-byok-for="${CSS.escape(block.id)}"]`;
  let translatedElement = document.querySelector(selector);
  if (!translatedElement) {
    translatedElement = document.createElement("div");
    translatedElement.className = "byok-translator__translation";
    translatedElement.dataset.byokTranslator = "";
    translatedElement.dataset.byokFor = block.id;

    if (["TD", "TH", "LI"].includes(block.element.tagName)) {
      block.element.append(translatedElement);
    } else {
      block.element.insertAdjacentElement("afterend", translatedElement);
    }
  }
  translatedElement.textContent = translation;
}

function markBatch(batch, status) {
  for (const item of batch) {
    const block = currentSession?.blocks.get(item.id);
    if (block) {
      block.status = status;
    }
  }
}

async function translateBatch(session, batch) {
  markBatch(batch, BlockStatus.TRANSLATING);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (session.stopped || currentSession?.id !== session.id) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: MessageType.TRANSLATE_BATCH,
      sessionId: session.id,
      targetLanguage: session.targetLanguage,
      items: batch.map(({ id, text }) => ({ id, text }))
    });

    if (currentSession?.id !== session.id || session.stopped) {
      return;
    }

    if (response?.ok && response.sessionId === session.id) {
      for (const item of batch) {
        const block = session.blocks.get(item.id);
        renderTranslation(block, response.translations[item.id]);
        block.status = BlockStatus.TRANSLATED;
      }
      session.lastError = null;
      return;
    }

    session.lastError = response?.error ?? {
      code: "UNKNOWN_ERROR",
      message: "翻译请求失败。"
    };
    for (const item of batch) {
      const block = session.blocks.get(item.id);
      block.retries = attempt + 1;
    }
  }

  markBatch(batch, BlockStatus.FAILED);
}

async function processQueued(session) {
  if (session.processing || session.stopped || currentSession?.id !== session.id) {
    return;
  }

  session.processing = true;
  session.status = "translating";
  try {
    const queued = [...session.blocks.values()].filter(
      (block) => block.status === BlockStatus.QUEUED
    );
    const batches = createBatches(queued);
    for (const batch of batches) {
      if (session.stopped || currentSession?.id !== session.id) {
        break;
      }
      await translateBatch(session, batch);
    }
  } finally {
    session.processing = false;
    if (currentSession?.id === session.id && !session.stopped) {
      const blocks = [...session.blocks.values()];
      session.status = blocks.some((block) => block.status === BlockStatus.FAILED)
        ? "completed-with-errors"
        : "completed";
    }
  }
}

function observeDynamicContent(session) {
  session.observer = new MutationObserver((mutations) => {
    if (session.stopped || currentSession?.id !== session.id) {
      return;
    }
    const roots = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          !node.matches("[data-byok-translator]") &&
          !node.closest("[data-byok-translator]")
        ) {
          roots.push(node);
        }
      }
    }
    if (roots.length === 0) {
      return;
    }
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      let added = 0;
      for (const root of roots) {
        if (root.isConnected) {
          added += addExtractedBlocks(session, root);
        }
      }
      if (added > 0) {
        void processQueued(session);
      }
    }, 350);
  });
  session.observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

async function startTranslation() {
  if (currentSession) {
    restorePage();
  }

  const providerStatus = await chrome.runtime.sendMessage({
    type: MessageType.GET_PROVIDER_STATUS
  });
  if (!providerStatus?.ok || !providerStatus.configured) {
    return {
      ok: false,
      error: {
        code: "NO_PROVIDER",
        message: "请先配置并选择翻译服务。"
      }
    };
  }

  const session = createSession(providerStatus.provider.targetLanguage);
  currentSession = session;
  const count = addExtractedBlocks(session, document);
  if (count === 0) {
    currentSession = null;
    return {
      ok: false,
      error: {
        code: "NO_TRANSLATABLE_TEXT",
        message: "当前页面没有可翻译的可见文本。"
      }
    };
  }

  observeDynamicContent(session);
  void processQueued(session);
  return { ok: true, status: getStatus() };
}

function stopTranslation() {
  if (!currentSession) {
    return { ok: true, status: getStatus() };
  }
  currentSession.stopped = true;
  currentSession.status = "stopped";
  currentSession.observer?.disconnect();
  for (const block of currentSession.blocks.values()) {
    if (
      block.status === BlockStatus.QUEUED ||
      block.status === BlockStatus.TRANSLATING
    ) {
      block.status = BlockStatus.CANCELLED;
    }
  }
  void chrome.runtime.sendMessage({
    type: MessageType.CANCEL_SESSION,
    sessionId: currentSession.id
  });
  return { ok: true, status: getStatus() };
}

function retryFailed() {
  if (!currentSession) {
    return { ok: true, status: getStatus() };
  }
  let retryCount = 0;
  for (const block of currentSession.blocks.values()) {
    if (
      block.status === BlockStatus.FAILED ||
      block.status === BlockStatus.CANCELLED
    ) {
      block.status = BlockStatus.QUEUED;
      block.retries = 0;
      retryCount += 1;
    }
  }
  if (retryCount > 0) {
    currentSession.stopped = false;
    currentSession.lastError = null;
    currentSession.observer?.disconnect();
    observeDynamicContent(currentSession);
    void processQueued(currentSession);
  }
  return { ok: true, status: getStatus() };
}

function restorePage() {
  const previous = currentSession;
  if (previous) {
    previous.stopped = true;
    previous.observer?.disconnect();
    void chrome.runtime.sendMessage({
      type: MessageType.CANCEL_SESSION,
      sessionId: previous.id
    });
  }
  clearTimeout(mutationTimer);
  document
    .querySelectorAll("[data-byok-translator]")
    .forEach((element) => element.remove());
  document
    .querySelectorAll("[data-byok-block-id]")
    .forEach((element) => element.removeAttribute("data-byok-block-id"));
  currentSession = null;
  return { ok: true, status: getStatus() };
}

function handlePageMessage(message) {
  switch (message?.type) {
    case MessageType.GET_PAGE_STATUS:
      return Promise.resolve({ ok: true, status: getStatus() });
    case MessageType.START_TRANSLATION:
      return startTranslation();
    case MessageType.STOP_TRANSLATION:
      return Promise.resolve(stopTranslation());
    case MessageType.RETRY_TRANSLATION:
      return Promise.resolve(retryFailed());
    case MessageType.RESTORE_PAGE:
      return Promise.resolve(restorePage());
    default:
      return undefined;
  }
}

export function installContentController() {
  if (globalThis.__BYOK_TRANSLATOR_CONTROLLER__) {
    return;
  }
  globalThis.__BYOK_TRANSLATOR_CONTROLLER__ = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const response = handlePageMessage(message);
    if (!response) {
      return false;
    }
    response.then(sendResponse).catch((error) =>
      sendResponse({
        ok: false,
        error: {
          code: "UNKNOWN_ERROR",
          message: error?.message ?? "页面翻译控制器发生错误。"
        }
      })
    );
    return true;
  });
}
