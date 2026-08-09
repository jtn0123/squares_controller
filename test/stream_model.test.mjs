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
      actualFps: 37.48,
      sentFrames: 100,
      uniqueFrames: 90,
      repeatedFrames: 10,
      lateFrames: 2,
      missedDeadlines: 0,
      p95GapMs: 27.1,
      maxGapMs: 29.4,
      p95LatenessMs: 0.8,
    }),
    {
      targetFps: 37.5,
      actualFps: 37.48,
      sentFrames: 100,
      uniqueFrames: 90,
      repeatedFrames: 10,
      lateFrames: 2,
      missedDeadlines: 0,
      p95GapMs: 27.1,
      maxGapMs: 29.4,
      p95LatenessMs: 0.8,
    },
  );
});

test("classifies idle, locked, and missed-deadline relay states", () => {
  assert.equal(streamHealth({ sentFrames: 0 }), "idle");
  assert.equal(
    streamHealth({
      sentFrames: 100,
      targetFps: 37.5,
      actualFps: 37.4,
      missedDeadlines: 0,
    }),
    "locked",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      targetFps: 37.5,
      actualFps: 37.5,
      p95GapMs: 31,
    }),
    "locked",
    "scheduling jitter within one frame period is healthy",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      targetFps: 40,
      actualFps: 40,
      p95GapMs: 50,
    }),
    "locked",
    "a gap of exactly twice the frame period is still healthy",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      targetFps: 40,
      actualFps: 40,
      p95GapMs: 50.1,
    }),
    "warning",
    "gaps beyond twice the frame period need attention",
  );
  assert.equal(
    streamHealth({
      sentFrames: 100,
      targetFps: 37.5,
      actualFps: 36.8,
      missedDeadlines: 1,
    }),
    "warning",
  );
});
