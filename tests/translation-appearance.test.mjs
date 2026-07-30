import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSLATION_APPEARANCE_SELECTOR,
  TRANSLATION_FONT_PROPERTY,
  TRANSLATION_MONO_FONT_PROPERTY,
  applyTranslationAppearance,
  createTranslationAppearanceController,
  loadInitialTranslationAppearance
} from "../extension/src/content/translation-appearance.mjs";
import {
  DEFAULT_APPEARANCE,
  normalizeAppearancePreference
} from "../extension/src/shared/appearance-preferences.mjs";

function createStyle() {
  const values = new Map();
  return {
    values,
    setProperty(name, value) {
      values.set(name, value);
    },
    removeProperty(name) {
      values.delete(name);
    }
  };
}

function createTranslationElement() {
  return {
    style: createStyle(),
    matches(selector) {
      return selector === TRANSLATION_APPEARANCE_SELECTOR;
    }
  };
}

const maple = normalizeAppearancePreference({
  version: 1,
  mode: "maple-mono",
  customFamilies: []
});

test("appearance applies only to extension-owned translation containers", () => {
  const translation = createTranslationElement();
  const source = {
    style: createStyle(),
    matches: () => false
  };
  const resolveStacks = () => ({
    body: '"Maple Mono", sans-serif',
    mono: '"Maple Mono", ui-monospace, monospace'
  });

  assert.equal(
    applyTranslationAppearance(translation, maple, { resolveStacks }),
    true
  );
  assert.equal(
    translation.style.values.get(TRANSLATION_FONT_PROPERTY),
    '"Maple Mono", sans-serif'
  );
  assert.equal(
    translation.style.values.get(TRANSLATION_MONO_FONT_PROPERTY),
    '"Maple Mono", ui-monospace, monospace'
  );
  assert.equal(
    applyTranslationAppearance(source, maple, { resolveStacks }),
    false
  );
  assert.equal(source.style.values.size, 0);
});

test("default mode removes both variables without touching other styles", () => {
  const translation = createTranslationElement();
  translation.style.values.set(TRANSLATION_FONT_PROPERTY, "old-body");
  translation.style.values.set(TRANSLATION_MONO_FONT_PROPERTY, "old-mono");
  translation.style.values.set("color", "red");

  applyTranslationAppearance(translation, DEFAULT_APPEARANCE, {
    resolveStacks: () => ({ body: null, mono: null })
  });

  assert.deepEqual(
    Object.fromEntries(translation.style.values),
    { color: "red" }
  );
});

test("existing translations update once per animation frame and new ones use latest preference", () => {
  const existing = createTranslationElement();
  const addedLater = createTranslationElement();
  const frames = [];
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, TRANSLATION_APPEARANCE_SELECTOR);
      return [existing];
    }
  };
  const controller = createTranslationAppearanceController({
    root,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    resolveStacks: (preference) =>
      preference.mode === "maple-mono"
        ? { body: "maple-body", mono: "maple-mono" }
        : preference.mode === "custom"
          ? { body: "custom-body", mono: "custom-mono" }
          : { body: null, mono: null }
  });
  const custom = normalizeAppearancePreference({
    version: 1,
    mode: "custom",
    customFamilies: ["Example Sans"]
  });

  assert.equal(controller.update(maple), true);
  assert.equal(controller.update(custom), true);
  assert.equal(frames.length, 1);

  controller.applyTo(addedLater);
  assert.equal(
    addedLater.style.values.get(TRANSLATION_FONT_PROPERTY),
    "custom-body"
  );

  frames[0]();
  assert.equal(
    existing.style.values.get(TRANSLATION_FONT_PROPERTY),
    "custom-body"
  );
});

test("invalid update messages leave the last valid preference unchanged", () => {
  const frames = [];
  const controller = createTranslationAppearanceController({
    root: { querySelectorAll: () => [] },
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    }
  });

  assert.equal(controller.update(maple), true);
  assert.equal(
    controller.update({
      ...maple,
      css: "url(https://evil.example/font.woff2)"
    }),
    false
  );
  assert.deepEqual(controller.getPreference(), maple);
  assert.equal(frames.length, 1);
});

test("initial loading falls back to default when background is unavailable or response is invalid", async () => {
  const element = createTranslationElement();
  element.style.values.set(TRANSLATION_FONT_PROPERTY, "old-body");
  const frames = [];
  const controller = createTranslationAppearanceController({
    root: { querySelectorAll: () => [element] },
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    }
  });

  const preference = await loadInitialTranslationAppearance({
    controller,
    sendMessage: async () => {
      throw new Error("Extension context unavailable");
    },
    messageType: "appearance:get-preference"
  });

  assert.deepEqual(preference, DEFAULT_APPEARANCE);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(
    element.style.values.has(TRANSLATION_FONT_PROPERTY),
    false
  );

  const invalid = await loadInitialTranslationAppearance({
    controller,
    sendMessage: async () => ({
      ok: true,
      preference: {
        version: 1,
        mode: "custom",
        customFamilies: ["url(evil)"]
      }
    }),
    messageType: "appearance:get-preference"
  });
  assert.deepEqual(invalid, DEFAULT_APPEARANCE);
});

test("CSS keeps translation and inline-code fonts on isolated variables", async () => {
  const css = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../extension/src/content/content.css", import.meta.url),
      "utf8"
    )
  );

  assert.match(
    css,
    /\.byok-translator__translation\[data-byok-translator\][^{]*\{[^}]*font-family:\s*var\(--byok-translation-font,\s*inherit\)/su
  );
  assert.match(css, /--byok-translation-mono-font/su);
  assert.match(css, /ui-monospace/su);
  assert.match(css, /monospace/su);
  assert.doesNotMatch(css, /html\s*\{[^}]*--byok-translation/su);
  assert.doesNotMatch(css, /:root\s*\{[^}]*--byok-translation/su);
});
