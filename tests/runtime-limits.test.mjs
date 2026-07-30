import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_PROVIDER_PROFILE,
  DEEPSEEK_PROVIDER_PROFILE,
  TRANSLATION_CONCURRENCY,
  validateProviderProfile
} from "../extension/src/shared/runtime-limits.mjs";

test("translation concurrency has one shared positive limit", () => {
  assert.equal(Number.isSafeInteger(TRANSLATION_CONCURRENCY), true);
  assert.equal(TRANSLATION_CONCURRENCY, 3);
});

test("defines DeepSeek and conservative custom provider profiles", () => {
  assert.deepEqual(DEEPSEEK_PROVIDER_PROFILE, {
    stream: true,
    initialConcurrency: 6,
    minConcurrency: 2,
    maxConcurrency: 8
  });
  assert.deepEqual(CUSTOM_PROVIDER_PROFILE, {
    stream: false,
    initialConcurrency: 3,
    minConcurrency: 1,
    maxConcurrency: 3
  });
});

test("validates bounded provider profiles", () => {
  assert.deepEqual(
    validateProviderProfile({
      stream: true,
      initialConcurrency: 4,
      minConcurrency: 2,
      maxConcurrency: 6
    }),
    {
      stream: true,
      initialConcurrency: 4,
      minConcurrency: 2,
      maxConcurrency: 6
    }
  );

  assert.throws(
    () =>
      validateProviderProfile({
        stream: false,
        initialConcurrency: 1,
        minConcurrency: 2,
        maxConcurrency: 3
      }),
    /并发/
  );
  assert.throws(
    () =>
      validateProviderProfile({
        stream: false,
        initialConcurrency: 3,
        minConcurrency: 1,
        maxConcurrency: 17
      }),
    /并发/
  );
  assert.throws(
    () =>
      validateProviderProfile({
        stream: "yes",
        initialConcurrency: 3,
        minConcurrency: 1,
        maxConcurrency: 3
      }),
    /流式/
  );
});
