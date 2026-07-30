import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_RESULT_TYPE,
  FORMAT_SCHEMA_VERSION,
  MAX_FORMAT_MARKS,
  FormatValidationError,
  createFormatDescriptor,
  createStructureFingerprint,
  extractFormatModel,
  parseFormattedTranslation,
  parseFormattedTranslationOrFallback,
  serializeFormattedText,
  stripReservedFormatMarkers,
  toRemoteFormatMetadata,
  validateFormattedTranslation
} from "../extension/src/shared/translation-format.mjs";
import {
  createRichTextArticleFixture,
  element,
  text
} from "./fixtures/rich-text-article.mjs";

test("extracts nested supported semantics while flattening unsupported containers", () => {
  const { paragraph } = createRichTextArticleFixture();
  const result = extractFormatModel(paragraph);

  assert.match(result.text, /memdir\/, CLAUDE\.md/);
  assert.match(result.text, /Visible custom text/);
  assert.equal(result.format.version, FORMAT_SCHEMA_VERSION);
  assert.deepEqual(
    result.format.marks.map(({ type }) => type),
    [
      "code", "code", "strong", "code", "em", "link", "link",
      "sub", "sup", "break", "mark", "kbd"
    ]
  );
  const strong = result.format.marks.find(({ type }) => type === "strong");
  const nestedCode = result.format.marks.find(
    ({ type, start, end }) =>
      type === "code" && start > strong.start && end < strong.end
  );
  assert.ok(nestedCode);
  assert.equal("class" in strong, false);
  assert.equal("style" in strong, false);
});

test("keeps link targets local and excludes them from fingerprints and remote metadata", () => {
  const { paragraph } = createRichTextArticleFixture();
  const { format } = extractFormatModel(paragraph);
  const links = format.marks.filter(({ type }) => type === "link");
  assert.deepEqual(links[0].link, {
    href: "https://example.com/docs?q=private",
    title: "Documentation",
    target: "_blank"
  });
  assert.equal(links[1].link.href, "javascript:alert(1)");

  const remote = toRemoteFormatMetadata(format);
  assert.deepEqual(Object.keys(remote), ["version", "fingerprint", "markIds"]);
  assert.equal(JSON.stringify(remote).includes("example.com"), false);
  assert.equal(format.fingerprint.includes("example.com"), false);
});

test("structure fingerprints exclude text and URL but distinguish formatting", () => {
  const plain = createFormatDescriptor([]);
  const strongA = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 5 }
  ]);
  const strongB = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 6 }
  ]);
  const linked = createFormatDescriptor([
    {
      id: "m0",
      type: "link",
      start: 0,
      end: 5,
      link: { href: "https://secret.test/path" }
    }
  ]);

  assert.notEqual(plain.fingerprint, strongA.fingerprint);
  assert.notEqual(strongA.fingerprint, strongB.fingerprint);
  assert.equal(
    linked.fingerprint,
    createStructureFingerprint([
      {
        id: "m0",
        type: "link",
        start: 0,
        end: 5,
        link: { href: "https://other.test/" }
      }
    ])
  );
  assert.equal(linked.fingerprint.includes("secret"), false);
});

test("falls back to plain format when the mark limit is exceeded", () => {
  const children = [];
  for (let index = 0; index < MAX_FORMAT_MARKS + 1; index += 1) {
    children.push(element("strong", {}, [text(`word${index} `)]));
  }
  const result = extractFormatModel(element("p", {}, children));

  assert.equal(result.format, null);
  assert.equal(result.formattedText, result.text);
});

test("serializes paired opaque markers and keeps plain blocks unchanged", () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 6 },
    { id: "m1", type: "code", start: 7, end: 11 }
  ]);
  const serialized = serializeFormattedText("Memory path", descriptor);

  assert.match(serialized, /\uE000BYOKF:1:m0:O\uE001/);
  assert.match(serialized, /\uE000BYOKF:1:m1:C\uE001/);
  assert.equal(serializeFormattedText("plain", null), "plain");
});

test("strictly parses moved complete marks and restores translated offsets", () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 6 },
    {
      id: "m1",
      type: "link",
      start: 7,
      end: 11,
      link: { href: "https://example.com/" }
    }
  ]);
  const source = serializeFormattedText("Memory docs", descriptor);
  const [openStrong, closeStrong, openLink, closeLink] =
    source.match(/\uE000BYOKF:[^\uE001]+\uE001/gu);
  const translated =
    `${openLink}文档${closeLink}中的${openStrong}记忆${closeStrong}`;
  const result = parseFormattedTranslation(translated, descriptor);

  assert.equal(result.text, "文档中的记忆");
  assert.equal(result.resultType, FORMAT_RESULT_TYPE.FORMATTED);
  assert.deepEqual(
    result.marks.map(({ id, start, end }) => ({ id, start, end })),
    [
      { id: "m1", start: 0, end: 2 },
      { id: "m0", start: 4, end: 6 }
    ]
  );
  assert.equal(result.marks[0].link.href, "https://example.com/");
});

test("rejects missing, duplicate, unknown, rewritten, and crossed markers", () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 4 },
    { id: "m1", type: "code", start: 4, end: 8 }
  ]);
  const open = (id) => `\uE000BYOKF:1:${id}:O\uE001`;
  const close = (id) => `\uE000BYOKF:1:${id}:C\uE001`;
  const invalid = [
    `${open("m0")}text`,
    `${open("m0")}${close("m0")}${open("m0")}${close("m0")}`,
    `${open("unknown")}x${close("unknown")}`,
    `\uE000BYOKF:2:m0:O\uE001x\uE000BYOKF:2:m0:C\uE001`,
    `${open("m0")}${open("m1")}x${close("m0")}${close("m1")}`
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseFormattedTranslation(value, descriptor),
      FormatValidationError
    );
  }
});

test("validates with URL-free remote metadata and degrades malformed output safely", () => {
  const descriptor = createFormatDescriptor([
    { id: "m0", type: "strong", start: 0, end: 4 }
  ]);
  const serialized = serializeFormattedText("test", descriptor);
  assert.deepEqual(
    validateFormattedTranslation(serialized, toRemoteFormatMetadata(descriptor)),
    { text: "test", resultType: FORMAT_RESULT_TYPE.FORMATTED }
  );

  const malformed =
    "\uE000BYOKF:1:m0:O\uE001译文<script>alert(1)</script>";
  const fallback = parseFormattedTranslationOrFallback(malformed, descriptor);
  assert.equal(fallback.resultType, FORMAT_RESULT_TYPE.FALLBACK);
  assert.equal(fallback.text, "译文<script>alert(1)</script>");
  assert.deepEqual(fallback.marks, []);
  assert.equal(stripReservedFormatMarkers(malformed), fallback.text);
});
