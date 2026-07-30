import {
  MessageType,
  TranslationScope,
  validateTranslationScope
} from "../shared/messages.mjs";

export function isSupportedPageUrl(url) {
  return /^https?:\/\//iu.test(url ?? "");
}
export function createStartPageMessage(scope = TranslationScope.MAIN_CONTENT) {
  if (!validateTranslationScope(scope)) {
    throw new Error("无效的翻译范围。");
  }
  return {
    type: MessageType.START_TRANSLATION,
    scope
  };
}
