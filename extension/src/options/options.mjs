import { MessageType } from "../shared/messages.mjs";
import {
  DEEPSEEK_PRESET,
  getProviderOriginPattern,
  validateProviderDraft
} from "../shared/provider-config.mjs";
import {
  createChromeProviderRepository
} from "../shared/provider-store.mjs";
import {
  removeUnusedProviderPermission,
  requestProviderPermission
} from "../shared/permissions.mjs";

const repository = createChromeProviderRepository();
const elements = {
  form: document.querySelector("#provider-form"),
  id: document.querySelector("#provider-id"),
  name: document.querySelector("#provider-name"),
  baseUrl: document.querySelector("#base-url"),
  apiKey: document.querySelector("#api-key"),
  model: document.querySelector("#model"),
  targetLanguage: document.querySelector("#target-language"),
  jsonMode: document.querySelector("#json-mode"),
  providerList: document.querySelector("#provider-list"),
  title: document.querySelector("#editor-title"),
  selectedBadge: document.querySelector("#selected-badge"),
  feedback: document.querySelector("#feedback"),
  test: document.querySelector("#test-provider"),
  delete: document.querySelector("#delete-provider"),
  newDeepSeek: document.querySelector("#new-deepseek"),
  newCustom: document.querySelector("#new-custom")
};

let state = await repository.getState();

function setFeedback(message = "", tone = "") {
  elements.feedback.textContent = message;
  elements.feedback.dataset.tone = tone;
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

function fillForm(provider = null) {
  elements.id.value = provider?.id ?? "";
  elements.name.value = provider?.name ?? "";
  elements.baseUrl.value = provider?.baseUrl ?? "";
  elements.apiKey.value = provider?.apiKey ?? "";
  elements.model.value = provider?.model ?? "";
  elements.targetLanguage.value = provider?.targetLanguage ?? "简体中文";
  elements.jsonMode.checked = provider?.jsonMode ?? false;
  elements.title.textContent = provider ? provider.name : "新建翻译服务";
  elements.delete.hidden = !provider;
  elements.selectedBadge.hidden =
    !provider || provider.id !== state.selectedProviderId;
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
  fillForm({ ...DEEPSEEK_PRESET, id: "", apiKey: "" });
  elements.title.textContent = "新建 DeepSeek";
});

elements.newCustom.addEventListener("click", () => fillForm());

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
      setFeedback("连接成功，Token 与模型可用。", "success");
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
  fillForm(selected ?? null);
  setFeedback("配置与 API Key 已删除。", "success");
});

renderProviderList();
fillForm(
  state.providers.find((provider) => provider.id === state.selectedProviderId) ??
    null
);
