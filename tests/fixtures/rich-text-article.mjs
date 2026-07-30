const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export function text(value) {
  return {
    nodeType: TEXT_NODE,
    nodeValue: value,
    textContent: value
  };
}

export function element(tagName, attributes = {}, children = []) {
  const node = {
    nodeType: ELEMENT_NODE,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    textContent: children.map((child) => child.textContent ?? "").join(""),
    getAttribute(name) {
      return attributes[name] ?? null;
    }
  };
  return node;
}

export function createRichTextArticleFixture() {
  const heading = element("h2", { class: "site-heading" }, [
    element("strong", {}, [text("5. Memory")])
  ]);
  const paragraph = element("p", {
    class: "prose fancy",
    style: "color:red",
    onclick: "danger()"
  }, [
    text("Memory uses "),
    element("code", { class: "token" }, [text("memdir/")]),
    text(", "),
    element("code", {}, [text("CLAUDE.md")]),
    text(" and "),
    element("strong", {}, [
      text("the "),
      element("code", {}, [text("~/.claude/MEMORY.md")]),
      text(" file")
    ]),
    text(". "),
    element("custom-widget", { "data-secret": "do-not-copy" }, [
      element("em", {}, [text("Visible custom text")])
    ]),
    text(" "),
    element("a", {
      href: "https://example.com/docs?q=private",
      title: "Documentation",
      target: "_blank",
      rel: "opener"
    }, [text("safe docs")]),
    text(" and "),
    element("a", {
      href: "javascript:alert(1)",
      onclick: "alert(2)"
    }, [text("unsafe docs")]),
    text(" H"),
    element("sub", {}, [text("2")]),
    text("O x"),
    element("sup", {}, [text("2")]),
    element("br"),
    element("mark", {}, [
      text("Press "),
      element("kbd", {}, [text("Enter")])
    ])
  ]);
  return { heading, paragraph };
}
