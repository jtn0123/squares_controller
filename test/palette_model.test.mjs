import assert from "node:assert/strict";
import test from "node:test";

import {
  CURATED_PALETTES,
  normalizePalette,
  sampleGradient,
} from "../public/palette_model.js";

test("ships a varied curated palette library", () => {
  assert.ok(CURATED_PALETTES.length >= 8);
  assert.equal(new Set(CURATED_PALETTES.map((palette) => palette.id)).size, CURATED_PALETTES.length);
  CURATED_PALETTES.forEach((palette) => {
    assert.ok(palette.colors.length >= 3);
    palette.colors.forEach((color) => assert.match(color, /^#[0-9a-f]{6}$/i));
  });
});

test("samples and wraps a multi-stop gradient", () => {
  const colors = ["#000000", "#ff0000", "#ffffff"];
  assert.deepEqual(sampleGradient(colors, 0), [0, 0, 0]);
  assert.deepEqual(sampleGradient(colors, 0.25), [128, 0, 0]);
  assert.deepEqual(sampleGradient(colors, 0.5), [255, 0, 0]);
  assert.deepEqual(sampleGradient(colors, 1), [0, 0, 0]);
  assert.deepEqual(sampleGradient(colors, -0.25), [255, 128, 128]);
});

test("normalizes saved palettes and falls back safely", () => {
  assert.deepEqual(
    normalizePalette({ id: "custom", colors: ["#123456", "#abcdef", "bad"] }),
    { id: "custom", colors: ["#123456", "#abcdef"] },
  );
  assert.deepEqual(normalizePalette(null), CURATED_PALETTES[0]);
});
