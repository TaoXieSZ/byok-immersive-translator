import {
  DEFAULT_APPEARANCE,
  normalizeAppearancePreference,
  resolveFontStacks
} from "../shared/appearance-preferences.mjs";

export const TRANSLATION_APPEARANCE_SELECTOR =
  ".byok-translator__translation[data-byok-translator]";
export const TRANSLATION_FONT_PROPERTY = "--byok-translation-font";
export const TRANSLATION_MONO_FONT_PROPERTY =
  "--byok-translation-mono-font";

function normalizeSafely(preference) {
  try {
    const normalized = normalizeAppearancePreference(preference);
    return normalized && typeof normalized === "object"
      ? normalized
      : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function valuesMatch(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
  return left === right;
}

function isCanonicalPreference(preference, normalized) {
  if (
    !preference ||
    typeof preference !== "object" ||
    Array.isArray(preference) ||
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    return false;
  }
  const normalizedKeys = Object.keys(normalized);
  const preferenceKeys = Object.keys(preference);
  return (
    normalizedKeys.length === preferenceKeys.length &&
    normalizedKeys.every(
      (key) =>
        Object.hasOwn(preference, key) &&
        valuesMatch(preference[key], normalized[key])
    )
  );
}

export function applyTranslationAppearance(
  element,
  preference,
  { resolveStacks = resolveFontStacks } = {}
) {
  if (!element?.matches?.(TRANSLATION_APPEARANCE_SELECTOR)) {
    return false;
  }
  const { body, mono } = resolveStacks(preference);
  if (body) {
    element.style.setProperty(TRANSLATION_FONT_PROPERTY, body);
  } else {
    element.style.removeProperty(TRANSLATION_FONT_PROPERTY);
  }
  if (mono) {
    element.style.setProperty(TRANSLATION_MONO_FONT_PROPERTY, mono);
  } else {
    element.style.removeProperty(TRANSLATION_MONO_FONT_PROPERTY);
  }
  return true;
}

export function createTranslationAppearanceController({
  root = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ??
    ((callback) => setTimeout(callback, 0)),
  normalize = normalizeSafely,
  resolveStacks = resolveFontStacks
} = {}) {
  let preference = normalize(DEFAULT_APPEARANCE);
  let frame = null;

  const applyTo = (element) =>
    applyTranslationAppearance(element, preference, { resolveStacks });

  const applyAll = () => {
    for (const element of root?.querySelectorAll?.(
      TRANSLATION_APPEARANCE_SELECTOR
    ) ?? []) {
      applyTo(element);
    }
  };

  const scheduleApplyAll = () => {
    if (frame !== null) {
      return;
    }
    frame = requestFrame(() => {
      frame = null;
      applyAll();
    });
  };

  return {
    applyTo,
    applyAll,
    getPreference: () => preference,
    useDefault() {
      preference = normalize(DEFAULT_APPEARANCE);
      scheduleApplyAll();
      return preference;
    },
    update(nextPreference, { requireCanonical = true } = {}) {
      let normalized;
      try {
        normalized = normalizeAppearancePreference(nextPreference, {
          strict: true
        });
      } catch {
        return false;
      }
      if (
        requireCanonical &&
        !isCanonicalPreference(nextPreference, normalized)
      ) {
        return false;
      }
      preference = normalized;
      scheduleApplyAll();
      return true;
    }
  };
}

export async function loadInitialTranslationAppearance({
  controller,
  sendMessage,
  messageType
}) {
  try {
    const response = await sendMessage({ type: messageType });
    if (
      response?.ok === true &&
      controller.update(response.preference)
    ) {
      return controller.getPreference();
    }
  } catch {
    // The content script remains usable when the background is unavailable.
  }
  return controller.useDefault();
}
