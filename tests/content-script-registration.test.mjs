import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSISTENT_CONTENT_SCRIPT,
  PERSISTENT_CONTENT_SCRIPT_ID,
  syncPersistentContentScript
} from "../extension/src/shared/content-script-registration.mjs";

function createPermissionsApi(authorized) {
  return {
    async contains() {
      return authorized;
    }
  };
}

function createScriptingApi(initialRegistration = null) {
  let registration = initialRegistration;
  const calls = [];
  return {
    calls,
    async getRegisteredContentScripts(filter) {
      calls.push(["get", filter]);
      return registration ? [structuredClone(registration)] : [];
    },
    async registerContentScripts(scripts) {
      calls.push(["register", structuredClone(scripts)]);
      registration = structuredClone(scripts[0]);
    },
    async unregisterContentScripts(filter) {
      calls.push(["unregister", filter]);
      registration = null;
    }
  };
}

test("registers one persistent content script and is idempotent", async () => {
  const scriptingApi = createScriptingApi();
  const options = {
    scriptingApi,
    permissionsApi: createPermissionsApi(true)
  };

  assert.deepEqual(await syncPersistentContentScript(options), {
    authorized: true,
    registered: true,
    changed: true
  });
  assert.deepEqual(await syncPersistentContentScript(options), {
    authorized: true,
    registered: true,
    changed: false
  });

  const registrations = scriptingApi.calls.filter(([name]) => name === "register");
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][1][0].id, PERSISTENT_CONTENT_SCRIPT_ID);
  assert.equal(registrations[0][1][0].persistAcrossSessions, true);
});

test("serializes concurrent synchronization without duplicate IDs", async () => {
  const scriptingApi = createScriptingApi();
  const options = {
    scriptingApi,
    permissionsApi: createPermissionsApi(true)
  };

  const results = await Promise.all([
    syncPersistentContentScript(options),
    syncPersistentContentScript(options)
  ]);

  assert.deepEqual(results, [
    { authorized: true, registered: true, changed: true },
    { authorized: true, registered: true, changed: false }
  ]);
  assert.equal(
    scriptingApi.calls.filter(([name]) => name === "register").length,
    1
  );
});

test("repairs stale registration and unregisters when access is absent", async () => {
  const stale = {
    ...PERSISTENT_CONTENT_SCRIPT,
    js: ["old-bootstrap.js"]
  };
  const scriptingApi = createScriptingApi(stale);

  assert.deepEqual(
    await syncPersistentContentScript({
      scriptingApi,
      permissionsApi: createPermissionsApi(true)
    }),
    { authorized: true, registered: true, changed: true }
  );
  assert.deepEqual(
    scriptingApi.calls.map(([name]) => name),
    ["get", "unregister", "register"]
  );

  assert.deepEqual(
    await syncPersistentContentScript({
      scriptingApi,
      permissionsApi: createPermissionsApi(false)
    }),
    { authorized: false, registered: false, changed: true }
  );
  assert.equal(
    scriptingApi.calls.filter(([name]) => name === "unregister").length,
    2
  );
});

test("does not register without website access", async () => {
  const scriptingApi = createScriptingApi();
  assert.deepEqual(
    await syncPersistentContentScript({
      scriptingApi,
      permissionsApi: createPermissionsApi(false)
    }),
    { authorized: false, registered: false, changed: false }
  );
  assert.deepEqual(
    scriptingApi.calls.map(([name]) => name),
    ["get"]
  );
});
