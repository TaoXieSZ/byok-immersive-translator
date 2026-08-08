import {
  DEFAULT_FLOATING_CONTROL_PREFERENCE,
  FLOATING_CONTROL_SCHEMA_VERSION,
  FloatingControlEdge,
  normalizeFloatingControlPreference
} from "../shared/floating-control-preferences.mjs";

export const ControllerStatus = Object.freeze({
  IDLE: "idle",
  STARTING: "starting",
  TRANSLATING: "translating",
  STOPPED: "stopped",
  COMPLETED: "completed",
  COMPLETED_WITH_ERRORS: "completed-with-errors"
});

export const FLOATING_CONTROL_SIZE = 58;
export const FLOATING_CONTROL_DRAG_THRESHOLD = 6;
export const FLOATING_CONTROL_CLICK_SUPPRESSION_MS = 400;
const FLOATING_CONTROL_MARGIN = 20;
const FLOATING_CONTROL_NARROW_MARGIN = 12;
const FLOATING_CONTROL_KEYBOARD_STEP = 40;
const FLOATING_CONTROL_PANEL_GAP = 12;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getFloatingControlMargin(viewportWidth) {
  return viewportWidth <= 520
    ? FLOATING_CONTROL_NARROW_MARGIN
    : FLOATING_CONTROL_MARGIN;
}

function getAvailableVerticalSpace(viewportHeight, size, margin) {
  return Math.max(0, viewportHeight - size - margin * 2);
}

export function isLauncherDragIntent(
  start,
  current,
  threshold = FLOATING_CONTROL_DRAG_THRESHOLD
) {
  if (!start || !current || !Number.isFinite(threshold) || threshold < 0) {
    return false;
  }
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

export function shouldSuppressLauncherClickAfterPointer(pointerState) {
  return pointerState?.moved === true;
}

export function resolveFloatingControlLayout(
  preference,
  viewport,
  { size = FLOATING_CONTROL_SIZE } = {}
) {
  const normalized = normalizeFloatingControlPreference(preference);
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const margin = getFloatingControlMargin(width);
  const available = getAvailableVerticalSpace(height, size, margin);
  return {
    edge: normalized.edge,
    top: Math.round(margin + normalized.verticalRatio * available),
    margin
  };
}

export function resolveFloatingPanelLayout(
  controlRect,
  viewportHeight,
  {
    gap = FLOATING_CONTROL_PANEL_GAP,
    margin = FLOATING_CONTROL_NARROW_MARGIN
  } = {}
) {
  const height = Math.max(0, Number(viewportHeight) || 0);
  const top = clamp(Number(controlRect?.top) || 0, 0, height);
  const bottom = clamp(Number(controlRect?.bottom) || top, top, height);
  const spaceAbove = Math.max(0, top - gap - margin);
  const spaceBelow = Math.max(0, height - bottom - gap - margin);
  const placement = spaceBelow > spaceAbove ? "below" : "above";
  return {
    placement,
    maxHeight: Math.floor(
      placement === "below" ? spaceBelow : spaceAbove
    )
  };
}

export function computeDockedFloatingControlPreference(
  point,
  viewport,
  { size = FLOATING_CONTROL_SIZE, pointerOffsetY = size / 2 } = {}
) {
  const width = Math.max(0, Number(viewport?.width) || 0);
  const height = Math.max(0, Number(viewport?.height) || 0);
  const margin = getFloatingControlMargin(width);
  const available = getAvailableVerticalSpace(height, size, margin);
  const top = clamp(
    (Number(point?.y) || 0) - pointerOffsetY,
    margin,
    margin + available
  );
  return {
    version: FLOATING_CONTROL_SCHEMA_VERSION,
    edge:
      (Number(point?.x) || 0) < width / 2
        ? FloatingControlEdge.LEFT
        : FloatingControlEdge.RIGHT,
    verticalRatio: available > 0 ? (top - margin) / available : 0
  };
}

export function moveFloatingControlPreferenceWithKeyboard(
  preference,
  key,
  viewport,
  { size = FLOATING_CONTROL_SIZE, step = FLOATING_CONTROL_KEYBOARD_STEP } = {}
) {
  const normalized = normalizeFloatingControlPreference(preference);
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return {
      ...normalized,
      edge:
        key === "ArrowLeft"
          ? FloatingControlEdge.LEFT
          : FloatingControlEdge.RIGHT
    };
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") {
    return normalized;
  }

  const layout = resolveFloatingControlLayout(normalized, viewport, { size });
  const nextTop = layout.top + (key === "ArrowUp" ? -step : step);
  const available = getAvailableVerticalSpace(
    Math.max(0, Number(viewport?.height) || 0),
    size,
    layout.margin
  );
  return {
    ...normalized,
    verticalRatio:
      available > 0
        ? (clamp(nextTop, layout.margin, layout.margin + available) -
            layout.margin) /
          available
        : 0
  };
}

const STATUS_LABELS = Object.freeze({
  idle: "准备翻译",
  starting: "正在启动",
  translating: "正在翻译",
  completed: "翻译完成",
  "completed-with-errors": "部分失败",
  stopped: "已暂停"
});

export function getLauncherIntent(status) {
  if (status === ControllerStatus.IDLE) {
    return "start";
  }
  if (status === ControllerStatus.STARTING) {
    return "ignore";
  }
  return "restore";
}

const BRAND_MARK_SVG = `
  <svg viewBox="0 0 48 48" data-icon="brand-b2" aria-hidden="true">
    <path d="M5 9h15a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3h-8l-5 4v-4H5a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3Z" fill="#fffdf8"/>
    <path d="M28 7h15a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3h-2v4l-5-4h-8a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z" fill="#d95b40"/>
    <path d="M8 16h8M8 21h11M8 26h7" fill="none" stroke="#172b3d" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M31 14h8M29 19h11M32 24h7" fill="none" stroke="#fffdf8" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M18 32h13l-3-3m3 3-3 3" fill="none" stroke="#f5efe4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const FLOATING_ACTION_SVG = `
  <svg viewBox="0 0 48 48" data-icon="floating-a3" aria-hidden="true">
    <path d="M6 6h36a4 4 0 0 1 4 4v21a4 4 0 0 1-4 4H28l-8 7v-7H6a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" fill="#172b3d"/>
    <path d="M24 6h18a4 4 0 0 1 4 4v21a4 4 0 0 1-4 4H28l-4 3.5Z" fill="#d95b40"/>
    <text x="4.5" y="29.5" fill="#fffdf8" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" font-size="19.5" font-weight="800">好</text>
    <path d="m29 29 4-13 5 13M31 25h5" fill="none" stroke="#fffdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const TEMPLATE = `
  <style>
    :host {
      all: initial;
      --byok-ink: #172b3d;
      --byok-paper: #f5efe4;
      --byok-surface: #fffdf8;
      --byok-accent: #d95b40;
      --byok-muted: #6f7880;
      --byok-line: rgba(23, 43, 61, .14);
      position: fixed;
      z-index: 2147483646;
      width: 58px;
      height: 58px;
      right: max(20px, env(safe-area-inset-right));
      bottom: max(20px, env(safe-area-inset-bottom));
      color: var(--byok-ink);
      font-family: "Avenir Next", "Noto Sans SC", sans-serif;
      font-size: 13px;
      line-height: 1.4;
    }
    :host([data-positioned="true"]) {
      top: var(--byok-floating-top);
      bottom: auto;
    }
    :host([data-edge="left"]) {
      right: auto;
      left: max(20px, env(safe-area-inset-left));
    }
    :host([data-edge="right"]) {
      right: max(20px, env(safe-area-inset-right));
      left: auto;
    }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .launcher {
      position: relative;
      display: grid;
      width: 58px;
      height: 58px;
      margin-left: auto;
      padding: 0;
      place-items: center;
      border: 0;
      border-radius: 18px 18px 24px 18px;
      background: conic-gradient(
        var(--byok-accent) var(--byok-progress, 0deg),
        rgba(255, 253, 248, .92) 0
      );
      box-shadow: 0 16px 38px rgba(23, 43, 61, .24), 0 2px 8px rgba(23, 43, 61, .15);
      cursor: pointer;
      touch-action: none;
      user-select: none;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    .launcher:hover {
      transform: translateY(-2px);
      box-shadow: 0 20px 44px rgba(23, 43, 61, .28), 0 3px 10px rgba(23, 43, 61, .16);
    }
    .launcher:focus-visible { outline: 3px solid rgba(217, 91, 64, .35); outline-offset: 3px; }
    :host([data-dragging="true"]) .launcher {
      cursor: grabbing;
      transform: none;
      box-shadow: 0 12px 30px rgba(23, 43, 61, .2), 0 2px 8px rgba(23, 43, 61, .14);
    }
    .launcher__inner {
      display: grid;
      width: 50px;
      height: 50px;
      place-items: center;
      border-radius: 15px 15px 21px 15px;
      background: var(--byok-paper);
      color: var(--byok-ink);
    }
    .launcher svg { width: 34px; height: 34px; overflow: visible; }
    .launcher__count {
      position: absolute;
      top: -7px;
      right: -7px;
      min-width: 24px;
      height: 22px;
      padding: 0 6px;
      border: 2px solid var(--byok-paper);
      border-radius: 999px;
      background: var(--byok-accent);
      color: white;
      font-size: 9px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      line-height: 18px;
      text-align: center;
      box-shadow: 0 3px 10px rgba(23, 43, 61, .18);
    }
    .launcher__count:empty { display: none; }
    .panel {
      position: absolute;
      right: 0;
      bottom: 70px;
      display: none;
      width: min(318px, calc(100vw - 32px));
      max-height: var(--byok-panel-max-height, calc(100vh - 90px));
      overflow-x: hidden;
      overflow-y: auto;
      border: 1px solid var(--byok-line);
      border-radius: 20px 20px 24px 20px;
      background:
        linear-gradient(145deg, rgba(255,255,255,.76), transparent 55%),
        var(--byok-paper);
      box-shadow: 0 24px 70px rgba(23, 43, 61, .25), 0 4px 14px rgba(23, 43, 61, .12);
      transform-origin: bottom right;
      animation: byok-panel-in 180ms cubic-bezier(.2,.8,.2,1) both;
    }
    :host([data-edge="left"]) .panel {
      right: auto;
      left: 0;
      transform-origin: bottom left;
    }
    :host([data-panel-placement="below"]) .panel {
      top: 70px;
      bottom: auto;
      transform-origin: top right;
    }
    :host([data-edge="left"][data-panel-placement="below"]) .panel {
      transform-origin: top left;
    }
    :host([data-open="true"]) .panel { display: block; }
    @keyframes byok-panel-in {
      from { opacity: 0; transform: translateY(10px) scale(.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .panel__header {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 15px 16px 12px;
    }
    .panel__mark {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      border-radius: 11px 11px 15px 11px;
      background: var(--byok-ink);
      color: var(--byok-ink);
    }
    .panel__mark svg { width: 28px; height: 28px; overflow: visible; }
    .eyebrow {
      margin: 0 0 1px;
      color: var(--byok-accent);
      font-size: 8px;
      font-weight: 900;
      letter-spacing: .16em;
    }
    .title { margin: 0; font-family: "Iowan Old Style", "Noto Serif SC", serif; font-size: 18px; line-height: 1.1; }
    .icon-button {
      display: grid;
      width: 30px;
      height: 30px;
      padding: 0;
      place-items: center;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      color: var(--byok-muted);
      cursor: pointer;
    }
    .icon-button:hover { border-color: var(--byok-line); background: rgba(255,255,255,.55); color: var(--byok-ink); }
    .status-card {
      margin: 0 12px 12px;
      padding: 14px;
      border: 1px solid var(--byok-line);
      border-radius: 15px;
      background: rgba(255, 253, 248, .88);
    }
    .status-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-weight: 800; }
    .fraction { color: var(--byok-muted); font-variant-numeric: tabular-nums; }
    .track { height: 5px; margin: 11px 0 9px; overflow: hidden; border-radius: 999px; background: #e4dbcf; }
    .track > span { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--byok-accent); transition: width 220ms ease; }
    .substatus { margin: 0; color: var(--byok-muted); font-size: 11px; }
    .feedback { min-height: 18px; margin: -3px 16px 9px; color: #9d3424; font-size: 10px; }
    .scope {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      margin: 0 12px 10px;
      padding: 3px;
      border: 1px solid var(--byok-line);
      border-radius: 11px;
      background: rgba(255, 253, 248, .58);
    }
    .scope__option {
      min-height: 30px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--byok-muted);
      font-weight: 800;
      cursor: pointer;
    }
    .scope__option[aria-pressed="true"] {
      background: var(--byok-surface);
      color: var(--byok-ink);
      box-shadow: 0 1px 4px rgba(23, 43, 61, .12);
    }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0 12px 12px; }
    .action {
      min-height: 38px;
      border: 1px solid var(--byok-line);
      border-radius: 11px;
      background: var(--byok-surface);
      color: var(--byok-ink);
      font-weight: 800;
      cursor: pointer;
    }
    .action--primary { grid-column: 1 / -1; border-color: var(--byok-ink); background: var(--byok-ink); color: white; }
    .action--quiet { color: var(--byok-muted); }
    .action:disabled { cursor: default; opacity: .38; }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .panel, .launcher { animation: none; transition: none; }
    }
    @media (max-width: 520px) {
      :host { right: 12px; bottom: 12px; }
      :host([data-edge="left"]) { right: auto; left: 12px; }
      :host([data-edge="right"]) { right: 12px; left: auto; }
    }
  </style>
  <section class="panel" aria-label="网页翻译控制器">
    <header class="panel__header">
      <span class="panel__mark">${BRAND_MARK_SVG}</span>
      <div>
        <p class="eyebrow">BYOK TRANSLATOR</p>
        <h2 class="title">双语阅读</h2>
      </div>
      <button class="icon-button" data-action="collapse" type="button" aria-label="收起">×</button>
    </header>
    <div class="status-card">
      <div class="status-row">
        <span data-field="label">准备翻译</span>
        <span class="fraction" data-field="fraction">0 / 0</span>
      </div>
      <div class="track"><span data-field="bar"></span></div>
      <p class="substatus" data-field="detail">点击开始后，当前正文会优先出现译文。</p>
    </div>
    <div class="feedback" data-field="feedback" role="status" aria-live="polite"></div>
    <div class="scope" role="group" aria-label="翻译范围">
      <button class="scope__option" data-action="scope-main" type="button" aria-pressed="true">主要内容</button>
      <button class="scope__option" data-action="scope-page" type="button" aria-pressed="false">整个页面</button>
    </div>
    <div class="actions">
      <button class="action action--primary" data-action="start" type="button">开始翻译</button>
      <button class="action" data-action="stop" type="button">暂停</button>
      <button class="action" data-action="retry" type="button">重试失败</button>
      <button class="action action--quiet" data-action="restore" type="button">恢复原文</button>
      <button class="action action--quiet" data-action="settings" type="button">翻译设置</button>
    </div>
  </section>
  <button class="launcher" data-action="toggle" type="button" aria-label="打开翻译控制器" aria-describedby="launcher-position-hint" aria-expanded="false">
    <span class="launcher__inner">${FLOATING_ACTION_SVG}</span>
    <span class="launcher__count" data-field="badge"></span>
  </button>
  <span id="launcher-position-hint" class="visually-hidden">拖动可移动位置；按 Shift 加方向键也可以移动。</span>
`;

export function createFloatingController(actions, { windowObj = window } = {}) {
  const host = document.createElement("div");
  host.id = "byok-translator-floating-control";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = TEMPLATE;
  document.documentElement.append(host);

  const fields = Object.fromEntries(
    [...shadow.querySelectorAll("[data-field]")].map((element) => [
      element.dataset.field,
      element
    ])
  );
  const buttons = Object.fromEntries(
    [...shadow.querySelectorAll("[data-action]")].map((element) => [
      element.dataset.action,
      element
    ])
  );
  let lastStatus = "idle";
  let currentPosition = normalizeFloatingControlPreference(
    DEFAULT_FLOATING_CONTROL_PREFERENCE
  );
  let dragState = null;
  let suppressNextLauncherClick = false;
  let suppressLauncherClickTimer = null;

  function getViewport() {
    return {
      width: windowObj.innerWidth,
      height: windowObj.innerHeight
    };
  }

  function applyFloatingControlPreference(preference) {
    currentPosition = normalizeFloatingControlPreference(preference);
    const layout = resolveFloatingControlLayout(
      currentPosition,
      getViewport()
    );
    host.dataset.positioned = "true";
    host.dataset.edge = layout.edge;
    host.style.setProperty("--byok-floating-top", `${layout.top}px`);
  }

  function persistFloatingControlPreference(preference) {
    void Promise.resolve(
      actions.saveFloatingControlPreference?.(preference)
    ).catch(() => undefined);
  }

  function updatePanelPlacement() {
    const rect = host.getBoundingClientRect();
    const layout = resolveFloatingPanelLayout(rect, windowObj.innerHeight);
    host.dataset.panelPlacement = layout.placement;
    host.style.setProperty(
      "--byok-panel-max-height",
      `${layout.maxHeight}px`
    );
  }

  function suppressLauncherClickBriefly() {
    suppressNextLauncherClick = true;
    if (suppressLauncherClickTimer !== null) {
      windowObj.clearTimeout(suppressLauncherClickTimer);
    }
    suppressLauncherClickTimer = windowObj.setTimeout(() => {
      suppressNextLauncherClick = false;
      suppressLauncherClickTimer = null;
    }, FLOATING_CONTROL_CLICK_SUPPRESSION_MS);
  }

  function clearLauncherClickSuppression() {
    suppressNextLauncherClick = false;
    if (suppressLauncherClickTimer !== null) {
      windowObj.clearTimeout(suppressLauncherClickTimer);
      suppressLauncherClickTimer = null;
    }
  }

  function clearDragState() {
    if (dragState?.pointerId !== undefined) {
      try {
        if (buttons.toggle.hasPointerCapture?.(dragState.pointerId)) {
          buttons.toggle.releasePointerCapture(dragState.pointerId);
        }
      } catch {
        // Pointer capture can already be released when the viewport changes.
      }
    }
    dragState = null;
    delete host.dataset.dragging;
  }

  function setOpen(open) {
    if (open) {
      updatePanelPlacement();
    }
    host.dataset.open = String(open);
    buttons.toggle.setAttribute("aria-expanded", String(open));
  }

  async function run(action) {
    fields.feedback.textContent = "";
    try {
      const response = await actions[action]?.();
      if (response?.error?.message) {
        fields.feedback.textContent = response.error.message;
      }
      return response;
    } catch (error) {
      fields.feedback.textContent = error?.message ?? "操作失败，请稍后重试。";
      return null;
    }
  }

  buttons.toggle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || dragState) {
      return;
    }
    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      pointerOffsetY: clamp(
        event.clientY - rect.top,
        0,
        FLOATING_CONTROL_SIZE
      ),
      moved: false,
      startPreference: currentPosition
    };
    buttons.toggle.setPointerCapture?.(event.pointerId);
  });

  buttons.toggle.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const current = { x: event.clientX, y: event.clientY };
    if (
      !dragState.moved &&
      !isLauncherDragIntent(dragState.start, current)
    ) {
      return;
    }
    event.preventDefault();
    if (!dragState.moved) {
      dragState.moved = true;
      host.dataset.dragging = "true";
      setOpen(false);
    }
    applyFloatingControlPreference(
      computeDockedFloatingControlPreference(current, getViewport(), {
        pointerOffsetY: dragState.pointerOffsetY
      })
    );
  });

  buttons.toggle.addEventListener("pointerup", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    if (shouldSuppressLauncherClickAfterPointer(dragState)) {
      suppressLauncherClickBriefly();
      persistFloatingControlPreference(currentPosition);
    }
    clearDragState();
  });

  buttons.toggle.addEventListener("pointercancel", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    applyFloatingControlPreference(dragState.startPreference);
    clearDragState();
  });

  buttons.toggle.addEventListener("keydown", (event) => {
    if (
      !event.shiftKey ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key
      )
    ) {
      return;
    }
    event.preventDefault();
    const preference = moveFloatingControlPreferenceWithKeyboard(
      currentPosition,
      event.key,
      getViewport()
    );
    applyFloatingControlPreference(preference);
    persistFloatingControlPreference(preference);
  });

  buttons.toggle.addEventListener("click", async (event) => {
    if (suppressNextLauncherClick) {
      clearLauncherClickSuppression();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const intent = getLauncherIntent(lastStatus);
    if (intent === "ignore") {
      return;
    }
    if (intent === "restore") {
      setOpen(false);
      const response = await run("restore");
      if (response?.ok) {
        lastStatus = ControllerStatus.IDLE;
      } else {
        setOpen(true);
      }
      return;
    }
    lastStatus = ControllerStatus.STARTING;
    buttons.toggle.setAttribute("aria-busy", "true");
    setOpen(false);
    const response = await run("start");
    buttons.toggle.removeAttribute("aria-busy");
    if (!response?.ok) {
      lastStatus = ControllerStatus.IDLE;
      setOpen(true);
    }
  });
  buttons.collapse.addEventListener("click", () => setOpen(false));
  for (const action of ["start", "stop", "retry", "restore", "settings"]) {
    buttons[action].addEventListener("click", () => void run(action));
  }
  buttons["scope-main"].addEventListener("click", () =>
    void run("setMainContentScope")
  );
  buttons["scope-page"].addEventListener("click", () =>
    void run("setWholePageScope")
  );

  const onResize = () => {
    applyFloatingControlPreference(currentPosition);
    if (host.dataset.open === "true") {
      updatePanelPlacement();
    }
  };
  windowObj.addEventListener("resize", onResize);
  applyFloatingControlPreference(currentPosition);
  void Promise.resolve(actions.getFloatingControlPreference?.())
    .then((response) => {
      if (response?.ok && response.preference) {
        applyFloatingControlPreference(response.preference);
      }
    })
    .catch(() => undefined);

  return {
    render(status = {}) {
      const total = status.total ?? 0;
      const translated = status.translated ?? 0;
      const failed = status.failed ?? 0;
      const cancelled = status.cancelled ?? 0;
      const completed = translated + failed;
      const active = (status.queued ?? 0) + (status.translating ?? 0);
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

      fields.label.textContent = STATUS_LABELS[status.status] ?? "准备翻译";
      fields.fraction.textContent = `${completed} / ${total}`;
      fields.bar.style.width = `${percent}%`;
      fields.detail.textContent =
        status.status === "starting"
          ? "正在检查配置并准备当前页面…"
          : status.status === "translating"
          ? `${translated} 段已完成 · ${active} 段处理中`
          : status.status === "completed"
            ? `已完成 ${translated} 段译文`
            : status.status === "stopped"
              ? `${translated} 段已完成 · ${cancelled} 段已暂停`
            : "当前正文会优先出现译文。";
      if (status.scopeFallback) {
        fields.detail.textContent =
          "未识别到明确正文，已按当前视口优先处理可翻译内容。";
      }
      fields.badge.textContent = total > 0 ? `${completed}/${total}` : "";
      buttons.toggle.style.setProperty(
        "--byok-progress",
        `${percent * 3.6}deg`
      );
      buttons.stop.disabled = status.status !== "translating";
      buttons.retry.disabled = failed + cancelled === 0;
      buttons.restore.disabled = total === 0;
      buttons.start.disabled = ["starting", "translating"].includes(
        status.status
      );
      buttons.toggle.setAttribute(
        "aria-label",
        status.status === "idle"
          ? "开始翻译"
          : status.status === "starting"
            ? "正在启动翻译"
            : "移除翻译"
      );
      buttons["scope-main"].setAttribute(
        "aria-pressed",
        String(status.scope !== "full-page")
      );
      buttons["scope-page"].setAttribute(
        "aria-pressed",
        String(status.scope === "full-page")
      );
      if (status.lastError?.message) {
        fields.feedback.textContent = status.lastError.message;
        setOpen(true);
      }
      lastStatus = status.status ?? "idle";
    },
    setOpen,
    destroy() {
      clearLauncherClickSuppression();
      windowObj.removeEventListener("resize", onResize);
      host.remove();
    }
  };
}
