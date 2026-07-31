import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTransition,
  transitionFrame,
} from "../public/transition_model.js";

const from = new Uint8Array([
  0, 0, 0,
  100, 100, 100,
  200, 200, 200,
  255, 255, 255,
]);
const to = new Uint8Array([
  255, 0, 0,
  0, 255, 0,
  0, 0, 255,
  20, 40, 60,
]);

test("crossfades RGB channels", () => {
  assert.deepEqual(
    Array.from(transitionFrame(from, to, 2, 2, "crossfade", 0.5)),
    [128, 0, 0, 50, 178, 50, 100, 100, 228, 138, 148, 158],
  );
});

test("push reveals the destination from left to right", () => {
  assert.deepEqual(
    Array.from(transitionFrame(from, to, 2, 2, "push", 0.5)),
    [
      255, 0, 0,
      0, 0, 0,
      0, 0, 255,
      200, 200, 200,
    ],
  );
});

test("dissolve is deterministic and reaches both endpoints", () => {
  assert.deepEqual(transitionFrame(from, to, 2, 2, "dissolve", 0), from);
  assert.deepEqual(transitionFrame(from, to, 2, 2, "dissolve", 1), to);
  assert.deepEqual(
    transitionFrame(from, to, 2, 2, "dissolve", 0.4),
    transitionFrame(from, to, 2, 2, "dissolve", 0.4),
  );
});

test("wipe and radial transitions reveal spatial regions", () => {
  assert.deepEqual(
    Array.from(transitionFrame(from, to, 2, 2, "wipe", 0.5)),
    [255, 0, 0, 100, 100, 100, 0, 0, 255, 255, 255, 255],
  );
  assert.deepEqual(
    Array.from(
      transitionFrame(
        new Uint8Array(27),
        new Uint8Array(27).fill(255),
        3,
        3,
        "radial",
        0.1,
      ),
    ),
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 255, 255, 255, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
  );
});

test("shift and pixelate transitions preserve frame dimensions", () => {
  for (const type of ["shift", "pixelate"]) {
    assert.equal(transitionFrame(from, to, 2, 2, type, 0.5).length, from.length);
  }
});

test("normalizes transition settings", () => {
  assert.deepEqual(normalizeTransition({ type: "push", duration: 9000 }), {
    type: "push",
    duration: 5000,
  });
  assert.deepEqual(normalizeTransition({ type: "bad", duration: -20 }), {
    type: "crossfade",
    duration: 0,
  });
});
