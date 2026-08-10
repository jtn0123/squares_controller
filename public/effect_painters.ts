import { FIELD_PAINTERS } from "./effect_painters_field.js";
import { MOTION_PAINTERS } from "./effect_painters_motion.js";
import { PARTICLE_PAINTERS } from "./effect_painters_particles.js";
import type { EffectPainter } from "./types.js";

// The complete painter registry, keyed by effect id. Each painter has the
// pure signature (time, target, paletteColors, ctx) where
// ctx = { width, height, zone, control }.
export const effectPainters: Record<string, EffectPainter> = {
  ...FIELD_PAINTERS,
  ...MOTION_PAINTERS,
  ...PARTICLE_PAINTERS,
};
