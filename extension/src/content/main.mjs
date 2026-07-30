import { createProgressiveBatches } from "../shared/batching.mjs";
import {
  extractBlocks,
  partitionBlocksByViewport,
  prioritizeBlocksForViewport,
  scanProgressiveChunks
} from "./extraction.mjs";
import { shouldSkipTargetLanguage } from "../shared/language-detection.mjs";
import {
  MessageType,
  TranslationScope,
  validateAppearancePreferenceMessage
} from "../shared/messages.mjs";
export { TranslationScope } from "../shared/messages.mjs";
import {
  FORMAT_MARKER_PREFIX,
  FORMAT_MARKER_SUFFIX,
  parseFormattedTranslation,
  stripReservedFormatMarkers
} from "../shared/translation-format.mjs";
import {
  BlockStatus,
  summarizeBlocks
} from "../shared/session-state.mjs";
import {
  createPerformanceTimeline,
  logTranslationEvent,
  toSafeLogError
} from "../shared/translation-log.mjs";
import { TRANSLATION_CONCURRENCY } from "../shared/runtime-limits.mjs";
import { createFloatingController } from "./floating-controller.mjs";
import {
  createFormatStreamFilter,
  renderTranslationSafely,
  replaceWithPlainTranslation
} from "./translation-renderer.mjs";
import {
  createTranslationAppearanceController,
  loadInitialTranslationAppearance
} from "./translation-appearance.mjs";

let currentSession = null;
let mutationTimer = null;
let priorityTimer = null;
let floatingController = null;
let pendingStartCommand = null;
let currentScope = "main-content";
let translationAppearance = null;

const MAIN_CONTENT_SELECTOR = "article,main,[role='main']";
const BACKGROUND_DISCOVERY_CHUNK_SIZE = 40;

export function createSession(
  targetLanguage,
  {
    scope = TranslationScope.MAIN_CONTENT,
    status = "translating"
  } = {}
) {
  return {
    id: crypto.randomUUID(),
    targetLanguage,
    scope,
    scopeFallback: false,
    status,
    blocks: new Map(),
    canonicalByText: new Map(),
    nextIndex: 0,
    stopped: false,
    processing: false,
    fastLaneStarted: false,
    priorityVersion: 0,
    observer: null,
    lastError: null
  };
}

function getStatus() {
  if (!currentSession) {
    return {
      ...summarizeBlocks([], "idle"),
      scope: currentScope,
      scopeFallback: false
    };
  }
  return {
    ...summarizeBlocks(
      [...currentSession.blocks.values()],
      currentSession.status,
      currentSession.lastError
    ),
    scope: currentSession.scope,
    scopeFallback: currentSession.scopeFallback
  };
}

function notifyStatus() {
  floatingController?.render(getStatus());
}

export function normalizeTranslationScope(scope) {
  return scope === TranslationScope.FULL_PAGE
    ? TranslationScope.FULL_PAGE
    : TranslationScope.MAIN_CONTENT;
}

export function resolveTranslationScopeRoot(
  rootDocument,
  scope = TranslationScope.MAIN_CONTENT
) {
  if (normalizeTranslationScope(scope) === TranslationScope.FULL_PAGE) {
    return { root: rootDocument, fallback: false };
  }
  const mainContent = rootDocument.querySelector?.(MAIN_CONTENT_SELECTOR);
  return mainContent
    ? { root: mainContent, fallback: false }
    : { root: rootDocument, fallback: true };
}

function persistTranslationScope(scope) {
  currentScope = normalizeTranslationScope(scope);
  if (currentSession) {
    currentSession.scope = currentScope;
  }
  notifyStatus();
  return { ok: true, status: getStatus() };
}

function registerExtractedBlocks(session, blocks) {
  let added = 0;
  for (const block of blocks) {
    if (shouldSkipTargetLanguage(block.text, session.targetLanguage)) {
      block.element.removeAttribute("data-byok-block-id");
      continue;
    }
    const canonicalKey =
      block.canonicalKey ??
      `${block.text}\u0000${block.format?.fingerprint ?? block.formatDescriptor?.fingerprint ?? ""}`;
    const canonical = session.canonicalByText.get(canonicalKey);
    if (canonical) {
      canonical.duplicates.push(block);
      renderBlockState(canonical, canonical.status);
      continue;
    }
    const queuedBlock = {
      ...block,
      status: BlockStatus.QUEUED,
      retries: 0,
      duplicates: []
    };
    session.canonicalByText.set(canonicalKey, queuedBlock);
    session.blocks.set(block.id, queuedBlock);
    renderBlockState(queuedBlock, BlockStatus.QUEUED);
    added += 1;
  }
  notifyStatus();
  return added;
}

function addExtractedBlocks(session, root) {
  const { blocks, nextIndex } = extractBlocks(root, {
    sessionId: session.id,
    startIndex: session.nextIndex,
    scope: "all"
  });
  session.nextIndex = nextIndex;
  return registerExtractedBlocks(session, blocks);
}

function yieldDiscoveryControl() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(resolve, { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function discoverBackgroundBlocks(session, blocks) {
  const signal = {
    get aborted() {
      return session.stopped || currentSession?.id !== session.id;
    }
  };
  for await (const chunk of scanProgressiveChunks(blocks, {
    chunkSize: BACKGROUND_DISCOVERY_CHUNK_SIZE,
    signal,
    yieldControl: yieldDiscoveryControl
  })) {
    if (signal.aborted) {
      return;
    }
    if (registerExtractedBlocks(session, chunk) > 0) {
      void processQueued(session);
    }
  }
  session.timeline?.mark("discovery-complete", {
    channel: "background",
    itemCount: blocks.length
  });
}

export function createThroughputBatches(blocks) {
  return createProgressiveBatches(blocks, {
    firstMaxItems: 20,
    firstMaxCharacters: 20_000,
    maxItems: 20,
    maxCharacters: 20_000
  });
}

function getTranslationElement(block) {
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
  translationAppearance?.applyTo(translatedElement);
  return translatedElement;
}

function renderBlockState(block, status) {
  const labels = {
    [BlockStatus.QUEUED]: "等待翻译",
    [BlockStatus.TRANSLATING]: "正在翻译",
    [BlockStatus.FAILED]: "翻译失败，可在控制器中重试",
    [BlockStatus.CANCELLED]: "翻译已暂停"
  };
  for (const target of [block, ...(block.duplicates ?? [])]) {
    const translatedElement = getTranslationElement(target);
    translatedElement.dataset.state = status;
    translatedElement.textContent = labels[status] ?? "";
  }
}

function renderTranslation(
  session,
  block,
  translation,
  resultType = null
) {
  for (const target of [block, ...(block.duplicates ?? [])]) {
    const translatedElement = getTranslationElement(target);
    translatedElement.dataset.state = BlockStatus.TRANSLATED;
    const format = target.format ?? null;
    const logFallback = (error) =>
      logTranslationEvent("warn", "content.format-fallback", {
        sessionId: session.id,
        blockId: target.id,
        formatFingerprint: format?.fingerprint ?? null,
        error: toSafeLogError(error)
      });
    let result;
    if (resultType === "format-fallback") {
      replaceWithPlainTranslation(
        translatedElement,
        stripReservedFormatMarkers(translation)
      );
      logFallback({
        code: "FORMAT_FALLBACK",
        message: "Provider returned a plain-text format fallback."
      });
      result = { formatted: false, fallback: true };
    } else {
      result = renderTranslationSafely(
        translatedElement,
        translation,
        format,
        {
          parse: parseFormattedTranslation,
          stripReservedMarkers: stripReservedFormatMarkers,
          onFallback: logFallback
        }
      );
    }
    translatedElement.dataset.resultType = result.formatted
      ? "formatted"
      : result.fallback
        ? "format-fallback"
        : "plain";
  }
}

function toTranslationRequestItem(block) {
  return {
    id: block.id,
    text: block.formattedText ?? block.text,
    ...(block.formatMetadata ? { format: block.formatMetadata } : {})
  };
}

function resetBlockStreamState(block) {
  block.streamText = "";
  block.streamSerialized = "";
  block.streamVisible = "";
  block.streamFilter?.reset();
  block.streamFilter = null;
}

export function appendStreamChunk(block, chunk) {
  block.streamSerialized = `${block.streamSerialized ?? ""}${chunk ?? ""}`;
  if (!block.format?.marks?.length) {
    block.streamVisible = `${block.streamVisible ?? ""}${chunk ?? ""}`;
    return block.streamVisible;
  }
  block.streamFilter ??= createFormatStreamFilter({
    markerPrefix: FORMAT_MARKER_PREFIX,
    markerSuffix: FORMAT_MARKER_SUFFIX
  });
  block.streamVisible = `${block.streamVisible ?? ""}${block.streamFilter.push(chunk)}`;
  return block.streamVisible;
}

function markBatch(session, batch, status) {
  for (const item of batch) {
    const block = session.blocks.get(item.id);
    if (block) {
      block.status = status;
      renderBlockState(block, status);
    }
  }
  notifyStatus();
}

async function translateBatch(session, batch, batchIndex) {
  markBatch(session, batch, BlockStatus.TRANSLATING);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (session.stopped || currentSession?.id !== session.id) {
      return;
    }

    logTranslationEvent("warn", "content.batch.start", {
      sessionId: session.id,
      batchIndex,
      attempt: attempt + 1,
      itemCount: batch.length
    });
    const response = await chrome.runtime.sendMessage({
      type: MessageType.TRANSLATE_BATCH,
      sessionId: session.id,
      batchIndex,
      targetLanguage: session.targetLanguage,
      items: batch.map(toTranslationRequestItem)
    });

    if (currentSession?.id !== session.id || session.stopped) {
      logTranslationEvent("warn", "content.batch.late-response-discarded", {
        sessionId: session.id,
        batchIndex,
        activeSessionId: currentSession?.id ?? null,
        responseSessionId: response?.sessionId ?? null,
        sessionMatches: currentSession?.id === session.id
      });
      return;
    }

    if (response?.ok && response.sessionId !== session.id) {
      logTranslationEvent("warn", "content.batch.late-response-discarded", {
        sessionId: session.id,
        batchIndex,
        activeSessionId: currentSession?.id ?? null,
        responseSessionId: response.sessionId,
        sessionMatches: false
      });
      return;
    }

    if (shouldApplyTranslationResponse(session, response)) {
      for (const item of batch) {
        const block = session.blocks.get(item.id);
        renderTranslation(
          session,
          block,
          response.translations[item.id],
          response.resultTypes?.[item.id]
        );
        block.status = BlockStatus.TRANSLATED;
      }
      session.lastError = null;
      logTranslationEvent("warn", "content.batch.complete", {
        sessionId: session.id,
        batchIndex,
        attempt: attempt + 1,
        itemCount: batch.length
      });
      settleSessionStatus(session);
      notifyStatus();
      return;
    }

    session.lastError = response?.error ?? {
      code: "UNKNOWN_ERROR",
      message: "翻译请求失败。"
    };
    logTranslationEvent("error", "content.batch.failed", {
      sessionId: session.id,
      batchIndex,
      attempt: attempt + 1,
      error: toSafeLogError(session.lastError)
    });
    for (const item of batch) {
      const block = session.blocks.get(item.id);
      block.retries = attempt + 1;
    }
    if (attempt === 0) {
      logTranslationEvent("warn", "content.batch.retry", {
        sessionId: session.id,
        batchIndex,
        nextAttempt: 2,
        error: toSafeLogError(session.lastError)
      });
    }
  }

  markBatch(session, batch, BlockStatus.FAILED);
  settleSessionStatus(session);
  notifyStatus();
}

export function shouldApplyTranslationResponse(
  session,
  response,
  activeSessionId = currentSession?.id
) {
  return (
    !session.stopped &&
    activeSessionId === session.id &&
    response?.ok === true &&
    response.sessionId === session.id
  );
}

export async function translateBatches(
  session,
  batches,
  {
    translate = translateBatch,
    isActive = () =>
      !session.stopped && currentSession?.id === session.id,
    concurrency = session.batchConcurrency ?? TRANSLATION_CONCURRENCY
  } = {}
) {
  let nextBatchIndex = 0;
  const workerCount = Math.min(concurrency, batches.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextBatchIndex < batches.length && isActive()) {
      const batch = batches[nextBatchIndex];
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      await translate(session, batch, batchIndex);
    }
  });
  await Promise.all(workers);
}

export function partitionTranslationLanes(blocks, fastLaneStarted = false) {
  const queued = blocks.filter(
    (block) => block.status === BlockStatus.QUEUED
  );
  if (fastLaneStarted || queued.length === 0) {
    return { fast: null, batch: queued };
  }
  return { fast: queued[0], batch: queued.slice(1) };
}

function settleSessionStatus(session) {
  const blocks = [...session.blocks.values()];
  if (
    blocks.some(
      (block) =>
        block.status === BlockStatus.QUEUED ||
        block.status === BlockStatus.TRANSLATING
    )
  ) {
    session.status = "translating";
  } else {
    session.status = blocks.some(
      (block) => block.status === BlockStatus.FAILED
    )
      ? "completed-with-errors"
      : "completed";
    if (session.timeline?.duration("full-page-complete") === null) {
      session.timeline?.mark("full-page-complete", {
        channel: "content",
        resultType: session.status
      });
    }
  }
  if (
    session.initialBlockIds?.every((id) => {
      const status = session.blocks.get(id)?.status;
      return [
        BlockStatus.TRANSLATED,
        BlockStatus.FAILED,
        BlockStatus.CANCELLED
      ].includes(status);
    }) &&
    session.timeline?.duration("viewport-complete") === null
  ) {
    session.timeline?.mark("viewport-complete", {
      channel: "fast",
      itemCount: session.initialBlockIds.length
    });
  }
}

async function translateFastBlock(session, block) {
  if (!block) {
    return;
  }
  if (!MessageType.TRANSLATE_STREAM_START) {
    await translateBatch(session, [block], 0);
    return;
  }

  markBatch(session, [block], BlockStatus.TRANSLATING);
  if (session.timeline?.duration("first-request") === null) {
    session.timeline?.mark("first-request", {
      channel: "fast",
      blockIndex: 0
    });
  }
  const response = await chrome.runtime.sendMessage({
    type: MessageType.TRANSLATE_STREAM_START,
    sessionId: session.id,
    blockId: block.id,
    targetLanguage: session.targetLanguage,
    text: block.formattedText ?? block.text,
    ...(block.formatMetadata ? { format: block.formatMetadata } : {})
  });

  if (session.stopped || currentSession?.id !== session.id) {
    return;
  }
  if (response?.ok && typeof response.text === "string") {
    renderTranslation(
      session,
      block,
      response.text,
      response.resultType
    );
    block.status = BlockStatus.TRANSLATED;
    resetBlockStreamState(block);
    session.lastError = null;
    notifyStatus();
    return;
  }
  if (response?.ok && response.streaming) {
    return;
  }
  if (block.status === BlockStatus.TRANSLATED) {
    return;
  }
  // A provider without a stream handler keeps the fast-lane ordering while
  // safely falling back to the validated single-item batch protocol.
  block.status = BlockStatus.QUEUED;
  await translateBatch(session, [block], 0);
}

export async function processQueued(
  session,
  {
    isActive = () =>
      !session.stopped && currentSession?.id === session.id,
    prioritize = prioritizeBlocksForViewport,
    createBatches = createThroughputBatches,
    translate = translateBatches,
    translateFast = translateFastBlock,
    onStatus = notifyStatus
  } = {}
) {
  if (session.processing || !isActive()) {
    return;
  }

  session.processing = true;
  session.status = "translating";
  onStatus();
  try {
    while (isActive()) {
      const queued = [...session.blocks.values()].filter(
        (block) => block.status === BlockStatus.QUEUED
      );
      if (queued.length === 0) {
        break;
      }
      const prioritized = prioritize(queued);
      const lanes = partitionTranslationLanes(
        prioritized,
        session.fastLaneStarted
      );
      if (lanes.fast) {
        session.fastLaneStarted = true;
      }
      const batches = createBatches(lanes.batch).slice(
        0,
        session.batchConcurrency ?? TRANSLATION_CONCURRENCY
      );
      await Promise.all([
        lanes.fast ? translateFast(session, lanes.fast) : Promise.resolve(),
        batches.length > 0 ? translate(session, batches) : Promise.resolve()
      ]);
    }
  } finally {
    session.processing = false;
    if (isActive()) {
      settleSessionStatus(session);
    }
    onStatus();
  }
}

function observeDynamicContent(session, root = document.documentElement) {
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
  session.observer.observe(root, {
    childList: true,
    subtree: true
  });
}

function observeViewportPriority(session) {
  const onViewportChange = () => {
    if (session.stopped || currentSession?.id !== session.id) {
      return;
    }
    clearTimeout(priorityTimer);
    priorityTimer = setTimeout(() => {
      session.priorityVersion += 1;
      void processQueued(session);
    }, 120);
  };
  globalThis.addEventListener?.("scroll", onViewportChange, { passive: true });
  globalThis.addEventListener?.("resize", onViewportChange, { passive: true });
  session.priorityCleanup = () => {
    clearTimeout(priorityTimer);
    globalThis.removeEventListener?.("scroll", onViewportChange);
    globalThis.removeEventListener?.("resize", onViewportChange);
  };
}

async function startTranslation(
  { scope = currentScope } = {}
) {
  if (
    currentSession &&
    ["starting", "translating"].includes(currentSession.status) &&
    !currentSession.stopped
  ) {
    return { ok: true, duplicate: true, status: getStatus() };
  }
  if (currentSession) {
    restorePage();
  }

  const normalizedScope = normalizeTranslationScope(scope);
  currentScope = normalizedScope;
  persistTranslationScope(normalizedScope);
  const session = createSession("", {
    scope: normalizedScope,
    status: "starting"
  });
  session.timeline = createPerformanceTimeline({
    sessionId: session.id,
    context: "content"
  });
  session.timeline.mark("command-received", {
    channel: "content",
    scope: normalizedScope
  });
  currentSession = session;
  notifyStatus();

  const providerStatus = await chrome.runtime.sendMessage({
    type: MessageType.GET_PROVIDER_STATUS
  });
  if (currentSession?.id !== session.id || session.stopped) {
    return { ok: false, error: { code: "REQUEST_CANCELLED", message: "启动已取消。" } };
  }
  if (!providerStatus?.ok || !providerStatus.configured) {
    currentSession = null;
    notifyStatus();
    return {
      ok: false,
      error: {
        code: "NO_PROVIDER",
        message: "请先配置并选择翻译服务。"
      }
    };
  }

  session.targetLanguage = providerStatus.provider.targetLanguage;
  session.batchConcurrency =
    providerStatus.provider.performanceProfile?.initialConcurrency ??
    TRANSLATION_CONCURRENCY;
  session.status = "translating";
  const { root, fallback } = resolveTranslationScopeRoot(
    document,
    normalizedScope
  );
  session.scopeFallback = fallback;
  const { blocks, nextIndex } = extractBlocks(root, {
    sessionId: session.id,
    startIndex: session.nextIndex,
    scope: "all"
  });
  session.timeline.mark("extraction-initial", {
    channel: "content",
    itemCount: blocks.length,
    scopeFallback: fallback
  });
  session.nextIndex = nextIndex;
  const eligibleBlocks = blocks.filter((block) => {
    if (shouldSkipTargetLanguage(block.text, session.targetLanguage)) {
      block.element.removeAttribute("data-byok-block-id");
      return false;
    }
    return true;
  });
  const { visible } = partitionBlocksByViewport(eligibleBlocks);
  const initialBlocks =
    visible.length > 0
      ? visible
      : prioritizeBlocksForViewport(eligibleBlocks).slice(0, 3);
  const initialIds = new Set(initialBlocks.map((block) => block.id));
  const backgroundBlocks = eligibleBlocks.filter(
    (block) => !initialIds.has(block.id)
  );
  const count = registerExtractedBlocks(session, initialBlocks);
  session.initialBlockIds = [...session.blocks.keys()];
  session.timeline.mark("loading", {
    channel: "content",
    itemCount: count
  });
  if (count === 0) {
    currentSession = null;
    notifyStatus();
    return {
      ok: false,
      error: {
        code: "NO_TRANSLATABLE_TEXT",
        message: "当前页面没有可翻译的可见文本。"
      }
    };
  }

  const observationRoot =
    root === document ? document.documentElement : root;
  observeDynamicContent(session, observationRoot);
  observeViewportPriority(session);
  void processQueued(session);
  void discoverBackgroundBlocks(session, backgroundBlocks);
  return { ok: true, status: getStatus() };
}

function handleTranslationStreamEvent(message) {
  if (
    ![
      MessageType.TRANSLATE_STREAM_CHUNK,
      MessageType.TRANSLATE_STREAM_COMPLETE,
      MessageType.TRANSLATE_STREAM_ERROR
    ].includes(message?.type)
  ) {
    return undefined;
  }
  const session = currentSession;
  const block = session?.blocks.get(message?.blockId);
  if (
    !session ||
    !block ||
    session.stopped ||
    message.sessionId !== session.id
  ) {
    return Promise.resolve({ ok: true, ignored: true });
  }

  switch (message.type) {
    case MessageType.TRANSLATE_STREAM_CHUNK: {
      if (session.timeline?.duration("first-token") === null) {
        session.timeline?.mark("first-token", {
          channel: "fast",
          blockIndex: 0
        });
      }
      const visible = appendStreamChunk(block, message.chunk);
      for (const target of [block, ...(block.duplicates ?? [])]) {
        const translatedElement = getTranslationElement(target);
        translatedElement.dataset.state = "streaming";
        replaceWithPlainTranslation(translatedElement, visible);
      }
      notifyStatus();
      return Promise.resolve({ ok: true });
    }
    case MessageType.TRANSLATE_STREAM_COMPLETE: {
      const translation = message.text ?? block.streamSerialized;
      if (typeof translation === "string" && translation.length > 0) {
        renderTranslation(
          session,
          block,
          translation,
          message.resultType
        );
        block.status = BlockStatus.TRANSLATED;
        resetBlockStreamState(block);
        session.lastError = null;
        settleSessionStatus(session);
        notifyStatus();
      }
      return Promise.resolve({ ok: true });
    }
    case MessageType.TRANSLATE_STREAM_ERROR: {
      resetStreamFailure(block);
      for (const target of [block, ...(block.duplicates ?? [])]) {
        const translatedElement = getTranslationElement(target);
        translatedElement.dataset.state = BlockStatus.QUEUED;
        replaceWithPlainTranslation(translatedElement, "");
      }
      return Promise.resolve({ ok: true });
    }
    default:
      return undefined;
  }
}

export function resetStreamFailure(block) {
  resetBlockStreamState(block);
  block.status = BlockStatus.QUEUED;
  return block;
}

function stopTranslation() {
  if (!currentSession) {
    return { ok: true, status: getStatus() };
  }
  currentSession.stopped = true;
  currentSession.status = "stopped";
  currentSession.observer?.disconnect();
  currentSession.priorityCleanup?.();
  for (const block of currentSession.blocks.values()) {
    if (
      block.status === BlockStatus.QUEUED ||
      block.status === BlockStatus.TRANSLATING
    ) {
      block.status = BlockStatus.CANCELLED;
      resetBlockStreamState(block);
      renderBlockState(block, BlockStatus.CANCELLED);
    }
  }
  void chrome.runtime.sendMessage({
    type: MessageType.CANCEL_SESSION,
    sessionId: currentSession.id
  });
  notifyStatus();
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
      resetBlockStreamState(block);
      renderBlockState(block, BlockStatus.QUEUED);
      retryCount += 1;
    }
  }
  if (retryCount > 0) {
    currentSession.stopped = false;
    currentSession.lastError = null;
    currentSession.observer?.disconnect();
    currentSession.priorityCleanup?.();
    const { root } = resolveTranslationScopeRoot(
      document,
      currentSession.scope
    );
    observeDynamicContent(
      currentSession,
      root === document ? document.documentElement : root
    );
    observeViewportPriority(currentSession);
    void processQueued(currentSession);
  }
  notifyStatus();
  return { ok: true, status: getStatus() };
}

export function restorePage(root = document) {
  const previous = currentSession;
  if (previous) {
    previous.stopped = true;
    previous.observer?.disconnect();
    previous.priorityCleanup?.();
    void chrome.runtime.sendMessage({
      type: MessageType.CANCEL_SESSION,
      sessionId: previous.id
    });
  }
  clearTimeout(mutationTimer);
  clearTimeout(priorityTimer);
  root
    .querySelectorAll("[data-byok-translator]")
    .forEach((element) => element.remove());
  root
    .querySelectorAll("[data-byok-block-id]")
    .forEach((element) => element.removeAttribute("data-byok-block-id"));
  currentSession = null;
  notifyStatus();
  return { ok: true, status: getStatus() };
}

export function handleSessionCommand(message, actions = {}) {
  const start = actions.start ?? startTranslation;
  const stop = actions.stop ?? stopTranslation;
  const retry = actions.retry ?? retryFailed;
  const restore = actions.restore ?? restorePage;
  const setScope = actions.setScope ?? persistTranslationScope;

  const streamResponse = handleTranslationStreamEvent(message);
  if (streamResponse) {
    return streamResponse;
  }

  switch (message?.type) {
    case MessageType.GET_PAGE_STATUS:
      return Promise.resolve({ ok: true, status: getStatus() });
    case MessageType.START_TRANSLATION: {
      if (!pendingStartCommand) {
        pendingStartCommand = Promise.resolve(
          start({ scope: normalizeTranslationScope(message.scope ?? currentScope) })
        ).finally(() => {
          pendingStartCommand = null;
        });
      }
      return pendingStartCommand;
    }
    case MessageType.STOP_TRANSLATION:
      return Promise.resolve(stop());
    case MessageType.RETRY_TRANSLATION:
      return Promise.resolve(retry());
    case MessageType.RESTORE_PAGE:
      return Promise.resolve(restore());
    case MessageType.SET_TRANSLATION_SCOPE:
      return Promise.resolve(setScope(message.scope));
    case MessageType.START_FULL_PAGE_TRANSLATION:
      return Promise.resolve(setScope(TranslationScope.FULL_PAGE)).then(() => {
        if (currentSession) {
          restore();
        }
        return handleSessionCommand(
          {
            type: MessageType.START_TRANSLATION,
            scope: TranslationScope.FULL_PAGE
          },
          actions
        );
      });
    case MessageType.TOGGLE_TRANSLATION:
      return getStatus().total > 0
        ? Promise.resolve(restore())
        : handleSessionCommand(
            {
              type: MessageType.START_TRANSLATION,
              scope: message.scope
            },
            actions
          );
    default:
      return undefined;
  }
}

export function installContentController() {
  if (globalThis.__BYOK_TRANSLATOR_CONTROLLER__) {
    return;
  }
  globalThis.__BYOK_TRANSLATOR_CONTROLLER__ = true;
  translationAppearance = createTranslationAppearanceController({
    root: document
  });
  void loadInitialTranslationAppearance({
    controller: translationAppearance,
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    messageType: MessageType.GET_APPEARANCE_PREFERENCE
  });
  floatingController = createFloatingController({
    start: () =>
      handleSessionCommand({
        type: MessageType.START_TRANSLATION,
        scope: currentScope
      }),
    stop: () =>
      handleSessionCommand({ type: MessageType.STOP_TRANSLATION }),
    retry: () =>
      handleSessionCommand({ type: MessageType.RETRY_TRANSLATION }),
    restore: () =>
      handleSessionCommand({ type: MessageType.RESTORE_PAGE }),
    setMainContentScope: () =>
      handleSessionCommand({
        type: MessageType.SET_TRANSLATION_SCOPE,
        scope: TranslationScope.MAIN_CONTENT
      }),
    setWholePageScope: () =>
      handleSessionCommand({
        type: MessageType.SET_TRANSLATION_SCOPE,
        scope: TranslationScope.FULL_PAGE
      }),
    settings: async () => {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }
  });
  notifyStatus();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MessageType.APPEARANCE_PREFERENCE_UPDATED) {
      if (validateAppearancePreferenceMessage(message)) {
        translationAppearance.update(message.preference);
      }
      return false;
    }
    const response = handleSessionCommand(message);
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
