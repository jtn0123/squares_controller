import { clampByte } from "./color_utils.js";
import { paintPixel } from "./effect_paint_utils.js";
import { hashUnit } from "./effect_catalog.js";
import { sampleGradient } from "./palette_model.js";

// Particle painters: a bounded set of moving elements drawn onto the frame.
// Painters are pure: (time, target, paletteColors, ctx) with
// ctx = { width, height, zone, control }.
export const PARTICLE_PAINTERS = {
  confetti(time, target, paletteColors, ctx) {
    const particleCount = Math.max(
      12,
      Math.round(ctx.width * 1.8 * ctx.control("confetti", "density") / 58),
    );
    for (let particle = 0; particle < particleCount; particle += 1) {
      const speed = 2.5 + hashUnit(particle * 31 + 7) * 6;
      const x = Math.floor(hashUnit(particle * 17 + 3) * ctx.width);
      const start = hashUnit(particle * 43 + 11) * ctx.height;
      const y = Math.floor((start + time * speed) % (ctx.height + 3)) - 2;
      const color = sampleGradient(
        paletteColors,
        hashUnit(particle * 59 + 13) + time * 0.015,
      );
      paintPixel(ctx, target, x, y, color);
      paintPixel(
        ctx,
        target,
        x,
        y - 1,
        color.map((channel) => clampByte(channel * 0.38)),
      );
    }
  },
  rain(time, target, paletteColors, ctx) {
    const trailLength = ctx.control("rain", "trail");
    for (let x = 0; x < ctx.width; x += 1) {
      const speed = 4 + hashUnit(x * 37 + 5) * 8;
      const head = Math.floor(
        (time * speed + hashUnit(x * 71 + 9) * ctx.height * 2) %
          (ctx.height + 10),
      );
      for (let trail = 0; trail < trailLength; trail += 1) {
        const y = head - trail;
        const gain = Math.max(0, 1 - trail / trailLength);
        const color = sampleGradient(
          paletteColors,
          x / ctx.width + trail * 0.025,
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
  fireworks(time, target, paletteColors, ctx) {
    const maximumRadius = Math.hypot(ctx.width, ctx.height) * 0.32;
    const burstCount = ctx.control("fireworks", "bursts");
    for (let burst = 0; burst < burstCount; burst += 1) {
      const cycle = time * 0.42 + burst * 0.29;
      const epoch = Math.floor(cycle);
      const age = cycle - epoch;
      const centerX =
        (0.15 + hashUnit(epoch * 97 + burst * 17) * 0.7) * ctx.width;
      const centerY =
        (0.15 + hashUnit(epoch * 53 + burst * 31) * 0.65) * ctx.height;
      const radius = age * maximumRadius;
      const fade = Math.pow(1 - age, 1.45);
      const color = sampleGradient(
        paletteColors,
        hashUnit(epoch * 113 + burst * 41),
      );
      for (let y = 0; y < ctx.height; y += 1) {
        for (let x = 0; x < ctx.width; x += 1) {
          const distance = Math.hypot(x - centerX, y - centerY);
          const spark = Math.max(0, 1 - Math.abs(distance - radius) * 0.9);
          if (spark <= 0) continue;
          const offset = (y * ctx.width + x) * 3;
          const current = target.subarray(offset, offset + 3);
          paintPixel(
            ctx,
            target,
            x,
            y,
            color.map((channel, index) =>
              clampByte(current[index] + channel * spark * fade),
            ),
          );
        }
      }
    }
  },
  snow(time, target, paletteColors, ctx) {
    const count = Math.max(
      12,
      Math.round(
        ctx.width *
          ctx.height *
          ctx.control("snow", "density") /
          1_100,
      ),
    );
    const drift = ctx.control("snow", "drift") / 100;
    for (let flake = 0; flake < count; flake += 1) {
      const depth = 0.35 + hashUnit(flake * 41 + 3) * 0.65;
      const fallSpeed = 0.7 + depth * 3.2;
      const cycle = time * fallSpeed + hashUnit(flake * 67 + 5) * ctx.height;
      const y = Math.floor(cycle % (ctx.height + 2)) - 1;
      const x = Math.floor(
        (
          hashUnit(flake * 97 + 11) * ctx.width +
          Math.sin(time * 0.7 + flake) * drift * 4 +
          ctx.width
        ) % ctx.width,
      );
      const color = sampleGradient(
        paletteColors,
        0.62 + hashUnit(flake * 131 + 17) * 0.3,
      );
      paintPixel(
        ctx,
        target,
        x,
        y,
        color.map((channel) => clampByte(channel * depth)),
      );
      if (depth > 0.7) {
        paintPixel(
          ctx,
          target,
          x,
          y - 1,
          color.map((channel) => clampByte(channel * depth * 0.22)),
        );
      }
      if (depth > 0.88) {
        paintPixel(
          ctx,
          target,
          x + 1,
          y,
          color.map((channel) => clampByte(channel * depth * 0.42)),
        );
      }
    }
  },
  blobs(time, target, paletteColors, ctx) {
    const count = ctx.control("blobs", "count");
    const size = ctx.control("blobs", "size") / 100;
    const sigma = 1.8 + size * 5.4;
    for (let y = 0; y < ctx.height; y += 1) {
      for (let x = 0; x < ctx.width; x += 1) {
        let field = 0;
        let strongest = 0;
        let strongestBlob = 0;
        for (let blob = 0; blob < count; blob += 1) {
          const centerX =
            ctx.width *
            (0.5 + Math.sin(time * (0.31 + blob * 0.037) + blob * 2.1) * 0.42);
          const centerY =
            ctx.height *
            (0.5 + Math.cos(time * (0.27 + blob * 0.041) + blob * 1.7) * 0.42);
          const distance = Math.hypot(x - centerX, y - centerY);
          const contribution = Math.exp(
            -(distance * distance) / (2 * sigma * sigma),
          );
          field += contribution;
          if (contribution > strongest) {
            strongest = contribution;
            strongestBlob = blob;
          }
        }
        if (field < 0.32) continue;
        const color = sampleGradient(
          paletteColors,
          strongestBlob / count + time * 0.025 + field * 0.08,
        );
        const gain = Math.min(1, (field - 0.28) * 1.7);
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
  ballpit(time, target, paletteColors, ctx) {
    const count = ctx.control("ballpit", "count");
    const gravity = ctx.control("ballpit", "gravity") / 100;
    for (let ball = 0; ball < count; ball += 1) {
      const radius = 1.2 + hashUnit(ball * 43 + 3) * 2.2;
      const speed = 1.4 + hashUnit(ball * 73 + 7) * 2.8;
      const spanX = Math.max(1, ctx.width - radius * 2);
      const spanY = Math.max(1, ctx.height - radius * 2);
      const rawX =
        (time * speed * 2 + hashUnit(ball * 101 + 13) * spanX * 2) %
        (spanX * 2);
      const centerX = radius + (rawX > spanX ? spanX * 2 - rawX : rawX);
      const bounce = Math.abs(
        Math.sin(time * speed * 0.72 + hashUnit(ball * 127 + 17) * Math.PI * 2),
      );
      const centerY =
        radius +
        spanY *
          (1 - Math.pow(bounce, 0.62 + (1 - gravity) * 0.9));
      const color = sampleGradient(paletteColors, ball / count + time * 0.025);
      const minX = Math.floor(centerX - radius);
      const maxX = Math.ceil(centerX + radius);
      const minY = Math.floor(centerY - radius);
      const maxY = Math.ceil(centerY + radius);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.hypot(x - centerX, y - centerY);
          if (
            distance > radius ||
            x < 0 ||
            y < 0 ||
            x >= ctx.width ||
            y >= ctx.height
          ) {
            continue;
          }
          const edge = distance / radius;
          const gain = Math.max(0.18, 1 - edge * edge * 0.72);
          const offset = (y * ctx.width + x) * 3;
          const current = target.subarray(offset, offset + 3);
          paintPixel(
            ctx,
            target,
            x,
            y,
            color.map((channel, index) =>
              clampByte(current[index] + channel * gain),
            ),
          );
        }
      }
    }
  },
};
