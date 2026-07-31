export const MAX_BAKE_FRAMES = 600;

export function controllerMovieFps(measuredFrameRate) {
  const measured = Number(measuredFrameRate);
  return Number.isFinite(measured) && measured > 0 ? Math.floor(measured) : 30;
}

export function movieFrameCount(durationSeconds, fps, availableFrames) {
  const duration = Number(durationSeconds);
  const rate = controllerMovieFps(fps);
  const available = Math.max(0, Math.floor(Number(availableFrames) || 0));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Movie duration must be positive.");
  }
  return Math.min(MAX_BAKE_FRAMES, available, Math.max(1, Math.floor(duration * rate)));
}

export function packMovieFrames(frames, frameSize) {
  if (!frames.length || frames.some((frame) => frame.length !== frameSize)) {
    throw new Error("Every movie frame must match the panel resolution.");
  }
  const packed = new Uint8Array(frames.length * frameSize);
  frames.forEach((frame, index) => packed.set(frame, index * frameSize));
  return packed;
}
