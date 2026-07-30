import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPageAccess,
  isSupportedPageUrl,
  PAGE_ACCESS_ORIGINS,
  removePageAccess,
  requestPageAccess
} from "../extension/src/shared/permissions.mjs";

function createPermissionsApi({ granted = false } = {}) {
  const calls = [];
  return {
    calls,
    async contains(permission) {
      calls.push(["contains", permission]);
      return granted;
    },
    async request(permission) {
      calls.push(["request", permission]);
      granted = true;
      return true;
    },
    async remove(permission) {
      calls.push(["remove", permission]);
      granted = false;
      return true;
    }
  };
}

test("requests, detects, and removes optional ordinary-page access", async () => {
  const permissions = createPermissionsApi();

  assert.equal(await hasPageAccess(permissions), false);
  assert.equal(await requestPageAccess(permissions), true);
  assert.equal(await hasPageAccess(permissions), true);
  assert.equal(await removePageAccess(permissions), true);
  assert.equal(await hasPageAccess(permissions), false);
  assert.deepEqual(
    permissions.calls.map(([, value]) => value.origins),
    Array(5).fill([...PAGE_ACCESS_ORIGINS])
  );
});

test("keeps activeTab fallback available when page access is refused", async () => {
  const calls = [];
  const permissions = {
    async request(permission) {
      calls.push(permission);
      return false;
    }
  };

  assert.equal(await requestPageAccess(permissions), false);
  assert.deepEqual(calls, [{ origins: [...PAGE_ACCESS_ORIGINS] }]);
});

test("allows ordinary HTTP pages and rejects restricted or invalid pages", () => {
  assert.equal(isSupportedPageUrl("https://example.com/article"), true);
  assert.equal(isSupportedPageUrl("http://localhost:3000/"), true);
  assert.equal(
    isSupportedPageUrl("https://chromewebstore.google.com/detail/example/id"),
    false
  );
  assert.equal(
    isSupportedPageUrl("https://microsoftedge.microsoft.com/addons/detail/x"),
    false
  );
  assert.equal(isSupportedPageUrl("chrome://extensions/"), false);
  assert.equal(isSupportedPageUrl("file:///tmp/article.html"), false);
  assert.equal(isSupportedPageUrl("not a url"), false);
});
