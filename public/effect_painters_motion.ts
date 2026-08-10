import { clampByte } from "./color_utils.js";
import { paintPixel } from "./effect_paint_utils.js";
import { sampleGradient } from "./palette_model.js";
import type { EffectPainter, PainterContext, Rgb } from "./types.js";

// Motion painters: a moving figure over a dark field, rather than a
// continuous function of every cell. These are original implementations
// of long-standing LED effect categories (marquee chase, comet trail,
// bouncing scanner, breathing wash, palette flow, juggling dots) — the
// same concept-level inspiration credited in NOTICE.md, with no code
// taken from any firmware project.
//
// Painters are pure: (time, target, paletteColors, ctx) with
// ctx = { width, height, zone, control }.

/** Exponential trail falloff: 1 at the head, ~0 beyond `length`. */
function trailLevel(distance: number, length: number): number {
  if (distance < 0 || distance > length) return 0;
  return (1 - distance / length) ** 1.7;
}

function scaled(color: Rgb, gain: number): Rgb {
  return color.map((channel) => clampByte(channel * gain));
}

/** Add light rather than replace it, so overlapping figures blend. */
function addPixel(
  ctx: PainterContext,
  target: Uint8Array,
  x: number,
  y: number,
  color: Rgb,
  gain: number,
): void {
  if (gain <= 0) return;
  const offset = (y * ctx.width + x) * 3;
  const existing: Rgb = [
    target[offset],
    target[offset + 1],
    target[offset + 2],
  ];
  paintPixel(
    ctx,
    target,
    x,
    y,
    color.map((channel, index) =>
      clampByte(existing[index] + channel * gain),
    ),
  );
}

export const MOTION_PAINTERS: Record<string, EffectPainter> = {
  meteor(time, target, paletteColors, ctx) {
    const trail = ctx.control("meteor", "trail") / 10;
    const count = Math.round(ctx.control("meteor", "count"));
    const span = ctx.width + ctx.height;
    for (let index = 0; index < count; index += 1) {
      const offset = index / count;
      // Each meteor runs its own diagonal at a slightly different speed
      // so they never lock into a marching column.
      const speed = 0.85 + offset * 0.5;
      const head = ((time * speed + offset) % 1) * span;
      const color = sampleGradient(paletteColors, offset + time * 0.05);
      for (let y = 0; y < ctx.height; y += 1) {
        for (let x = 0; x < ctx.width; x += 1) {
          const along = x + (ctx.height - 1 - y);
          const level = trailLevel(head - along, trail);
          if (level > 0.01) addPixel(ctx, target, x, y, color, level);
        }
      }
    }
  },

  chase(time, target, paletteColors, ctx) {
    const gap = Math.max(2, Math.round(ctx.control("chase", "spacing")));
    const width = Math.max(1, Math.round(ctx.control("chase", "width")));
    // The control is labelled GAP, so it has to be the dark run, not the
    // whole period: otherwise a bar wider than the gap lights every
    // column and the effect disappears.
    const period = width + gap;
    const step = Math.floor(time * 9);
    for (let x = 0; x < ctx.width; x += 1) {
      const phase = (((x - step) % period) + period) % period;
      if (phase >= width) continue;
      const color = sampleGradient(
        paletteColors,
        x / ctx.width + time * 0.09,
      );
      const gain = 1 - phase / (width + 0.6);
      for (let y = 0; y < ctx.height; y += 1) {
        paintPixel(ctx, target, x, y, scaled(color, gain));
      }
    }
  },

  scanner(time, target, paletteColors, ctx) {
    const trail = ctx.control("scanner", "trail") / 10;
    const travel = Math.max(1, ctx.width - 1);
    // Triangle wave: sweeps out and back without a jump at the ends.
    const cycle = (time * 0.55) % 2;
    const head = (cycle < 1 ? cycle : 2 - cycle) * travel;
    const color = sampleGradient(paletteColors, time * 0.08);
    const edge = sampleGradient(paletteColors, time * 0.08 + 0.5);
    for (let x = 0; x < ctx.width; x += 1) {
      const level = trailLevel(Math.abs(x - head), trail);
      if (level <= 0.01) continue;
      for (let y = 0; y < ctx.height; y += 1) {
        // Rows away from centre take the second palette stop, which
        // gives the bar depth instead of a flat column.
        const middle = Math.abs(y - (ctx.height - 1) / 2) / ctx.height;
        const blended = color.map((channel, index) =>
          clampByte(channel * (1 - middle) + edge[index] * middle),
        );
        paintPixel(ctx, target, x, y, scaled(blended, level));
      }
    }
  },

  breathe(time, target, paletteColors, ctx) {
    const depth = ctx.control("breathe", "depth") / 100;
    // Sine on a raised floor: never fully dark, so the wall keeps its
    // colour while the level moves.
    const wave = 0.5 + 0.5 * Math.sin(time * 1.15);
    const gain = 1 - depth + depth * wave * wave;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        const across = (x + y) / (ctx.width + ctx.height);
        const color = sampleGradient(paletteColors, across + time * 0.03);
        paintPixel(ctx, target, x, y, scaled(color, gain));
      }
    }
  },

  colorwaves(time, target, paletteColors, ctx) {
    const scale = ctx.control("colorwaves", "scale") / 40;
    const speed = ctx.control("colorwaves", "speed") / 50;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        // Two travelling waves at different angles; where they meet the
        // palette folds back on itself, which is what gives the drifting
        // banded look rather than a plain scroll.
        const first = Math.sin((x * 0.21 + y * 0.07) * scale - time * speed);
        const second = Math.cos((y * 0.17 - x * 0.05) * scale + time * speed * 0.6);
        const position = (first + second) * 0.25 + time * 0.04;
        const color = sampleGradient(paletteColors, position);
        const gain = 0.55 + 0.45 * (0.5 + 0.5 * first * second);
        paintPixel(ctx, target, x, y, scaled(color, gain));
      }
    }
  },

  juggle(time, target, paletteColors, ctx) {
    const count = Math.max(2, Math.round(ctx.control("juggle", "dots")));
    const trail = ctx.control("juggle", "trail") / 10;
    for (let index = 0; index < count; index += 1) {
      // Each dot gets its own frequency, so the group repeatedly
      // scatters and re-converges instead of moving in lockstep.
      const rate = 0.6 + index * 0.17;
      const x = (0.5 + 0.5 * Math.sin(time * rate)) * (ctx.width - 1);
      const y = (0.5 + 0.5 * Math.cos(time * rate * 0.83 + index)) * (ctx.height - 1);
      const color = sampleGradient(paletteColors, index / count);
      const reach = Math.ceil(trail);
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const px = Math.round(x) + dx;
          const py = Math.round(y) + dy;
          const distance = Math.hypot(px - x, py - y);
          const level = trailLevel(distance, trail);
          if (level > 0.01) addPixel(ctx, target, px, py, color, level);
        }
      }
    }
  },
};
