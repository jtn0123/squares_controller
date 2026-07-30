import assert from "node:assert/strict";
import test from "node:test";

import {
  advancePlaylist,
  createSceneSnapshot,
  normalizeLibrary,
  playlistStepProgress,
} from "../public/library_model.js";

test("normalizes a server library and drops malformed records", () => {
  assert.deepEqual(
    normalizeLibrary({
      scenes: [{ id: "one", name: "One" }, null, { id: 2, name: "No" }],
      playlists: [{ id: "show", name: "Show", steps: [] }, { id: "bad" }],
    }),
    {
      scenes: [{ id: "one", name: "One" }],
      playlists: [{ id: "show", name: "Show", steps: [] }],
    },
  );
});

test("creates either an effect scene or a raster scene", () => {
  const base = {
    name: "Scene",
    width: 2,
    height: 1,
    pixels: new Uint8Array([1, 2, 3, 4, 5, 6]),
    speed: 90,
    intensity: 60,
    brightness: 25,
    zone: { type: "panel", column: 1, row: 2 },
    layers: { overlay: { enabled: true, effect: "orbit" } },
    transition: { type: "dissolve", duration: 900 },
  };

  assert.deepEqual(createSceneSnapshot({ ...base, effect: "tide" }), {
    name: "Scene",
    effect: "tide",
    width: 2,
    height: 1,
    pixels: null,
    previewPixels: [1, 2, 3, 4, 5, 6],
    speed: 90,
    intensity: 60,
    brightness: 25,
    zone: { type: "panel", column: 1, row: 2 },
    layers: { overlay: { enabled: true, effect: "orbit" } },
    transition: { type: "dissolve", duration: 900 },
  });
  assert.deepEqual(createSceneSnapshot({ ...base, effect: null }).pixels, [
    1, 2, 3, 4, 5, 6,
  ]);
});

test("tracks bounded playlist step progress and remaining time", () => {
  assert.deepEqual(playlistStepProgress(1_000, 5, 2_250), {
    progress: 0.25,
    remainingSeconds: 4,
  });
  assert.deepEqual(playlistStepProgress(1_000, 5, 8_000), {
    progress: 1,
    remainingSeconds: 0,
  });
  assert.deepEqual(playlistStepProgress(null, 5, 2_000), {
    progress: 0,
    remainingSeconds: 5,
  });
});

test("advances and stops or repeats at the playlist boundary", () => {
  assert.deepEqual(advancePlaylist(0, 3, false), { index: 1, done: false });
  assert.deepEqual(advancePlaylist(2, 3, false), { index: 2, done: true });
  assert.deepEqual(advancePlaylist(2, 3, true), { index: 0, done: false });
});
