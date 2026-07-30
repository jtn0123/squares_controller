import assert from "node:assert/strict";
import test from "node:test";

import {
  describeZone,
  panelGrid,
  normalizeZone,
  zoneContains,
} from "../public/zone_model.js";

test("builds panel buttons from the rotated logical dimensions", () => {
  assert.deepEqual(
    panelGrid(24, 32).map(({ id, column, row }) => ({ id, column, row })),
    [
      { id: "panel-0-0", column: 0, row: 0 },
      { id: "panel-1-0", column: 1, row: 0 },
      { id: "panel-2-0", column: 2, row: 0 },
      { id: "panel-0-1", column: 0, row: 1 },
      { id: "panel-1-1", column: 1, row: 1 },
      { id: "panel-2-1", column: 2, row: 1 },
      { id: "panel-0-2", column: 0, row: 2 },
      { id: "panel-1-2", column: 1, row: 2 },
      { id: "panel-2-2", column: 2, row: 2 },
      { id: "panel-0-3", column: 0, row: 3 },
      { id: "panel-1-3", column: 1, row: 3 },
      { id: "panel-2-3", column: 2, row: 3 },
    ],
  );
});

test("normalizes bounds and detects pixels in every zone type", () => {
  const panel = normalizeZone({ type: "panel", column: 2, row: 3 }, 24, 32);
  const row = normalizeZone({ type: "row", index: 50 }, 24, 32);
  const column = normalizeZone({ type: "column", index: -2 }, 24, 32);
  const custom = normalizeZone({ type: "custom", x: 20, y: 30, width: 10, height: 10 }, 24, 32);

  assert.equal(zoneContains(panel, 16, 24, 24, 32), true);
  assert.equal(zoneContains(panel, 15, 24, 24, 32), false);
  assert.deepEqual(row, { type: "row", index: 31 });
  assert.deepEqual(column, { type: "column", index: 0 });
  assert.deepEqual(custom, { type: "custom", x: 20, y: 30, width: 4, height: 2 });
  assert.equal(zoneContains(custom, 23, 31, 24, 32), true);
  assert.equal(zoneContains(custom, 19, 31, 24, 32), false);
});

test("describes zones in user-facing coordinates", () => {
  assert.equal(describeZone({ type: "all" }), "WHOLE WALL");
  assert.equal(describeZone({ type: "panel", column: 1, row: 2 }), "PANEL C2 / R3");
  assert.equal(describeZone({ type: "row", index: 4 }), "ROW 5");
  assert.equal(describeZone({ type: "column", index: 8 }), "COLUMN 9");
  assert.equal(
    describeZone({ type: "custom", x: 2, y: 3, width: 5, height: 6 }),
    "RECT 3,4 / 5×6",
  );
});
