const FIELDS = [
  "targetFps",
  "actualFps",
  "sentFrames",
  "uniqueFrames",
  "repeatedFrames",
  "lateFrames",
  "missedDeadlines",
  "p95GapMs",
  "maxGapMs",
  "p95LatenessMs",
];

export function normalizeStreamTelemetry(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    FIELDS.map((field) => {
      const value = Number(source[field]);
      return [field, Number.isFinite(value) && value >= 0 ? value : 0];
    }),
  );
}

export function streamHealth(raw) {
  const telemetry = normalizeStreamTelemetry(raw);
  if (telemetry.sentFrames < 2) return "idle";
  // Ordinary OS scheduling jitter pushes p95 a few ms past the interval;
  // the deadline-skipping relay absorbs that by design. Only a gap of more
  // than a full extra frame period, a missed deadline, or a sagging rate
  // means the clock is actually in trouble.
  const expectedGap = telemetry.targetFps ? 1000 / telemetry.targetFps : 0;
  if (
    telemetry.missedDeadlines > 0 ||
    telemetry.actualFps < telemetry.targetFps - 0.75 ||
    (expectedGap && telemetry.p95GapMs > expectedGap * 2)
  ) {
    return "warning";
  }
  return "locked";
}
