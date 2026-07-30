import test from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveScheduler,
  createAdaptiveScheduler
} from "../extension/src/shared/adaptive-scheduler.mjs";

const profile = {
  minConcurrency: 2,
  initialConcurrency: 4,
  maxConcurrency: 6
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("isolates provider concurrency and respects each profile", async () => {
  const scheduler = createAdaptiveScheduler();
  const releases = [];
  let activeA = 0;
  let maxActiveA = 0;
  const tasks = Array.from({ length: 6 }, (_, index) =>
    scheduler.run({
      providerId: "a",
      profile: { min: 1, initial: 2, max: 2 },
      sessionId: "s",
      operation: () =>
        new Promise((resolve) => {
          activeA += 1;
          maxActiveA = Math.max(maxActiveA, activeA);
          releases.push(() => {
            activeA -= 1;
            resolve(index);
          });
        })
    })
  );
  const other = scheduler.run({
    providerId: "b",
    profile: { min: 1, initial: 1, max: 1 },
    sessionId: "s",
    operation: async () => "b"
  });
  await flush();
  assert.equal(maxActiveA, 2);
  assert.equal(await other, "b");
  while (releases.length) {
    releases.splice(0).forEach((release) => release());
    await flush();
  }
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
});

test("reduces on 429, honors Retry-After, retries with jitter, and recovers", async () => {
  let now = 0;
  const timers = [];
  const scheduler = new AdaptiveScheduler({
    now: () => now,
    random: () => 0,
    successThreshold: 2,
    setTimeoutImpl(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImpl() {}
  });
  let attempts = 0;
  const retried = scheduler.run({
    providerId: "p",
    profile,
    sessionId: "s",
    operation: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("limited"), {
          status: 429,
          retryAfter: 1200
        });
      }
      return "ok";
    }
  });
  await flush();
  assert.equal(scheduler.getState("p").currentConcurrency, 2);
  assert.equal(timers[0].delay, 1200);
  now = 1200;
  timers.shift().callback();
  assert.equal(await retried, "ok");

  for (let index = 0; index < 4; index += 1) {
    await scheduler.run({
      providerId: "p",
      profile,
      sessionId: "s",
      operation: async () => index
    });
  }
  assert.equal(scheduler.getState("p").currentConcurrency, 4);
});

test("multiplicatively reduces after consecutive high-latency successes", async () => {
  let now = 0;
  const scheduler = new AdaptiveScheduler({
    now: () => now,
    highLatencyMs: 100,
    highLatencyThreshold: 2
  });
  for (let index = 0; index < 2; index += 1) {
    await scheduler.run({
      providerId: "p",
      profile,
      sessionId: "slow",
      operation: async () => {
        now += 150;
      }
    });
  }
  assert.equal(scheduler.getState("p").currentConcurrency, 2);
});

test("retries 503 overload responses after reducing concurrency", async () => {
  const scheduler = new AdaptiveScheduler({ baseDelayMs: 0 });
  let attempts = 0;
  const result = await scheduler.run({
    providerId: "p",
    profile,
    sessionId: "overloaded",
    operation: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("overloaded"), { status: 503 });
      }
      return "recovered";
    }
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
  assert.equal(scheduler.getState("p").currentConcurrency, 2);
});

test("cancels a task while it is waiting in backoff", async () => {
  const timers = [];
  const clearedTimers = [];
  const scheduler = new AdaptiveScheduler({
    setTimeoutImpl(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImpl(timer) {
      clearedTimers.push(timer);
    }
  });
  let attempts = 0;
  const task = scheduler.run({
    providerId: "p",
    profile,
    sessionId: "backoff",
    operation: async () => {
      attempts += 1;
      throw Object.assign(new Error("limited"), {
        status: 429,
        retryAfter: 1_000
      });
    }
  });
  await flush();
  assert.equal(scheduler.getState("p").queuedCount, 1);
  assert.equal(scheduler.cancelSession("backoff"), 1);
  await assert.rejects(task, (error) => error.name === "AbortError");
  assert.equal(scheduler.getState("p").queuedCount, 0);
  assert.equal(attempts, 1);
  assert.deepEqual(clearedTimers, [1]);
});

test("cancels queued and in-flight work for one session", async () => {
  let releaseOther;
  const scheduler = new AdaptiveScheduler();
  const running = scheduler.run({
    providerId: "p",
    profile: { min: 1, initial: 1, max: 1 },
    sessionId: "cancel-me",
    operation: ({ signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true }
        );
      })
  });
  const queued = scheduler.run({
    providerId: "p",
    profile: { min: 1, initial: 1, max: 1 },
    sessionId: "cancel-me",
    operation: async () => "should not run"
  });
  const other = scheduler.run({
    providerId: "p",
    profile: { min: 1, initial: 1, max: 1 },
    sessionId: "keep",
    operation: () =>
      new Promise((resolve) => {
        releaseOther = resolve;
      })
  });
  await flush();
  assert.equal(scheduler.cancelSession("cancel-me"), 2);
  await assert.rejects(running, (error) => error.name === "AbortError");
  await assert.rejects(queued, (error) => error.name === "AbortError");
  await flush();
  releaseOther("kept");
  assert.equal(await other, "kept");
});
