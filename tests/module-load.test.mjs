import test from "node:test";
import assert from "node:assert/strict";

test("shared modules load without runtime dependencies", async () => {
  const modules = await Promise.all([
    import("../extension/src/shared/messages.mjs"),
    import("../extension/src/shared/provider-config.mjs"),
    import("../extension/src/shared/provider-store.mjs"),
    import("../extension/src/shared/batching.mjs"),
    import("../extension/src/shared/openai-adapter.mjs"),
    import("../extension/src/shared/session-state.mjs"),
    import("../extension/src/shared/permissions.mjs"),
    import("../extension/src/shared/content-script-registration.mjs"),
    import("../extension/src/shared/translation-format.mjs"),
    import("../extension/src/shared/translation-cache.mjs"),
    import("../extension/src/content/selection-snapshot.mjs"),
    import("../extension/src/content/magic-lens-controller.mjs")
  ]);
  assert.equal(modules.length, 12);
});
