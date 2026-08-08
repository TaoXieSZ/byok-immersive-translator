import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ControllerStatus,
  computeDockedFloatingControlPreference,
  getLauncherIntent,
  isLauncherDragIntent,
  moveFloatingControlPreferenceWithKeyboard,
  resolveFloatingControlLayout,
  resolveFloatingPanelLayout,
  shouldSuppressLauncherClickAfterPointer
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

test("drag intent requires movement beyond the click-safety threshold", () => {
  const start = { x: 100, y: 100 };
  assert.equal(isLauncherDragIntent(start, { x: 106, y: 100 }), false);
  assert.equal(isLauncherDragIntent(start, { x: 106.1, y: 100 }), true);
  assert.equal(isLauncherDragIntent(start, { x: 103, y: 104 }), false);
  assert.equal(shouldSuppressLauncherClickAfterPointer({ moved: false }), false);
  assert.equal(shouldSuppressLauncherClickAfterPointer({ moved: true }), true);
});

test("pointer placement snaps to an edge and stays inside viewport margins", () => {
  const viewport = { width: 1000, height: 800 };
  const left = computeDockedFloatingControlPreference(
    { x: 100, y: 300 },
    viewport
  );
  assert.equal(left.edge, "left");
  assert.ok(left.verticalRatio > 0 && left.verticalRatio < 1);

  assert.deepEqual(
    computeDockedFloatingControlPreference({ x: 900, y: -100 }, viewport),
    { version: 1, edge: "right", verticalRatio: 0 }
  );
  assert.deepEqual(
    computeDockedFloatingControlPreference({ x: 900, y: 2_000 }, viewport),
    { version: 1, edge: "right", verticalRatio: 1 }
  );
});

test("saved ratios adapt to viewport size and keyboard movement remains bounded", () => {
  const viewport = { width: 1000, height: 800 };
  const preference = { version: 1, edge: "right", verticalRatio: 0.5 };
  assert.deepEqual(resolveFloatingControlLayout(preference, viewport), {
    edge: "right",
    top: 371,
    margin: 20
  });
  assert.equal(
    moveFloatingControlPreferenceWithKeyboard(
      preference,
      "ArrowLeft",
      viewport
    ).edge,
    "left"
  );
  assert.ok(
    moveFloatingControlPreferenceWithKeyboard(
      preference,
      "ArrowUp",
      viewport
    ).verticalRatio < preference.verticalRatio
  );
  assert.equal(
    moveFloatingControlPreferenceWithKeyboard(
      { ...preference, verticalRatio: 0 },
      "ArrowUp",
      viewport
    ).verticalRatio,
    0
  );
});

test("panel opens toward the larger space and remains bounded after resize", () => {
  assert.deepEqual(
    resolveFloatingPanelLayout({ top: 600, bottom: 658 }, 800),
    { placement: "above", maxHeight: 576 }
  );
  assert.deepEqual(
    resolveFloatingPanelLayout({ top: 40, bottom: 98 }, 800),
    { placement: "below", maxHeight: 678 }
  );
  assert.deepEqual(
    resolveFloatingPanelLayout({ top: 20, bottom: 78 }, 100),
    { placement: "above", maxHeight: 0 }
  );
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
  assert.match(source, /addEventListener\("pointerdown"/u);
  assert.match(source, /addEventListener\("pointermove"/u);
  assert.match(source, /suppressLauncherClickBriefly\(\)/u);
  assert.match(source, /FLOATING_CONTROL_CLICK_SUPPRESSION_MS/u);
  assert.match(source, /host\.dataset\.open === "true"/u);
  assert.match(source, /touch-action: none/u);
  assert.match(source, /Shift 加方向键/u);
});
