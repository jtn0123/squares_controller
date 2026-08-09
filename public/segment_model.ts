import { normalizePalette } from "./palette_model.js";
import { normalizeZone, zoneBounds } from "./zone_model.js";
import type { Segment, SegmentTransform } from "./types.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_EFFECT = /^[a-z][a-z0-9-]{0,63}$/;

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function normalizeUnit(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric > 2 ? numeric / 100 : numeric;
}

export function normalizeSegmentTransform(
  raw: unknown,
  pixelCount: number = 65_536,
): SegmentTransform {
  const value = raw as Partial<SegmentTransform> | null | undefined;
  return {
    mirrorX: Boolean(value?.mirrorX),
    mirrorY: Boolean(value?.mirrorY),
    transpose: Boolean(value?.transpose),
    grouping: clampInteger(value?.grouping ?? 1, 1, 8),
    spacing: clampInteger(value?.spacing ?? 0, 0, 8),
    offset: clampInteger(
      value?.offset ?? 0,
      -Math.max(0, pixelCount - 1),
      Math.max(0, pixelCount - 1),
    ),
  };
}

export function normalizeSegment(
  raw: unknown,
  width: number,
  height: number,
  fallbackId: string = "segment",
): Segment {
  const pixelCount = Math.max(1, width * height);
  const value = raw as Partial<Segment> | null | undefined;
  const rawName = typeof value?.name === "string" ? value.name.trim() : "";
  return {
    // String() mirrors RegExp.test's own coercion; a missing id stringifies
    // to "undefined", which SAFE_ID accepts — quirk preserved from the JS.
    id: SAFE_ID.test(String(value?.id)) ? (value!.id as string) : fallbackId,
    name: (rawName || "SEGMENT").slice(0, 32).toUpperCase(),
    enabled: value?.enabled !== false,
    effect: SAFE_EFFECT.test(String(value?.effect)) ? (value!.effect as string) : "tide",
    speed: Math.max(0.1, Math.min(2, normalizeUnit(value?.speed, 1))),
    intensity: Math.max(0.1, Math.min(1, normalizeUnit(value?.intensity, 0.75))),
    palette: normalizePalette(value?.palette),
    zone: normalizeZone(value?.zone, width, height),
    transform: normalizeSegmentTransform(value?.transform, pixelCount),
  };
}

export function segmentSourceIndex(
  rawZone: unknown,
  rawTransform: unknown,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const bounds = zoneBounds(rawZone, width, height);
  if (
    x < bounds.x ||
    x >= bounds.x + bounds.width ||
    y < bounds.y ||
    y >= bounds.y + bounds.height
  ) {
    return -1;
  }

  const transform = normalizeSegmentTransform(rawTransform, width * height);
  let localX = x - bounds.x;
  let localY = y - bounds.y;
  const groupSpan = transform.grouping + transform.spacing;
  const groupPosition = localX % groupSpan;
  if (groupPosition >= transform.grouping) return -1;
  localX -= groupPosition;

  if (transform.transpose) {
    const transposedX = Math.min(
      bounds.width - 1,
      Math.floor((localY / Math.max(1, bounds.height)) * bounds.width),
    );
    const transposedY = Math.min(
      bounds.height - 1,
      Math.floor((localX / Math.max(1, bounds.width)) * bounds.height),
    );
    localX = transposedX;
    localY = transposedY;
  }
  if (transform.mirrorX) localX = bounds.width - 1 - localX;
  if (transform.mirrorY) localY = bounds.height - 1 - localY;

  const segmentLength = bounds.width * bounds.height;
  const localIndex =
    ((localY * bounds.width + localX + transform.offset) % segmentLength +
      segmentLength) %
    segmentLength;
  const sourceX = bounds.x + (localIndex % bounds.width);
  const sourceY = bounds.y + Math.floor(localIndex / bounds.width);
  return sourceY * width + sourceX;
}
