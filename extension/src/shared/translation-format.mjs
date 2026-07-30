export const FORMAT_SCHEMA_VERSION = 1;
export const MAX_FORMAT_MARKS = 32;
export const MAX_SERIALIZED_FORMAT_LENGTH = 24_000;
export const FORMAT_MARKER_PREFIX = "\uE000BYOKF:";
export const FORMAT_MARKER_SUFFIX = "\uE001";
export const FORMAT_RESULT_TYPE = Object.freeze({
  PLAIN: "plain",
  FORMATTED: "formatted",
  FALLBACK: "format-fallback"
});
export const SUPPORTED_FORMAT_TYPES = Object.freeze([
  "strong",
  "em",
  "code",
  "kbd",
  "mark",
  "sub",
  "sup",
  "break",
  "link"
]);

const SUPPORTED_TYPE_SET = new Set(SUPPORTED_FORMAT_TYPES);
const ELEMENT_TYPE = Object.freeze({
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  CODE: "code",
  KBD: "kbd",
  MARK: "mark",
  SUB: "sub",
  SUP: "sup",
  BR: "break",
  A: "link"
});
const MARKER_PATTERN =
  /\uE000BYOKF:(\d+):([A-Za-z0-9_-]+):(O|C)\uE001/gu;
const RESERVED_MARKER_PATTERN = /\uE000BYOKF:[^\uE001]{0,256}\uE001/gu;
const MARK_ID_PATTERN = /^m\d+$/u;

export class FormatValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormatValidationError";
    this.code = "INVALID_FORMAT_MARKERS";
  }
}

function normalizeVisibleText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function hashStructure(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function fingerprintShape(mark) {
  return [
    mark.id,
    mark.type,
    mark.start,
    mark.end,
    mark.parentId ?? null
  ];
}

export function createStructureFingerprint(marks = []) {
  const shape = Array.isArray(marks) ? marks.map(fingerprintShape) : [];
  return `fmt${FORMAT_SCHEMA_VERSION}:${hashStructure(JSON.stringify(shape))}`;
}

function copyLink(link) {
  if (!link || typeof link !== "object") {
    return undefined;
  }
  const local = {};
  for (const name of ["href", "title", "target"]) {
    if (typeof link[name] === "string" && link[name].length > 0) {
      local[name] = link[name];
    }
  }
  return Object.keys(local).length > 0 ? local : undefined;
}

function copyMark(mark) {
  const copied = {
    id: mark.id,
    type: mark.type,
    start: mark.start,
    end: mark.end,
    parentId: mark.parentId ?? null
  };
  const link = copyLink(mark.link);
  if (link) {
    copied.link = link;
  }
  return copied;
}

function assertDescriptor(format, { textLength } = {}) {
  if (
    !format ||
    format.version !== FORMAT_SCHEMA_VERSION ||
    !Array.isArray(format.marks) ||
    format.marks.length > MAX_FORMAT_MARKS
  ) {
    throw new FormatValidationError("Invalid format descriptor.");
  }
  const ids = new Set();
  for (const mark of format.marks) {
    if (
      !MARK_ID_PATTERN.test(mark?.id ?? "") ||
      ids.has(mark.id) ||
      !SUPPORTED_TYPE_SET.has(mark?.type) ||
      !Number.isSafeInteger(mark.start) ||
      !Number.isSafeInteger(mark.end) ||
      mark.start < 0 ||
      mark.end < mark.start ||
      (mark.type !== "break" && mark.end === mark.start) ||
      (mark.type === "break" && mark.end !== mark.start) ||
      (Number.isSafeInteger(textLength) && mark.end > textLength)
    ) {
      throw new FormatValidationError("Invalid format mark.");
    }
    ids.add(mark.id);
  }
  for (const mark of format.marks) {
    if (mark.parentId !== null && !ids.has(mark.parentId)) {
      throw new FormatValidationError("Unknown format parent.");
    }
  }
}

export function createFormatDescriptor(marks = []) {
  const copiedMarks = Array.isArray(marks) ? marks.map(copyMark) : [];
  const descriptor = {
    version: FORMAT_SCHEMA_VERSION,
    fingerprint: createStructureFingerprint(copiedMarks),
    marks: copiedMarks
  };
  assertDescriptor(descriptor);
  return descriptor;
}

function getLocalLink(element) {
  const link = {};
  for (const name of ["href", "title", "target"]) {
    const value = element?.getAttribute?.(name);
    if (typeof value === "string" && value.length > 0) {
      link[name] = value;
    }
  }
  return Object.keys(link).length > 0 ? link : undefined;
}

function normalizedBoundary(rawText, offset) {
  return normalizeVisibleText(rawText.slice(0, offset)).length;
}

export function extractFormatModel(element, { maxMarks = MAX_FORMAT_MARKS } = {}) {
  if (!Number.isSafeInteger(maxMarks) || maxMarks < 0) {
    throw new TypeError("maxMarks must be a non-negative integer.");
  }
  let rawText = "";
  const rawMarks = [];

  function visit(node, parentId = null) {
    if (node?.nodeType === 3) {
      rawText += String(node.nodeValue ?? node.textContent ?? "");
      return;
    }
    if (node?.nodeType !== 1) {
      return;
    }

    const type = ELEMENT_TYPE[String(node.tagName ?? "").toUpperCase()];
    if (type === "break") {
      const id = `m${rawMarks.length}`;
      rawMarks.push({
        id,
        type,
        start: rawText.length,
        end: rawText.length,
        parentId
      });
      rawText += " ";
      return;
    }

    let mark;
    if (type) {
      mark = {
        id: `m${rawMarks.length}`,
        type,
        start: rawText.length,
        end: rawText.length,
        parentId
      };
      if (type === "link") {
        mark.link = getLocalLink(node);
      }
      rawMarks.push(mark);
      parentId = mark.id;
    }
    for (const child of node.childNodes ?? []) {
      visit(child, parentId);
    }
    if (mark) {
      mark.end = rawText.length;
    }
  }

  visit(element);
  const text = normalizeVisibleText(rawText);
  if (rawMarks.length === 0 || rawMarks.length > maxMarks) {
    return {
      text,
      format: null,
      formattedText: text,
      formatMetadata: null
    };
  }

  const normalizedMarks = rawMarks
    .map((mark) => ({
      ...mark,
      start: normalizedBoundary(rawText, mark.start),
      end: normalizedBoundary(rawText, mark.end)
    }))
    .filter((mark) => mark.type === "break" || mark.end > mark.start);
  if (normalizedMarks.length === 0 || normalizedMarks.length > maxMarks) {
    return {
      text,
      format: null,
      formattedText: text,
      formatMetadata: null
    };
  }

  const retainedIds = new Set(normalizedMarks.map(({ id }) => id));
  for (const mark of normalizedMarks) {
    while (mark.parentId && !retainedIds.has(mark.parentId)) {
      mark.parentId =
        rawMarks.find(({ id }) => id === mark.parentId)?.parentId ?? null;
    }
  }
  const format = createFormatDescriptor(normalizedMarks);
  const formattedText = serializeFormattedText(text, format);
  if (formattedText.length > MAX_SERIALIZED_FORMAT_LENGTH) {
    return {
      text,
      format: null,
      formattedText: text,
      formatMetadata: null
    };
  }
  return {
    text,
    format,
    formattedText,
    formatMetadata: toRemoteFormatMetadata(format)
  };
}

function marker(id, side) {
  return (
    `${FORMAT_MARKER_PREFIX}${FORMAT_SCHEMA_VERSION}:${id}:${side}` +
    FORMAT_MARKER_SUFFIX
  );
}

function markDepth(mark, byId) {
  let depth = 0;
  let parentId = mark.parentId;
  const seen = new Set();
  while (parentId) {
    if (seen.has(parentId)) {
      throw new FormatValidationError("Cyclic format nesting.");
    }
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) {
      throw new FormatValidationError("Unknown format parent.");
    }
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

export function serializeFormattedText(text, format) {
  const source = String(text ?? "");
  if (!format || format.marks?.length === 0) {
    return source;
  }
  assertDescriptor(format, { textLength: source.length });
  const byId = new Map(format.marks.map((mark) => [mark.id, mark]));
  const events = [];
  for (const [order, mark] of format.marks.entries()) {
    const depth = markDepth(mark, byId);
    events.push({ offset: mark.start, side: "O", mark, depth, order });
    events.push({ offset: mark.end, side: "C", mark, depth, order });
  }
  events.sort((left, right) => {
    if (left.offset !== right.offset) {
      return left.offset - right.offset;
    }
    if (left.mark.id === right.mark.id) {
      return left.side === "O" ? -1 : 1;
    }
    if (left.side !== right.side) {
      return left.side === "C" ? -1 : 1;
    }
    if (left.side === "O") {
      return left.depth - right.depth || left.order - right.order;
    }
    return right.depth - left.depth || right.order - left.order;
  });

  let serialized = "";
  let cursor = 0;
  for (const event of events) {
    serialized += source.slice(cursor, event.offset);
    serialized += marker(event.mark.id, event.side);
    cursor = event.offset;
  }
  serialized += source.slice(cursor);
  if (serialized.length > MAX_SERIALIZED_FORMAT_LENGTH) {
    throw new FormatValidationError("Serialized format exceeds the limit.");
  }
  return serialized;
}

export function toRemoteFormatMetadata(format) {
  if (!format || format.marks?.length === 0) {
    return null;
  }
  assertDescriptor(format);
  return {
    version: FORMAT_SCHEMA_VERSION,
    fingerprint: format.fingerprint,
    markIds: format.marks.map(({ id }) => id)
  };
}

function expectedIdsFrom(formatOrMetadata) {
  if (
    !formatOrMetadata ||
    formatOrMetadata.version !== FORMAT_SCHEMA_VERSION
  ) {
    throw new FormatValidationError("Unknown format schema version.");
  }
  const ids = Array.isArray(formatOrMetadata.marks)
    ? formatOrMetadata.marks.map(({ id }) => id)
    : formatOrMetadata.markIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_FORMAT_MARKS ||
    ids.some((id) => !MARK_ID_PATTERN.test(id))
  ) {
    throw new FormatValidationError("Invalid expected mark IDs.");
  }
  if (new Set(ids).size !== ids.length) {
    throw new FormatValidationError("Duplicate expected mark IDs.");
  }
  return ids;
}

function parseMarkers(serialized, formatOrMetadata) {
  const value = String(serialized ?? "");
  if (value.length > MAX_SERIALIZED_FORMAT_LENGTH) {
    throw new FormatValidationError("Formatted response exceeds the limit.");
  }
  const expectedIds = expectedIdsFrom(formatOrMetadata);
  const expected = new Set(expectedIds);
  const seenOpen = new Set();
  const seenClose = new Set();
  const stack = [];
  const ranges = new Map();
  let text = "";
  let cursor = 0;

  MARKER_PATTERN.lastIndex = 0;
  for (let match = MARKER_PATTERN.exec(value); match; match = MARKER_PATTERN.exec(value)) {
    text += value.slice(cursor, match.index);
    const version = Number(match[1]);
    const id = match[2];
    const side = match[3];
    if (version !== FORMAT_SCHEMA_VERSION || !expected.has(id)) {
      throw new FormatValidationError("Unknown format marker.");
    }
    if (side === "O") {
      if (seenOpen.has(id)) {
        throw new FormatValidationError("Duplicate opening marker.");
      }
      seenOpen.add(id);
      stack.push(id);
      ranges.set(id, { start: text.length, parentId: stack.at(-2) ?? null });
    } else {
      if (seenClose.has(id) || stack.at(-1) !== id) {
        throw new FormatValidationError("Invalid marker nesting.");
      }
      seenClose.add(id);
      stack.pop();
      ranges.get(id).end = text.length;
    }
    cursor = match.index + match[0].length;
  }
  text += value.slice(cursor);
  if (value.slice(cursor).includes(FORMAT_MARKER_PREFIX)) {
    throw new FormatValidationError("Malformed reserved marker.");
  }
  if (
    stack.length > 0 ||
    expectedIds.some((id) => !seenOpen.has(id) || !seenClose.has(id))
  ) {
    throw new FormatValidationError("Missing format marker.");
  }
  return { text, ranges, expectedIds };
}

export function validateFormattedTranslation(serialized, remoteMetadata) {
  const { text } = parseMarkers(serialized, remoteMetadata);
  return { text, resultType: FORMAT_RESULT_TYPE.FORMATTED };
}

export function parseFormattedTranslation(serialized, format) {
  assertDescriptor(format);
  const { text, ranges } = parseMarkers(serialized, format);
  const sourceById = new Map(format.marks.map((mark) => [mark.id, mark]));
  const marks = [...ranges.entries()]
    .map(([id, range]) => {
      const source = sourceById.get(id);
      if ((source.parentId ?? null) !== range.parentId) {
        throw new FormatValidationError("Format nesting changed.");
      }
      return {
        ...copyMark(source),
        start: range.start,
        end: range.end
      };
    })
    .sort((left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      Number(left.id.slice(1)) - Number(right.id.slice(1))
    );
  return { text, marks, resultType: FORMAT_RESULT_TYPE.FORMATTED };
}

export function stripReservedFormatMarkers(value) {
  return String(value ?? "")
    .replace(RESERVED_MARKER_PATTERN, "")
    .replaceAll(FORMAT_MARKER_PREFIX, "")
    .replaceAll(FORMAT_MARKER_SUFFIX, "");
}

export function parseFormattedTranslationOrFallback(serialized, format) {
  try {
    return parseFormattedTranslation(serialized, format);
  } catch (error) {
    return {
      text: stripReservedFormatMarkers(serialized),
      marks: [],
      resultType: FORMAT_RESULT_TYPE.FALLBACK,
      error:
        error instanceof FormatValidationError
          ? error
          : new FormatValidationError("Invalid formatted translation.")
    };
  }
}

export function validateFormattedTranslationOrFallback(
  serialized,
  remoteMetadata
) {
  try {
    return validateFormattedTranslation(serialized, remoteMetadata);
  } catch (error) {
    return {
      text: stripReservedFormatMarkers(serialized),
      resultType: FORMAT_RESULT_TYPE.FALLBACK,
      error:
        error instanceof FormatValidationError
          ? error
          : new FormatValidationError("Invalid formatted translation.")
    };
  }
}
