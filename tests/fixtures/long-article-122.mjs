const REPEATED_LABELS = [
  "On this page",
  "Previous chapter",
  "Next chapter",
  "Claude Code from Source"
];

export const LONG_ARTICLE_BLOCKS = Object.freeze(
  Array.from({ length: 122 }, (_, index) => {
    const repeated = index % 15 === 0;
    return Object.freeze({
      id: `fixture:b${index}`,
      text: repeated
        ? REPEATED_LABELS[index % REPEATED_LABELS.length]
        : `Section ${index + 1} explains how an agent moves from input to a deterministic tool result while preserving session state and user control.`,
      viewport: index < 8
    });
  })
);
