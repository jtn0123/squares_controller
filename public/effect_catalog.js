export const EFFECT_CATALOG = Object.freeze([
  {
    id: "tide",
    name: "CHROMA TIDE",
    subtitle: "LIQUID SPECTRUM",
    controls: [
      { id: "scale", label: "WAVE SCALE", min: 20, max: 100, step: 1, default: 52 },
    ],
  },
  {
    id: "radar",
    name: "NIGHT RADAR",
    subtitle: "PHOSPHOR SWEEP",
    controls: [
      { id: "trail", label: "SWEEP TRAIL", min: 20, max: 100, step: 1, default: 72 },
      { id: "rings", label: "RING LEVEL", min: 0, max: 100, step: 1, default: 18 },
    ],
  },
  {
    id: "ember",
    name: "EMBER FIELD",
    subtitle: "LOW FIRE",
    controls: [
      { id: "turbulence", label: "TURBULENCE", min: 10, max: 100, step: 1, default: 55 },
    ],
  },
  { id: "orbit", name: "ORBITAL", subtitle: "DUAL PULSE" },
  { id: "plasma", name: "PLASMA FIELD", subtitle: "INTERFERENCE MAP" },
  {
    id: "confetti",
    name: "CONFETTI",
    subtitle: "PARTICLE FALL",
    controls: [
      { id: "density", label: "DENSITY", min: 20, max: 100, step: 1, default: 58 },
    ],
  },
  {
    id: "rain",
    name: "DIGITAL RAIN",
    subtitle: "COLUMN TRAILS",
    controls: [
      { id: "trail", label: "TRAIL LENGTH", min: 3, max: 16, step: 1, default: 10 },
    ],
  },
  {
    id: "fireworks",
    name: "FIREWORKS",
    subtitle: "RADIAL BURSTS",
    controls: [
      { id: "bursts", label: "BURSTS", min: 1, max: 7, step: 1, default: 4 },
    ],
  },
  { id: "ripples", name: "TWIN RIPPLES", subtitle: "WAVE TANK" },
  { id: "vortex", name: "VORTEX", subtitle: "ANGULAR FLOW" },
  {
    id: "galaxy",
    name: "GALAXY WELL",
    subtitle: "SPIRAL PARTICLES",
    controls: [
      { id: "arms", label: "SPIRAL ARMS", min: 1, max: 6, step: 1, default: 3 },
      { id: "twist", label: "TWIST", min: 0.5, max: 6, step: 0.1, default: 2.8 },
    ],
  },
  {
    id: "waterfall",
    name: "PRISM FALLS",
    subtitle: "LIQUID COLUMNS",
    controls: [
      { id: "width", label: "STREAM WIDTH", min: 1, max: 8, step: 1, default: 3 },
      { id: "turbulence", label: "TURBULENCE", min: 0, max: 100, step: 1, default: 46 },
    ],
  },
  {
    id: "life",
    name: "CELLULAR LIFE",
    subtitle: "GENERATIVE COLONY",
    controls: [
      { id: "density", label: "SEED DENSITY", min: 10, max: 90, step: 1, default: 42 },
      { id: "cadence", label: "EVOLUTION", min: 1, max: 12, step: 1, default: 5 },
    ],
  },
  {
    id: "snow",
    name: "SLOW SNOW",
    subtitle: "DRIFT FIELD",
    controls: [
      { id: "density", label: "FLAKE COUNT", min: 10, max: 100, step: 1, default: 52 },
      { id: "drift", label: "SIDE DRIFT", min: 0, max: 100, step: 1, default: 35 },
    ],
  },
  {
    id: "blobs",
    name: "COLOR BLOBS",
    subtitle: "METABALL FIELD",
    controls: [
      { id: "count", label: "BLOB COUNT", min: 2, max: 8, step: 1, default: 4 },
      { id: "size", label: "BLOB SIZE", min: 20, max: 100, step: 1, default: 58 },
    ],
  },
  {
    id: "ballpit",
    name: "BALL PIT",
    subtitle: "BOUNCE PARTICLES",
    controls: [
      { id: "count", label: "BALL COUNT", min: 3, max: 18, step: 1, default: 9 },
      { id: "gravity", label: "GRAVITY", min: 10, max: 100, step: 1, default: 62 },
    ],
  },
]);

const EFFECT_MAP = new Map(EFFECT_CATALOG.map((effect) => [effect.id, effect]));

export function effectById(id) {
  return EFFECT_MAP.get(id) ?? null;
}

export function normalizeEffectControls(id, raw) {
  const effect = effectById(id);
  if (!effect?.controls) return {};
  return Object.fromEntries(
    effect.controls.map((control) => {
      const numeric = Number(raw?.[control.id]);
      const value = Number.isFinite(numeric) ? numeric : control.default;
      const clamped = Math.max(control.min, Math.min(control.max, value));
      const stepped =
        Math.round(clamped / control.step) * control.step;
      return [control.id, Number(stepped.toFixed(4))];
    }),
  );
}

export function hashUnit(seed) {
  let value = Number(seed) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

export function radarLightLevel(delta, ring = 0, spark = 0) {
  const sweepLight = Math.max(0, 1 - Math.abs(Number(delta)) * 3.2);
  return Math.min(
    1,
    Math.max(0, Number(ring) + sweepLight * 0.72 + Number(spark)),
  );
}
