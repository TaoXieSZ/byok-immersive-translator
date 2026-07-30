const LOG_PREFIX = "[byok-translator]";
const REDACTED = "[redacted]";

function redactSecrets(message) {
  return String(message ?? "")
    .replace(/Bearer\s+\S+/giu, `Bearer ${REDACTED}`)
    .replace(
      /(?:api[_ -]?key|token)\s*[:=]\s*\S+/giu,
      (match) => `${match.split(/[:=]/u)[0]}=${REDACTED}`
    );
}

export function toSafeLogError(error) {
  return {
    code:
      typeof error?.code === "string"
        ? error.code
        : "UNKNOWN_ERROR",
    message:
      typeof error?.message === "string"
        ? redactSecrets(error.message)
        : "翻译请求失败。"
  };
}

export function logTranslationEvent(level, event, details = {}) {
  const payload = {
    event,
    ...details
  };
  if (level === "error") {
    console.error(LOG_PREFIX, payload);
    return;
  }
  console.debug(LOG_PREFIX, payload);
}

export function createPerformanceTimeline({
  sessionId,
  context,
  now = () => performance.now(),
  log = logTranslationEvent
}) {
  const startedAt = now();
  const marks = new Map();

  return {
    mark(event, details = {}, level = "warn") {
      const durationMs = Math.max(0, now() - startedAt);
      const payload = {
        sessionId,
        context,
        durationMs,
        ...details
      };
      marks.set(event, durationMs);
      log(level, `performance.${event}`, payload);
      return payload;
    },

    duration(event) {
      return marks.get(event) ?? null;
    },

    snapshot() {
      return Object.fromEntries(marks);
    }
  };
}
