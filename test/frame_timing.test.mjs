import assert from "node:assert/strict";
import test from "node:test";

import {
  FRAME_INTERVAL_MS,
  alignFrameTime,
  nextFrameDeadline,
  setUploadTargetFps,
  uploadInterval,
} from "../public/frame_timing.js";

test("aligns 60 Hz browser ticks to a 40 FPS frame clock", () => {
  let previous = 0;
  let frames = 0;

  for (let now = 1000 / 60; now <= 1000; now += 1000 / 60) {
    if (now - previous < FRAME_INTERVAL_MS) continue;
    previous = alignFrameTime(previous, now);
    frames += 1;
  }

  assert.equal(FRAME_INTERVAL_MS, 25);
  assert.ok(frames >= 39 && frames <= 40, `${frames} frames`);
});

test("upload deadlines correct timer drift and skip missed slots", () => {
  let deadline = nextFrameDeadline(0, 10);
  assert.equal(deadline, 35);

  deadline = nextFrameDeadline(deadline, 36.5);
  assert.equal(deadline, 60);

  deadline = nextFrameDeadline(deadline, 90);
  assert.equal(deadline, 115);
});

test("upload cadence paces just under the relay rate", () => {
  try {
    // A 37.5 fps relay means the browser should produce at 36 fps so
    // every frame ships and the relay pads with repeats, never drops.
    setUploadTargetFps(37.5);
    assert.equal(uploadInterval(), 1000 / 36);
    assert.equal(nextFrameDeadline(0, 10), 10 + 1000 / 36);

    // Never faster than the 40 fps ceiling, never slower than 10 fps.
    setUploadTargetFps(500);
    assert.equal(uploadInterval(), FRAME_INTERVAL_MS);
    setUploadTargetFps(4);
    assert.equal(uploadInterval(), 100);

    // Garbage rates leave the cadence unchanged.
    setUploadTargetFps(Number.NaN);
    assert.equal(uploadInterval(), 100);
    setUploadTargetFps(0);
    assert.equal(uploadInterval(), 100);

    // Callers can still pin an explicit interval.
    assert.equal(nextFrameDeadline(0, 10, 25), 35);
    assert.equal(alignFrameTime(0, 60, 25), 50);
  } finally {
    setUploadTargetFps(1000 / FRAME_INTERVAL_MS + 1.5);
    assert.equal(uploadInterval(), FRAME_INTERVAL_MS);
  }
});

