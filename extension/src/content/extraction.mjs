const CANDIDATE_SELECTOR =
  "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd";
const EXCLUDED_ANCESTOR_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "input",
  "select",
  "option",
  "button",
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "[contenteditable='true']",
  "[aria-hidden='true']",
  "[hidden]",
  "[data-byok-translator]"
].join(",");

export function normalizeText(text) {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isMeaningfulText(text) {
  const normalized = normalizeText(text);
  return normalized.length >= 2 && /[\p{L}\p{N}]/u.test(normalized);
}

export function isCandidateTag(tagName) {
  return /^(P|H[1-6]|LI|BLOCKQUOTE|FIGCAPTION|TD|TH|DT|DD)$/u.test(
    String(tagName ?? "").toUpperCase()
  );
}

function getViewportPriority(block, viewportWidth, viewportHeight, index) {
  const rect = block?.element?.getBoundingClientRect?.();
  if (
    !rect ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.bottom) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.right)
  ) {
    return [3, 3, 0, 0, index];
  }

  const verticalTier =
    rect.bottom >= 0 && rect.top <= viewportHeight
      ? 0
      : rect.top > viewportHeight
        ? 1
        : 2;
  const contentTier = block.element.closest?.("article,[role='main']")
    ? 0
    : block.element.closest?.("main")
      ? 1
      : 2;
  const horizontalCenter = (rect.left + rect.right) / 2;
  const horizontalDistance = Math.abs(horizontalCenter - viewportWidth / 2);

  return [verticalTier, contentTier, horizontalDistance, rect.top, index];
}

export function prioritizeBlocksForViewport(
  blocks,
  {
    viewportWidth = globalThis.innerWidth ?? 0,
    viewportHeight = globalThis.innerHeight ?? 0
  } = {}
) {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks
    .map((block, index) => ({
      block,
      priority: getViewportPriority(
        block,
        viewportWidth,
        viewportHeight,
        index
      )
    }))
    .sort((left, right) => {
      for (let index = 0; index < left.priority.length; index += 1) {
        const difference = left.priority[index] - right.priority[index];
        if (difference !== 0) {
          return difference;
        }
      }
      return 0;
    })
    .map(({ block }) => block);
}

function isVisible(element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function hasNestedCandidate(element) {
  return Boolean(element.querySelector(CANDIDATE_SELECTOR));
}

function isEligibleElement(element) {
  return (
    isCandidateTag(element.tagName) &&
    !element.matches("[data-byok-block-id],[data-byok-translator]") &&
    !element.closest(EXCLUDED_ANCESTOR_SELECTOR) &&
    !hasNestedCandidate(element) &&
    isVisible(element) &&
    isMeaningfulText(element.textContent)
  );
}

export function extractBlocks(
  root,
  { sessionId, startIndex = 0 } = {}
) {
  const candidates = [];
  if (root.nodeType === Node.ELEMENT_NODE && root.matches(CANDIDATE_SELECTOR)) {
    candidates.push(root);
  }
  candidates.push(...root.querySelectorAll(CANDIDATE_SELECTOR));

  const blocks = [];
  let nextIndex = startIndex;
  for (const element of candidates) {
    if (!isEligibleElement(element)) {
      continue;
    }
    const id = `${sessionId}:b${nextIndex}`;
    nextIndex += 1;
    element.dataset.byokBlockId = id;
    blocks.push({
      id,
      text: normalizeText(element.textContent),
      element
    });
  }

  return { blocks, nextIndex };
}
