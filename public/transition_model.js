const TRANSITION_TYPES = new Set(["cut", "crossfade", "push", "dissolve"]);

function clampProgress(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function normalizeTransition(raw) {
  return {
    type: TRANSITION_TYPES.has(raw?.type) ? raw.type : "crossfade",
    duration: Math.max(0, Math.min(5000, Math.round(Number(raw?.duration) || 0))),
  };
}

function pixelHash(index) {
  let value = (index + 1) * 0x45d9f3b;
  value = ((value >>> 16) ^ value) * 0x45d9f3b;
  value = (value >>> 16) ^ value;
  return (value >>> 0) / 0xffffffff;
}

export function transitionFrame(from, to, width, height, type, rawProgress) {
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

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixelHash(pixel) < progress ? to : from;
    const offset = pixel * 3;
    result.set(source.subarray(offset, offset + 3), offset);
  }
  return result;
}
