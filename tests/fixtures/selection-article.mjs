function element(tagName, textContent = "", attributes = {}, parentElement = null) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    textContent,
    attributes,
    parentElement,
    id: attributes.id ?? "",
    isContentEditable: attributes.contenteditable === "true",
    hasAttribute(name) {
      return Object.hasOwn(attributes, name);
    },
    getAttribute(name) {
      return attributes[name] ?? null;
    }
  };
}

function textNode(value, parentElement) {
  return { nodeType: 3, nodeValue: value, textContent: value, parentElement };
}

function selection(text, startContainer, endContainer = startContainer, rects = []) {
  const range = {
    startContainer,
    endContainer,
    getClientRects: () => rects,
    getBoundingClientRect: () => rects.at(-1) ?? null
  };
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => range
  };
}

const article = element("article");
const paragraph = element(
  "p",
  "The agent keeps persistent context across sessions.",
  {},
  article
);
const paragraphText = textNode(paragraph.textContent, paragraph);
const listItem = element("li", "A deterministic tool result", {}, article);
const listText = textNode(listItem.textContent, listItem);
const heading = element("h2", "Memory and context", {}, article);
const headingText = textNode(heading.textContent, heading);
const longText = `${"before ".repeat(500)}selected phrase${" after".repeat(500)}`;
const longParagraph = element("p", longText, {}, article);
const longParagraphText = textNode(longText, longParagraph);
const otherParagraph = element("p", "Another paragraph", {}, article);
const otherText = textNode(otherParagraph.textContent, otherParagraph);
const code = element("code", "npm run verify", {}, paragraph);
const codeText = textNode(code.textContent, code);
const pre = element("pre", "const agent = true;", {}, article);
const preText = textNode(pre.textContent, pre);
const input = element("input", "secret", {}, article);
const inputText = textNode("secret", input);
const editable = element("div", "draft", { contenteditable: "true" }, article);
const editableText = textNode("draft", editable);
const translation = element(
  "div",
  "智能体会保留上下文。",
  { "data-byok-translator": "" },
  article
);
const translationText = textNode(translation.textContent, translation);
const magicLens = element(
  "div",
  "段落魔法镜",
  { id: "byok-translator-magic-lens" },
  article
);
const magicLensText = textNode(magicLens.textContent, magicLens);

const rect = { left: 100, top: 120, right: 260, bottom: 144, width: 160, height: 24 };

export function createSelectionArticleFixture() {
  return {
    paragraph: selection("agent", paragraphText, paragraphText, [rect]),
    list: selection("deterministic tool", listText, listText, [rect]),
    heading: selection("Memory", headingText, headingText, [rect]),
    longParagraph: selection(
      "selected phrase",
      longParagraphText,
      longParagraphText,
      [rect]
    ),
    crossContainer: selection("context Another", paragraphText, otherText, [rect]),
    code: selection("npm run verify", codeText, codeText, [rect]),
    pre: selection("const agent = true", preText, preText, [rect]),
    input: selection("secret", inputText, inputText, [rect]),
    editable: selection("draft", editableText, editableText, [rect]),
    translation: selection(
      "智能体会保留上下文",
      translationText,
      translationText,
      [rect]
    ),
    magicLens: selection("段落魔法镜", magicLensText, magicLensText, [rect])
  };
}
