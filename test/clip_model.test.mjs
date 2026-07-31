import assert from "node:assert/strict";
import test from "node:test";

import {
  clipFrameIndex,
  normalizeClip,
  normalizeClipFrame,
} from "../public/clip_model.js";

test("normalizes bounded pixel frames and durations", () => {
  const frame = normalizeClipFrame(
    { pixels: [-5, 20.4, 999, 4, 5, 6], duration: 9_000 },
    6,
  );
  assert.deepEqual(Array.from(frame.pixels), [0, 20, 255, 4, 5, 6]);
  assert.equal(frame.duration, 2_000);
  assert.equal(normalizeClipFrame({ pixels: [1, 2] }, 6), null);
});

test("caps clips at thirty-two valid frames", () => {
  const source = Array.from({ length: 40 }, (_, index) => ({
    pixels: [index, 0, 0],
    duration: index === 0 ? 10 : 100,
  }));
  const frames = normalizeClip(source, 3);
  assert.equal(frames.length, 32);
  assert.equal(frames[0].duration, 25);
  assert.deepEqual(Array.from(frames.at(-1).pixels), [31, 0, 0]);
});

test("selects variable-duration frames on a looping clock", () => {
  const frames = [
    { duration: 100 },
    { duration: 250 },
    { duration: 50 },
  ];
  assert.equal(clipFrameIndex(frames, 0), 0);
  assert.equal(clipFrameIndex(frames, 99), 0);
  assert.equal(clipFrameIndex(frames, 100), 1);
  assert.equal(clipFrameIndex(frames, 349), 1);
  assert.equal(clipFrameIndex(frames, 350), 2);
  assert.equal(clipFrameIndex(frames, 400), 0);
  assert.equal(clipFrameIndex([], 100), -1);
});
