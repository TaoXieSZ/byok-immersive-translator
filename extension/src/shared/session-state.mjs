export const BlockStatus = Object.freeze({
  QUEUED: "queued",
  TRANSLATING: "translating",
  TRANSLATED: "translated",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

export function summarizeBlocks(blocks, sessionStatus = "idle", lastError = null) {
  const summary = {
    status: sessionStatus,
    queued: 0,
    translating: 0,
    translated: 0,
    failed: 0,
    cancelled: 0,
    total: blocks.length,
    lastError
  };

  for (const block of blocks) {
    if (Object.hasOwn(summary, block.status)) {
      summary[block.status] += 1;
    }
  }
  return summary;
}
