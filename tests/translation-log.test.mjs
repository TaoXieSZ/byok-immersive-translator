import test from "node:test";
import assert from "node:assert/strict";
import {
  createPerformanceTimeline,
  logTranslationEvent,
  toSafeLogError
} from "../extension/src/shared/translation-log.mjs";

test("writes searchable structured translation events without extension warnings", () => {
  const originalDebug = console.debug;
  const originalError = console.error;
  const calls = [];
  console.debug = (...args) => calls.push(["debug", ...args]);
  console.error = (...args) => calls.push(["error", ...args]);

  try {
    logTranslationEvent("warn", "content.batch.start", {
      sessionId: "session-1",
      batchIndex: 2
    });
    logTranslationEvent("error", "background.batch.failed", {
      sessionId: "session-1",
      error: toSafeLogError({ code: "RATE_LIMITED", message: "稍后重试" })
    });
  } finally {
    console.debug = originalDebug;
    console.error = originalError;
  }

  assert.deepEqual(calls, [
    [
      "debug",
      "[byok-translator]",
      {
        event: "content.batch.start",
        sessionId: "session-1",
        batchIndex: 2
      }
    ],
    [
      "error",
      "[byok-translator]",
      {
        event: "background.batch.failed",
        sessionId: "session-1",
        error: { code: "RATE_LIMITED", message: "稍后重试" }
      }
    ]
  ]);
});

test("performance timeline records monotonic durations without page content", () => {
  let current = 100;
  const events = [];
  const timeline = createPerformanceTimeline({
    sessionId: "session-2",
    context: "content",
    now: () => current,
    log: (level, event, details) => events.push({ level, event, details })
  });

  current = 124;
  timeline.mark("loading", { channel: "fast" });
  current = 157;
  timeline.mark("first-token", { blockIndex: 0 });

  assert.deepEqual(timeline.snapshot(), {
    loading: 24,
    "first-token": 57
  });
  assert.equal(events[0].details.durationMs, 24);
  assert.equal(events[1].details.durationMs, 57);
  assert.equal(JSON.stringify(events).includes("page text"), false);
});

test("safe log errors redact bearer tokens and API keys", () => {
  assert.deepEqual(
    toSafeLogError({
      code: "AUTH_FAILED",
      message: "Bearer secret-token api_key=another-secret"
    }),
    {
      code: "AUTH_FAILED",
      message: "Bearer [redacted] api_key=[redacted]"
    }
  );
});
