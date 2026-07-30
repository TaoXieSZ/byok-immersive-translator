export function createDeterministicClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(milliseconds) {
      current += milliseconds;
      return current;
    }
  };
}

export function createDeterministicStageHarness({
  start = 0,
  unitCostMs = 0.01
} = {}) {
  const clock = createDeterministicClock(start);
  const stages = {};
  return {
    clock,
    stages,
    run(name, units, operation) {
      const startedAt = clock.now();
      const result = operation();
      const resolvedUnits =
        typeof units === "function" ? units(result) : units;
      const duration = Math.max(0, resolvedUnits) * unitCostMs;
      clock.advance(duration);
      stages[name] = clock.now() - startedAt;
      return result;
    },
    report() {
      return {
        elapsed: clock.now() - start,
        stages: { ...stages }
      };
    }
  };
}

function createInstrumentedParent(documentLike, tagName = null) {
  return {
    tagName,
    children: [],
    attributes: {},
    ownerDocument: documentLike,
    append(...children) {
      this.children.push(...children);
      documentLike.metrics.appendOperations += children.length;
    },
    replaceChildren(...children) {
      this.children = [...children];
      documentLike.metrics.replaceOperations += 1;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      documentLike.metrics.attributeOperations += 1;
    }
  };
}

export function createInstrumentedDocument({
  baseURI = "https://example.test/article"
} = {}) {
  const documentLike = {
    baseURI,
    metrics: {
      createdElements: 0,
      createdTextNodes: 0,
      createdFragments: 0,
      appendOperations: 0,
      replaceOperations: 0,
      attributeOperations: 0
    },
    createDocumentFragment() {
      this.metrics.createdFragments += 1;
      return createInstrumentedParent(this);
    },
    createElement(tagName) {
      this.metrics.createdElements += 1;
      return createInstrumentedParent(this, tagName);
    },
    createTextNode(value) {
      this.metrics.createdTextNodes += 1;
      return { type: "text", value: String(value), ownerDocument: this };
    }
  };
  return {
    documentLike,
    createContainer() {
      return createInstrumentedParent(documentLike, "div");
    },
    operationCount() {
      return Object.values(documentLike.metrics).reduce(
        (total, count) => total + count,
        0
      );
    }
  };
}

export async function measureCachedViewport(
  blocks,
  lookup,
  {
    start = 0,
    lookupCostMs = 2,
    renderCostMs = 1
  } = {}
) {
  const clock = createDeterministicClock(start);
  let requestCount = 0;
  for (const block of blocks) {
    const cached = await lookup(block);
    clock.advance(lookupCostMs);
    if (cached) {
      clock.advance(renderCostMs);
    } else {
      requestCount += 1;
    }
  }
  return {
    requestCount,
    viewportComplete: clock.now() - start
  };
}

function translationMapFromRequest(init) {
  const body = JSON.parse(init.body);
  const prompt = body.messages.at(-1).content;
  const jsonStart = prompt.lastIndexOf("\n{");
  const source = JSON.parse(prompt.slice(jsonStart + 1));
  return Object.fromEntries(
    Object.entries(source).map(([id, text]) => [id, `译：${text}`])
  );
}

export function createNonStreamingProviderStub({ latency = 80 } = {}) {
  const requests = [];
  return {
    requests,
    async fetch(url, init) {
      requests.push({ url, init });
      await new Promise((resolve) => setTimeout(resolve, latency));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(translationMapFromRequest(init))
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  };
}

export function createStreamingProviderStub({
  chunks = ["译", "：", "Hello"],
  firstChunkDelay = 20,
  chunkDelay = 5
} = {}) {
  const requests = [];
  const encoder = new TextEncoder();
  return {
    requests,
    async fetch(url, init) {
      requests.push({ url, init });
      const stream = new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, firstChunkDelay));
          for (const chunk of chunks) {
            const payload = JSON.stringify({
              choices: [{ delta: { content: chunk } }]
            });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, chunkDelay));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    }
  };
}
