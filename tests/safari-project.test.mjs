import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL(
  "../platforms/safari/BYOK Immersive Translator/",
  import.meta.url
);
const manifest = JSON.parse(
  await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8")
);

test("Safari 工程共享 WebExtension 源码并锁定 Safari 16.4 基线", async () => {
  const project = await readFile(
    new URL(
      "BYOK Immersive Translator.xcodeproj/project.pbxproj",
      projectRoot
    ),
    "utf8"
  );

  assert.match(project, /path = \.\.\/\.\.\/\.\.\/\.\.\/extension\/manifest\.json/u);
  assert.match(project, /path = \.\.\/\.\.\/\.\.\/\.\.\/extension\/src/u);
  assert.match(project, /path = \.\.\/\.\.\/\.\.\/\.\.\/extension\/assets/u);
  assert.doesNotMatch(project, /\/Users\//u);
  assert.doesNotMatch(project, /MACOSX_DEPLOYMENT_TARGET = (?:10\.14|26\.4)/u);
  assert.equal(
    [...project.matchAll(/MACOSX_DEPLOYMENT_TARGET = 13\.3/gu)].length,
    4
  );
  assert.equal(
    manifest.browser_specific_settings.safari.strict_min_version,
    "16.4"
  );
});

test("Safari App 与 Extension bundle ID 保持可嵌入关系", async () => {
  const project = await readFile(
    new URL(
      "BYOK Immersive Translator.xcodeproj/project.pbxproj",
      projectRoot
    ),
    "utf8"
  );

  assert.match(
    project,
    /PRODUCT_BUNDLE_IDENTIFIER = "com\.taoxie\.byok-immersive-translator"/u
  );
  assert.match(
    project,
    /PRODUCT_BUNDLE_IDENTIFIER = "com\.taoxie\.byok-immersive-translator\.Extension"/u
  );
});

test("Safari 容器提供中文启用入口且不处理翻译凭据", async () => {
  const html = await readFile(
    new URL(
      "BYOK Immersive Translator/Resources/Base.lproj/Main.html",
      projectRoot
    ),
    "utf8"
  );
  const swift = await readFile(
    new URL("BYOK Immersive Translator/ViewController.swift", projectRoot),
    "utf8"
  );

  assert.match(html, /打开 Safari 扩展设置/u);
  assert.match(swift, /SFSafariExtensionManager/u);
  assert.doesNotMatch(
    `${html}\n${swift}`,
    /apiKey|localStorage|Keychain|type=["']password["']/u
  );
});
