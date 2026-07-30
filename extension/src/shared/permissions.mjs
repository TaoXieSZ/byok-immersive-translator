import {
  getProviderOriginPattern,
  normalizeBaseUrl
} from "./provider-config.mjs";

export const PAGE_ACCESS_ORIGINS = Object.freeze([
  "http://*/*",
  "https://*/*"
]);

const RESTRICTED_WEB_ORIGINS = new Set([
  "https://chrome.google.com",
  "https://chromewebstore.google.com",
  "https://microsoftedge.microsoft.com"
]);

function getPermissionsApi(permissionsApi) {
  return permissionsApi ?? chrome.permissions;
}

export function isSupportedPageUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }
    if (RESTRICTED_WEB_ORIGINS.has(parsed.origin)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function hasPageAccess(permissionsApi) {
  return getPermissionsApi(permissionsApi).contains({
    origins: [...PAGE_ACCESS_ORIGINS]
  });
}

export async function requestPageAccess(permissionsApi) {
  return getPermissionsApi(permissionsApi).request({
    origins: [...PAGE_ACCESS_ORIGINS]
  });
}

export async function removePageAccess(permissionsApi) {
  return getPermissionsApi(permissionsApi).remove({
    origins: [...PAGE_ACCESS_ORIGINS]
  });
}

export async function requestProviderPermission(baseUrl, permissionsApi) {
  const origin = getProviderOriginPattern(baseUrl);
  const granted = await getPermissionsApi(permissionsApi).request({
    origins: [origin]
  });
  if (!granted) {
    throw new Error(`未获得访问 ${new URL(normalizeBaseUrl(baseUrl)).origin} 的权限。`);
  }
  return origin;
}

export async function removeUnusedProviderPermission(
  removedBaseUrl,
  remainingProviders,
  permissionsApi
) {
  const removedPattern = getProviderOriginPattern(removedBaseUrl);
  const stillUsed = remainingProviders.some(
    (provider) => getProviderOriginPattern(provider.baseUrl) === removedPattern
  );
  if (!stillUsed) {
    await getPermissionsApi(permissionsApi).remove({
      origins: [removedPattern]
    });
  }
}
