import { extractFormatModel } from "../shared/translation-format.mjs";

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
const MAIN_CONTENT_SELECTOR = "article,main,[role='main']";

export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function groupCanonicalBlocks(blocks) {
  const canonicalByKey = new Map();
  const canonicalBlocks = [];
  const groups = new Map();

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const canonicalText = normalizeText(block?.text);
    if (!canonicalText) {
      continue;
    }
    const formatFingerprint =
      block?.formatFingerprint ??
      block?.format?.fingerprint ??
      "plain";
    const canonicalKey = `${canonicalText}\u0000${formatFingerprint}`;
    let canonical = canonicalByKey.get(canonicalKey);
    if (!canonical) {
      canonical = block;
      canonicalByKey.set(canonicalKey, canonical);
      canonicalBlocks.push(canonical);
      groups.set(canonical.id, [block]);
    } else {
      groups.get(canonical.id).push(block);
    }
  }

  return { canonicalBlocks, groups };
}

export const createCanonicalBlockGroups = groupCanonicalBlocks;

export function extractTextAndFormat(element) {
  return extractFormatModel(element);
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

export function partitionBlocksByViewport(
  blocks,
  {
    viewportWidth = globalThis.innerWidth ?? 0,
    viewportHeight = globalThis.innerHeight ?? 0
  } = {}
) {
  const visible = [];
  const remaining = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const rect = block?.element?.getBoundingClientRect?.();
    if (
      rect &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.bottom) &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.right) &&
      rect.bottom >= 0 &&
      rect.top <= viewportHeight &&
      rect.right >= 0 &&
      rect.left <= viewportWidth
    ) {
      visible.push(block);
    } else {
      remaining.push(block);
    }
  }
  return { visible, remaining };
}

export function reorderQueuedBlocks(
  blocks,
  options = {}
) {
  if (!Array.isArray(blocks)) {
    return [];
  }
  const queued = prioritizeBlocksForViewport(
    blocks.filter((block) => block?.status === "queued"),
    options
  );
  let queuedIndex = 0;
  return blocks.map((block) =>
    block?.status === "queued" ? queued[queuedIndex++] : block
  );
}

export function createProgressiveChunks(items, { chunkSize = 40 } = {}) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError("chunkSize must be a positive integer.");
  }
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function* scanProgressiveChunks(
  items,
  {
    chunkSize = 40,
    signal,
    yieldControl = () => Promise.resolve()
  } = {}
) {
  const chunks = createProgressiveChunks(items, { chunkSize });
  for (let index = 0; index < chunks.length; index += 1) {
    if (signal?.aborted) {
      return;
    }
    yield chunks[index];
    if (index < chunks.length - 1) {
      await yieldControl();
    }
  }
}

export function selectExtractionRoots(root, { scope = "main" } = {}) {
  if (!root?.querySelectorAll) {
    return { roots: [], scope, fallback: scope === "main" };
  }
  if (scope === "all") {
    return { roots: [root], scope, fallback: false };
  }
  if (scope !== "main") {
    throw new TypeError("scope must be either 'main' or 'all'.");
  }

  const explicitRoots = [];
  if (root.matches?.(MAIN_CONTENT_SELECTOR)) {
    explicitRoots.push(root);
  }
  explicitRoots.push(...root.querySelectorAll(MAIN_CONTENT_SELECTOR));
  const roots = explicitRoots.filter(
    (candidate, index) =>
      !explicitRoots.some(
        (other, otherIndex) =>
          otherIndex !== index && other?.contains?.(candidate)
      )
  );
  return roots.length > 0
    ? { roots, scope, fallback: false }
    : { roots: [root], scope, fallback: true };
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
  { sessionId, startIndex = 0, scope = "all" } = {}
) {
  const candidates = [];
  const { roots } = selectExtractionRoots(root, { scope });
  for (const extractionRoot of roots) {
    if (
      extractionRoot.nodeType === Node.ELEMENT_NODE &&
      extractionRoot.matches(CANDIDATE_SELECTOR)
    ) {
      candidates.push(extractionRoot);
    }
    candidates.push(
      ...extractionRoot.querySelectorAll(CANDIDATE_SELECTOR)
    );
  }

  const blocks = [];
  let nextIndex = startIndex;
  for (const element of new Set(candidates)) {
    if (!isEligibleElement(element)) {
      continue;
    }
    const id = `${sessionId}:b${nextIndex}`;
    nextIndex += 1;
    element.dataset.byokBlockId = id;
    const extracted = extractTextAndFormat(element);
    blocks.push({
      id,
      ...extracted,
      formatFingerprint: extracted.format?.fingerprint ?? "plain",
      element
    });
  }

  return { blocks, nextIndex };
}
