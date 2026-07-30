import assert from "node:assert/strict";
import test from "node:test";

import {
  BLEND_MODES,
  blendRgb,
  normalizeLayer,
} from "../public/blend_model.js";

test("supports practical light blending modes", () => {
  assert.deepEqual(BLEND_MODES.map((mode) => mode.id), [
    "normal",
    "add",
    "screen",
    "multiply",
    "difference",
  ]);
  assert.deepEqual(blendRgb([100, 150, 200], [50, 100, 150], "normal", 1), [50, 100, 150]);
  assert.deepEqual(blendRgb([100, 150, 200], [50, 100, 150], "add", 1), [150, 250, 255]);
  assert.deepEqual(blendRgb([100, 150, 200], [50, 100, 150], "multiply", 1), [20, 59, 118]);
  assert.deepEqual(blendRgb([100, 150, 200], [50, 100, 150], "difference", 1), [50, 50, 50]);
});

test("mixes the blended result by opacity", () => {
  assert.deepEqual(blendRgb([20, 40, 60], [220, 140, 60], "normal", 0.5), [120, 90, 60]);
  assert.deepEqual(blendRgb([20, 40, 60], [220, 140, 60], "normal", 0), [20, 40, 60]);
});

test("normalizes saved layer settings", () => {
  assert.deepEqual(
    normalizeLayer({ enabled: 1, effect: "orbit", blend: "screen", opacity: 150, paletteId: "ice" }),
    { enabled: true, effect: "orbit", blend: "screen", opacity: 100, paletteId: "ice" },
  );
  assert.deepEqual(
    normalizeLayer({ effect: "../bad", blend: "unknown", opacity: -5 }),
    { enabled: false, effect: "tide", blend: "normal", opacity: 0, paletteId: "acid" },
  );
});
