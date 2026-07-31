import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderEffectPreview } from "../public/effect_preview_model.js";

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

test("effect cards do not use separate CSS artwork", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(
    app,
    /renderEffectPreview\(\s*effectPainters\[effect\.id\]/,
  );
  assert.doesNotMatch(styles, /\.effect-card--[a-z]+ \.effect-visual/);
});
