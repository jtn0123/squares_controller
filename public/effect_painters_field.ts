import { clampByte } from "./color_utils.js";
import { paintPixel } from "./effect_paint_utils.js";
import {
  cellularLifeLevel,
  hashUnit,
  radarLightLevel,
} from "./effect_catalog.js";
import { sampleGradient } from "./palette_model.js";
import type { EffectPainter } from "./types.js";

// Full-field painters: every cell is computed from a continuous function.
// Painters are pure: (time, target, paletteColors, ctx) with
// ctx = { width, height, zone, control }.
export const FIELD_PAINTERS: Record<string, EffectPainter> = {
  tide(time, target, paletteColors, ctx) {
    const scale = ctx.control("tide", "scale") / 52;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const wave =
          Math.sin(x * 0.24 * scale + time * 1.3) +
          Math.cos(y * 0.31 * scale - time * 0.95) +
          Math.sin((x + y) * 0.11 * scale + time * 0.7);
        const phase = (x * 0.018 - y * 0.011 + time * 0.075 + wave * 0.08);
        const color = sampleGradient(paletteColors, phase);
        const gain = 0.58 + (wave + 3) * 0.075;
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  radar(time, target, paletteColors, ctx) {
    const centerX = (ctx.width - 1) / 2;
    const centerY = (ctx.height - 1) / 2;
    const sweep = time * 1.4;
    const trail = ctx.control("radar", "trail") / 72;
    const rings = ctx.control("radar", "rings") / 100;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const angle = Math.atan2(dy, dx);
        const delta = Math.atan2(Math.sin(angle - sweep), Math.cos(angle - sweep));
        const ring =
          Math.abs(Math.sin(Math.hypot(dx, dy) * 1.15)) < 0.08 ? rings : 0;
        const spark = ((x * 17 + y * 31) % 71 === 0) ? 0.65 : 0;
        const value = radarLightLevel(delta / trail, ring, spark);
        const color = sampleGradient(
          paletteColors,
          angle / (Math.PI * 2) + time * 0.035,
        );
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * value)),
        );
      }
    }
  },
  ember(time, target, paletteColors, ctx) {
    const turbulence = ctx.control("ember", "turbulence") / 55;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const rise = 1 - y / ctx.height;
        const noise =
          Math.sin(x * 1.31 + time * 3.1 * turbulence) *
          Math.sin(y * 0.73 - time * 2.3 * turbulence) *
          Math.sin((x + y) * 0.42 + time * turbulence);
        const heat = Math.max(0, rise * 0.72 + noise * 0.33 - 0.08);
        const color = sampleGradient(paletteColors, heat * 0.82);
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * Math.min(1, heat * 1.35))),
        );
      }
    }
  },
  orbit(time, target, paletteColors, ctx) {
    const cx = (ctx.width - 1) / 2;
    const cy = (ctx.height - 1) / 2;
    const first = [cx + Math.cos(time) * 8.5, cy + Math.sin(time * 1.17) * 6];
    const second = [cx + Math.cos(-time * 0.73 + 2) * 11, cy + Math.sin(-time + 1) * 8];
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const d1 = Math.hypot(x - first[0], y - first[1]);
        const d2 = Math.hypot(x - second[0], y - second[1]);
        const a = Math.exp(-d1 * 0.42);
        const b = Math.exp(-d2 * 0.38);
        const firstColor = sampleGradient(paletteColors, time * 0.025 + 0.2);
        const secondColor = sampleGradient(paletteColors, -time * 0.02 + 0.72);
        paintPixel(
          ctx,
          target,
          x,
          y,
          firstColor.map((channel, index) =>
            clampByte(channel * a + secondColor[index] * b),
          ),
        );
      }
    }
  },
  plasma(time, target, paletteColors, ctx) {
    const movingX = ctx.width * (0.5 + Math.cos(time * 0.37) * 0.28);
    const movingY = ctx.height * (0.5 + Math.sin(time * 0.43) * 0.3);
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const field =
          Math.sin(x * 0.34 + time * 1.4) +
          Math.sin(y * 0.29 - time * 1.1) +
          Math.sin(Math.hypot(x - movingX, y - movingY) * 0.42 - time * 1.8);
        const phase = 0.5 + field / 6;
        const color = sampleGradient(paletteColors, phase);
        const gain = 0.65 + Math.abs(field) * 0.11;
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  ripples(time, target, paletteColors, ctx) {
    const centers = [
      [ctx.width * 0.28, ctx.height * 0.38],
      [ctx.width * 0.72, ctx.height * 0.63],
    ];
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const waves = centers.map(([centerX, centerY], index) => {
          const distance = Math.hypot(x - centerX, y - centerY);
          return 0.5 + 0.5 * Math.cos(distance * 1.1 - time * (2.6 + index * 0.4));
        });
        const value = Math.pow(Math.max(...waves), 5);
        const color = sampleGradient(
          paletteColors,
          (waves[0] - waves[1]) * 0.5 + time * 0.03,
        );
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * value)),
        );
      }
    }
  },
  vortex(time, target, paletteColors, ctx) {
    const centerX = (ctx.width - 1) / 2;
    const centerY = (ctx.height - 1) / 2;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const phase = angle / (Math.PI * 2) + radius * 0.085 - time * 0.16;
        const pulse = 0.48 + 0.52 * Math.sin(radius * 0.72 - time * 2.1 + angle * 3);
        const color = sampleGradient(paletteColors, phase);
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * (0.32 + pulse * 0.68))),
        );
      }
    }
  },
  galaxy(time, target, paletteColors, ctx) {
    const centerX = (ctx.width - 1) / 2;
    const centerY = (ctx.height - 1) / 2;
    const scale = Math.max(1, Math.min(ctx.width, ctx.height));
    const arms = ctx.control("galaxy", "arms");
    const twist = ctx.control("galaxy", "twist");
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const dx = (x - centerX) / scale;
        const dy = (y - centerY) / scale;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const spiral =
          0.5 +
          0.5 *
            Math.cos(
              (angle - time * 0.18) * arms -
                radius * twist * 10,
            );
        const armGlow =
          spiral ** 6 * Math.exp(-radius * 1.85) *
          Math.max(0, 1 - radius * 0.55);
        const core = Math.exp(-radius * 9);
        const starSeed = hashUnit(x * 197 + y * 389);
        const star =
          starSeed > 0.968
            ? Math.max(0, Math.sin(time * (1.5 + starSeed) + starSeed * 31)) *
              0.7
            : 0;
        const gain = Math.min(1, armGlow * 1.25 + core * 0.9 + star);
        const color = sampleGradient(
          paletteColors,
          angle / (Math.PI * 2) + time * 0.025 + radius * 0.45,
        );
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  waterfall(time, target, paletteColors, ctx) {
    const width = ctx.control("waterfall", "width");
    const turbulence = ctx.control("waterfall", "turbulence") / 100;
    const span = width + 2;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const stream = Math.floor(x / span);
        const center =
          stream * span +
          1 +
          (width - 1) / 2 +
          Math.sin(y * 0.28 + time * 1.1 + stream) * turbulence * 1.4;
        const lane =
          Math.max(0, 1 - Math.abs(x - center) / Math.max(1, width / 2)) ** 2;
        if (lane <= 0) continue;
        const phase =
          y * 0.24 +
          time * (2.2 + hashUnit(stream * 37 + 5) * 1.8) +
          stream * 1.7;
        const crest = Math.max(0, Math.sin(phase) * 0.5 + 0.5) ** 3;
        const shimmer =
          Math.max(0, Math.sin(phase * 0.37 + x * 0.71)) * turbulence * 0.28;
        const gain = Math.min(1, lane * (0.08 + crest * 0.92 + shimmer));
        const color = sampleGradient(
          paletteColors,
          x / ctx.width * 0.45 + y / ctx.height * 0.2 + time * 0.035,
        );
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  life(time, target, paletteColors, ctx) {
    const density = ctx.control("life", "density");
    const cadence = ctx.control("life", "cadence");
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const life = cellularLifeLevel(x, y, time, density, cadence);
        if (life <= 0.01) continue;
        const color = sampleGradient(
          paletteColors,
          x / ctx.width * 0.18 +
            y / ctx.height * 0.12 +
            time * 0.018 +
            life * 0.28,
        );
        const gain = 0.1 + life ** 0.72 * 0.9;
        paintPixel(
          ctx,
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
};
