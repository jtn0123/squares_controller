export function brightnessFromStatus({
  currentBrightness,
  statusBrightness,
  syncBrightness = true,
}) {
  return syncBrightness ? Number(statusBrightness) : Number(currentBrightness);
}

export function statusOptionsForSource(source) {
  return {
    syncBrightness: source !== "frame",
  };
}

export function shouldApplyStatus(source, previousStatus, nextStatus) {
  if (source !== "frame" || !previousStatus) return true;
  return (
    previousStatus.mode !== nextStatus.mode ||
    Boolean(previousStatus.streaming) !== Boolean(nextStatus.streaming)
  );
}
