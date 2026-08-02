import {
  ErrorCode,
  MessageType,
  validateSelectionMessage
} from "../shared/messages.mjs";
import {
  MAGIC_LENS_HOST_ID,
  createSelectionSnapshot
} from "./selection-snapshot.mjs";

export const MagicLensStatus = Object.freeze({
  HIDDEN: "hidden",
  TRIGGER: "trigger",
  LOADING: "loading",
  STREAMING: "streaming",
  COMPLETE: "complete",
  ERROR: "error"
});
export const MAGIC_LENS_PERFORMANCE_BUDGET_MS = Object.freeze({
  triggerVisible: 50,
  loadingVisible: 100,
  cachedComplete: 300
});

const A3_ICON = `
  <svg viewBox="0 0 48 48" data-icon="floating-a3" aria-hidden="true">
    <path d="M6 6h36a4 4 0 0 1 4 4v21a4 4 0 0 1-4 4H28l-8 7v-7H6a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" fill="#172b3d"/>
    <path d="M24 6h18a4 4 0 0 1 4 4v21a4 4 0 0 1-4 4H28l-4 3.5Z" fill="#d95b40"/>
    <text x="4.5" y="29.5" fill="#fffdf8" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" font-size="19.5" font-weight="800">好</text>
    <path d="m29 29 4-13 5 13M31 25h5" fill="none" stroke="#fffdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

export const MAGIC_LENS_TEMPLATE = `
  <style>
    :host {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      left: 0;
      top: 0;
      color: #172b3d;
      font: 13px/1.45 "Avenir Next", "Noto Sans SC", sans-serif;
      --lens-paper: #f5efe4;
      --lens-surface: #fffdf8;
      --lens-ink: #172b3d;
      --lens-accent: #d95b40;
      --lens-line: rgba(23,43,61,.15);
      --lens-muted: #66717b;
    }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .trigger, .card { display: none; }
    :host([data-state="trigger"]) .trigger { display: grid; }
    :host([data-state="loading"]) .card,
    :host([data-state="streaming"]) .card,
    :host([data-state="complete"]) .card,
    :host([data-state="error"]) .card { display: block; }
    .trigger {
      width: 38px;
      height: 38px;
      padding: 3px;
      place-items: center;
      border: 1px solid rgba(255,255,255,.72);
      border-radius: 12px 12px 16px 12px;
      background: var(--lens-paper);
      box-shadow: 0 8px 24px rgba(23,43,61,.26), 0 2px 6px rgba(23,43,61,.18);
      cursor: pointer;
    }
    .trigger svg { width: 30px; height: 30px; }
    .trigger:hover { transform: translateY(-1px); }
    .trigger:focus-visible, .card button:focus-visible {
      outline: 3px solid rgba(217,91,64,.42);
      outline-offset: 2px;
    }
    .card {
      width: min(360px, calc(100vw - 24px));
      overflow: hidden;
      border: 1px solid var(--lens-line);
      border-radius: 18px 18px 22px 18px;
      background: linear-gradient(145deg, rgba(255,255,255,.78), transparent 58%), var(--lens-paper);
      box-shadow: 0 22px 58px rgba(23,43,61,.28), 0 3px 10px rgba(23,43,61,.13);
    }
    .header { display: flex; align-items: center; gap: 9px; padding: 12px 13px 9px; }
    .mark { display: grid; width: 30px; height: 30px; place-items: center; }
    .mark svg { width: 28px; height: 28px; }
    .heading { min-width: 0; flex: 1; }
    .title { margin: 0; font: 800 14px/1.2 "Iowan Old Style", "Noto Serif SC", serif; }
    .provider { margin: 2px 0 0; overflow: hidden; color: var(--lens-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
    .close {
      width: 28px; height: 28px; padding: 0; border: 0; border-radius: 9px;
      background: transparent; color: var(--lens-muted); cursor: pointer;
    }
    .close:hover { background: rgba(255,255,255,.65); color: var(--lens-ink); }
    .body { margin: 0 11px; padding: 13px; border: 1px solid var(--lens-line); border-radius: 13px; background: rgba(255,253,248,.9); }
    .status { display: flex; align-items: center; gap: 8px; color: var(--lens-muted); font-size: 11px; }
    .spinner { width: 14px; height: 14px; border: 2px solid rgba(217,91,64,.24); border-top-color: var(--lens-accent); border-radius: 50%; animation: lens-spin .8s linear infinite; }
    @keyframes lens-spin { to { transform: rotate(360deg); } }
    .translation { margin: 0; color: var(--lens-ink); font: 500 15px/1.65 var(--byok-translation-font, "Avenir Next", "Noto Sans SC", sans-serif); white-space: pre-wrap; overflow-wrap: anywhere; }
    :host([data-state="loading"]) .translation { display: none; }
    :host([data-state="complete"]) .status,
    :host([data-state="streaming"]) .status { display: none; }
    .error { margin: 0; color: #9d3424; font-size: 12px; white-space: pre-wrap; }
    :host(:not([data-state="error"])) .error { display: none; }
    .feedback { min-height: 18px; margin: 7px 14px 2px; color: var(--lens-muted); font-size: 10px; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 7px 11px 11px; }
    .action { min-height: 34px; padding: 0 9px; border: 1px solid var(--lens-line); border-radius: 10px; background: var(--lens-surface); color: var(--lens-ink); font-weight: 750; cursor: pointer; }
    .action:hover { border-color: rgba(217,91,64,.45); }
    .action:disabled { cursor: default; opacity: .4; }
    .settings { display: none; grid-column: 1 / -1; background: var(--lens-ink); color: white; }
    :host([data-error-code="NO_PROVIDER"]) .settings { display: block; }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .trigger { transition: none; } }
  </style>
  <button class="trigger" data-action="translate" type="button" aria-label="翻译所选文字">${A3_ICON}</button>
  <section class="card" role="dialog" aria-label="段落魔法镜" aria-live="polite">
    <header class="header">
      <span class="mark">${A3_ICON}</span>
      <div class="heading"><h2 class="title">段落魔法镜</h2><p class="provider" data-field="provider"></p></div>
      <button class="close" data-action="close" type="button" aria-label="关闭段落魔法镜">×</button>
    </header>
    <div class="body">
      <div class="status" data-field="status"><span class="spinner"></span><span>正在翻译所选文字…</span></div>
      <p class="translation" data-field="translation"></p>
      <p class="error" data-field="error"></p>
    </div>
    <div class="feedback" data-field="feedback" role="status" aria-live="polite"></div>
    <div class="actions">
      <button class="action" data-action="copy-translation" type="button">复制译文</button>
      <button class="action" data-action="copy-bilingual" type="button">复制双语</button>
      <button class="action" data-action="retranslate" type="button">重新翻译</button>
      <button class="action" data-action="close" type="button">关闭</button>
      <button class="action settings" data-action="settings" type="button">打开翻译设置</button>
    </div>
  </section>
`;

export function createInitialMagicLensState() {
  return {
    status: MagicLensStatus.HIDDEN,
    snapshot: null,
    requestId: null,
    translation: "",
    providerLabel: "",
    error: null,
    feedback: ""
  };
}

export function reduceMagicLensState(state, event) {
  switch (event.type) {
    case "capture":
      return {
        ...createInitialMagicLensState(),
        status: MagicLensStatus.TRIGGER,
        snapshot: event.snapshot
      };
    case "start":
      return {
        ...state,
        status: MagicLensStatus.LOADING,
        requestId: event.requestId,
        translation: "",
        providerLabel: event.providerLabel ?? "",
        error: null,
        feedback: ""
      };
    case "chunk":
      return {
        ...state,
        status: MagicLensStatus.STREAMING,
        translation: `${state.translation}${event.chunk}`
      };
    case "complete":
      return {
        ...state,
        status: MagicLensStatus.COMPLETE,
        requestId: null,
        translation: event.text,
        error: null
      };
    case "error":
      return {
        ...state,
        status: MagicLensStatus.ERROR,
        requestId: null,
        error: event.error,
        translation: ""
      };
    case "feedback":
      return { ...state, feedback: event.message };
    case "anchor":
      return state.snapshot
        ? {
            ...state,
            snapshot: { ...state.snapshot, anchorRect: event.anchorRect }
          }
        : state;
    case "close":
      return createInitialMagicLensState();
    default:
      return state;
  }
}

export function computeMagicLensPosition(
  anchor,
  surface,
  viewport,
  { margin = 12, gap = 8 } = {}
) {
  const width = Math.max(1, Number(surface?.width ?? 1));
  const height = Math.max(1, Number(surface?.height ?? 1));
  const viewportWidth = Math.max(width + margin * 2, Number(viewport?.width ?? 0));
  const viewportHeight = Math.max(height + margin * 2, Number(viewport?.height ?? 0));
  const preferredLeft = Number(anchor?.right ?? anchor?.left ?? margin) - width;
  const left = Math.min(
    viewportWidth - width - margin,
    Math.max(margin, preferredLeft)
  );
  const below = Number(anchor?.bottom ?? margin) + gap;
  const above = Number(anchor?.top ?? margin) - height - gap;
  const preferredTop =
    below + height <= viewportHeight - margin
      ? below
      : above;
  const top = Math.min(
    viewportHeight - height - margin,
    Math.max(margin, preferredTop)
  );
  return { left, top };
}

export function formatBilingualCopy(snapshot, translation) {
  return `${snapshot.selectionText}\n${translation}`;
}

export function evaluateMagicLensPerformance(metrics = {}) {
  return {
    triggerVisible:
      Number(metrics.triggerVisible) <=
      MAGIC_LENS_PERFORMANCE_BUDGET_MS.triggerVisible,
    loadingVisible:
      Number(metrics.loadingVisible) <=
      MAGIC_LENS_PERFORMANCE_BUDGET_MS.loadingVisible,
    cachedComplete:
      Number(metrics.cachedComplete) <=
      MAGIC_LENS_PERFORMANCE_BUDGET_MS.cachedComplete
  };
}

export function createFrameScheduler(callback, requestFrame) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestFrame(() => {
      scheduled = false;
      callback();
    });
  };
}

export function shouldEvaluateMagicLensSelection(event, containsTarget) {
  return (
    ["pointerup", "keyup"].includes(event?.type) &&
    !containsTarget(event?.target)
  );
}

export function isMagicLensDismissKey(event) {
  return event?.type === "keydown" && event.key === "Escape";
}

function createMagicLensView(documentObj, windowObj) {
  const host = documentObj.createElement("div");
  host.id = MAGIC_LENS_HOST_ID;
  host.dataset.state = MagicLensStatus.HIDDEN;
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = MAGIC_LENS_TEMPLATE;
  documentObj.documentElement.append(host);
  const fields = Object.fromEntries(
    [...shadow.querySelectorAll("[data-field]")].map((element) => [
      element.dataset.field,
      element
    ])
  );
  const buttons = [...shadow.querySelectorAll("[data-action]")];
  const handlers = new Map();
  for (const button of buttons) {
    button.addEventListener("click", () => handlers.get(button.dataset.action)?.());
  }

  function position(anchorRect) {
    const surface =
      host.dataset.state === MagicLensStatus.TRIGGER
        ? shadow.querySelector(".trigger")
        : shadow.querySelector(".card");
    const size = surface?.getBoundingClientRect?.() ?? { width: 360, height: 240 };
    const point = computeMagicLensPosition(anchorRect, size, {
      width: windowObj.innerWidth,
      height: windowObj.innerHeight
    });
    host.style.left = `${point.left}px`;
    host.style.top = `${point.top}px`;
  }

  return {
    host,
    on(action, handler) {
      handlers.set(action, handler);
    },
    render(state) {
      host.dataset.state = state.status;
      host.dataset.errorCode = state.error?.code ?? "";
      fields.provider.textContent = state.providerLabel;
      fields.translation.textContent = state.translation;
      fields.error.textContent = state.error?.message ?? "";
      fields.feedback.textContent = state.feedback;
      for (const button of buttons) {
        if (["copy-translation", "copy-bilingual"].includes(button.dataset.action)) {
          button.disabled = state.status !== MagicLensStatus.COMPLETE;
        }
      }
      if (state.snapshot) position(state.snapshot.anchorRect);
    },
    contains(target) {
      return target === host || host.contains(target);
    },
    destroy() {
      host.remove();
    }
  };
}

export function createMagicLensController({
  runtime,
  view,
  clipboard,
  createRequestId = () => crypto.randomUUID(),
  openOptions = () => runtime.openOptionsPage()
}) {
  let state = createInitialMagicLensState();

  const render = () => view.render(state);
  const transition = (event) => {
    state = reduceMagicLensState(state, event);
    render();
    return state;
  };

  function cancelActive() {
    if (!state.requestId) return;
    const requestId = state.requestId;
    state = { ...state, requestId: null };
    void runtime.sendMessage({
      type: MessageType.CANCEL_SELECTION,
      requestId
    }).catch(() => {});
  }

  async function start({ bypassCache = false } = {}) {
    if (!state.snapshot) return { ok: false };
    cancelActive();
    const requestId = createRequestId();
    transition({
      type: "start",
      requestId,
      providerLabel: "正在检查翻译服务…"
    });
    let providerStatus;
    try {
      providerStatus = await runtime.sendMessage({
        type: MessageType.GET_PROVIDER_STATUS
      });
    } catch {
      transition({
        type: "error",
        error: {
          code: ErrorCode.NETWORK_ERROR,
          message: "无法连接扩展后台，请稍后重试。"
        }
      });
      return { ok: false };
    }
    if (state.requestId !== requestId) {
      return { ok: false, cancelled: true };
    }
    if (!providerStatus?.ok || !providerStatus.configured) {
      transition({
        type: "error",
        error: {
          code: ErrorCode.NO_PROVIDER,
          message: "请先配置并选择翻译服务。"
        }
      });
      return providerStatus;
    }
    transition({
      type: "start",
      requestId,
      providerLabel: `${providerStatus.provider.name} · ${providerStatus.provider.model}`
    });
    void runtime
      .sendMessage({
        type: MessageType.TRANSLATE_SELECTION_START,
        requestId,
        targetLanguage: providerStatus.provider.targetLanguage,
        selectionText: state.snapshot.selectionText,
        contextText: state.snapshot.contextText,
        bypassCache
      })
      .then((response) => {
        if (state.requestId !== requestId || response?.ok) return;
        transition({
          type: "error",
          error: response?.error ?? {
            code: ErrorCode.UNKNOWN_ERROR,
            message: "选区翻译失败，请稍后重试。"
          }
        });
      })
      .catch(() => {
        if (state.requestId !== requestId) return;
        transition({
          type: "error",
          error: {
            code: ErrorCode.NETWORK_ERROR,
            message: "无法连接扩展后台，请稍后重试。"
          }
        });
      });
    return { ok: true, requestId };
  }

  async function copy(value) {
    if (!value) return { ok: false };
    try {
      await clipboard.writeText(value);
      transition({ type: "feedback", message: "已复制到剪贴板。" });
      return { ok: true };
    } catch {
      transition({ type: "feedback", message: "复制失败，请手动选择译文。" });
      return { ok: false };
    }
  }

  function close() {
    cancelActive();
    transition({ type: "close" });
  }

  view.on("translate", () => void start());
  view.on("close", close);
  view.on("retranslate", () => void start({ bypassCache: true }));
  view.on("copy-translation", () => void copy(state.translation));
  view.on("copy-bilingual", () =>
    void copy(formatBilingualCopy(state.snapshot, state.translation))
  );
  view.on("settings", () => void openOptions());
  render();

  return {
    showSnapshot(snapshot) {
      cancelActive();
      transition({ type: "capture", snapshot });
    },
    refreshAnchor(anchorRect) {
      transition({ type: "anchor", anchorRect });
    },
    start,
    close,
    contains: view.contains,
    getState() {
      return structuredClone(state);
    },
    handleMessage(message) {
      if (!validateSelectionMessage(message)) return undefined;
      if (message.requestId !== state.requestId) {
        return { ok: true, ignored: true };
      }
      if (message.type === MessageType.TRANSLATE_SELECTION_CHUNK) {
        transition({ type: "chunk", chunk: message.chunk });
      } else if (message.type === MessageType.TRANSLATE_SELECTION_COMPLETE) {
        transition({ type: "complete", text: message.text });
      } else if (message.type === MessageType.TRANSLATE_SELECTION_ERROR) {
        transition({ type: "error", error: message.error });
      } else {
        return undefined;
      }
      return { ok: true };
    },
    destroy() {
      close();
      view.destroy?.();
    }
  };
}

export function installMagicLensController({
  documentObj = document,
  windowObj = window,
  runtime = chrome.runtime,
  clipboard = navigator.clipboard
} = {}) {
  const view = createMagicLensView(documentObj, windowObj);
  const controller = createMagicLensController({ runtime, view, clipboard });

  const evaluateSelection = () => {
    const snapshot = createSelectionSnapshot(windowObj.getSelection?.());
    if (snapshot) controller.showSnapshot(snapshot);
    else controller.close();
  };
  const requestFrame = (callback) => {
    if (typeof windowObj.requestAnimationFrame === "function") {
      windowObj.requestAnimationFrame(callback);
    } else {
      setTimeout(callback, 0);
    }
  };
  const scheduleEvaluation = createFrameScheduler(
    evaluateSelection,
    requestFrame
  );
  const refreshPosition = () => {
    const current = controller.getState();
    if (current.status === MagicLensStatus.HIDDEN) return;
    const snapshot = createSelectionSnapshot(windowObj.getSelection?.());
    if (
      !snapshot ||
      snapshot.selectionText !== current.snapshot?.selectionText ||
      snapshot.contextText !== current.snapshot?.contextText
    ) {
      controller.close();
      return;
    }
    controller.refreshAnchor(snapshot.anchorRect);
  };
  const schedulePositionRefresh = createFrameScheduler(
    refreshPosition,
    requestFrame
  );
  const onPointerDown = (event) => {
    if (!controller.contains(event.target)) controller.close();
  };
  const onSelectionEnd = (event) => {
    if (shouldEvaluateMagicLensSelection(event, controller.contains)) {
      scheduleEvaluation();
    }
  };
  const onKeyDown = (event) => {
    if (isMagicLensDismissKey(event)) controller.close();
  };
  const onVisibilityChange = () => {
    if (documentObj.visibilityState === "hidden") controller.close();
  };

  documentObj.addEventListener("pointerup", onSelectionEnd, true);
  documentObj.addEventListener("keyup", onSelectionEnd, true);
  documentObj.addEventListener("pointerdown", onPointerDown, true);
  documentObj.addEventListener("keydown", onKeyDown, true);
  documentObj.addEventListener("visibilitychange", onVisibilityChange);
  windowObj.addEventListener("scroll", schedulePositionRefresh, true);
  windowObj.addEventListener("resize", schedulePositionRefresh);

  return {
    ...controller,
    destroy() {
      documentObj.removeEventListener("pointerup", onSelectionEnd, true);
      documentObj.removeEventListener("keyup", onSelectionEnd, true);
      documentObj.removeEventListener("pointerdown", onPointerDown, true);
      documentObj.removeEventListener("keydown", onKeyDown, true);
      documentObj.removeEventListener("visibilitychange", onVisibilityChange);
      windowObj.removeEventListener("scroll", schedulePositionRefresh, true);
      windowObj.removeEventListener("resize", schedulePositionRefresh);
      controller.destroy();
    }
  };
}
