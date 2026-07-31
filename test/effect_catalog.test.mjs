import assert from "node:assert/strict";
import test from "node:test";

import {
  EFFECT_CATALOG,
  effectById,
  hashUnit,
  normalizeEffectControls,
  radarLightLevel,
} from "../public/effect_catalog.js";

test("publishes a unique sixteen-effect 2D catalog", () => {
  assert.equal(EFFECT_CATALOG.length, 16);
  assert.equal(new Set(EFFECT_CATALOG.map((effect) => effect.id)).size, 16);
  EFFECT_CATALOG.forEach((effect) => {
    assert.match(effect.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(effect.name.length > 0);
    assert.ok(effect.subtitle.length > 0);
  });
});

test("normalizes only the selected effect's compact advanced controls", () => {
  assert.deepEqual(
    normalizeEffectControls("galaxy", { arms: 99, twist: "4.5", unknown: 4 }),
    { arms: 6, twist: 4.5 },
  );
  assert.deepEqual(normalizeEffectControls("unknown", { arms: 3 }), {});
});

test("looks effects up by stable ID", () => {
  assert.equal(effectById("fireworks")?.name, "FIREWORKS");
  assert.equal(effectById("../bad"), null);
});

test("generates deterministic normalized particle seeds", () => {
  assert.equal(hashUnit(42), hashUnit(42));
  assert.notEqual(hashUnit(42), hashUnit(43));
  for (let seed = 0; seed < 100; seed += 1) {
    assert.ok(hashUnit(seed) >= 0);
    assert.ok(hashUnit(seed) < 1);
  }
});

test("keeps inactive radar pixels true black", () => {
  assert.equal(radarLightLevel(Math.PI, 0, 0), 0);
  assert.equal(radarLightLevel(0, 0, 0), 0.72);
  assert.equal(radarLightLevel(Math.PI, 0.18, 0), 0.18);
  assert.equal(radarLightLevel(Math.PI, 0.18, 0.9), 1);
});
