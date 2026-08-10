import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStreamTelemetry,
  streamHealth,
} from "../public/stream_model.js";

test("normalizes bounded relay telemetry", () => {
  assert.deepEqual(
    normalizeStreamTelemetry({
      targetFps: 37.5,
      actualFps: 36.02,
      uniqueFps: 35.99,
      sentFrames: 100,
      uniqueFrames: 96,
      repeatedFrames: 4,
      lateFrames: 2,
      missedDeadlines: 0,
      p95GapMs: 27.1,
      maxGapMs: 29.4,
      p95UniqueGapMs: 28.2,
      maxUniqueGapMs: 31.0,
      p95LatenessMs: 0.8,
    }),
    {
      targetFps: 37.5,
      actualFps: 36.02,
      uniqueFps: 35.99,
      sentFrames: 100,
      uniqueFrames: 96,
      repeatedFrames: 4,
      lateFrames: 2,
      missedDeadlines: 0,
      p95GapMs: 27.1,
      maxGapMs: 29.4,
      p95UniqueGapMs: 28.2,
      maxUniqueGapMs: 31.0,
      p95LatenessMs: 0.8,
    },
  );
});

test("classifies idle, held, streaming, and stuttering relay states", () => {
  assert.equal(streamHealth({ sentFrames: 0 }), "idle");
  assert.equal(
    streamHealth({ sentFrames: 100, uniqueFrames: 1, repeatedFrames: 99 }),
    "locked",
    "holding a static frame on keepalive repeats is healthy",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      uniqueFrames: 96,
      uniqueFps: 36,
      p95UniqueGapMs: 29,
    }),
    "locked",
    "scheduling jitter within one frame period is healthy",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      uniqueFrames: 96,
      uniqueFps: 40,
      p95UniqueGapMs: 50,
    }),
    "locked",
    "a fresh gap of exactly twice the average is still healthy",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      uniqueFrames: 96,
      uniqueFps: 40,
      p95UniqueGapMs: 50.1,
    }),
    "warning",
    "fresh gaps beyond twice the average read as stutter on the wall",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      uniqueFrames: 96,
      uniqueFps: 36,
      p95UniqueGapMs: 28,
      missedDeadlines: 1,
    }),
    "warning",
  );
});
