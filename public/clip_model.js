export const MAX_CLIP_FRAMES = 32;
export const MIN_FRAME_DURATION = 25;
export const MAX_FRAME_DURATION = 2_000;

export function normalizeClipFrame(raw, pixelLength) {
  if (
    !raw ||
    (!Array.isArray(raw.pixels) && !(raw.pixels instanceof Uint8Array)) ||
    raw.pixels.length !== pixelLength
  ) {
    return null;
  }
  const pixels = Uint8Array.from(raw.pixels, (value) =>
    Math.max(0, Math.min(255, Math.round(Number(value) || 0))),
  );
  const duration = Math.max(
    MIN_FRAME_DURATION,
    Math.min(MAX_FRAME_DURATION, Math.round(Number(raw.duration) || 250)),
  );
  return { pixels, duration };
}

export function normalizeClip(raw, pixelLength) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_CLIP_FRAMES)
    .map((frame) => normalizeClipFrame(frame, pixelLength))
    .filter(Boolean);
}

export function clipFrameIndex(frames, rawElapsed) {
  if (!Array.isArray(frames) || !frames.length) return -1;
  const total = frames.reduce(
    (sum, frame) => sum + Math.max(1, Number(frame.duration) || 1),
    0,
  );
  let elapsed = Math.max(0, Number(rawElapsed) || 0) % total;
  for (let index = 0; index < frames.length; index += 1) {
    elapsed -= Math.max(1, Number(frames[index].duration) || 1);
    if (elapsed < 0) return index;
  }
  return frames.length - 1;
}
