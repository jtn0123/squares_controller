import type { ClipFrame } from "./types.js";

export const MAX_CLIP_FRAMES = 32;
export const MIN_FRAME_DURATION = 25;
export const MAX_FRAME_DURATION = 2_000;

export function normalizeClipFrame(raw: unknown, pixelLength: number): ClipFrame | null {
  // Persisted clips store pixels as plain arrays; live clips carry Uint8Array.
  const frame = raw as { pixels?: number[] | Uint8Array; duration?: number } | null | undefined;
  if (
    !frame ||
    (!Array.isArray(frame.pixels) && !(frame.pixels instanceof Uint8Array)) ||
    frame.pixels.length !== pixelLength
  ) {
    return null;
  }
  const pixels = Uint8Array.from(frame.pixels, (value) =>
    Math.max(0, Math.min(255, Math.round(Number(value) || 0))),
  );
  const duration = Math.max(
    MIN_FRAME_DURATION,
    Math.min(MAX_FRAME_DURATION, Math.round(Number(frame.duration) || 250)),
  );
  return { pixels, duration };
}

export function normalizeClip(raw: unknown, pixelLength: number): ClipFrame[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, MAX_CLIP_FRAMES)
    .map((frame) => normalizeClipFrame(frame, pixelLength))
    .filter((frame): frame is ClipFrame => Boolean(frame));
}

export function clipFrameIndex(
  frames: ClipFrame[] | null | undefined,
  rawElapsed: number,
): number {
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
