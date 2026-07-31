import assert from "node:assert/strict";
import test from "node:test";

import {
  brightnessFromStatus,
  shouldApplyStatus,
  statusOptionsForSource,
} from "../public/status_sync.js";

test("live frame status cannot overwrite a brightness edit", () => {
  assert.equal(
    brightnessFromStatus({
      currentBrightness: 5,
      statusBrightness: 20,
      syncBrightness: false,
    }),
    5,
  );
});

test("authoritative status refreshes can update brightness", () => {
  assert.equal(
    brightnessFromStatus({
      currentBrightness: 5,
      statusBrightness: 20,
      syncBrightness: true,
    }),
    20,
  );
});

test("frame broadcasts preserve brightness edits", () => {
  assert.deepEqual(statusOptionsForSource("frame"), {
    syncBrightness: false,
  });
  assert.deepEqual(statusOptionsForSource("brightness"), {
    syncBrightness: true,
  });
});

test("stable frame broadcasts do not reapply unchanged controller state", () => {
  const status = { mode: "rt", streaming: true };
  assert.equal(shouldApplyStatus("frame", status, { ...status }), false);
});

test("frame broadcasts still apply output mode transitions", () => {
  assert.equal(
    shouldApplyStatus(
      "frame",
      { mode: "movie", streaming: false },
      { mode: "rt", streaming: true },
    ),
    true,
  );
});

test("authoritative controller events always apply", () => {
  const status = { mode: "rt", streaming: true };
  assert.equal(shouldApplyStatus("brightness", status, { ...status }), true);
});
