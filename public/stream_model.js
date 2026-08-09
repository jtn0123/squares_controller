const FIELDS = [
  "targetFps",
  "actualFps",
  "uniqueFps",
  "sentFrames",
  "uniqueFrames",
  "repeatedFrames",
  "lateFrames",
  "missedDeadlines",
  "p95GapMs",
  "maxGapMs",
  "p95UniqueGapMs",
  "maxUniqueGapMs",
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
  // The relay forwards fresh frames the moment they arrive and only
  // repeats to keep realtime mode alive, so overall send gaps say nothing
  // about smoothness. What the wall feels is the cadence of fresh
  // content: judge its p95 gap against its own average. Holding a static
  // frame (no fresh cadence at all) is healthy.
  if (telemetry.uniqueFrames < 2 || !telemetry.uniqueFps) return "locked";
  const expectedGap = 1000 / telemetry.uniqueFps;
  if (
    telemetry.missedDeadlines > 0 ||
    telemetry.p95UniqueGapMs > expectedGap * 2
  ) {
    return "warning";
  }
  return "locked";
}
