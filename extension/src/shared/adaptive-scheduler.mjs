const DEFAULT_SUCCESS_THRESHOLD = 3;
const DEFAULT_HIGH_LATENCY_THRESHOLD = 2;
const DEFAULT_HIGH_LATENCY_MS = 8_000;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 2;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function abortError() {
  const error = new Error("翻译请求已取消。");
  error.name = "AbortError";
  return error;
}

function normalizeProfile(profile) {
  const min = profile?.minConcurrency ?? profile?.min ?? 1;
  const max = profile?.maxConcurrency ?? profile?.max ?? min;
  const initial = profile?.initialConcurrency ?? profile?.initial ?? min;
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    !Number.isInteger(initial) ||
    min < 1 ||
    min > initial ||
    initial > max
  ) {
    throw new TypeError("Provider 并发画像无效。");
  }
  return { min, initial, max };
}

export class AdaptiveScheduler {
  constructor({
    now = () => Date.now(),
    random = Math.random,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    successThreshold = DEFAULT_SUCCESS_THRESHOLD,
    highLatencyThreshold = DEFAULT_HIGH_LATENCY_THRESHOLD,
    highLatencyMs = DEFAULT_HIGH_LATENCY_MS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxRetries = DEFAULT_MAX_RETRIES
  } = {}) {
    this.now = now;
    this.random = random;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.successThreshold = successThreshold;
    this.highLatencyThreshold = highLatencyThreshold;
    this.highLatencyMs = highLatencyMs;
    this.baseDelayMs = baseDelayMs;
    this.maxRetries = maxRetries;
    this.providers = new Map();
  }

  run({ providerId, profile, sessionId, operation, signal, maxRetries }) {
    if (
      typeof providerId !== "string" ||
      !providerId ||
      typeof sessionId !== "string"
    ) {
      return Promise.reject(new TypeError("调度任务缺少 providerId 或 sessionId。"));
    }
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("调度任务缺少 operation。"));
    }
    const state = this.#getProvider(providerId, profile);
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const entry = {
        sessionId,
        operation,
        controller,
        resolve,
        reject,
        attempts: 0,
        maxRetries: maxRetries ?? this.maxRetries,
        settled: false,
        removeExternalAbort: null
      };
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      if (signal) {
        const onAbort = () => this.#cancelEntry(state, entry);
        signal.addEventListener("abort", onAbort, { once: true });
        entry.removeExternalAbort = () =>
          signal.removeEventListener("abort", onAbort);
      }
      state.queue.push(entry);
      this.#drain(state);
    });
  }

  cancelSession(sessionId) {
    let cancelled = 0;
    for (const state of this.providers.values()) {
      for (const entry of [...state.queue, ...state.active]) {
        if (entry.sessionId === sessionId && !entry.settled) {
          cancelled += 1;
          this.#cancelEntry(state, entry);
        }
      }
      if (
        state.queue.length === 0 &&
        state.active.size === 0 &&
        state.timer
      ) {
        this.clearTimeoutImpl(state.timer);
        state.timer = null;
        state.cooldownUntil = 0;
      }
      this.#drain(state);
    }
    return cancelled;
  }

  getState(providerId) {
    const state = this.providers.get(providerId);
    return state
      ? {
          currentConcurrency: state.currentConcurrency,
          activeCount: state.active.size,
          queuedCount: state.queue.length,
          cooldownUntil: state.cooldownUntil,
          consecutiveSuccesses: state.consecutiveSuccesses
        }
      : null;
  }

  #getProvider(providerId, profile) {
    const limits = normalizeProfile(profile);
    const existing = this.providers.get(providerId);
    if (existing) {
      existing.limits = limits;
      existing.currentConcurrency = Math.min(
        limits.max,
        Math.max(limits.min, existing.currentConcurrency)
      );
      return existing;
    }
    const state = {
      providerId,
      limits,
      currentConcurrency: limits.initial,
      consecutiveSuccesses: 0,
      consecutiveHighLatency: 0,
      cooldownUntil: 0,
      queue: [],
      active: new Set(),
      timer: null
    };
    this.providers.set(providerId, state);
    return state;
  }

  #drain(state) {
    if (state.timer) {
      return;
    }
    const wait = state.cooldownUntil - this.now();
    if (wait > 0) {
      state.timer = this.setTimeoutImpl(() => {
        state.timer = null;
        this.#drain(state);
      }, wait);
      return;
    }
    while (
      state.active.size < state.currentConcurrency &&
      state.queue.length > 0
    ) {
      const entry = state.queue.shift();
      if (!entry.settled) {
        this.#start(state, entry);
      }
    }
  }

  #start(state, entry) {
    state.active.add(entry);
    const startedAt = this.now();
    Promise.resolve()
      .then(() =>
        entry.operation({
          signal: entry.controller.signal,
          attempt: entry.attempts
        })
      )
      .then((value) => {
        const latency = Math.max(0, this.now() - startedAt);
        this.#recordSuccess(state, latency);
        this.#settle(entry, "resolve", value);
      })
      .catch((error) => {
        if (entry.controller.signal.aborted || error?.name === "AbortError") {
          this.#settle(entry, "reject", abortError());
          return;
        }
        if (error?.status === 429 || error?.status === 503) {
          this.#reduce(state);
          if (entry.attempts < entry.maxRetries) {
            entry.attempts += 1;
            const jitterDelay =
              this.baseDelayMs *
              2 ** (entry.attempts - 1) *
              (0.5 + this.random());
            const retryAfter =
              Number.isFinite(error.retryAfter) && error.retryAfter >= 0
                ? error.retryAfter
                : 0;
            const delay = Math.min(
              MAX_TIMER_DELAY_MS,
              Math.max(retryAfter, jitterDelay)
            );
            state.cooldownUntil = Math.max(
              state.cooldownUntil,
              this.now() + delay
            );
            state.queue.push(entry);
            return;
          }
        }
        this.#settle(entry, "reject", error);
      })
      .finally(() => {
        state.active.delete(entry);
        this.#drain(state);
      });
  }

  #recordSuccess(state, latency) {
    if (latency >= this.highLatencyMs) {
      state.consecutiveHighLatency += 1;
      state.consecutiveSuccesses = 0;
      if (state.consecutiveHighLatency >= this.highLatencyThreshold) {
        this.#reduce(state);
      }
      return;
    }
    state.consecutiveHighLatency = 0;
    state.consecutiveSuccesses += 1;
    if (
      state.consecutiveSuccesses >= this.successThreshold &&
      state.currentConcurrency < state.limits.max
    ) {
      state.currentConcurrency += 1;
      state.consecutiveSuccesses = 0;
    }
  }

  #reduce(state) {
    state.currentConcurrency = Math.max(
      state.limits.min,
      Math.floor(state.currentConcurrency / 2)
    );
    state.consecutiveSuccesses = 0;
    state.consecutiveHighLatency = 0;
  }

  #cancelEntry(state, entry) {
    if (entry.settled) {
      return;
    }
    const index = state.queue.indexOf(entry);
    if (index >= 0) {
      state.queue.splice(index, 1);
    }
    entry.controller.abort();
    this.#settle(entry, "reject", abortError());
  }

  #settle(entry, method, value) {
    if (entry.settled) {
      return;
    }
    entry.settled = true;
    entry.removeExternalAbort?.();
    entry[method](value);
  }
}

export function createAdaptiveScheduler(options) {
  return new AdaptiveScheduler(options);
}
