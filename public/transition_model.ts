import type { TransitionSettings } from "./types.js";

const TRANSITION_TYPES = new Set<string>([
  "cut",
  "crossfade",
  "push",
  "dissolve",
  "wipe",
  "shift",
  "radial",
  "pixelate",
]);

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function normalizeTransition(raw: unknown): TransitionSettings {
  const value = raw as Partial<TransitionSettings> | null | undefined;
  return {
    type:
      value?.type !== undefined && TRANSITION_TYPES.has(value.type)
        ? value.type
        : "crossfade",
    duration: Math.max(0, Math.min(5000, Math.round(Number(value?.duration) || 0))),
  };
}

function pixelHash(index: number): number {
  let value = (index + 1) * 0x45d9f3b;
  value = ((value >>> 16) ^ value) * 0x45d9f3b;
  value = (value >>> 16) ^ value;
  return (value >>> 0) / 0xffffffff;
}

export function transitionFrame(
  from: Uint8Array,
  to: Uint8Array,
  width: number,
  height: number,
  type: string,
  rawProgress: number,
): Uint8Array {
  if (from.length !== to.length || from.length !== width * height * 3) {
    throw new Error("Transition frames must match the display dimensions.");
  }
  const progress = clampProgress(rawProgress);
  if (progress <= 0) return from.slice();
  if (progress >= 1 || type === "cut") return to.slice();
  const result = new Uint8Array(from.length);

  if (type === "crossfade") {
    for (let index = 0; index < result.length; index += 1) {
      result[index] = Math.round(from[index] + (to[index] - from[index]) * progress);
    }
    return result;
  }

  if (type === "push") {
    const revealed = Math.max(1, Math.round(width * progress));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const destinationOffset = (y * width + x) * 3;
        const sourceX = x < revealed ? x : x - revealed;
        const source = x < revealed ? to : from;
        const sourceOffset = (y * width + sourceX) * 3;
        result.set(source.subarray(sourceOffset, sourceOffset + 3), destinationOffset);
      }
    }
    return result;
  }

  if (type === "wipe") {
    const revealed = Math.ceil(width * progress);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        const source = x < revealed ? to : from;
        result.set(source.subarray(offset, offset + 3), offset);
      }
    }
    return result;
  }

  if (type === "shift") {
    const shift = Math.max(1, Math.round(width * progress));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const destinationOffset = (y * width + x) * 3;
        const incoming = x >= width - shift;
        const sourceX = incoming ? x - (width - shift) : x + shift;
        const source = incoming ? to : from;
        const sourceOffset = (y * width + sourceX) * 3;
        result.set(source.subarray(sourceOffset, sourceOffset + 3), destinationOffset);
      }
    }
    return result;
  }

  if (type === "radial") {
    const centerX = (width - 1) / 2;
    const centerY = (height - 1) / 2;
    const maximum = Math.max(1, Math.hypot(centerX, centerY));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        const source =
          Math.hypot(x - centerX, y - centerY) <= maximum * progress
            ? to
            : from;
        result.set(source.subarray(offset, offset + 3), offset);
      }
    }
    return result;
  }

  if (type === "pixelate") {
    const blockSize = Math.max(
      1,
      Math.round((1 - progress) * Math.min(width, height) * 0.4),
    );
    const blocksWide = Math.ceil(width / blockSize);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const block =
          Math.floor(y / blockSize) * blocksWide + Math.floor(x / blockSize);
        const source = pixelHash(block) < progress ? to : from;
        const offset = (y * width + x) * 3;
        result.set(source.subarray(offset, offset + 3), offset);
      }
    }
    return result;
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixelHash(pixel) < progress ? to : from;
    const offset = pixel * 3;
    result.set(source.subarray(offset, offset + 3), offset);
  }
  return result;
}
