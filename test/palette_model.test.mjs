import assert from "node:assert/strict";
import test from "node:test";

import {
  CURATED_PALETTES,
  normalizePalette,
  normalizeSavedPalette,
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
  // Stops themselves are reproduced exactly: black, red, and white all
  // sit on the saturation transform's fixed points.
  assert.deepEqual(sampleGradient(colors, 0), [0, 0, 0]);
  assert.deepEqual(sampleGradient(colors, 0.5), [255, 0, 0]);
  assert.deepEqual(sampleGradient(colors, 1), [0, 0, 0]);
  // Midway out of black stays a pure red hue rather than fading up
  // through pink, and midway into white stays a tint of the same hue.
  assert.deepEqual(sampleGradient(colors, 0.25), [236, 0, 0]);
  assert.deepEqual(sampleGradient(colors, -0.25), [255, 82, 82]);
});

test("gradient midpoints stay saturated instead of washing to grey", () => {
  // Straight RGB interpolation used to drag this midpoint toward a pale
  // green; hue-space blending keeps it a real colour.
  const midpoint = sampleGradient(["#d9ff5b", "#57e6d5"], 0.5);
  const [min, max] = [Math.min(...midpoint), Math.max(...midpoint)];
  assert.ok(max > 0, "midpoint went black");
  const saturation = (max - min) / max;
  assert.ok(
    saturation > 0.8,
    `midpoint saturation ${saturation.toFixed(2)} is washed out`,
  );
});

test("a ramp out of black keeps the other stop's hue", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff"]) {
    const quarter = sampleGradient(["#000000", hex], 0.25);
    const zeroes = quarter.filter((channel) => channel === 0).length;
    assert.equal(
      zeroes,
      2,
      `${hex} ramp picked up other channels: ${quarter}`,
    );
  }
});

test("normalizes saved palettes and falls back safely", () => {
  assert.deepEqual(
    normalizePalette({ id: "custom", colors: ["#123456", "#abcdef", "bad"] }),
    { id: "custom", colors: ["#123456", "#abcdef"] },
  );
  assert.deepEqual(normalizePalette(null), CURATED_PALETTES[0]);
});

test("normalizes named reusable palettes with up to eight stops", () => {
  assert.deepEqual(
    normalizeSavedPalette({
      id: "northern-lights",
      name: " Northern lights ",
      colors: [
        "#001122",
        "#22ccaa",
        "#8855ff",
        "#ffffff",
        "#123456",
        "#234567",
        "#345678",
        "#456789",
        "#abcdef",
      ],
    }),
    {
      id: "northern-lights",
      name: "NORTHERN LIGHTS",
      colors: [
        "#001122",
        "#22ccaa",
        "#8855ff",
        "#ffffff",
        "#123456",
        "#234567",
        "#345678",
        "#456789",
      ],
    },
  );
  assert.equal(normalizeSavedPalette({ id: "bad", name: "", colors: [] }), null);
});
