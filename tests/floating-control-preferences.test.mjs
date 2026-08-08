import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FLOATING_CONTROL_PREFERENCE,
  FLOATING_CONTROL_STORAGE_KEY,
  FloatingControlEdge,
  createFloatingControlRepository,
  normalizeFloatingControlPreference,
  validateFloatingControlPreference
} from "../extension/src/shared/floating-control-preferences.mjs";

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(key) {
      return { [key]: structuredClone(data[key]) };
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    }
  };
}

test("defines a bounded global floating-control preference", () => {
  assert.deepEqual(DEFAULT_FLOATING_CONTROL_PREFERENCE, {
    version: 1,
    edge: FloatingControlEdge.RIGHT,
    verticalRatio: 1
  });
  assert.equal(Object.isFrozen(DEFAULT_FLOATING_CONTROL_PREFERENCE), true);
  assert.notEqual(FLOATING_CONTROL_STORAGE_KEY, "byokTranslatorState");
});

test("normalizes corrupted positions and strictly rejects privileged fields", () => {
  for (const invalid of [
    null,
    { version: 1, edge: "center", verticalRatio: 0.5 },
    { version: 1, edge: "left", verticalRatio: -0.1 },
    { version: 1, edge: "right", verticalRatio: 1.1 },
    {
      version: 1,
      edge: "right",
      verticalRatio: 0.5,
      url: "https://private.example"
    }
  ]) {
    assert.deepEqual(
      normalizeFloatingControlPreference(invalid),
      DEFAULT_FLOATING_CONTROL_PREFERENCE
    );
    assert.throws(() => validateFloatingControlPreference(invalid));
  }
});

test("repository persists only a validated edge and vertical ratio", async () => {
  const storage = storageArea();
  const repository = createFloatingControlRepository(storage);
  const preference = {
    version: 1,
    edge: FloatingControlEdge.LEFT,
    verticalRatio: 0.35
  };

  assert.deepEqual(await repository.savePreference(preference), preference);
  assert.deepEqual(await repository.getPreference(), preference);
});
