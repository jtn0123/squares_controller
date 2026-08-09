import assert from "node:assert/strict";
import test from "node:test";

import {
  FRAME_INTERVAL_MS,
  alignFrameTime,
  nextFrameDeadline,
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

