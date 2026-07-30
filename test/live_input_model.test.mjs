import assert from "node:assert/strict";
import test from "node:test";

import {
  detectAudioBeat,
  measureAudioBands,
  normalizeAudioControls,
  renderAudioFrame,
} from "../public/live_input_model.js";

test("normalizes live audio controls to safe browser ranges", () => {
  assert.deepEqual(
    normalizeAudioControls({
      mode: "bad",
      sensitivity: 8,
      smoothing: -1,
    }),
    {
      mode: "spectrum",
      sensitivity: 4,
      smoothing: 0,
    },
  );
});

test("measures low, mid, and high frequency energy independently", () => {
  const bins = new Uint8Array(100);
  bins.fill(255, 0, 15);
  bins.fill(128, 15, 55);
  bins.fill(32, 55);

  const bands = measureAudioBands(bins, 1);
  assert.ok(bands.bass > bands.mid);
  assert.ok(bands.mid > bands.treble);
  assert.ok(bands.level > 0);
  assert.ok(bands.level <= 1);
});

test("detects a beat above the moving bass floor and then respects cooldown", () => {
  const quiet = detectAudioBeat(null, 0.1, 1_000);
  const hit = detectAudioBeat(quiet, 0.8, 1_500);
  const held = detectAudioBeat(hit, 0.9, 1_560);

  assert.equal(quiet.beat, false);
  assert.equal(hit.beat, true);
  assert.equal(hit.pulse, 1);
  assert.equal(held.beat, false);
  assert.ok(held.pulse < 1);
});

test("renders bounded RGB frames for every audio visualization", () => {
  const bins = Uint8Array.from({ length: 64 }, (_, index) =>
    Math.round((index / 63) * 255),
  );
  for (const mode of ["spectrum", "halo", "bands"]) {
    const frame = renderAudioFrame({
      width: 8,
      height: 6,
      bins,
      mode,
      sensitivity: 1.2,
      palette: ["#d9ff5b", "#57e6d5", "#ec5fff"],
      time: 1.5,
      beatPulse: 0.7,
    });
    assert.equal(frame.length, 8 * 6 * 3);
    assert.ok(frame.some((channel) => channel > 0));
    assert.ok(frame.every((channel) => channel >= 0 && channel <= 255));
  }
});
