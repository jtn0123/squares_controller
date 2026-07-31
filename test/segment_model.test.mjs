import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSegment,
  normalizeSegmentTransform,
  segmentSourceIndex,
} from "../public/segment_model.js";

test("normalizes a bounded 2D segment snapshot", () => {
  assert.deepEqual(
    normalizeSegment(
      {
        id: "segment-1",
        name: "Left wash",
        enabled: true,
        effect: "tide",
        speed: 250,
        intensity: -10,
        palette: { id: "custom", colors: ["#000000", "#ffffff"] },
        zone: { type: "custom", x: 0, y: 0, width: 12, height: 32 },
        transform: { mirrorX: true, grouping: 3, spacing: 2, offset: 999 },
      },
      24,
      32,
    ),
    {
      id: "segment-1",
      name: "LEFT WASH",
      enabled: true,
      effect: "tide",
      speed: 2,
      intensity: 0.1,
      palette: { id: "custom", colors: ["#000000", "#ffffff"] },
      zone: { type: "custom", x: 0, y: 0, width: 12, height: 32 },
      transform: {
        mirrorX: true,
        mirrorY: false,
        transpose: false,
        grouping: 3,
        spacing: 2,
        offset: 767,
      },
    },
  );
});

test("maps mirror, transpose, grouping, spacing, and offset without allocations", () => {
  const zone = { type: "custom", x: 0, y: 0, width: 4, height: 2 };
  assert.equal(
    segmentSourceIndex(
      zone,
      normalizeSegmentTransform({ mirrorX: true }),
      0,
      0,
      4,
      2,
    ),
    3,
  );
  assert.equal(
    segmentSourceIndex(
      zone,
      normalizeSegmentTransform({ transpose: true }),
      3,
      0,
      4,
      2,
    ),
    4,
  );
  assert.equal(
    segmentSourceIndex(
      zone,
      normalizeSegmentTransform({ grouping: 2, spacing: 1 }),
      2,
      0,
      4,
      2,
    ),
    -1,
  );
  assert.equal(
    segmentSourceIndex(
      zone,
      normalizeSegmentTransform({ offset: 1 }),
      0,
      0,
      4,
      2,
    ),
    1,
  );
});
