export function brightnessFromStatus({
  currentBrightness,
  statusBrightness,
  syncBrightness = true,
}) {
  return syncBrightness ? Number(statusBrightness) : Number(currentBrightness);
}
