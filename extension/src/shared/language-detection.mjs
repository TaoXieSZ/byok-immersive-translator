const MIN_CONFIDENT_LETTERS = 12;
const MIN_TARGET_RATIO = 0.85;
const MAX_OTHER_SCRIPT_RATIO = 0.1;

const SCRIPT_PATTERNS = Object.freeze({
  han: /\p{Script=Han}/u,
  hiragana: /\p{Script=Hiragana}/u,
  katakana: /\p{Script=Katakana}/u,
  hangul: /\p{Script=Hangul}/u,
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  devanagari: /\p{Script=Devanagari}/u,
  hebrew: /\p{Script=Hebrew}/u,
  thai: /\p{Script=Thai}/u
});

const TARGET_SCRIPT_ALIASES = Object.freeze([
  { pattern: /^(?:zh|cmn|yue)(?:[-_]|$)|中文|汉语|漢語|简体|簡體|繁体|繁體/iu, scripts: ["han"], kind: "chinese" },
  { pattern: /^(?:ja)(?:[-_]|$)|日本語|日语|日文/iu, scripts: ["hiragana", "katakana", "han"], kind: "japanese" },
  { pattern: /^(?:ko)(?:[-_]|$)|한국어|韩语|韓語|朝鲜语/iu, scripts: ["hangul"], kind: "korean" },
  { pattern: /^(?:ru|uk|bg|sr)(?:[-_]|$)|俄语|俄文/iu, scripts: ["cyrillic"], kind: "cyrillic" },
  { pattern: /^(?:ar|fa|ur)(?:[-_]|$)|阿拉伯语|波斯语/iu, scripts: ["arabic"], kind: "arabic" },
  { pattern: /^(?:hi|mr|ne)(?:[-_]|$)|印地语/iu, scripts: ["devanagari"], kind: "devanagari" },
  { pattern: /^(?:he|yi)(?:[-_]|$)|希伯来语/iu, scripts: ["hebrew"], kind: "hebrew" },
  { pattern: /^(?:th)(?:[-_]|$)|泰语/iu, scripts: ["thai"], kind: "thai" },
  { pattern: /^(?:en|fr|de|es|it|pt|nl|pl|tr|vi)(?:[-_]|$)|英语|英文|法语|德语|西班牙语|葡萄牙语/iu, scripts: ["latin"], kind: "latin" }
]);

export function countUnicodeScripts(text) {
  const counts = Object.fromEntries(
    Object.keys(SCRIPT_PATTERNS).map((script) => [script, 0])
  );
  let letters = 0;
  for (const character of String(text ?? "").normalize("NFKC")) {
    if (!/\p{L}/u.test(character)) {
      continue;
    }
    letters += 1;
    for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS)) {
      if (pattern.test(character)) {
        counts[script] += 1;
        break;
      }
    }
  }
  return { letters, counts };
}

export function resolveTargetScripts(targetLanguage) {
  const normalized = String(targetLanguage ?? "").trim();
  return (
    TARGET_SCRIPT_ALIASES.find(({ pattern }) => pattern.test(normalized)) ??
    null
  );
}

export function analyzeTargetLanguage(text, targetLanguage) {
  const target = resolveTargetScripts(targetLanguage);
  const { letters, counts } = countUnicodeScripts(text);
  if (!target || letters < MIN_CONFIDENT_LETTERS) {
    return {
      confident: false,
      targetRatio: 0,
      otherScriptRatio: 0,
      letters,
      targetKind: target?.kind ?? null
    };
  }

  const targetLetters = target.scripts.reduce(
    (total, script) => total + counts[script],
    0
  );
  const knownScriptLetters = Object.values(counts).reduce(
    (total, count) => total + count,
    0
  );
  const otherScriptLetters = knownScriptLetters - targetLetters;
  const targetRatio = targetLetters / letters;
  const otherScriptRatio = otherScriptLetters / letters;

  let scriptEvidence = targetLetters >= MIN_CONFIDENT_LETTERS;
  if (target.kind === "japanese") {
    scriptEvidence = counts.hiragana + counts.katakana >= 2;
  } else if (target.kind === "chinese") {
    scriptEvidence = counts.hiragana + counts.katakana === 0;
  }

  return {
    confident:
      scriptEvidence &&
      targetRatio >= MIN_TARGET_RATIO &&
      otherScriptRatio <= MAX_OTHER_SCRIPT_RATIO,
    targetRatio,
    otherScriptRatio,
    letters,
    targetKind: target.kind
  };
}

export function shouldSkipTargetLanguage(text, targetLanguage) {
  return analyzeTargetLanguage(text, targetLanguage).confident;
}

export const isHighConfidenceTargetLanguage = shouldSkipTargetLanguage;
