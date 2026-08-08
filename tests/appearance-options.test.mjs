import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyPreviewFont,
  createAppearanceDraft,
  createAppearanceFormController,
  createCanvasFontMetricProbe,
  detectFontAvailability,
  getExtensionOriginSetting,
  getProviderSetupCopy,
  inferProviderKind,
  ProviderKind,
  parseCustomFamilyInput
} from "../extension/src/options/options.mjs";
import {
  AppearanceMode,
  DEFAULT_APPEARANCE
} from "../extension/src/shared/appearance-preferences.mjs";

class FakeStyle {
  constructor() {
    this.fontFamily = "";
  }

  removeProperty(name) {
    if (name === "font-family") {
      this.fontFamily = "";
    }
  }
}

class FakeElement {
  constructor() {
    this.checked = false;
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
    this.style = new FakeStyle();
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event = {}) {
    return this.listeners.get(type)?.({
      preventDefault() {},
      ...event
    });
  }
}

function createElements() {
  const defaultMode = new FakeElement();
  defaultMode.value = AppearanceMode.DEFAULT;
  const mapleMode = new FakeElement();
  mapleMode.value = AppearanceMode.MAPLE_MONO;
  const customMode = new FakeElement();
  customMode.value = AppearanceMode.CUSTOM;
  return {
    form: new FakeElement(),
    modeInputs: [defaultMode, mapleMode, customMode],
    customField: new FakeElement(),
    customInput: new FakeElement(),
    availability: new FakeElement(),
    feedback: new FakeElement(),
    save: new FakeElement(),
    preview: {
      body: new FakeElement(),
      code: new FakeElement(),
      kbd: new FakeElement()
    }
  };
}

test("Options 提供三种字体选择、本机说明及完整预览样本", async () => {
  const html = await readFile(
    new URL("../extension/src/options/options.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /id="appearance-form"/u);
  assert.match(html, /value="default"/u);
  assert.match(html, /value="maple-mono"/u);
  assert.match(html, /value="custom"/u);
  assert.match(html, /只使用这台设备已安装的本机字体/u);
  assert.match(html, /Readable English 0123456789/u);
  assert.match(html, /id="font-preview-code"/u);
  assert.match(html, /id="font-preview-kbd"/u);
});

test("Options 默认只要求 API Key，并把连接细节收进高级设置", async () => {
  const html = await readFile(
    new URL("../extension/src/options/options.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /id="api-key-field" class="primary-field"/u);
  assert.match(html, /只需填写这一项/u);
  assert.match(html, /id="target-language" required/u);
  assert.match(html, /id="advanced-settings"/u);
  assert.match(html, /通常无需修改/u);
});

test("Options 提供无需 API Key 的 Ollama 预设和隐私边界说明", async () => {
  const html = await readFile(
    new URL("../extension/src/options/options.html", import.meta.url),
    "utf8"
  );
  assert.match(html, /id="new-ollama"/u);
  assert.match(html, /无需 Key/u);
  assert.match(html, /id="local-privacy-note"/u);
  assert.match(html, /正文不出设备/u);
  assert.match(html, /id="ollama-extension-origin"/u);
});

test("Ollama 来源提示同时支持 Chrome 与 Safari 扩展协议", () => {
  assert.equal(
    getExtensionOriginSetting("chrome-extension://abc/"),
    "OLLAMA_ORIGINS=chrome-extension://abc"
  );
  assert.equal(
    getExtensionOriginSetting("safari-web-extension://com.example.extension/"),
    "OLLAMA_ORIGINS=safari-web-extension://com.example.extension"
  );
});

test("Provider 预设识别为首次配置提供完整默认值", () => {
  assert.equal(
    inferProviderKind({ baseUrl: "https://api.deepseek.com" }),
    ProviderKind.DEEPSEEK
  );
  assert.equal(
    inferProviderKind({ baseUrl: "http://localhost:11434/v1" }),
    ProviderKind.OLLAMA
  );
  assert.equal(
    inferProviderKind({ baseUrl: "https://api.example.com/v1" }),
    ProviderKind.CUSTOM
  );
  assert.deepEqual(
    getProviderSetupCopy(ProviderKind.DEEPSEEK).modelSuggestions,
    ["deepseek-v4-flash", "deepseek-v4-pro"]
  );
  assert.match(
    getProviderSetupCopy(ProviderKind.DEEPSEEK).hint,
    /粘贴 API Key/u
  );
  assert.match(
    getProviderSetupCopy(ProviderKind.OLLAMA).hint,
    /无需 API Key/u
  );
});

test("自定义字体输入支持换行和英文逗号并清理空项", () => {
  assert.deepEqual(
    parseCustomFamilyInput(" Maple Mono NF CN,\n LXGW WenKai ,,  "),
    ["Maple Mono NF CN", "LXGW WenKai"]
  );
});

test("Maple Mono 与自定义表单生成结构化偏好", () => {
  assert.deepEqual(
    createAppearanceDraft(AppearanceMode.MAPLE_MONO),
    {
      version: DEFAULT_APPEARANCE.version,
      mode: AppearanceMode.MAPLE_MONO,
      customFamilies: []
    }
  );
  assert.deepEqual(
    createAppearanceDraft(
      AppearanceMode.CUSTOM,
      "Maple Mono NF CN, LXGW WenKai"
    ).customFamilies,
    ["Maple Mono NF CN", "LXGW WenKai"]
  );
});

test("实时预览分别应用正文和等宽字体栈", () => {
  const preview = {
    body: new FakeElement(),
    code: new FakeElement(),
    kbd: new FakeElement()
  };
  const stacks = applyPreviewFont(
    createAppearanceDraft(AppearanceMode.MAPLE_MONO),
    preview
  );

  assert.equal(preview.body.style.fontFamily, stacks.body);
  assert.equal(preview.code.style.fontFamily, stacks.mono);
  assert.equal(preview.kbd.style.fontFamily, stacks.mono);
  assert.match(stacks.body, /Maple Mono/u);

  applyPreviewFont(DEFAULT_APPEARANCE, preview);
  assert.equal(preview.body.style.fontFamily, "");
  assert.equal(preview.code.style.fontFamily, "");
  assert.equal(preview.kbd.style.fontFamily, "");
});

test("字体检测区分可用、未安装、无法检测和默认继承", () => {
  const maple = createAppearanceDraft(AppearanceMode.MAPLE_MONO);
  assert.equal(
    detectFontAvailability(maple, { check: () => true }).status,
    "available"
  );
  assert.equal(
    detectFontAvailability(maple, { check: () => false }).status,
    "missing"
  );
  assert.equal(
    detectFontAvailability(maple, { check: () => true }, () => false).status,
    "missing"
  );
  assert.equal(detectFontAvailability(maple).status, "unknown");
  assert.equal(
    detectFontAvailability(maple, {
      check() {
        throw new Error("blocked");
      }
    }).status,
    "unknown"
  );
  assert.equal(
    detectFontAvailability(DEFAULT_APPEARANCE, { check: () => false }).status,
    "inherited"
  );
});

test("Canvas 字宽探针区分真实字体与回退字体", () => {
  const context = {
    font: "",
    measureText() {
      return {
        width: this.font.includes('"Installed Font"') ? 321 : 300
      };
    }
  };
  const metricProbe = createCanvasFontMetricProbe({
    createElement() {
      return {
        getContext() {
          return context;
        }
      };
    }
  });

  assert.equal(metricProbe("Installed Font"), true);
  assert.equal(metricProbe("Missing Font"), false);
  assert.equal(
    createCanvasFontMetricProbe({
      createElement() {
        return { getContext: () => null };
      }
    }),
    null
  );
});

test("表单加载保存 Maple Mono 并显示成功反馈", async () => {
  const elements = createElements();
  const saves = [];
  const repository = {
    async getPreference() {
      return DEFAULT_APPEARANCE;
    },
    async savePreference(preference) {
      saves.push(preference);
      return preference;
    }
  };
  const controller = createAppearanceFormController({
    repository,
    elements,
    fontSet: { check: () => true }
  });

  await controller.load();
  assert.equal(elements.modeInputs[0].checked, true);
  assert.equal(elements.customInput.disabled, true);

  elements.modeInputs[0].checked = false;
  elements.modeInputs[1].checked = true;
  elements.modeInputs[1].dispatch("change");
  assert.match(elements.preview.body.style.fontFamily, /Maple Mono/u);
  assert.equal(elements.availability.dataset.status, "available");

  const result = await controller.save();
  assert.equal(result.ok, true);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].mode, AppearanceMode.MAPLE_MONO);
  assert.equal(elements.feedback.dataset.tone, "success");
});

test("非法自定义输入不覆盖上一份有效设置", async () => {
  const elements = createElements();
  let saveCount = 0;
  const repository = {
    async getPreference() {
      return createAppearanceDraft(AppearanceMode.MAPLE_MONO);
    },
    async savePreference(preference) {
      saveCount += 1;
      return preference;
    }
  };
  const controller = createAppearanceFormController({
    repository,
    elements,
    fontSet: { check: () => true }
  });

  await controller.load();
  elements.modeInputs[1].checked = false;
  elements.modeInputs[2].checked = true;
  elements.customInput.value = "url(https://evil.example/font.woff2)";

  const result = await controller.save();
  assert.equal(result.ok, false);
  assert.equal(result.preference.mode, AppearanceMode.MAPLE_MONO);
  assert.equal(saveCount, 0);
  assert.equal(elements.feedback.dataset.tone, "error");
});

test("字体检测失败不阻止有效设置保存", async () => {
  const elements = createElements();
  let saved = null;
  const controller = createAppearanceFormController({
    repository: {
      async getPreference() {
        return DEFAULT_APPEARANCE;
      },
      async savePreference(preference) {
        saved = preference;
        return preference;
      }
    },
    elements,
    fontSet: null
  });
  await controller.load();
  elements.modeInputs[0].checked = false;
  elements.modeInputs[1].checked = true;

  const result = await controller.save();
  assert.equal(result.ok, true);
  assert.equal(saved.mode, AppearanceMode.MAPLE_MONO);
  assert.equal(elements.availability.dataset.status, "unknown");
});
