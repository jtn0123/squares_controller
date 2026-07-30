import assert from "node:assert/strict";
import test from "node:test";

import {
  EFFECT_CATALOG,
  effectById,
  hashUnit,
} from "../public/effect_catalog.js";

test("publishes a unique ten-effect 2D catalog", () => {
  assert.equal(EFFECT_CATALOG.length, 10);
  assert.equal(new Set(EFFECT_CATALOG.map((effect) => effect.id)).size, 10);
  EFFECT_CATALOG.forEach((effect) => {
    assert.match(effect.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(effect.name.length > 0);
    assert.ok(effect.subtitle.length > 0);
  });
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
