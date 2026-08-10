import type { EffectDefinition } from "./types.js";

export const EFFECT_CATALOG: readonly EffectDefinition[] = Object.freeze([
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
  {
    id: "meteor",
    name: "METEOR",
    subtitle: "DIAGONAL TRAILS",
    controls: [
      { id: "trail", label: "TRAIL LENGTH", min: 30, max: 240, step: 1, default: 110 },
      { id: "count", label: "METEORS", min: 1, max: 5, step: 1, default: 3 },
    ],
  },
  {
    id: "chase",
    name: "MARQUEE CHASE",
    subtitle: "THEATRE COLUMNS",
    controls: [
      { id: "spacing", label: "GAP", min: 2, max: 8, step: 1, default: 4 },
      { id: "width", label: "BAR WIDTH", min: 1, max: 4, step: 1, default: 1 },
    ],
  },
  {
    id: "scanner",
    name: "SCANNER",
    subtitle: "SWEEPING EYE",
    controls: [
      { id: "trail", label: "TRAIL LENGTH", min: 20, max: 160, step: 1, default: 70 },
    ],
  },
  {
    id: "breathe",
    name: "BREATHE",
    subtitle: "SLOW PALETTE SWELL",
    controls: [
      { id: "depth", label: "DEPTH", min: 20, max: 100, step: 1, default: 75 },
    ],
  },
  {
    id: "colorwaves",
    name: "COLOR WAVES",
    subtitle: "FOLDING PALETTE FLOW",
    controls: [
      { id: "scale", label: "WAVE SCALE", min: 15, max: 100, step: 1, default: 40 },
      { id: "speed", label: "FLOW SPEED", min: 10, max: 100, step: 1, default: 50 },
    ],
  },
  {
    id: "juggle",
    name: "JUGGLE",
    subtitle: "CROSSING DOTS",
    controls: [
      { id: "dots", label: "DOTS", min: 2, max: 8, step: 1, default: 5 },
      { id: "trail", label: "GLOW SIZE", min: 10, max: 60, step: 1, default: 25 },
    ],
  },
]);

const EFFECT_MAP = new Map<string, EffectDefinition>(
  EFFECT_CATALOG.map((effect) => [effect.id, effect]),
);

export function effectById(
  id: string | null | undefined,
): EffectDefinition | null {
  // Map.get with null/undefined simply misses at runtime; the cast keeps the
  // permissive call signature without changing behavior.
  return EFFECT_MAP.get(id as string) ?? null;
}

export function normalizeEffectControls(
  id: string,
  raw?: Record<string, number | string>,
): Record<string, number> {
  const effect = effectById(id);
  if (!effect?.controls) return {};
  return Object.fromEntries(
    effect.controls.map((control): [string, number] => {
      const numeric = Number(raw?.[control.id]);
      const value = Number.isFinite(numeric) ? numeric : control.default;
      const clamped = Math.max(control.min, Math.min(control.max, value));
      const stepped =
        Math.round(clamped / control.step) * control.step;
      return [control.id, Number(stepped.toFixed(4))];
    }),
  );
}

export function hashUnit(seed: number): number {
  // The shift/imul steps below coerce to int32 anyway, so truncation here
  // yields bit-identical hashes to the old `| 0` coercion.
  let value = Math.trunc(Number(seed)) || 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

export function radarLightLevel(
  delta: number,
  ring: number = 0,
  spark: number = 0,
): number {
  const sweepLight = Math.max(0, 1 - Math.abs(Number(delta)) * 3.2);
  return Math.min(
    1,
    Math.max(0, Number(ring) + sweepLight * 0.72 + Number(spark)),
  );
}

export function cellularLifeLevel(
  x: number,
  y: number,
  time: number,
  rawDensity: number,
  rawCadence: number,
): number {
  const density = Math.max(10, Math.min(90, Number(rawDensity) || 42));
  const cadence = Math.max(1, Math.min(12, Number(rawCadence) || 5));
  const drift = (Number(time) || 0) * (0.18 + cadence * 0.045);
  const field =
    Math.sin(Number(x) * 0.45 + drift * 1.1) +
    Math.cos(Number(y) * 0.41 - drift * 0.87) +
    Math.sin((Number(x) + Number(y)) * 0.23 + drift * 0.63) +
    Math.cos((Number(x) - Number(y)) * 0.17 - drift * 0.41);
  const threshold = 2.15 - density * 0.036;
  return Math.max(0, Math.min(1, (field - threshold) / 1.6));
}
