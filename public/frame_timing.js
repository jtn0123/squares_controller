// The browser must produce frames slightly SLOWER than the relay ships
// them (panel-measured rate capped at 37.5 fps). If the producer outruns
// the relay, fresh frames get overwritten before they are sent — a
// visible judder beat (40 fps in, 37.5 fps out drops ~2.5 frames every
// second). Producing just under the relay rate means every frame ships
// and the relay pads with imperceptible repeats instead.
export const FRAME_INTERVAL_MS = 25;
const UPLOAD_HEADROOM_FPS = 1.5;
const MIN_UPLOAD_FPS = 10;
const MAX_UPLOAD_FPS = 1000 / FRAME_INTERVAL_MS;

let uploadIntervalMs = FRAME_INTERVAL_MS;

export function setUploadTargetFps(relayFps) {
  const rate = Number(relayFps);
  if (!Number.isFinite(rate) || rate <= 0) return;
  const paced = Math.min(
    MAX_UPLOAD_FPS,
    Math.max(MIN_UPLOAD_FPS, rate - UPLOAD_HEADROOM_FPS),
  );
  uploadIntervalMs = 1000 / paced;
}

export function uploadInterval() {
  return uploadIntervalMs;
}

export function alignFrameTime(previous, now, interval = uploadIntervalMs) {
  return now - ((now - previous) % interval);
}

export function nextFrameDeadline(previous, now, interval = uploadIntervalMs) {
  if (previous <= 0) return now + interval;
  const target = previous + interval;
  return target <= now ? now + interval : target;
}
