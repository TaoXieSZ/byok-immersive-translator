(async () => {
  if (globalThis.__BYOK_TRANSLATOR_BOOTSTRAPPED__) {
    return;
  }
  globalThis.__BYOK_TRANSLATOR_BOOTSTRAPPED__ = true;

  try {
    const moduleUrl = chrome.runtime.getURL("src/content/main.mjs");
    const { installContentController } = await import(moduleUrl);
    installContentController();
  } catch (error) {
    globalThis.__BYOK_TRANSLATOR_BOOTSTRAPPED__ = false;
    console.error("BYOK Translator failed to start.", error);
  }
})();
