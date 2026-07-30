import assert from "node:assert/strict";
import test from "node:test";

import { brightnessFromStatus } from "../public/status_sync.js";

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
