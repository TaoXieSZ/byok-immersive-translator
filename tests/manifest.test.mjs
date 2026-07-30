import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8")
);

test("declares optional page access without requiring broad host access", () => {
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://*/*",
    "http://*/*"
  ]);
  assert.equal("host_permissions" in manifest, false);
  assert.equal(manifest.permissions.includes("activeTab"), true);
});

test("declares translation commands with suggested shortcuts", () => {
  assert.deepEqual(manifest.commands, {
    "toggle-translation": {
      suggested_key: "Alt+A",
      description: "开始翻译，或在原文与译文之间切换"
    },
    "translate-whole-page": {
      suggested_key: "Alt+W",
      description: "翻译整个页面"
    }
  });
});

test("ships one B2 brand source and matching manifest PNG dimensions", async () => {
  assert.deepEqual(manifest.action.default_icon, manifest.icons);

  const brandSource = await readFile(
    new URL("../extension/assets/brand/translator-mark.svg", import.meta.url),
    "utf8"
  );
  assert.match(brandSource, /data-icon="brand-b2"/u);
  assert.match(brandSource, /data-role="source-page"/u);
  assert.match(brandSource, /data-role="translation-page"/u);
  assert.match(brandSource, /data-role="translation-bridge"/u);

  for (const [declaredSize, relativePath] of Object.entries(manifest.icons)) {
    const png = await readFile(
      new URL(`../extension/${relativePath}`, import.meta.url)
    );
    const size = Number(declaredSize);
    assert.deepEqual([...png.subarray(0, 8)], [
      137, 80, 78, 71, 13, 10, 26, 10
    ]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
