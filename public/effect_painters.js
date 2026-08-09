import { FIELD_PAINTERS } from "./effect_painters_field.js";
import { PARTICLE_PAINTERS } from "./effect_painters_particles.js";

// The complete painter registry, keyed by effect id. Each painter has the
// pure signature (time, target, paletteColors, ctx) where
// ctx = { width, height, zone, control }.
export const effectPainters = {
  ...FIELD_PAINTERS,
  ...PARTICLE_PAINTERS,
};
