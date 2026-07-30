import test from "node:test";
import assert from "node:assert/strict";
import {
  APPEARANCE_SCHEMA_VERSION,
  APPEARANCE_STORAGE_KEY,
  AppearanceMode,
  DEFAULT_APPEARANCE,
  createAppearanceRepository,
  normalizeAppearancePreference,
  resolveFontStacks,
  toPublicAppearancePreference,
  validateAppearancePreference
} from "../extension/src/shared/appearance-preferences.mjs";

function createMemoryStorage(initial = {}) {
  const data = structuredClone(initial);
  const writes = [];
  return {
    data,
    writes,
    async get(key) {
      return { [key]: structuredClone(data[key]) };
    },
    async set(values) {
      writes.push(structuredClone(values));
      Object.assign(data, structuredClone(values));
    }
  };
}

const customPreference = (customFamilies) => ({
  version: APPEARANCE_SCHEMA_VERSION,
  mode: AppearanceMode.CUSTOM,
  customFamilies
});

test("defines an immutable versioned default preference", () => {
  assert.deepEqual(DEFAULT_APPEARANCE, {
    version: 1,
    mode: "default",
    customFamilies: []
  });
  assert.equal(Object.isFrozen(DEFAULT_APPEARANCE), true);
  assert.equal(Object.isFrozen(DEFAULT_APPEARANCE.customFamilies), true);
  assert.notEqual(APPEARANCE_STORAGE_KEY, "byokTranslatorState");
});

test("normalizes custom family whitespace and removes duplicates", () => {
  assert.deepEqual(
    validateAppearancePreference(
      customPreference([
        "  Maple   Mono NF CN ",
        "Noto Sans CJK SC",
        "maple mono nf cn"
      ])
    ),
    {
      version: 1,
      mode: "custom",
      customFamilies: ["Maple Mono NF CN", "Noto Sans CJK SC"]
    }
  );
});

test("supports default and Maple Mono modes without custom families", () => {
  assert.deepEqual(
    validateAppearancePreference({ version: 1, mode: "default" }),
    DEFAULT_APPEARANCE
  );
  assert.deepEqual(
    validateAppearancePreference({
      version: 1,
      mode: "maple-mono",
      customFamilies: []
    }),
    { version: 1, mode: "maple-mono", customFamilies: [] }
  );
});

test("strict validation rejects unsafe CSS, URL, data, and path inputs", () => {
  const unsafeFamilies = [
    "url(https://example.com/font.woff2)",
    "@font-face",
    "var(--website-font)",
    "Maple Mono; color: red",
    "Maple { Mono }",
    "data:font/woff2;base64,AAAA",
    "/Users/me/font.ttf",
    String.raw`C:\Windows\Fonts\font.ttf`,
    "Maple\u0000Mono"
  ];

  for (const family of unsafeFamilies) {
    assert.throws(
      () => validateAppearancePreference(customPreference([family])),
      /字体/u,
      family
    );
  }
});

test("strict validation rejects malformed structure and bounded-list violations", () => {
  const invalidPreferences = [
    null,
    { version: 2, mode: "default", customFamilies: [] },
    { version: 1, mode: "unknown", customFamilies: [] },
    { version: 1, mode: "default", customFamilies: ["Maple Mono"] },
    customPreference([]),
    customPreference(["a", "b", "c", "d", "e"]),
    customPreference(["x".repeat(81)]),
    { ...customPreference(["Maple Mono"]), css: "color:red" }
  ];

  for (const preference of invalidPreferences) {
    assert.throws(() => validateAppearancePreference(preference));
  }
});

test("non-strict normalization returns a fresh default for invalid values", () => {
  const normalized = normalizeAppearancePreference({
    version: 99,
    mode: "custom",
    customFamilies: ["url(https://example.com/font.woff2)"]
  });

  assert.deepEqual(normalized, DEFAULT_APPEARANCE);
  assert.notEqual(normalized, DEFAULT_APPEARANCE);
  assert.notEqual(normalized.customFamilies, DEFAULT_APPEARANCE.customFamilies);
});

test("generates deterministic quoted Maple Mono body and mono stacks", () => {
  const stacks = resolveFontStacks({
    version: 1,
    mode: "maple-mono",
    customFamilies: []
  });

  assert.match(stacks.body, /^"Maple Mono NF CN", "Maple Mono"/u);
  assert.match(stacks.body, /"PingFang SC"/u);
  assert.match(stacks.body, /sans-serif$/u);
  assert.match(stacks.mono, /^"Maple Mono NF CN", "Maple Mono"/u);
  assert.match(stacks.mono, /"SFMono-Regular"/u);
  assert.match(stacks.mono, /monospace$/u);
});

test("quotes and escapes every custom family instead of accepting raw CSS", () => {
  const stacks = resolveFontStacks(
    customPreference(['Family "Quoted"', "Noto Sans CJK SC"])
  );

  assert.match(stacks.body, /^"Family \\"Quoted\\"", "Noto Sans CJK SC"/u);
  assert.match(stacks.mono, /^"Family \\"Quoted\\"", "Noto Sans CJK SC"/u);
  assert.deepEqual(resolveFontStacks(DEFAULT_APPEARANCE), {
    body: null,
    mono: null
  });
});

test("public preference contains only safe schema fields and returns copies", () => {
  const publicPreference = toPublicAppearancePreference(
    customPreference(["Maple Mono NF CN"])
  );
  assert.deepEqual(Object.keys(publicPreference), [
    "version",
    "mode",
    "customFamilies"
  ]);
  publicPreference.customFamilies.push("mutated");
  assert.deepEqual(
    toPublicAppearancePreference(customPreference(["Maple Mono NF CN"]))
      .customFamilies,
    ["Maple Mono NF CN"]
  );
});

test("repository uses one isolated local key and preserves the last valid value", async () => {
  const storage = createMemoryStorage({
    byokTranslatorState: {
      providers: [{ id: "secret", apiKey: "do-not-touch" }]
    }
  });
  const repository = createAppearanceRepository(storage);

  const saved = await repository.savePreference(
    customPreference(["Maple Mono NF CN"])
  );
  assert.deepEqual(saved.customFamilies, ["Maple Mono NF CN"]);
  assert.deepEqual(storage.writes, [
    {
      [APPEARANCE_STORAGE_KEY]: {
        version: 1,
        mode: "custom",
        customFamilies: ["Maple Mono NF CN"]
      }
    }
  ]);
  assert.equal(
    storage.data.byokTranslatorState.providers[0].apiKey,
    "do-not-touch"
  );

  await assert.rejects(() =>
    repository.savePreference(customPreference(["url(evil)"]))
  );
  assert.deepEqual((await repository.getPreference()).customFamilies, [
    "Maple Mono NF CN"
  ]);
});

test("repository falls back to default for missing, corrupted, or unknown data", async () => {
  for (const storedValue of [
    undefined,
    "corrupted",
    { version: 99, mode: "maple-mono", customFamilies: [] },
    customPreference(["file:///tmp/font.ttf"])
  ]) {
    const storage = createMemoryStorage({
      [APPEARANCE_STORAGE_KEY]: storedValue
    });
    assert.deepEqual(
      await createAppearanceRepository(storage).getPreference(),
      DEFAULT_APPEARANCE
    );
    assert.equal(storage.writes.length, 0);
  }
});

test("repository requires a compatible local storage area", () => {
  assert.throws(() => createAppearanceRepository());
  assert.throws(() => createAppearanceRepository({ get() {} }));
});
