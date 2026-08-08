import { MessageType } from "../shared/messages.mjs";
import {
  AppearanceMode,
  DEFAULT_APPEARANCE,
  createChromeAppearanceRepository,
  resolveFontStacks,
  validateAppearancePreference
} from "../shared/appearance-preferences.mjs";
import {
  DEEPSEEK_PRESET,
  getProviderOriginPattern,
  OLLAMA_PRESET,
  validateProviderDraft
} from "../shared/provider-config.mjs";
import {
  createChromeProviderRepository
} from "../shared/provider-store.mjs";
import {
  hasPageAccess,
  removeUnusedProviderPermission,
  removePageAccess,
  requestPageAccess,
  requestProviderPermission
} from "../shared/permissions.mjs";

const MAPLE_MONO_PRIMARY_FAMILY = "Maple Mono NF CN";
const FONT_PROBE_TEXT = "mmmmmmmmmmlliWW@@你好0123456789";
const FONT_PROBE_FALLBACKS = ["monospace", "sans-serif", "serif"];
export const ProviderKind = Object.freeze({
  DEEPSEEK: "deepseek",
  OLLAMA: "ollama",
  CUSTOM: "custom"
});

export function inferProviderKind(provider) {
  try {
    const url = new URL(provider?.baseUrl);
    if (url.hostname === "api.deepseek.com") {
      return ProviderKind.DEEPSEEK;
    }
    if (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.port === "11434"
    ) {
      return ProviderKind.OLLAMA;
    }
  } catch {
    // Incomplete custom drafts intentionally fall through to the custom form.
  }
  return ProviderKind.CUSTOM;
}

export function getProviderSetupCopy(kind) {
  if (kind === ProviderKind.DEEPSEEK) {
    return {
      title: "连接 DeepSeek",
      hint: "推荐配置已经准备好。粘贴 API Key，保存后即可开始翻译。",
      modelHelp: "默认使用速度和成本更均衡的 DeepSeek V4 Flash。",
      modelSuggestions: ["deepseek-v4-flash", "deepseek-v4-pro"]
    };
  }
  if (kind === ProviderKind.OLLAMA) {
    return {
      title: "连接 Ollama（本机）",
      hint: "无需 API Key。确认本机模型名称，保存后即可在设备内翻译。",
      modelHelp: "默认使用 qwen3:8b；也可以输入本机已经下载的模型名称。",
      modelSuggestions: ["qwen3:8b"]
    };
  }
  return {
    title: "连接自定义服务",
    hint: "填写 OpenAI-compatible 服务的凭据；连接地址和兼容选项位于高级设置。",
    modelHelp: "输入服务商提供的准确模型 ID。",
    modelSuggestions: []
  };
}

export function getExtensionOriginSetting(runtimeUrl) {
  const origin = typeof runtimeUrl === "string"
    ? runtimeUrl.replace(/\/+$/u, "")
    : "";
  return `OLLAMA_ORIGINS=${origin || "当前扩展来源"}`;
}

export function parseCustomFamilyInput(input) {
  return String(input ?? "")
    .split(/[\n,]+/u)
    .map((family) => family.trim())
    .filter(Boolean);
}

export function createAppearanceDraft(mode, customInput = "") {
  return validateAppearancePreference({
    version: DEFAULT_APPEARANCE.version,
    mode,
    customFamilies:
      mode === AppearanceMode.CUSTOM
        ? parseCustomFamilyInput(customInput)
        : []
  });
}

export function getPrimaryFontFamily(preference) {
  if (preference.mode === AppearanceMode.MAPLE_MONO) {
    return MAPLE_MONO_PRIMARY_FAMILY;
  }
  if (preference.mode === AppearanceMode.CUSTOM) {
    return preference.customFamilies[0] ?? null;
  }
  return null;
}

export function createCanvasFontMetricProbe(documentRef) {
  const context = documentRef
    ?.createElement?.("canvas")
    ?.getContext?.("2d");
  if (!context || typeof context.measureText !== "function") {
    return null;
  }

  return (family) =>
    FONT_PROBE_FALLBACKS.some((fallback) => {
      context.font = `72px ${fallback}`;
      const fallbackWidth = context.measureText(FONT_PROBE_TEXT).width;
      context.font = `72px "${family.replaceAll('"', '\\"')}", ${fallback}`;
      const candidateWidth = context.measureText(FONT_PROBE_TEXT).width;
      return Math.abs(candidateWidth - fallbackWidth) > 0.01;
    });
}

export function detectFontAvailability(
  preference,
  fontSet,
  metricProbe = null
) {
  const family = getPrimaryFontFamily(preference);
  if (!family) {
    return {
      status: "inherited",
      message: "跟随网页字体，无需检测。"
    };
  }
  if (!fontSet || typeof fontSet.check !== "function") {
    return {
      status: "unknown",
      message: `无法检测“${family}”，仍可安全保存并使用回退字体。`
    };
  }
  try {
    const available =
      fontSet.check(
        `16px "${family.replaceAll('"', '\\"')}"`,
        FONT_PROBE_TEXT
      ) &&
      (typeof metricProbe !== "function" || metricProbe(family));
    return available
      ? { status: "available", message: `“${family}”已安装，可直接使用。` }
      : {
          status: "missing",
          message: `未检测到“${family}”，请自行安装；保存后会自动回退。`
        };
  } catch {
    return {
      status: "unknown",
      message: `无法检测“${family}”，仍可安全保存并使用回退字体。`
    };
  }
}

export function applyPreviewFont(preference, elements) {
  const stacks = resolveFontStacks(preference);
  if (stacks.body) {
    elements.body.style.fontFamily = stacks.body;
  } else {
    elements.body.style.removeProperty("font-family");
  }
  for (const element of [elements.code, elements.kbd]) {
    if (stacks.mono) {
      element.style.fontFamily = stacks.mono;
    } else {
      element.style.removeProperty("font-family");
    }
  }
  return stacks;
}

export function createAppearanceFormController({
  repository,
  elements,
  fontSet,
  metricProbe = null,
  onError = () => {}
}) {
  let savedPreference = DEFAULT_APPEARANCE;

  function selectedMode() {
    return elements.modeInputs.find((input) => input.checked)?.value ??
      AppearanceMode.DEFAULT;
  }

  function setFeedback(message = "", tone = "") {
    elements.feedback.textContent = message;
    elements.feedback.dataset.tone = tone;
  }

  function showPreference(preference) {
    for (const input of elements.modeInputs) {
      input.checked = input.value === preference.mode;
    }
    elements.customInput.value = preference.customFamilies.join("\n");
  }

  function readDraft() {
    return createAppearanceDraft(selectedMode(), elements.customInput.value);
  }

  function updateCustomField() {
    const enabled = selectedMode() === AppearanceMode.CUSTOM;
    elements.customInput.disabled = !enabled;
    elements.customField.dataset.disabled = String(!enabled);
  }

  function renderDraft() {
    updateCustomField();
    try {
      const draft = readDraft();
      applyPreviewFont(draft, elements.preview);
      const detection = detectFontAvailability(draft, fontSet, metricProbe);
      elements.availability.textContent = detection.message;
      elements.availability.dataset.status = detection.status;
      setFeedback();
      return draft;
    } catch (error) {
      elements.availability.textContent = "请先修正自定义字体名称。";
      elements.availability.dataset.status = "unknown";
      setFeedback(error.message, "error");
      onError(error);
      return null;
    }
  }

  async function load() {
    savedPreference = await repository.getPreference();
    showPreference(savedPreference);
    renderDraft();
    return savedPreference;
  }

  async function save() {
    const draft = renderDraft();
    if (!draft) {
      return { ok: false, preference: savedPreference };
    }
    try {
      elements.save.disabled = true;
      savedPreference = await repository.savePreference(draft);
      showPreference(savedPreference);
      renderDraft();
      setFeedback("译文字体已保存，已打开页面会立即更新。", "success");
      return { ok: true, preference: savedPreference };
    } catch (error) {
      setFeedback(error.message, "error");
      onError(error);
      return { ok: false, preference: savedPreference };
    } finally {
      elements.save.disabled = false;
    }
  }

  for (const input of elements.modeInputs) {
    input.addEventListener("change", renderDraft);
  }
  elements.customInput.addEventListener("input", renderDraft);
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await save();
  });

  return { load, readDraft, renderDraft, save };
}

async function initializeOptions() {
  const repository = createChromeProviderRepository();
  const appearanceRepository = createChromeAppearanceRepository();
  const elements = {
    form: document.querySelector("#provider-form"),
    id: document.querySelector("#provider-id"),
    name: document.querySelector("#provider-name"),
    baseUrl: document.querySelector("#base-url"),
    apiKey: document.querySelector("#api-key"),
    model: document.querySelector("#model"),
    modelHelp: document.querySelector("#model-help"),
    modelSuggestions: document.querySelector("#model-suggestions"),
    targetLanguage: document.querySelector("#target-language"),
    jsonMode: document.querySelector("#json-mode"),
    providerList: document.querySelector("#provider-list"),
    title: document.querySelector("#editor-title"),
    setupHint: document.querySelector("#setup-hint"),
    selectedBadge: document.querySelector("#selected-badge"),
    apiKeyField: document.querySelector("#api-key-field"),
    advancedSettings: document.querySelector("#advanced-settings"),
    localPrivacyNote: document.querySelector("#local-privacy-note"),
    ollamaExtensionOrigin: document.querySelector("#ollama-extension-origin"),
    feedback: document.querySelector("#feedback"),
    test: document.querySelector("#test-provider"),
    delete: document.querySelector("#delete-provider"),
    newDeepSeek: document.querySelector("#new-deepseek"),
    newOllama: document.querySelector("#new-ollama"),
    newCustom: document.querySelector("#new-custom"),
    pageAccess: document.querySelector("#page-access"),
    pageAccessStatus: document.querySelector("#page-access-status")
  };
  const appearanceElements = {
    form: document.querySelector("#appearance-form"),
    modeInputs: [...document.querySelectorAll("[name='appearance-mode']")],
    customField: document.querySelector("#custom-font-field"),
    customInput: document.querySelector("#custom-font-families"),
    availability: document.querySelector("#font-availability"),
    feedback: document.querySelector("#appearance-feedback"),
    save: document.querySelector("#save-appearance"),
    preview: {
      body: document.querySelector("#font-preview-body"),
      code: document.querySelector("#font-preview-code"),
      kbd: document.querySelector("#font-preview-kbd")
    }
  };

  let state = await repository.getState();
  elements.ollamaExtensionOrigin.textContent = getExtensionOriginSetting(
    chrome.runtime.getURL("")
  );

  function setFeedback(message = "", tone = "") {
    elements.feedback.textContent = message;
    elements.feedback.dataset.tone = tone;
  }

  function renderPageAccess(enabled, message = "", tone = "") {
    elements.pageAccess.checked = enabled;
    elements.pageAccessStatus.textContent =
      message ||
      (enabled
        ? "已开启：获准的普通网页会自动显示悬浮按钮。"
        : "未开启：点击扩展按钮后，仍可通过 activeTab 临时翻译当前页面。");
    elements.pageAccessStatus.dataset.enabled = String(enabled);
    elements.pageAccessStatus.dataset.tone = tone;
  }

  function readDraft() {
    return validateProviderDraft({
      id: elements.id.value || crypto.randomUUID(),
      name: elements.name.value,
      baseUrl: elements.baseUrl.value,
      apiKey: elements.apiKey.value,
      model: elements.model.value,
      targetLanguage: elements.targetLanguage.value,
      jsonMode: elements.jsonMode.checked
    });
  }

  function selectTargetLanguage(language) {
    const value = language || "简体中文";
    for (const option of [...elements.targetLanguage.options]) {
      if (option.dataset.custom === "true") {
        option.remove();
      }
    }
    if (![...elements.targetLanguage.options].some((option) => option.value === value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.dataset.custom = "true";
      elements.targetLanguage.append(option);
    }
    elements.targetLanguage.value = value;
  }

  function renderProviderKind(kind) {
    const copy = getProviderSetupCopy(kind);
    elements.title.textContent = copy.title;
    elements.setupHint.textContent = copy.hint;
    elements.modelHelp.textContent = copy.modelHelp;
    elements.modelSuggestions.replaceChildren(
      ...copy.modelSuggestions.map((model) => {
        const option = document.createElement("option");
        option.value = model;
        return option;
      })
    );
    elements.apiKeyField.hidden = kind === ProviderKind.OLLAMA;
    elements.apiKey.required = kind !== ProviderKind.OLLAMA;
    elements.apiKey.placeholder =
      kind === ProviderKind.DEEPSEEK
        ? "粘贴 DeepSeek API Key"
        : "粘贴服务商提供的 API Key";
    elements.localPrivacyNote.hidden = kind !== ProviderKind.OLLAMA;
    elements.advancedSettings.open = kind === ProviderKind.CUSTOM;
    elements.newDeepSeek.setAttribute(
      "aria-pressed",
      String(kind === ProviderKind.DEEPSEEK)
    );
    elements.newOllama.setAttribute(
      "aria-pressed",
      String(kind === ProviderKind.OLLAMA)
    );
  }

  function fillForm(provider = null, requestedKind = null) {
    const kind = requestedKind ?? inferProviderKind(provider);
    elements.id.value = provider?.id ?? "";
    elements.name.value = provider?.name ?? "";
    elements.baseUrl.value = provider?.baseUrl ?? "";
    elements.apiKey.value =
      provider?.apiKey ?? (kind === ProviderKind.OLLAMA ? "ollama" : "");
    elements.model.value = provider?.model ?? "";
    selectTargetLanguage(provider?.targetLanguage);
    elements.jsonMode.checked = provider?.jsonMode ?? false;
    elements.delete.hidden = !provider;
    elements.selectedBadge.hidden =
      !provider || provider.id !== state.selectedProviderId;
    renderProviderKind(kind);
    setFeedback();
  }

  function renderProviderList() {
    elements.providerList.replaceChildren();
    for (const provider of state.providers) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "provider-card";
      button.setAttribute(
        "aria-current",
        String(provider.id === state.selectedProviderId)
      );
      const content = document.createElement("span");
      const name = document.createElement("strong");
      const details = document.createElement("small");
      name.textContent = provider.name;
      details.textContent = `${provider.model} · ${provider.targetLanguage}`;
      content.append(name, details);
      button.append(content);
      button.addEventListener("click", async () => {
        state = await repository.selectProvider(provider.id);
        fillForm(provider);
        renderProviderList();
      });
      elements.providerList.append(button);
    }
  }

  async function withBusy(button, operation) {
    button.disabled = true;
    try {
      return await operation();
    } finally {
      button.disabled = false;
    }
  }

  elements.newDeepSeek.addEventListener("click", () => {
    fillForm(
      { ...DEEPSEEK_PRESET, id: "", apiKey: "" },
      ProviderKind.DEEPSEEK
    );
    elements.apiKey.focus();
  });

  elements.newOllama.addEventListener("click", () => {
    fillForm({ ...OLLAMA_PRESET, id: "" }, ProviderKind.OLLAMA);
    elements.model.focus();
  });

  elements.newCustom.addEventListener("click", () => {
    fillForm(null, ProviderKind.CUSTOM);
    elements.apiKey.focus();
  });

  elements.pageAccess.addEventListener("change", async () => {
    const enable = elements.pageAccess.checked;
    elements.pageAccess.disabled = true;
    try {
      if (enable) {
        const granted = await requestPageAccess();
        if (!granted) {
          renderPageAccess(
            false,
            "未获得网站访问权限；activeTab 临时翻译仍可正常使用。",
            "error"
          );
          return;
        }
        renderPageAccess(true);
        return;
      }

      const removed = await removePageAccess();
      if (!removed && await hasPageAccess()) {
        renderPageAccess(true, "网站访问权限未能撤销，请稍后重试。", "error");
        return;
      }
      renderPageAccess(false);
    } catch (error) {
      renderPageAccess(
        await hasPageAccess().catch(() => !enable),
        error.message,
        "error"
      );
    } finally {
      elements.pageAccess.disabled = false;
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter;
    await withBusy(submitButton, async () => {
      try {
        const provider = readDraft();
        const previousProvider = state.providers.find(
          (item) => item.id === provider.id
        );
        await requestProviderPermission(provider.baseUrl);
        state = await repository.saveProvider(provider);
        if (
          previousProvider &&
          getProviderOriginPattern(previousProvider.baseUrl) !==
            getProviderOriginPattern(provider.baseUrl)
        ) {
          await removeUnusedProviderPermission(
            previousProvider.baseUrl,
            state.providers
          );
        }
        renderProviderList();
        fillForm(provider);
        setFeedback("已保存在本机，并设为当前翻译服务。", "success");
      } catch (error) {
        setFeedback(error.message, "error");
      }
    });
  });

  elements.test.addEventListener("click", async () => {
    await withBusy(elements.test, async () => {
      try {
        const provider = readDraft();
        await requestProviderPermission(provider.baseUrl);
        setFeedback("正在发送最小连接测试…");
        const response = await chrome.runtime.sendMessage({
          type: MessageType.TEST_PROVIDER,
          provider
        });
        if (!response?.ok) {
          throw new Error(response?.error?.message ?? "连接测试失败。");
        }
        setFeedback("连接成功，凭据（若服务需要）与模型可用。", "success");
      } catch (error) {
        setFeedback(error.message, "error");
      }
    });
  });

  elements.delete.addEventListener("click", async () => {
    const provider = state.providers.find((item) => item.id === elements.id.value);
    if (!provider || !confirm(`删除“${provider.name}”？API Key 将从本机清除。`)) {
      return;
    }
    state = await repository.deleteProvider(provider.id);
    await removeUnusedProviderPermission(provider.baseUrl, state.providers);
    renderProviderList();
    const selected = state.providers.find(
      (item) => item.id === state.selectedProviderId
    );
    fillForm(
      selected ?? { ...DEEPSEEK_PRESET, id: "", apiKey: "" },
      selected ? null : ProviderKind.DEEPSEEK
    );
    setFeedback("配置与 API Key 已删除。", "success");
  });

  renderProviderList();
  const selectedProvider = state.providers.find(
    (provider) => provider.id === state.selectedProviderId
  );
  fillForm(
    selectedProvider ?? { ...DEEPSEEK_PRESET, id: "", apiKey: "" },
    selectedProvider ? null : ProviderKind.DEEPSEEK
  );
  renderPageAccess(await hasPageAccess());

  chrome.permissions.onAdded.addListener(async () => {
    renderPageAccess(await hasPageAccess());
  });
  chrome.permissions.onRemoved.addListener(async () => {
    renderPageAccess(await hasPageAccess());
  });

  const appearanceController = createAppearanceFormController({
    repository: appearanceRepository,
    elements: appearanceElements,
    fontSet: document.fonts,
    metricProbe: createCanvasFontMetricProbe(document)
  });
  await appearanceController.load();
}

if (typeof document !== "undefined") {
  await initializeOptions();
}
