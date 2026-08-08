import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRepository } from "../extension/src/shared/provider-store.mjs";

function createMemoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    }
  };
}

test("creates, selects, updates, and deletes provider records", async () => {
  const storage = createMemoryStorage();
  const repository = createProviderRepository(storage);
  const first = { id: "a", apiKey: "one" };
  const second = { id: "b", apiKey: "two" };

  await repository.saveProvider(first);
  await repository.saveProvider(second, { select: false });
  assert.equal((await repository.getSelectedProvider()).id, "a");

  await repository.selectProvider("b");
  assert.equal((await repository.getSelectedProvider()).apiKey, "two");

  await repository.saveProvider({ ...second, apiKey: "updated" });
  assert.equal((await repository.getSelectedProvider()).apiKey, "updated");

  const state = await repository.deleteProvider("b");
  assert.equal(state.providers.length, 1);
  assert.equal(state.selectedProviderId, "a");
  assert.equal("sync" in storage.data, false);
});

test("persists migration of retired official DeepSeek model aliases", async () => {
  const storage = createMemoryStorage();
  storage.data.byokTranslatorState = {
    providers: [{
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "secret",
      model: "deepseek-chat"
    }],
    selectedProviderId: "deepseek"
  };
  const repository = createProviderRepository(storage);

  const state = await repository.getState();

  assert.equal(state.providers[0].name, "DeepSeek V4 Flash");
  assert.equal(state.providers[0].model, "deepseek-v4-flash");
  assert.equal(
    storage.data.byokTranslatorState.providers[0].model,
    "deepseek-v4-flash"
  );
});
