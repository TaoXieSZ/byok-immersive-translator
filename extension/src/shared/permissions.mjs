import {
  getProviderOriginPattern,
  normalizeBaseUrl
} from "./provider-config.mjs";

export async function requestProviderPermission(baseUrl) {
  const origin = getProviderOriginPattern(baseUrl);
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`未获得访问 ${new URL(normalizeBaseUrl(baseUrl)).origin} 的权限。`);
  }
  return origin;
}

export async function removeUnusedProviderPermission(
  removedBaseUrl,
  remainingProviders
) {
  const removedPattern = getProviderOriginPattern(removedBaseUrl);
  const stillUsed = remainingProviders.some(
    (provider) => getProviderOriginPattern(provider.baseUrl) === removedPattern
  );
  if (!stillUsed) {
    await chrome.permissions.remove({ origins: [removedPattern] });
  }
}
