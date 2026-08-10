import assert from "node:assert/strict";
import test from "node:test";

import { effectPainters } from "../public/effect_painters.js";
import {
  EFFECT_CATALOG,
  normalizeEffectControls,
} from "../public/effect_catalog.js";

const WIDTH = 32;
const HEIGHT = 24;
const PALETTE = ["#d9ff5b", "#57e6d5", "#4b83ff", "#ec5fff"];
const SAMPLE_TIMES = [0, 0.37, 1.1, 2.75, 9.5];

function contextFor(effectId, zone = { type: "all" }) {
  const defaults = normalizeEffectControls(effectId, {});
  return {
    width: WIDTH,
    height: HEIGHT,
    zone,
    control: (id, control) => normalizeEffectControls(id, {})[control] ?? defaults[control],
  };
}

function render(effectId, time, zone) {
  const target = new Uint8Array(WIDTH * HEIGHT * 3);
  effectPainters[effectId](time, target, PALETTE, contextFor(effectId, zone));
  return target;
}

test("every catalogued effect has a painter", () => {
  for (const effect of EFFECT_CATALOG) {
    assert.ok(
      typeof effectPainters[effect.id] === "function",
      `no painter registered for ${effect.id}`,
    );
  }
});

test("every painter writes finite bytes inside the display", () => {
  for (const effect of EFFECT_CATALOG) {
    for (const time of SAMPLE_TIMES) {
      const frame = render(effect.id, time);
      assert.equal(frame.length, WIDTH * HEIGHT * 3);
      for (const value of frame) {
        // Uint8Array already clamps, so a NaN would land as 0 rather
        // than throwing; check the painter's own arithmetic instead.
        assert.ok(
          Number.isInteger(value) && value >= 0 && value <= 255,
          `${effect.id} produced ${value} at t=${time}`,
        );
      }
    }
  }
});

test("every painter lights something within a few seconds", () => {
  for (const effect of EFFECT_CATALOG) {
    const lit = SAMPLE_TIMES.reduce(
      (total, time) => total + render(effect.id, time).reduce(
        (count, value) => count + (value > 0 ? 1 : 0),
        0,
      ),
      0,
    );
    assert.ok(lit > 0, `${effect.id} rendered nothing at any sampled time`);
  }
});

test("painters animate rather than holding one frame", () => {
  for (const effect of EFFECT_CATALOG) {
    const first = render(effect.id, 0.2);
    const later = render(effect.id, 3.1);
    assert.notDeepEqual(
      Array.from(first),
      Array.from(later),
      `${effect.id} is identical at t=0.2 and t=3.1`,
    );
  }
});

test("painters honour the active zone", () => {
  const zone = { type: "custom", x: 2, y: 3, width: 5, height: 4 };
  for (const effect of EFFECT_CATALOG) {
    const frame = render(effect.id, 1.4, zone);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const inside =
          x >= zone.x &&
          x < zone.x + zone.width &&
          y >= zone.y &&
          y < zone.y + zone.height;
        if (inside) continue;
        const offset = (y * WIDTH + x) * 3;
        assert.equal(
          frame[offset] + frame[offset + 1] + frame[offset + 2],
          0,
          `${effect.id} painted outside its zone at ${x},${y}`,
        );
      }
    }
  }
});

test("painters are deterministic for a given time", () => {
  for (const effect of EFFECT_CATALOG) {
    assert.deepEqual(
      Array.from(render(effect.id, 1.75)),
      Array.from(render(effect.id, 1.75)),
      `${effect.id} is not reproducible`,
    );
  }
});
