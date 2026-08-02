import test from "node:test";
import assert from "node:assert/strict";
import {
  MAGIC_LENS_TEMPLATE,
  MagicLensStatus,
  TermExplanationStatus,
  computeMagicLensPosition,
  createFrameScheduler,
  createInitialMagicLensState,
  createMagicLensController,
  evaluateMagicLensPerformance,
  formatBilingualCopy,
  isMagicLensDismissKey,
  reduceMagicLensState,
  shouldFollowMagicLensStream,
  shouldEvaluateMagicLensSelection
} from "../extension/src/content/magic-lens-controller.mjs";
import { MessageType } from "../extension/src/shared/messages.mjs";

const snapshot = {
  selectionText: "agent",
  contextText: "The agent keeps persistent context.",
  anchorRect: {
    left: 100,
    top: 120,
    right: 180,
    bottom: 144,
    width: 80,
    height: 24
  }
};

function createFakeView() {
  const handlers = new Map();
  const renders = [];
  return {
    renders,
    on(action, handler) {
      handlers.set(action, handler);
    },
    fire(action, ...args) {
      return handlers.get(action)?.(...args);
    },
    render(state) {
      renders.push(structuredClone(state));
    },
    contains: () => false,
    destroy() {}
  };
}

function createRuntime() {
  const messages = [];
  return {
    messages,
    async sendMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === MessageType.GET_PROVIDER_STATUS) {
        return {
          ok: true,
          configured: true,
          provider: {
            name: "DeepSeek",
            model: "deepseek-chat",
            targetLanguage: "简体中文"
          }
        };
      }
      return { ok: true };
    },
    async openOptionsPage() {}
  };
}

test("magic lens reducer covers hidden, trigger, loading, streaming, complete, and error", () => {
  let state = createInitialMagicLensState();
  assert.equal(state.status, MagicLensStatus.HIDDEN);
  state = reduceMagicLensState(state, { type: "capture", snapshot });
  assert.equal(state.status, MagicLensStatus.TRIGGER);
  state = reduceMagicLensState(state, { type: "start", requestId: "r1" });
  assert.equal(state.status, MagicLensStatus.LOADING);
  state = reduceMagicLensState(state, { type: "chunk", chunk: "智能" });
  state = reduceMagicLensState(state, { type: "chunk", chunk: "体" });
  assert.equal(state.status, MagicLensStatus.STREAMING);
  assert.equal(state.translation, "智能体");
  state = reduceMagicLensState(state, { type: "complete", text: "智能体" });
  assert.equal(state.status, MagicLensStatus.COMPLETE);
  state = reduceMagicLensState(state, {
    type: "term-start",
    requestId: "term-1",
    term: "REPL"
  });
  assert.equal(state.termStatus, TermExplanationStatus.LOADING);
  state = reduceMagicLensState(state, {
    type: "term-complete",
    term: "REPL",
    explanation: "Read-Eval-Print Loop。"
  });
  assert.equal(state.termStatus, TermExplanationStatus.COMPLETE);
  assert.equal(state.termExplanation, "Read-Eval-Print Loop。");
  state = reduceMagicLensState(state, {
    type: "error",
    error: { code: "NETWORK_ERROR", message: "网络错误" }
  });
  assert.equal(state.status, MagicLensStatus.ERROR);
  assert.equal(reduceMagicLensState(state, { type: "close" }).status, "hidden");
});

test("selection capture remains local until the user explicitly starts", async () => {
  const view = createFakeView();
  const runtime = createRuntime();
  const controller = createMagicLensController({
    runtime,
    view,
    clipboard: { async writeText() {} },
    createRequestId: () => "selection-1"
  });
  controller.showSnapshot(snapshot);
  assert.equal(controller.getState().status, MagicLensStatus.TRIGGER);
  assert.deepEqual(runtime.messages, []);

  const start = controller.start();
  assert.equal(controller.getState().status, MagicLensStatus.LOADING);
  await start;
  assert.deepEqual(
    runtime.messages.map(({ type }) => type),
    [MessageType.GET_PROVIDER_STATUS, MessageType.TRANSLATE_SELECTION_START]
  );
  assert.deepEqual(runtime.messages[1], {
    type: MessageType.TRANSLATE_SELECTION_START,
    requestId: "selection-1",
    targetLanguage: "简体中文",
    selectionText: "agent",
    contextText: "The agent keeps persistent context.",
    bypassCache: false
  });
});

test("applies only active stream events and suppresses stale responses", async () => {
  const view = createFakeView();
  const controller = createMagicLensController({
    runtime: createRuntime(),
    view,
    clipboard: { async writeText() {} },
    createRequestId: () => "selection-active"
  });
  controller.showSnapshot(snapshot);
  await controller.start();
  assert.deepEqual(
    controller.handleMessage({
      type: MessageType.TRANSLATE_SELECTION_CHUNK,
      requestId: "selection-old",
      chunk: "旧"
    }),
    { ok: true, ignored: true }
  );
  controller.handleMessage({
    type: MessageType.TRANSLATE_SELECTION_CHUNK,
    requestId: "selection-active",
    chunk: "智能"
  });
  controller.handleMessage({
    type: MessageType.TRANSLATE_SELECTION_COMPLETE,
    requestId: "selection-active",
    text: "智能体",
    cacheHit: false
  });
  assert.equal(controller.getState().status, MagicLensStatus.COMPLETE);
  assert.equal(controller.getState().translation, "智能体");
});

test("whole-page commands and responses do not mutate or cancel the active lens", async () => {
  const view = createFakeView();
  const runtime = createRuntime();
  const controller = createMagicLensController({
    runtime,
    view,
    clipboard: { async writeText() {} },
    createRequestId: () => "selection-independent"
  });
  controller.showSnapshot(snapshot);
  await controller.start();
  const activeState = controller.getState();

  for (const type of [
    MessageType.STOP_TRANSLATION,
    MessageType.RESTORE_PAGE,
    MessageType.TRANSLATION_CHUNK,
    MessageType.TRANSLATION_COMPLETE
  ]) {
    assert.equal(controller.handleMessage({ type }), undefined);
    assert.deepEqual(controller.getState(), activeState);
  }

  controller.close();
  assert.deepEqual(
    runtime.messages.filter(({ type }) => type.startsWith("selection:")),
    [
      {
        type: MessageType.TRANSLATE_SELECTION_START,
        requestId: "selection-independent",
        targetLanguage: "简体中文",
        selectionText: "agent",
        contextText: "The agent keeps persistent context.",
        bypassCache: false
      },
      {
        type: MessageType.CANCEL_SELECTION,
        requestId: "selection-independent"
      }
    ]
  );
});

test("retranslation bypasses cache, copy stays visible on failure, and close cancels active work", async () => {
  const view = createFakeView();
  const runtime = createRuntime();
  let requestNumber = 0;
  const controller = createMagicLensController({
    runtime,
    view,
    clipboard: {
      async writeText() {
        throw new Error("denied");
      }
    },
    createRequestId: () => `selection-${++requestNumber}`
  });
  controller.showSnapshot(snapshot);
  await controller.start();
  controller.handleMessage({
    type: MessageType.TRANSLATE_SELECTION_COMPLETE,
    requestId: "selection-1",
    text: "智能体"
  });
  view.fire("copy-bilingual");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().feedback, "复制失败，请手动选择译文。");

  await controller.start({ bypassCache: true });
  assert.equal(runtime.messages.at(-1).bypassCache, true);
  controller.close();
  assert.equal(runtime.messages.at(-1).type, MessageType.CANCEL_SELECTION);
  assert.equal(controller.getState().status, MagicLensStatus.HIDDEN);
});

test("detects terms locally and explains one only after the reader asks", async () => {
  const view = createFakeView();
  const messages = [];
  const runtime = {
    messages,
    async sendMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === MessageType.GET_PROVIDER_STATUS) {
        return {
          ok: true,
          configured: true,
          provider: {
            name: "DeepSeek",
            model: "deepseek-chat",
            targetLanguage: "简体中文"
          }
        };
      }
      if (message.type === MessageType.EXPLAIN_TERM) {
        return {
          ok: true,
          requestId: message.requestId,
          term: message.term,
          explanation:
            "REPL 是 Read-Eval-Print Loop（读取-求值-输出循环），用于交互式运行代码。"
        };
      }
      return { ok: true };
    },
    async openOptionsPage() {}
  };
  let requestNumber = 0;
  const controller = createMagicLensController({
    runtime,
    view,
    clipboard: { async writeText() {} },
    createRequestId: () => `request-${++requestNumber}`
  });
  controller.showSnapshot({
    ...snapshot,
    selectionText: "The REPL pulls messages from the query loop.",
    contextText: "The REPL pulls messages from the query loop."
  });
  assert.deepEqual(controller.getState().terms, ["REPL"]);
  assert.equal(
    messages.some(({ type }) => type === MessageType.EXPLAIN_TERM),
    false
  );

  await controller.start();
  controller.handleMessage({
    type: MessageType.TRANSLATE_SELECTION_COMPLETE,
    requestId: "request-1",
    text: "REPL 从查询循环中拉取消息。"
  });
  const first = await controller.explainTerm("REPL");
  assert.equal(first.ok, true);
  assert.equal(controller.getState().termStatus, TermExplanationStatus.COMPLETE);
  assert.match(controller.getState().termExplanation, /Read-Eval-Print Loop/u);
  assert.deepEqual(
    messages.find(({ type }) => type === MessageType.EXPLAIN_TERM),
    {
      type: MessageType.EXPLAIN_TERM,
      requestId: "request-2",
      term: "REPL",
      contextText: "The REPL pulls messages from the query loop.",
      targetLanguage: "简体中文"
    }
  );

  const second = await controller.explainTerm("REPL");
  assert.equal(second.cacheHit, true);
  assert.equal(
    messages.filter(({ type }) => type === MessageType.EXPLAIN_TERM).length,
    1
  );
});

test("keeps trigger and card within viewport and formats bilingual copy without context", () => {
  assert.deepEqual(
    computeMagicLensPosition(
      { left: 980, right: 1000, top: 760, bottom: 790 },
      { width: 360, height: 240 },
      { width: 1024, height: 800 }
    ),
    { left: 640, top: 512 }
  );
  assert.deepEqual(
    computeMagicLensPosition(
      { left: 420, right: 690, top: -240, bottom: -216 },
      { width: 360, height: 240 },
      { width: 1024, height: 800 }
    ),
    { left: 330, top: 12 }
  );
  assert.deepEqual(
    computeMagicLensPosition(
      { left: 420, right: 690, top: 900, bottom: 924 },
      { width: 360, height: 240 },
      { width: 1024, height: 800 }
    ),
    { left: 330, top: 548 }
  );
  assert.equal(formatBilingualCopy(snapshot, "智能体"), "agent\n智能体");
  assert.equal(formatBilingualCopy(snapshot, "智能体").includes("persistent"), false);
});

test("locks interaction budgets and coalesces repeated positioning into one frame", () => {
  assert.deepEqual(
    evaluateMagicLensPerformance({
      triggerVisible: 49,
      loadingVisible: 99,
      cachedComplete: 299
    }),
    {
      triggerVisible: true,
      loadingVisible: true,
      cachedComplete: true
    }
  );
  assert.equal(
    evaluateMagicLensPerformance({
      triggerVisible: 51,
      loadingVisible: 101,
      cachedComplete: 301
    }).cachedComplete,
    false
  );
  const frames = [];
  let calls = 0;
  const schedule = createFrameScheduler(
    () => {
      calls += 1;
    },
    (callback) => frames.push(callback)
  );
  schedule();
  schedule();
  schedule();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(calls, 1);
  schedule();
  assert.equal(frames.length, 1);
});

test("long translations follow the stream only while the reader stays near the end", () => {
  assert.equal(
    shouldFollowMagicLensStream({
      scrollHeight: 500,
      scrollTop: 276,
      clientHeight: 200
    }),
    true
  );
  assert.equal(
    shouldFollowMagicLensStream({
      scrollHeight: 500,
      scrollTop: 200,
      clientHeight: 200
    }),
    false
  );
});

test("template uses the A3 mark, native controls, visible focus, and live status", () => {
  assert.match(MAGIC_LENS_TEMPLATE, /data-icon="floating-a3"/u);
  assert.match(MAGIC_LENS_TEMPLATE, />好<\/text>/u);
  assert.match(MAGIC_LENS_TEMPLATE, /data-field="source"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /max-height: min\(560px, calc\(100vh - 24px\)\)/u);
  assert.match(MAGIC_LENS_TEMPLATE, /overflow-y: auto/u);
  assert.match(MAGIC_LENS_TEMPLATE, /术语·点击解释/u);
  assert.match(MAGIC_LENS_TEMPLATE, /data-field="terms"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /role="dialog"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /aria-live="polite"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /focus-visible/u);
  assert.match(MAGIC_LENS_TEMPLATE, /data-action="copy-translation"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /data-action="copy-bilingual"/u);
  assert.match(MAGIC_LENS_TEMPLATE, /data-action="retranslate"/u);
});

test("keyboard selection enters the lens flow and Escape dismisses it", () => {
  const outside = { id: "article" };
  const inside = { id: "lens" };
  const contains = (target) => target === inside;
  assert.equal(
    shouldEvaluateMagicLensSelection({ type: "keyup", target: outside }, contains),
    true
  );
  assert.equal(
    shouldEvaluateMagicLensSelection({ type: "keyup", target: inside }, contains),
    false
  );
  assert.equal(
    shouldEvaluateMagicLensSelection({ type: "keydown", target: outside }, contains),
    false
  );
  assert.equal(isMagicLensDismissKey({ type: "keydown", key: "Escape" }), true);
  assert.equal(isMagicLensDismissKey({ type: "keyup", key: "Escape" }), false);
  assert.equal(isMagicLensDismissKey({ type: "keydown", key: "Enter" }), false);
});
