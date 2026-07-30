import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTargetLanguage,
  countUnicodeScripts,
  shouldSkipTargetLanguage
} from "../extension/src/shared/language-detection.mjs";

test("skips long high-confidence target-language text across scripts", () => {
  assert.equal(
    shouldSkipTargetLanguage("这是一个已经主要使用简体中文书写的完整段落。", "zh-CN"),
    true
  );
  assert.equal(
    shouldSkipTargetLanguage("これはすでに日本語で書かれている長い文章です。", "ja"),
    true
  );
  assert.equal(
    shouldSkipTargetLanguage("이 문장은 이미 한국어로 작성되어 있습니다.", "ko"),
    true
  );
  assert.equal(
    shouldSkipTargetLanguage("Этот абзац уже полностью написан по-русски.", "ru"),
    true
  );
});

test("keeps short and mixed-script text conservative", () => {
  assert.equal(shouldSkipTargetLanguage("你好", "zh-CN"), false);
  assert.equal(
    shouldSkipTargetLanguage("这是中文 paragraph with enough English mixed in.", "zh-CN"),
    false
  );
  assert.equal(
    shouldSkipTargetLanguage("日本語と English text are mixed together here.", "ja"),
    false
  );
});

test("does not confuse Japanese kana with Chinese target text", () => {
  const result = analyzeTargetLanguage(
    "これは日本語で書かれている十分に長い文章です。",
    "简体中文"
  );
  assert.equal(result.confident, false);
  assert.ok(countUnicodeScripts("汉字かなカナ").counts.hiragana > 0);
});
