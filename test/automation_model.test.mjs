import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSleepAutomation,
  daysForPreset,
  describeAutomation,
  localDateTime,
} from "../public/automation_model.js";

test("formats controller-local datetime values", () => {
  assert.equal(localDateTime(new Date(2026, 6, 29, 9, 5)), "2026-07-29T09:05");
});

test("builds a bounded one-shot sleep action", () => {
  assert.deepEqual(
    buildSleepAutomation(30, new Date(2026, 6, 29, 21, 45)),
    {
      name: "SLEEP IN 30 MIN",
      kind: "once",
      runAt: "2026-07-29T22:15",
      action: "off",
    },
  );
  assert.throws(() => buildSleepAutomation(0, new Date()), /1 to 1440/);
});

test("maps useful recurring day presets", () => {
  assert.deepEqual(daysForPreset("daily"), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(daysForPreset("weekdays"), [0, 1, 2, 3, 4]);
  assert.deepEqual(daysForPreset("weekends"), [5, 6]);
});

test("describes once and daily automations", () => {
  assert.equal(
    describeAutomation({
      kind: "daily",
      time: "07:30",
      days: [0, 1, 2, 3, 4],
      action: "wake",
      value: 25,
    }),
    "WEEKDAYS / 07:30 / WAKE 25%",
  );
  assert.equal(
    describeAutomation({
      kind: "once",
      runAt: "2026-07-29T22:15",
      action: "off",
    }),
    "ONCE / JUL 29, 10:15 PM / OFF",
  );
});
