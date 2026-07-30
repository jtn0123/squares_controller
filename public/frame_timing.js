export const FRAME_INTERVAL_MS = 25;

export function alignFrameTime(previous, now) {
  return now - ((now - previous) % FRAME_INTERVAL_MS);
}

export function nextFrameDeadline(previous, now) {
  if (previous <= 0) return now + FRAME_INTERVAL_MS;
  const target = previous + FRAME_INTERVAL_MS;
  return target <= now ? now + FRAME_INTERVAL_MS : target;
}
