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

// Producer loops run on a drift-corrected timer, not requestAnimationFrame:
// rAF quantizes every frame to the display's 60 Hz grid, so a 36 fps
// cadence degenerates into 33/33/33/17 ms bursts — visible judder on the
// wall. A timer fires within a millisecond or two of each deadline and the
// deadline chain never accumulates drift. Ticks pause while the tab is
// hidden (matching rAF) and resume immediately when it returns.
export function startPacedLoop(tick, getIntervalMs = uploadInterval) {
  let timer = null;
  let deadline = 0;
  let stopped = false;
  const run = () => {
    const now = performance.now();
    if (!document.hidden) tick(now);
    if (stopped) return;
    deadline = nextFrameDeadline(deadline, now, getIntervalMs());
    timer = setTimeout(run, Math.max(0, deadline - performance.now()));
  };
  const onVisibility = () => {
    // A background tab's throttled timer can be minutes away; rejoin the
    // cadence immediately when the tab becomes visible again.
    if (!document.hidden && !stopped) {
      clearTimeout(timer);
      deadline = 0;
      run();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  timer = setTimeout(run, getIntervalMs());
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
