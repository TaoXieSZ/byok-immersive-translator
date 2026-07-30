import { LONG_ARTICLE_BLOCKS } from "./long-article-122.mjs";

function freezeMark(mark) {
  return Object.freeze({ ...mark });
}

function createRichBlock(id, parts) {
  let text = "";
  let nextMarkId = 1;
  const marks = [];

  function append(part, parentId = null) {
    if (typeof part === "string") {
      text += part;
      return;
    }
    const mark = {
      id: `m${nextMarkId}`,
      type: part.type,
      start: text.length,
      parentId,
      ...(part.href
        ? {
            link: {
              href: part.href,
              ...(part.target ? { target: part.target } : {})
            }
          }
        : {})
    };
    nextMarkId += 1;
    marks.push(mark);
    if (part.type === "break") {
      mark.end = mark.start;
      text += "\n";
    } else {
      for (const child of part.children ?? []) {
        append(child, mark.id);
      }
      mark.end = text.length;
    }
  }

  for (const part of parts) {
    append(part);
  }

  return Object.freeze({
    id,
    text,
    viewport: true,
    format: Object.freeze({
      marks: Object.freeze(marks.map(freezeMark))
    })
  });
}

export const RICH_TEXT_VIEWPORT_BLOCKS = Object.freeze([
  createRichBlock("rich:memory", [
    { type: "strong", children: ["5. Memory"] },
    " stores durable context in ",
    { type: "code", children: ["memdir/"] },
    ", ",
    { type: "code", children: ["CLAUDE.md"] },
    ", and ",
    { type: "code", children: ["~/.claude/MEMORY.md"] },
    "."
  ]),
  createRichBlock("rich:nested", [
    "Run ",
    {
      type: "strong",
      children: [
        "the ",
        { type: "code", children: ["verify"] },
        " command"
      ]
    },
    " before publishing."
  ]),
  createRichBlock("rich:emphasis", [
    "Keep ",
    { type: "em", children: ["user intent"] },
    " and ",
    { type: "mark", children: ["safe defaults"] },
    " visible."
  ]),
  createRichBlock("rich:keyboard", [
    "Press ",
    { type: "kbd", children: ["Alt"] },
    " + ",
    { type: "kbd", children: ["A"] },
    " to translate."
  ]),
  createRichBlock("rich:links", [
    "Read the ",
    {
      type: "link",
      href: "https://example.com/reference",
      target: "_blank",
      children: ["reference"]
    },
    " and ignore the ",
    {
      type: "link",
      href: "javascript:alert(1)",
      children: ["unsafe mirror"]
    },
    "."
  ]),
  createRichBlock("rich:scripts", [
    "Water is H",
    { type: "sub", children: ["2"] },
    "O and the result is x",
    { type: "sup", children: ["2"] },
    "."
  ]),
  createRichBlock("rich:break", [
    "First visible line",
    { type: "break" },
    "Second visible line"
  ]),
  createRichBlock("rich:plain-mix", [
    "A normal sentence with ",
    { type: "code", children: ["inline()"] },
    " and unformatted context."
  ])
]);

export const RICH_TEXT_PERFORMANCE_BLOCKS = Object.freeze(
  LONG_ARTICLE_BLOCKS.map((block, index) =>
    index < RICH_TEXT_VIEWPORT_BLOCKS.length
      ? RICH_TEXT_VIEWPORT_BLOCKS[index]
      : block
  )
);
