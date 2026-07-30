const TAG_BY_MARK_TYPE = Object.freeze({
  strong: "strong",
  bold: "strong",
  em: "em",
  italic: "em",
  code: "code",
  kbd: "kbd",
  mark: "mark",
  sub: "sub",
  sup: "sup",
  br: "br",
  break: "br",
  link: "a",
  a: "a"
});

function markMapFromDescriptor(descriptor) {
  return new Map(
    (descriptor?.marks ?? []).map((mark) => [
      String(mark.id),
      {
        ...mark,
        ...(mark.link ?? {})
      }
    ])
  );
}

export function nodesFromParsedTranslation(parsed) {
  const text = String(parsed?.text ?? "");
  const root = { start: 0, end: text.length, children: [] };
  const stack = [root];
  const ordered = [...(parsed?.marks ?? [])].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end
  );

  for (const mark of ordered) {
    while (
      stack.length > 1 &&
      !(
        mark.start >= stack.at(-1).start &&
        mark.end <= stack.at(-1).end
      )
    ) {
      stack.pop();
    }
    const parent = stack.at(-1);
    const entry = { ...mark, children: [] };
    parent.children.push(entry);
    if (entry.end > entry.start) {
      stack.push(entry);
    }
  }

  function renderRange(range) {
    const nodes = [];
    let cursor = range.start;
    for (const mark of range.children) {
      if (mark.start > cursor) {
        nodes.push({ type: "text", value: text.slice(cursor, mark.start) });
      }
      nodes.push({
        type: "mark",
        markId: mark.id,
        children: renderRange(mark)
      });
      cursor = Math.max(cursor, mark.end);
    }
    if (cursor < range.end) {
      nodes.push({ type: "text", value: text.slice(cursor, range.end) });
    }
    return nodes;
  }

  return renderRange(root);
}

export function resolveSafeLink(href, baseUrl) {
  if (typeof href !== "string" || href.length === 0) {
    return null;
  }
  if (href.startsWith("#")) {
    return href;
  }
  try {
    const resolved = new URL(href, baseUrl);
    return ["http:", "https:", "mailto:"].includes(resolved.protocol)
      ? resolved.href
      : null;
  } catch {
    return null;
  }
}

export function createFormatStreamFilter({
  markerPrefix,
  markerSuffix
}) {
  if (!markerPrefix || !markerSuffix) {
    throw new TypeError("Format marker boundaries are required.");
  }
  let pending = "";

  return {
    push(chunk) {
      const source = pending + String(chunk ?? "");
      pending = "";
      let visible = "";
      let index = 0;
      while (index < source.length) {
        if (source.startsWith(markerPrefix, index)) {
          const end = source.indexOf(
            markerSuffix,
            index + markerPrefix.length
          );
          if (end < 0) {
            pending = source.slice(index);
            break;
          }
          index = end + markerSuffix.length;
          continue;
        }
        const tail = source.slice(index);
        if (markerPrefix.startsWith(tail)) {
          pending = tail;
          break;
        }
        visible += source[index];
        index += 1;
      }
      return visible;
    },

    reset() {
      pending = "";
    },

    get pendingLength() {
      return pending.length;
    }
  };
}

function appendParsedNodes(parent, nodes, context, depth = 0) {
  if (!Array.isArray(nodes) || depth > 32) {
    throw new TypeError("Invalid formatted translation tree.");
  }
  for (const node of nodes) {
    if (node?.type === "text") {
      parent.append(
        context.document.createTextNode(String(node.value ?? node.text ?? ""))
      );
      continue;
    }
    if (node?.type !== "mark") {
      throw new TypeError("Unknown formatted translation node.");
    }

    const descriptor = context.marks.get(String(node.markId ?? node.id));
    const tagName = TAG_BY_MARK_TYPE[descriptor?.type];
    if (!descriptor || !tagName) {
      throw new TypeError("Unknown translation format mark.");
    }
    if (tagName === "br") {
      parent.append(context.document.createElement("br"));
      continue;
    }

    if (tagName === "a") {
      const href = resolveSafeLink(
        descriptor.href,
        context.document.baseURI
      );
      if (!href) {
        appendParsedNodes(parent, node.children ?? [], context, depth + 1);
        continue;
      }
      const link = context.document.createElement("a");
      link.setAttribute("href", href);
      if (typeof descriptor.title === "string" && descriptor.title) {
        link.setAttribute("title", descriptor.title);
      }
      if (descriptor.target === "_blank") {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
      appendParsedNodes(link, node.children ?? [], context, depth + 1);
      parent.append(link);
      continue;
    }

    const element = context.document.createElement(tagName);
    appendParsedNodes(element, node.children ?? [], context, depth + 1);
    parent.append(element);
  }
}

export function createFormattedFragment(
  documentLike,
  nodes,
  descriptor
) {
  const fragment = documentLike.createDocumentFragment();
  appendParsedNodes(fragment, nodes, {
    document: documentLike,
    marks: markMapFromDescriptor(descriptor)
  });
  return fragment;
}

export function replaceWithFormattedTranslation(
  container,
  nodes,
  descriptor,
  { documentLike = container.ownerDocument } = {}
) {
  const fragment = createFormattedFragment(documentLike, nodes, descriptor);
  container.replaceChildren(fragment);
  return container;
}

export function replaceWithPlainTranslation(
  container,
  translation,
  { documentLike = container.ownerDocument } = {}
) {
  container.replaceChildren(
    documentLike.createTextNode(String(translation ?? ""))
  );
  return container;
}

export function renderTranslationSafely(
  container,
  translation,
  descriptor,
  {
    documentLike = container.ownerDocument,
    parse,
    stripReservedMarkers = (value) => String(value ?? ""),
    onFallback = () => {}
  } = {}
) {
  if (!descriptor?.marks?.length || typeof parse !== "function") {
    replaceWithPlainTranslation(container, translation, { documentLike });
    return { formatted: false, fallback: false };
  }
  try {
    const parsed = parse(translation, descriptor);
    const nodes = parsed?.nodes ?? nodesFromParsedTranslation(parsed);
    replaceWithFormattedTranslation(container, nodes, {
      ...descriptor,
      marks: parsed?.marks ?? descriptor.marks
    }, {
      documentLike
    });
    return { formatted: true, fallback: false };
  } catch (error) {
    replaceWithPlainTranslation(
      container,
      stripReservedMarkers(translation),
      { documentLike }
    );
    onFallback(error);
    return { formatted: false, fallback: true };
  }
}
