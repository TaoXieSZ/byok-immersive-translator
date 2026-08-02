export const MAX_SELECTION_CHARACTERS = 2_000;
export const MAX_SELECTION_CONTEXT_CHARACTERS = 4_000;
export const MAGIC_LENS_HOST_ID = "byok-translator-magic-lens";

const SEMANTIC_TAGS = new Set([
  "P",
  "LI",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "TD",
  "TH",
  "DT",
  "DD",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6"
]);
const EXCLUDED_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "PRE",
  "CODE",
  "SCRIPT",
  "STYLE"
]);

export function normalizeSelectionText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isMeaningfulSelectionText(value) {
  const normalized = normalizeSelectionText(value);
  return (
    normalized.length >= 1 &&
    normalized.length <= MAX_SELECTION_CHARACTERS &&
    /[\p{L}\p{N}]/u.test(normalized)
  );
}

function elementFromNode(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement ?? node.parentNode ?? null;
}

function parentElement(element) {
  return element?.parentElement ?? element?.parentNode ?? null;
}

function hasAttribute(element, name) {
  if (typeof element?.hasAttribute === "function") {
    return element.hasAttribute(name);
  }
  return element?.attributes?.[name] !== undefined;
}

function getAttribute(element, name) {
  if (typeof element?.getAttribute === "function") {
    return element.getAttribute(name);
  }
  return element?.attributes?.[name] ?? null;
}

export function isExcludedSelectionNode(node) {
  let element = elementFromNode(node);
  while (element) {
    const tagName = String(element.tagName ?? "").toUpperCase();
    const contentEditable = getAttribute(element, "contenteditable");
    if (
      EXCLUDED_TAGS.has(tagName) ||
      element.isContentEditable === true ||
      (contentEditable !== null && contentEditable !== "false") ||
      element.id === MAGIC_LENS_HOST_ID ||
      hasAttribute(element, "data-byok-translator")
    ) {
      return true;
    }
    element = parentElement(element);
  }
  return false;
}

export function findSemanticSelectionRoot(node) {
  let element = elementFromNode(node);
  while (element) {
    if (SEMANTIC_TAGS.has(String(element.tagName ?? "").toUpperCase())) {
      return element;
    }
    element = parentElement(element);
  }
  return null;
}

export function createBoundedSelectionContext(
  context,
  selection,
  maxCharacters = MAX_SELECTION_CONTEXT_CHARACTERS
) {
  const normalizedSelection = normalizeSelectionText(selection);
  const normalizedContext = normalizeSelectionText(context);
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new TypeError("A positive context character limit is required.");
  }
  if (!normalizedSelection) return "";
  if (!normalizedContext.includes(normalizedSelection)) {
    return normalizedSelection.slice(0, maxCharacters);
  }
  if (normalizedContext.length <= maxCharacters) {
    return normalizedContext;
  }

  const selectionIndex = normalizedContext.indexOf(normalizedSelection);
  if (normalizedSelection.length >= maxCharacters) {
    return normalizedSelection.slice(0, maxCharacters);
  }
  const surroundingBudget = maxCharacters - normalizedSelection.length;
  let start = Math.max(0, selectionIndex - Math.floor(surroundingBudget / 2));
  let end = Math.min(normalizedContext.length, start + maxCharacters);
  start = Math.max(0, end - maxCharacters);
  return normalizedContext.slice(start, end);
}

function toPlainRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left ?? 0);
  const top = Number(rect.top ?? 0);
  const width = Number(rect.width ?? Number(rect.right ?? left) - left);
  const height = Number(rect.height ?? Number(rect.bottom ?? top) - top);
  return {
    left,
    top,
    right: Number(rect.right ?? left + width),
    bottom: Number(rect.bottom ?? top + height),
    width,
    height
  };
}

function lastUsableRect(range) {
  const rects = Array.from(range?.getClientRects?.() ?? [])
    .map(toPlainRect)
    .filter((rect) => rect && (rect.width > 0 || rect.height > 0));
  return rects.at(-1) ?? toPlainRect(range?.getBoundingClientRect?.());
}

export function createSelectionSnapshot(selection) {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const selectionText = normalizeSelectionText(selection.toString?.());
  if (!isMeaningfulSelectionText(selectionText)) return null;

  const range = selection.getRangeAt?.(0);
  if (
    !range ||
    isExcludedSelectionNode(range.startContainer) ||
    isExcludedSelectionNode(range.endContainer)
  ) {
    return null;
  }

  const startRoot = findSemanticSelectionRoot(range.startContainer);
  const endRoot = findSemanticSelectionRoot(range.endContainer);
  if (startRoot !== endRoot && (startRoot || endRoot)) {
    return null;
  }
  const anchorRect = lastUsableRect(range);
  if (!anchorRect) return null;

  const contextText = createBoundedSelectionContext(
    startRoot?.textContent ?? selectionText,
    selectionText
  );
  return Object.freeze({
    selectionText,
    contextText,
    anchorRect: Object.freeze(anchorRect)
  });
}
