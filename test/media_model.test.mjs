import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustRgb,
  fitRect,
  normalizeMediaControls,
} from "../public/media_model.js";

test("calculates contain, cover, and stretch rectangles", () => {
  assert.deepEqual(fitRect(1920, 1080, 24, 32, "contain"), {
    x: 0,
    y: 9.25,
    width: 24,
    height: 13.5,
  });
  assert.deepEqual(fitRect(1920, 1080, 24, 32, "cover"), {
    x: -16.444444444444446,
    y: 0,
    width: 56.88888888888889,
    height: 32,
  });
  assert.deepEqual(fitRect(1920, 1080, 24, 32, "stretch"), {
    x: 0,
    y: 0,
    width: 24,
    height: 32,
  });
});

test("adjusts saturation, contrast, brightness, and gamma safely", () => {
  assert.deepEqual(
    adjustRgb([100, 150, 200], {
      brightness: 1,
      contrast: 1,
      saturation: 0,
      gamma: 1,
    }),
    [143, 143, 143],
  );
  assert.deepEqual(
    adjustRgb([100, 150, 200], {
      brightness: 2,
      contrast: 1,
      saturation: 1,
      gamma: 1,
    }),
    [200, 255, 255],
  );
});

test("normalizes media control boundaries", () => {
  assert.deepEqual(
    normalizeMediaControls({
      fit: "bad",
      sampling: "bad",
      saturation: 300,
      contrast: -2,
      brightness: 0,
      gamma: 5,
    }),
    {
      fit: "cover",
      sampling: "smooth",
      saturation: 2,
      contrast: 0,
      brightness: 0.1,
      gamma: 2,
    },
  );
});
