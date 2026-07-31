import assert from "node:assert/strict";
import test from "node:test";

import {
  controllerMovieFps,
  movieFrameCount,
  packMovieFrames,
} from "../public/movie_model.js";

test("uses the controller's integer measured movie clock", () => {
  assert.equal(controllerMovieFps(38.46), 38);
  assert.equal(movieFrameCount(5, 38.46, 1_000), 190);
  assert.equal(movieFrameCount(30, 38.46, 450), 450);
});

test("packs exact RGB frames without JSON integer expansion", () => {
  assert.deepEqual(
    packMovieFrames(
      [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])],
      3,
    ),
    Uint8Array.from([1, 2, 3, 4, 5, 6]),
  );
});
