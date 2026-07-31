import { normalizePalette } from "./palette_model.js";
import { normalizeZone, zoneBounds } from "./zone_model.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_EFFECT = /^[a-z][a-z0-9-]{0,63}$/;

function clampInteger(value, minimum, maximum) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function normalizeUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric > 2 ? numeric / 100 : numeric;
}

export function normalizeSegmentTransform(raw, pixelCount = 65_536) {
  return {
    mirrorX: Boolean(raw?.mirrorX),
    mirrorY: Boolean(raw?.mirrorY),
    transpose: Boolean(raw?.transpose),
    grouping: clampInteger(raw?.grouping ?? 1, 1, 8),
    spacing: clampInteger(raw?.spacing ?? 0, 0, 8),
    offset: clampInteger(
      raw?.offset ?? 0,
      -Math.max(0, pixelCount - 1),
      Math.max(0, pixelCount - 1),
    ),
  };
}

export function normalizeSegment(raw, width, height, fallbackId = "segment") {
  const pixelCount = Math.max(1, width * height);
  const rawName = typeof raw?.name === "string" ? raw.name.trim() : "";
  return {
    id: SAFE_ID.test(raw?.id) ? raw.id : fallbackId,
    name: (rawName || "SEGMENT").slice(0, 32).toUpperCase(),
    enabled: raw?.enabled !== false,
    effect: SAFE_EFFECT.test(raw?.effect) ? raw.effect : "tide",
    speed: Math.max(0.1, Math.min(2, normalizeUnit(raw?.speed, 1))),
    intensity: Math.max(0.1, Math.min(1, normalizeUnit(raw?.intensity, 0.75))),
    palette: normalizePalette(raw?.palette),
    zone: normalizeZone(raw?.zone, width, height),
    transform: normalizeSegmentTransform(raw?.transform, pixelCount),
  };
}

export function segmentSourceIndex(
  rawZone,
  rawTransform,
  x,
  y,
  width,
  height,
) {
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
