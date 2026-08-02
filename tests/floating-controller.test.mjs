import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ControllerStatus,
  getLauncherIntent
} from "../extension/src/content/floating-controller.mjs";

test("idle launcher starts immediately while starting clicks are ignored", () => {
  assert.equal(getLauncherIntent(ControllerStatus.IDLE), "start");
  assert.equal(getLauncherIntent(ControllerStatus.STARTING), "ignore");
});

test("active and terminal launcher states restore the original page", () => {
  for (const status of [
    ControllerStatus.TRANSLATING,
    ControllerStatus.STOPPED,
    ControllerStatus.COMPLETED,
    ControllerStatus.COMPLETED_WITH_ERRORS
  ]) {
    assert.equal(getLauncherIntent(status), "restore");
  }
});

test("uses B2 for panel branding and A3 for the floating translation action", async () => {
  const source = await readFile(
    new URL(
      "../extension/src/content/floating-controller.mjs",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /data-icon="brand-b2"/u);
  assert.match(source, /data-icon="floating-a3"/u);
  assert.match(source, />好<\/text>/u);
  assert.match(
    source,
    /class="panel__mark">\$\{BRAND_MARK_SVG\}<\/span>/u
  );
  assert.match(
    source,
    /class="launcher__inner">\$\{FLOATING_ACTION_SVG\}<\/span>/u
  );
});
