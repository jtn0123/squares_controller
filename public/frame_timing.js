export const FRAME_INTERVAL_MS = 25;

export function alignFrameTime(previous, now) {
  return now - ((now - previous) % FRAME_INTERVAL_MS);
}
