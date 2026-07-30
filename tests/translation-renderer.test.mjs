import test from "node:test";
import assert from "node:assert/strict";
import {
  createFormatStreamFilter,
  nodesFromParsedTranslation,
  renderTranslationSafely,
  replaceWithFormattedTranslation,
  replaceWithPlainTranslation,
  resolveSafeLink
} from "../extension/src/content/translation-renderer.mjs";

class FakeNode {
  constructor(type, value = "") {
    this.type = type;
    this.value = value;
    this.children = [];
    this.attributes = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes.flatMap((node) =>
      node?.type === "fragment" ? node.children : [node]
    );
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function createFakeDocument() {
  const calls = [];
  return {
    baseURI: "https://example.test/docs/page",
    calls,
    createElement(tagName) {
      calls.push(["element", tagName]);
      return new FakeNode(tagName);
    },
    createTextNode(value) {
      calls.push(["text", value]);
      return new FakeNode("text", value);
    },
    createDocumentFragment() {
      calls.push(["fragment"]);
      return new FakeNode("fragment");
    }
  };
}

function textContent(node) {
  return node.type === "text"
    ? node.value
    : node.children.map(textContent).join("");
}

test("builds nested semantics only through the DOM whitelist", () => {
  const documentLike = createFakeDocument();
  const container = new FakeNode("div");
  container.ownerDocument = documentLike;
  replaceWithFormattedTranslation(
    container,
    [
      {
        type: "mark",
        markId: "m0",
        children: [
          { type: "text", value: "5. " },
          {
            type: "mark",
            markId: "m1",
            children: [{ type: "text", value: "Memory" }]
          }
        ]
      },
      { type: "text", value: " uses " },
      {
        type: "mark",
        markId: "m2",
        children: [{ type: "text", value: "memdir/" }]
      }
    ],
    {
      marks: [
        { id: "m0", type: "strong" },
        { id: "m1", type: "em" },
        { id: "m2", type: "code" }
      ]
    }
  );

  assert.deepEqual(
    documentLike.calls.filter(([kind]) => kind === "element"),
    [["element", "strong"], ["element", "em"], ["element", "code"]]
  );
  assert.equal(textContent(container), "5. Memory uses memdir/");
});

test("restores only safe local links and hardens new windows", () => {
  const documentLike = createFakeDocument();
  const container = new FakeNode("div");
  container.ownerDocument = documentLike;
  replaceWithFormattedTranslation(
    container,
    [
      {
        type: "mark",
        markId: "safe",
        children: [{ type: "text", value: "docs" }]
      },
      { type: "text", value: " / " },
      {
        type: "mark",
        markId: "unsafe",
        children: [{ type: "text", value: "run" }]
      }
    ],
    {
      marks: [
        {
          id: "safe",
          type: "link",
          href: "/guide",
          target: "_blank"
        },
        { id: "unsafe", type: "link", href: "javascript:alert(1)" }
      ]
    }
  );

  assert.equal(container.children[0].type, "a");
  assert.equal(container.children[0].attributes.href, "https://example.test/guide");
  assert.equal(container.children[0].attributes.rel, "noopener noreferrer");
  assert.equal(container.children.some((node) => node.type === "script"), false);
  assert.equal(textContent(container), "docs / run");
});

test("allows http, https, mailto, and fragments only", () => {
  const base = "https://example.test/page";
  assert.equal(resolveSafeLink("#part", base), "#part");
  assert.equal(resolveSafeLink("https://openai.com/docs", base), "https://openai.com/docs");
  assert.equal(resolveSafeLink("mailto:test@example.com", base), "mailto:test@example.com");
  assert.equal(resolveSafeLink("javascript:alert(1)", base), null);
  assert.equal(resolveSafeLink("data:text/html,boom", base), null);
});

test("keeps provider HTML as text and falls back atomically", () => {
  const documentLike = createFakeDocument();
  const container = new FakeNode("div");
  container.ownerDocument = documentLike;
  let fallbackCount = 0;

  const result = renderTranslationSafely(
    container,
    "⟦bad⟧<script>alert(1)</script>",
    { marks: [{ id: "m0", type: "strong" }] },
    {
      parse: () => {
        throw new Error("invalid marks");
      },
      stripReservedMarkers: (value) => value.replace("⟦bad⟧", ""),
      onFallback: () => {
        fallbackCount += 1;
      }
    }
  );

  assert.deepEqual(result, { formatted: false, fallback: true });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].type, "text");
  assert.equal(container.children[0].value, "<script>alert(1)</script>");
  assert.equal(fallbackCount, 1);
});

test("formatted completion atomically replaces streaming text without duplicates", () => {
  const documentLike = createFakeDocument();
  const container = new FakeNode("div");
  container.ownerDocument = documentLike;
  replaceWithPlainTranslation(container, "partial");
  const descriptor = {
    marks: [{ id: "m0", type: "code" }]
  };
  const parse = () => ({
    text: "use memdir/",
    marks: [{ id: "m0", type: "code", start: 4, end: 11 }]
  });

  renderTranslationSafely(container, "serialized", descriptor, { parse });
  renderTranslationSafely(container, "serialized", descriptor, { parse });

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].type, "text");
  assert.equal(container.children[1].type, "code");
  assert.equal(textContent(container), "use memdir/");
});

test("plain translations remain a single text node", () => {
  const documentLike = createFakeDocument();
  const container = new FakeNode("div");
  container.ownerDocument = documentLike;

  replaceWithPlainTranslation(container, "<strong>not markup</strong>");

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].type, "text");
  assert.equal(container.children[0].value, "<strong>not markup</strong>");
});

test("converts validated translated offsets into nested render nodes", () => {
  assert.deepEqual(
    nodesFromParsedTranslation({
      text: "5. Memory uses memdir/",
      marks: [
        { id: "bold", start: 0, end: 9 },
        { id: "code", start: 15, end: 22 }
      ]
    }),
    [
      {
        type: "mark",
        markId: "bold",
        children: [{ type: "text", value: "5. Memory" }]
      },
      { type: "text", value: " uses " },
      {
        type: "mark",
        markId: "code",
        children: [{ type: "text", value: "memdir/" }]
      }
    ]
  );
});

test("renders explicit zero-width breaks without swallowing following text", () => {
  const nodes = nodesFromParsedTranslation({
    text: "line one line two",
    marks: [{ id: "br0", type: "break", start: 8, end: 8 }]
  });
  assert.deepEqual(nodes, [
    { type: "text", value: "line one" },
    { type: "mark", markId: "br0", children: [] },
    { type: "text", value: " line two" }
  ]);
});

test("filters reserved markers split across streaming chunks", () => {
  const prefix = "\uE000BYOKF:";
  const suffix = "\uE001";
  const filter = createFormatStreamFilter({
    markerPrefix: prefix,
    markerSuffix: suffix
  });

  const visible = [
    filter.push("翻译 "),
    filter.push("\uE000BY"),
    filter.push("OKF:m0:o\uE001粗"),
    filter.push("体\uE000BYOKF:m0:c"),
    filter.push("\uE001 完成")
  ].join("");

  assert.equal(visible, "翻译 粗体 完成");
  assert.equal(filter.pendingLength, 0);
});
