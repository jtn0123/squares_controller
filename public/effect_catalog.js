export const EFFECT_CATALOG = Object.freeze([
  { id: "tide", name: "CHROMA TIDE", subtitle: "LIQUID SPECTRUM" },
  { id: "radar", name: "NIGHT RADAR", subtitle: "PHOSPHOR SWEEP" },
  { id: "ember", name: "EMBER FIELD", subtitle: "LOW FIRE" },
  { id: "orbit", name: "ORBITAL", subtitle: "DUAL PULSE" },
  { id: "plasma", name: "PLASMA FIELD", subtitle: "INTERFERENCE MAP" },
  { id: "confetti", name: "CONFETTI", subtitle: "PARTICLE FALL" },
  { id: "rain", name: "DIGITAL RAIN", subtitle: "COLUMN TRAILS" },
  { id: "fireworks", name: "FIREWORKS", subtitle: "RADIAL BURSTS" },
  { id: "ripples", name: "TWIN RIPPLES", subtitle: "WAVE TANK" },
  { id: "vortex", name: "VORTEX", subtitle: "ANGULAR FLOW" },
]);

const EFFECT_MAP = new Map(EFFECT_CATALOG.map((effect) => [effect.id, effect]));

export function effectById(id) {
  return EFFECT_MAP.get(id) ?? null;
}

export function hashUnit(seed) {
  let value = Number(seed) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}
