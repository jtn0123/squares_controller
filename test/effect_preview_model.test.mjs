import assert from "node:assert/strict";
import test from "node:test";

import { renderEffectPreview } from "../public/effect_preview_model.js";
import { effectPainters } from "../public/effect_painters.js";
import { EFFECT_CATALOG, normalizeEffectControls } from "../public/effect_catalog.js";

test("builds a preview by calling the supplied production painter", () => {
  const calls = [];
  const pixels = renderEffectPreview(
    (time, target, palette) => {
      calls.push({ time, palette });
      target.set([1, 2, 3, 4, 5, 6]);
    },
    {
      width: 2,
      height: 1,
      time: 1.25,
      palette: ["#112233", "#abcdef"],
    },
  );
  assert.deepEqual(Array.from(pixels), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(calls, [
    { time: 1.25, palette: ["#112233", "#abcdef"] },
  ]);
});

test("every cataloged effect has a pure painter usable for previews", () => {
  const ctx = {
    width: 8,
    height: 6,
    zone: { type: "all" },
    control: (effect, control) =>
      normalizeEffectControls(effect, undefined)[control],
  };
  EFFECT_CATALOG.forEach((effect) => {
    const painter = effectPainters[effect.id];
    assert.equal(typeof painter, "function", `${effect.id} has no painter`);
    const first = renderEffectPreview(
      (time, target, palette) => painter(time, target, palette, ctx),
      {
        width: ctx.width,
        height: ctx.height,
        time: 1.2,
        palette: ["#ff0044", "#00ff88"],
      },
    );
    const second = renderEffectPreview(
      (time, target, palette) => painter(time, target, palette, ctx),
      {
        width: ctx.width,
        height: ctx.height,
        time: 1.2,
        palette: ["#ff0044", "#00ff88"],
      },
    );
    assert.deepEqual(
      Array.from(first),
      Array.from(second),
      `${effect.id} is not deterministic`,
    );
    assert.ok(
      first.some((channel) => channel > 0),
      `${effect.id} painted nothing`,
    );
  });
});

test("painters honor the zone in their context", () => {
  const ctx = {
    width: 8,
    height: 6,
    zone: { type: "custom", x: 0, y: 0, width: 4, height: 6 },
    control: (effect, control) =>
      normalizeEffectControls(effect, undefined)[control],
  };
  const pixels = new Uint8Array(ctx.width * ctx.height * 3);
  effectPainters.tide(1.5, pixels, ["#ff0044", "#00ff88"], ctx);
  for (let y = 0; y < ctx.height; y += 1) {
    for (let x = 4; x < ctx.width; x += 1) {
      const offset = (y * ctx.width + x) * 3;
      assert.equal(pixels[offset], 0, `pixel ${x},${y} escaped the zone`);
      assert.equal(pixels[offset + 1], 0);
      assert.equal(pixels[offset + 2], 0);
    }
  }
});
