const MAX_TERM_LENGTH = 60;
const DEFAULT_MAX_TERMS = 6;
const COMMON_TITLE_WORDS = new Set([
  "A",
  "An",
  "And",
  "At",
  "But",
  "For",
  "From",
  "Here",
  "How",
  "If",
  "In",
  "It",
  "Once",
  "Or",
  "That",
  "The",
  "These",
  "This",
  "Three",
  "To",
  "What",
  "When",
  "With",
  "Without"
]);

function tokenizeLatinTerms(text) {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9+#.-]*/gu)].map((match) => ({
    value: match[0].replace(/[.-]+$/u, ""),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function isAcronym(value) {
  return (
    value.length >= 2 &&
    value.length <= 16 &&
    /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/u.test(value)
  );
}

function isMixedCaseName(value) {
  return (
    value.length >= 3 &&
    value.length <= MAX_TERM_LENGTH &&
    /^[A-Z][A-Za-z0-9+#.-]+$/u.test(value) &&
    /[a-z]/u.test(value) &&
    /[A-Z0-9]/u.test(value.slice(1))
  );
}

function isTitleWord(value) {
  return /^[A-Z][a-z]{1,30}$/u.test(value);
}

function addCandidate(candidates, value, start, end, priority) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < 2 || normalized.length > MAX_TERM_LENGTH) return;
  candidates.push({ value: normalized, start, end, priority });
}

export function detectTechnicalTerms(
  text,
  { maxTerms = DEFAULT_MAX_TERMS } = {}
) {
  if (typeof text !== "string" || text.trim() === "") return [];
  if (!Number.isInteger(maxTerms) || maxTerms < 1 || maxTerms > 12) {
    throw new TypeError("maxTerms must be an integer between 1 and 12.");
  }

  const tokens = tokenizeLatinTerms(text);
  const candidates = [];
  const multiWordRanges = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const sequence = [];
    for (
      let cursor = index;
      cursor < tokens.length && sequence.length < 3;
      cursor += 1
    ) {
      const token = tokens[cursor];
      const previous = sequence.at(-1);
      if (
        !isTitleWord(token.value) ||
        (previous && !/^\s+$/u.test(text.slice(previous.end, token.start)))
      ) {
        break;
      }
      sequence.push(token);
    }
    const meaningful = sequence.filter(
      (token, sequenceIndex) =>
        sequenceIndex > 0 || !COMMON_TITLE_WORDS.has(token.value)
    );
    if (meaningful.length >= 2) {
      const first = meaningful[0];
      const last = meaningful.at(-1);
      addCandidate(
        candidates,
        text.slice(first.start, last.end),
        first.start,
        last.end,
        2
      );
      multiWordRanges.push([first.start, last.end]);
    }
  }

  for (const token of tokens) {
    if (isAcronym(token.value)) {
      addCandidate(candidates, token.value, token.start, token.end, 0);
      continue;
    }
    if (isMixedCaseName(token.value)) {
      addCandidate(candidates, token.value, token.start, token.end, 1);
      continue;
    }
    const insideMultiWordName = multiWordRanges.some(
      ([start, end]) => token.start >= start && token.end <= end
    );
    const previousText = text.slice(0, token.start).trimEnd();
    const startsSentence = previousText === "" || /[.!?]\s*$/u.test(previousText);
    if (
      isTitleWord(token.value) &&
      !insideMultiWordName &&
      !startsSentence &&
      !COMMON_TITLE_WORDS.has(token.value)
    ) {
      addCandidate(candidates, token.value, token.start, token.end, 3);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates.sort(
    (left, right) => left.start - right.start || left.priority - right.priority
  )) {
    const key = candidate.value.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return unique.slice(0, maxTerms).map(({ value }) => value);
}
