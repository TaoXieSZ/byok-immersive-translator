import {
  hasPageAccess,
  PAGE_ACCESS_ORIGINS
} from "./permissions.mjs";

export const PERSISTENT_CONTENT_SCRIPT_ID =
  "byok-immersive-translator-controller";

export const PERSISTENT_CONTENT_SCRIPT = Object.freeze({
  id: PERSISTENT_CONTENT_SCRIPT_ID,
  matches: PAGE_ACCESS_ORIGINS,
  excludeMatches: Object.freeze([
    "https://chrome.google.com/webstore/*",
    "https://chromewebstore.google.com/*",
    "https://microsoftedge.microsoft.com/addons/*"
  ]),
  js: Object.freeze(["src/content/bootstrap.js"]),
  css: Object.freeze(["src/content/content.css"]),
  allFrames: false,
  persistAcrossSessions: true,
  runAt: "document_idle",
  world: "ISOLATED"
});

function toRegistration() {
  return {
    ...PERSISTENT_CONTENT_SCRIPT,
    matches: [...PERSISTENT_CONTENT_SCRIPT.matches],
    excludeMatches: [...PERSISTENT_CONTENT_SCRIPT.excludeMatches],
    js: [...PERSISTENT_CONTENT_SCRIPT.js],
    css: [...PERSISTENT_CONTENT_SCRIPT.css]
  };
}

function sameStrings(actual = [], expected = []) {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

export function isPersistentRegistrationCurrent(registration) {
  return Boolean(
    registration?.id === PERSISTENT_CONTENT_SCRIPT.id &&
      sameStrings(registration.matches, PERSISTENT_CONTENT_SCRIPT.matches) &&
      sameStrings(
        registration.excludeMatches,
        PERSISTENT_CONTENT_SCRIPT.excludeMatches
      ) &&
      sameStrings(registration.js, PERSISTENT_CONTENT_SCRIPT.js) &&
      sameStrings(registration.css, PERSISTENT_CONTENT_SCRIPT.css) &&
      registration.allFrames !== true &&
      registration.persistAcrossSessions !== false &&
      (registration.runAt ?? "document_idle") ===
        PERSISTENT_CONTENT_SCRIPT.runAt &&
      (registration.world ?? "ISOLATED") === PERSISTENT_CONTENT_SCRIPT.world
  );
}

async function performSync({
  scriptingApi = chrome.scripting,
  permissionsApi = chrome.permissions
} = {}) {
  const authorized = await hasPageAccess(permissionsApi);
  const [existing] = await scriptingApi.getRegisteredContentScripts({
    ids: [PERSISTENT_CONTENT_SCRIPT_ID]
  });

  if (!authorized) {
    if (existing) {
      await scriptingApi.unregisterContentScripts({
        ids: [PERSISTENT_CONTENT_SCRIPT_ID]
      });
      return { authorized: false, registered: false, changed: true };
    }
    return { authorized: false, registered: false, changed: false };
  }

  if (isPersistentRegistrationCurrent(existing)) {
    return { authorized: true, registered: true, changed: false };
  }

  if (existing) {
    await scriptingApi.unregisterContentScripts({
      ids: [PERSISTENT_CONTENT_SCRIPT_ID]
    });
  }
  await scriptingApi.registerContentScripts([toRegistration()]);
  return { authorized: true, registered: true, changed: true };
}

let syncQueue = Promise.resolve();

export function syncPersistentContentScript(options = {}) {
  const operation = syncQueue.then(() => performSync(options));
  syncQueue = operation.catch(() => {});
  return operation;
}
