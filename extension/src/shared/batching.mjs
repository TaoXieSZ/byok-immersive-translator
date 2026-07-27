export function createBatches(
  items,
  { maxItems = 12, maxCharacters = 6_000 } = {}
) {
  if (!Array.isArray(items) || maxItems < 1 || maxCharacters < 1) {
    throw new Error("Invalid batching arguments.");
  }

  const batches = [];
  let current = [];
  let currentCharacters = 0;

  for (const item of items) {
    if (!item?.id || typeof item.text !== "string" || item.text.length === 0) {
      throw new Error("Every batch item must contain an id and text.");
    }

    const wouldOverflow =
      current.length > 0 &&
      (current.length >= maxItems ||
        currentCharacters + item.text.length > maxCharacters);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }

    current.push(item);
    currentCharacters += item.text.length;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export function createProgressiveBatches(
  items,
  {
    firstMaxItems = 3,
    firstMaxCharacters = 1_200,
    maxItems = 10,
    maxCharacters = 4_000
  } = {}
) {
  if (
    !Array.isArray(items) ||
    firstMaxItems < 1 ||
    firstMaxCharacters < 1
  ) {
    throw new Error("Invalid progressive batching arguments.");
  }
  if (items.length === 0) {
    return [];
  }

  const firstBatch = [];
  let firstCharacters = 0;
  let nextIndex = 0;
  while (nextIndex < items.length) {
    const item = items[nextIndex];
    if (!item?.id || typeof item.text !== "string" || item.text.length === 0) {
      throw new Error("Every batch item must contain an id and text.");
    }
    const wouldOverflow =
      firstBatch.length > 0 &&
      (firstBatch.length >= firstMaxItems ||
        firstCharacters + item.text.length > firstMaxCharacters);
    if (wouldOverflow) {
      break;
    }
    firstBatch.push(item);
    firstCharacters += item.text.length;
    nextIndex += 1;
  }

  return [
    firstBatch,
    ...createBatches(items.slice(nextIndex), { maxItems, maxCharacters })
  ].filter((batch) => batch.length > 0);
}
