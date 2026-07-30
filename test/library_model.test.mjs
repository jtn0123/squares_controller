import assert from "node:assert/strict";
import test from "node:test";

import {
  advancePlaylist,
  createSceneSnapshot,
  duplicateScene,
  filterScenes,
  normalizeLibrary,
  parseSceneTags,
  playlistStepProgress,
  sceneFolders,
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

test("parses unique scene tags and discovers folders", () => {
  assert.deepEqual(parseSceneTags("ambient, NIGHT, ambient, party"), [
    "AMBIENT",
    "NIGHT",
    "PARTY",
  ]);
  assert.deepEqual(
    sceneFolders([
      { folder: "Studio" },
      { folder: "bedroom" },
      { folder: "Studio" },
      {},
    ]),
    ["BEDROOM", "STUDIO"],
  );
});

test("filters scenes across names, folders, tags, and favorites", () => {
  const scenes = [
    {
      id: "one",
      name: "Night Radar",
      folder: "Studio",
      tags: ["AMBIENT", "GREEN"],
      favorite: true,
    },
    {
      id: "two",
      name: "Warm Hearth",
      folder: "Bedroom",
      tags: ["CALM"],
      favorite: false,
    },
  ];

  assert.deepEqual(
    filterScenes(scenes, {
      query: "green",
      folder: "STUDIO",
      favoritesOnly: true,
    }).map((scene) => scene.id),
    ["one"],
  );
  assert.deepEqual(
    filterScenes(scenes, { query: "warm", folder: "ALL" }).map(
      (scene) => scene.id,
    ),
    ["two"],
  );
});

test("duplicates a scene with a unique name and preserved organization", () => {
  const copy = duplicateScene(
    {
      id: "one",
      name: "Night Radar",
      effect: "radar",
      folder: "Studio",
      tags: ["GREEN"],
      favorite: true,
    },
    ["Night Radar", "Night Radar Copy"],
  );

  assert.equal(copy.id, undefined);
  assert.equal(copy.name, "NIGHT RADAR COPY 2");
  assert.equal(copy.effect, "radar");
  assert.equal(copy.folder, "Studio");
  assert.deepEqual(copy.tags, ["GREEN"]);
  assert.equal(copy.favorite, false);
});
