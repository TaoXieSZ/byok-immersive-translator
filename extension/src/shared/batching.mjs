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
