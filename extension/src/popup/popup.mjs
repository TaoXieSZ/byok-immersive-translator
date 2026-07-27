import { MessageType } from "../shared/messages.mjs";

const elements = {
  providerName: document.querySelector("#provider-name"),
  statusDot: document.querySelector("#status-dot"),
  statusLabel: document.querySelector("#status-label"),
  fraction: document.querySelector("#progress-fraction"),
  bar: document.querySelector("#progress-bar"),
  translated: document.querySelector("#metric-translated"),
  active: document.querySelector("#metric-active"),
  failed: document.querySelector("#metric-failed"),
  feedback: document.querySelector("#feedback"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  retry: document.querySelector("#retry"),
  restore: document.querySelector("#restore"),
  options: document.querySelector("#open-options")
};

let activeTab = null;
let providerConfigured = false;
let pollTimer = null;
let pageStatus = "idle";

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(url ?? "");
}

function setFeedback(message = "", tone = "") {
  elements.feedback.textContent = message;
  elements.feedback.dataset.tone = tone;
}

function renderStatus(status = {}) {
  pageStatus = status.status ?? "idle";
  const total = status.total ?? 0;
  const translated = status.translated ?? 0;
  const active = (status.queued ?? 0) + (status.translating ?? 0);
  const failed = status.failed ?? 0;
  const completed = translated + failed;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const labels = {
    idle: "准备翻译当前页面",
    translating: "正在翻译",
    completed: "翻译完成",
    "completed-with-errors": "部分内容翻译失败",
    stopped: "翻译已停止"
  };

  elements.statusLabel.textContent = labels[status.status] ?? "准备翻译当前页面";
  elements.fraction.textContent = `${completed} / ${total}`;
  elements.bar.style.width = `${percent}%`;
  elements.translated.textContent = translated;
  elements.active.textContent = active;
  elements.failed.textContent = failed;
  elements.statusDot.dataset.active = String(status.status === "translating");
  elements.stop.disabled = status.status !== "translating";
  elements.retry.disabled = failed + (status.cancelled ?? 0) === 0;
  elements.restore.disabled = total === 0;
  elements.start.disabled =
    pageStatus === "translating" ||
    !providerConfigured ||
    !isSupportedUrl(activeTab?.url);

  if (status.lastError?.message) {
    setFeedback(status.lastError.message, "error");
  }
}

async function sendToPage(type) {
  if (!activeTab?.id) {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(activeTab.id, { type });
  } catch {
    return null;
  }
}

async function ensureContentController() {
  await chrome.scripting.insertCSS({
    target: { tabId: activeTab.id },
    files: ["src/content/content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ["src/content/bootstrap.js"]
  });
}

async function refreshStatus() {
  const response = await sendToPage(MessageType.GET_PAGE_STATUS);
  renderStatus(response?.status ?? { status: "idle", total: 0 });
}

async function initialize() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const provider = await chrome.runtime.sendMessage({
    type: MessageType.GET_PROVIDER_STATUS
  });
  providerConfigured = Boolean(provider?.ok && provider.configured);
  elements.providerName.textContent = providerConfigured
    ? `${provider.provider.name} · ${provider.provider.model}`
    : "尚未配置";

  if (!isSupportedUrl(activeTab?.url)) {
    setFeedback("浏览器内部页面和扩展商店页面不能注入翻译脚本。", "error");
  } else if (!providerConfigured) {
    setFeedback("先打开设置，添加你的 DeepSeek 或其他 API Token。");
  }
  if (isSupportedUrl(activeTab?.url)) {
    await ensureContentController();
  }
  await refreshStatus();
  pollTimer = setInterval(refreshStatus, 600);
}

elements.options.addEventListener("click", () => chrome.runtime.openOptionsPage());

elements.start.addEventListener("click", async () => {
  elements.start.disabled = true;
  try {
    await ensureContentController();
    const response = await sendToPage(MessageType.START_TRANSLATION);
    if (!response?.ok) {
      throw new Error(response?.error?.message ?? "无法开始翻译当前页面。");
    }
    setFeedback("正文已排队，译文会逐段出现。");
    renderStatus(response.status);
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    elements.start.disabled =
      pageStatus === "translating" ||
      !providerConfigured ||
      !isSupportedUrl(activeTab?.url);
  }
});

elements.stop.addEventListener("click", async () => {
  const response = await sendToPage(MessageType.STOP_TRANSLATION);
  if (response?.status) renderStatus(response.status);
});

elements.retry.addEventListener("click", async () => {
  const response = await sendToPage(MessageType.RETRY_TRANSLATION);
  if (response?.status) renderStatus(response.status);
});

elements.restore.addEventListener("click", async () => {
  const response = await sendToPage(MessageType.RESTORE_PAGE);
  if (response?.status) renderStatus(response.status);
  setFeedback("已移除扩展插入的译文，原页面内容未改动。");
});

window.addEventListener("unload", () => clearInterval(pollTimer));
await initialize();
