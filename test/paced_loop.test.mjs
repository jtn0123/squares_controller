import assert from "node:assert/strict";
import test, { mock } from "node:test";

// startPacedLoop reads performance.now() and document visibility; give the
// module a controllable clock and a minimal document before importing it.
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
const listeners = new Map();
globalThis.document = {
  hidden: false,
  addEventListener: (type, handler) => listeners.set(type, handler),
  removeEventListener: (type) => listeners.delete(type),
};

const { startPacedLoop } = await import("../public/frame_timing.js");

test("paced loop holds cadence, corrects drift, and pauses while hidden", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const ticks = [];
    const stop = startPacedLoop((now) => ticks.push(now), () => 25);

    fakeNow = 25;
    mock.timers.tick(25);
    assert.deepEqual(ticks, [25]);

    // A timer that fires 5 ms late is pulled back onto the deadline
    // chain: the next delay shrinks so the average stays exact.
    fakeNow = 55;
    mock.timers.tick(30);
    fakeNow = 75;
    mock.timers.tick(20);
    assert.deepEqual(ticks, [25, 55, 75]);

    // Hidden tabs keep the timer alive but skip producing frames…
    document.hidden = true;
    fakeNow = 100;
    mock.timers.tick(25);
    assert.deepEqual(ticks, [25, 55, 75]);

    // …and returning to the tab resumes the cadence immediately.
    document.hidden = false;
    listeners.get("visibilitychange")();
    assert.deepEqual(ticks, [25, 55, 75, 100]);

    stop();
    fakeNow = 500;
    mock.timers.tick(400);
    assert.deepEqual(ticks, [25, 55, 75, 100]);
    assert.equal(listeners.size, 0, "cancel removes the visibility listener");
  } finally {
    mock.timers.reset();
  }
});
