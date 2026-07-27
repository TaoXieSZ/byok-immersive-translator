const STORAGE_KEY = "byokTranslatorState";
const EMPTY_STATE = Object.freeze({
  providers: [],
  selectedProviderId: null
});

function copyState(state) {
  return {
    providers: Array.isArray(state?.providers)
      ? state.providers.map((provider) => ({ ...provider }))
      : [],
    selectedProviderId:
      typeof state?.selectedProviderId === "string"
        ? state.selectedProviderId
        : null
  };
}

export function createProviderRepository(storageArea) {
  if (!storageArea?.get || !storageArea?.set) {
    throw new Error("A compatible storage area is required.");
  }

  return {
    async getState() {
      const stored = await storageArea.get(STORAGE_KEY);
      return copyState(stored?.[STORAGE_KEY] ?? EMPTY_STATE);
    },

    async saveProvider(provider, { select = true } = {}) {
      const state = await this.getState();
      const index = state.providers.findIndex((item) => item.id === provider.id);
      if (index === -1) {
        state.providers.push({ ...provider });
      } else {
        state.providers[index] = { ...provider };
      }
      if (select) {
        state.selectedProviderId = provider.id;
      }
      await storageArea.set({ [STORAGE_KEY]: state });
      return copyState(state);
    },

    async deleteProvider(providerId) {
      const state = await this.getState();
      state.providers = state.providers.filter(
        (provider) => provider.id !== providerId
      );
      if (state.selectedProviderId === providerId) {
        state.selectedProviderId = state.providers[0]?.id ?? null;
      }
      await storageArea.set({ [STORAGE_KEY]: state });
      return copyState(state);
    },

    async selectProvider(providerId) {
      const state = await this.getState();
      if (!state.providers.some((provider) => provider.id === providerId)) {
        throw new Error("Provider does not exist.");
      }
      state.selectedProviderId = providerId;
      await storageArea.set({ [STORAGE_KEY]: state });
      return copyState(state);
    },

    async getSelectedProvider() {
      const state = await this.getState();
      return (
        state.providers.find(
          (provider) => provider.id === state.selectedProviderId
        ) ?? null
      );
    }
  };
}

export function createChromeProviderRepository() {
  return createProviderRepository(chrome.storage.local);
}

export async function restrictStorageToTrustedContexts() {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS"
    });
  }
}
