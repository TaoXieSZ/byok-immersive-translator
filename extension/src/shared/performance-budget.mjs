export const PERFORMANCE_BUDGET_MS = Object.freeze({
  loading: 100,
  firstRequest: 200,
  firstToken: 2_500,
  viewportComplete: 5_000,
  cachedViewportComplete: 300
});

export const LONG_ARTICLE_REQUEST_BUDGET = 8;

export function evaluatePerformanceBudget(
  measurements,
  {
    cached = false,
    requestCount = 0,
    blockCount = 0
  } = {}
) {
  const checks = {
    loading:
      Number.isFinite(measurements?.loading) &&
      measurements.loading <= PERFORMANCE_BUDGET_MS.loading,
    firstRequest: cached
      ? requestCount === 0
      : Number.isFinite(measurements?.firstRequest) &&
        measurements.firstRequest <= PERFORMANCE_BUDGET_MS.firstRequest,
    firstToken: cached
      ? true
      : Number.isFinite(measurements?.firstToken) &&
        measurements.firstToken <= PERFORMANCE_BUDGET_MS.firstToken,
    viewportComplete:
      Number.isFinite(measurements?.viewportComplete) &&
      measurements.viewportComplete <=
        (cached
          ? PERFORMANCE_BUDGET_MS.cachedViewportComplete
          : PERFORMANCE_BUDGET_MS.viewportComplete),
    requestCount:
      blockCount < 122 || requestCount <= LONG_ARTICLE_REQUEST_BUDGET
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
}
