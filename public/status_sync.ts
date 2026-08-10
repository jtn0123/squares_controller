import type { ControllerStatus } from "./types.js";

export function statusOptionsForSource(source: unknown): {
  syncBrightness: boolean;
} {
  return {
    syncBrightness: source !== "frame",
  };
}

export function shouldApplyStatus(
  source: unknown,
  previousStatus: ControllerStatus | null,
  nextStatus: ControllerStatus,
): boolean {
  if (source !== "frame" || !previousStatus) return true;
  return (
    previousStatus.mode !== nextStatus.mode ||
    Boolean(previousStatus.streaming) !== Boolean(nextStatus.streaming)
  );
}
