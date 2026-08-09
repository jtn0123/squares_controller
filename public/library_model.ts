import { normalizeSavedPalette } from "./palette_model.js";
import type {
  BlendLayer,
  LibrarySnapshot,
  Palette,
  SavedPalette,
  SceneSnapshot,
  Segment,
  SegmentTransform,
  TransitionSettings,
  Zone,
} from "./types.js";

export function normalizeLibrary(value: unknown): LibrarySnapshot {
  const raw = value as Partial<LibrarySnapshot> | null | undefined;
  const scenes = Array.isArray(raw?.scenes)
    ? raw.scenes.filter(
        (scene) =>
          scene &&
          typeof scene === "object" &&
          typeof scene.id === "string" &&
          typeof scene.name === "string",
      )
    : [];
  const playlists = Array.isArray(raw?.playlists)
    ? raw.playlists.filter(
        (playlist) =>
          playlist &&
          typeof playlist === "object" &&
          typeof playlist.id === "string" &&
          typeof playlist.name === "string" &&
          Array.isArray(playlist.steps),
      )
    : [];
  const palettes = Array.isArray(raw?.palettes)
    ? raw.palettes
        .map(normalizeSavedPalette)
        .filter((palette): palette is SavedPalette => Boolean(palette))
    : [];
  return { scenes, playlists, palettes };
}

function normalizeFolder(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 32).toUpperCase()
    : "";
}

export function parseSceneTags(value: unknown): string[] {
  const raw: readonly unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, " ").slice(0, 20).toUpperCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 8) break;
  }
  return tags;
}

export function sceneFolders(scenes: SceneSnapshot[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (Array.isArray(scenes) ? scenes : [])
        .map((scene) => normalizeFolder(scene?.folder))
        .filter(Boolean),
    ),
  ).sort((first, second) => first.localeCompare(second));
}

export function filterScenes(
  scenes: SceneSnapshot[] | null | undefined,
  filters: { query?: string; folder?: string; favoritesOnly?: boolean } = {},
): SceneSnapshot[] {
  const query = String(filters.query ?? "").trim().toUpperCase();
  const folder = normalizeFolder(filters.folder);
  const favoritesOnly = Boolean(filters.favoritesOnly);
  return (Array.isArray(scenes) ? scenes : []).filter((scene) => {
    const sceneFolder = normalizeFolder(scene?.folder);
    const tags = parseSceneTags(scene?.tags);
    const searchable = [
      String(scene?.name ?? ""),
      sceneFolder,
      ...tags,
    ]
      .join(" ")
      .toUpperCase();
    return (
      (!query || searchable.includes(query)) &&
      (!folder || folder === "ALL" || sceneFolder === folder) &&
      (!favoritesOnly || Boolean(scene?.favorite))
    );
  });
}

export function duplicateScene(
  scene: SceneSnapshot | null | undefined,
  existingNames: unknown[] = [],
): SceneSnapshot {
  const { id: _id, ...portable } = structuredClone((scene ?? {}) as Partial<SceneSnapshot>);
  const sourceName = String(portable.name ?? "SCENE").trim().toUpperCase();
  const usedNames = new Set(
    (Array.isArray(existingNames) ? existingNames : []).map((name) =>
      String(name).trim().toUpperCase(),
    ),
  );
  let suffix = " COPY";
  let index = 1;
  let name = `${sourceName.slice(0, 48 - suffix.length)}${suffix}`;
  while (usedNames.has(name)) {
    index += 1;
    suffix = ` COPY ${index}`;
    name = `${sourceName.slice(0, 48 - suffix.length)}${suffix}`;
  }
  // Callers pass a complete scene; Partial models only the defensive `?? {}`
  // fallback, so the rebuilt copy still satisfies SceneSnapshot.
  return {
    ...portable,
    name,
    favorite: false,
  } as SceneSnapshot;
}

export interface SceneSnapshotInput {
  name: string;
  effect: string | null;
  width: number;
  height: number;
  pixels: Uint8Array | readonly number[];
  speed: number;
  intensity: number;
  brightness: number;
  palette?: Palette | null;
  zone?: Zone | null;
  layers?: { overlay?: BlendLayer } | null;
  transition?: TransitionSettings | null;
  segments?: Segment[] | null;
  segmentTransform?: SegmentTransform | null;
  effectControls?: Record<string, Record<string, number>> | null;
}

export function createSceneSnapshot({
  name,
  effect,
  width,
  height,
  pixels,
  speed,
  intensity,
  brightness,
  palette,
  zone,
  layers,
  transition,
  segments,
  segmentTransform,
  effectControls,
}: SceneSnapshotInput): SceneSnapshot {
  return {
    name,
    effect: effect ?? null,
    width,
    height,
    pixels: effect ? null : Array.from(pixels),
    ...(effect ? { previewPixels: Array.from(pixels) } : {}),
    speed: Number(speed),
    intensity: Number(intensity),
    brightness: Number(brightness),
    ...(palette ? { palette: structuredClone(palette) } : {}),
    ...(zone ? { zone: structuredClone(zone) } : {}),
    ...(layers ? { layers: structuredClone(layers) } : {}),
    ...(transition ? { transition: structuredClone(transition) } : {}),
    ...(segments?.length ? { segments: structuredClone(segments) } : {}),
    ...(segmentTransform
      ? { segmentTransform: structuredClone(segmentTransform) }
      : {}),
    ...(effectControls
      ? { effectControls: structuredClone(effectControls) }
      : {}),
  };
}

export function playlistStepProgress(
  startedAt: number | null | undefined,
  durationSeconds: number,
  now: number = Date.now(),
): { progress: number; remainingSeconds: number } {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  if (!Number.isFinite(startedAt)) {
    return { progress: 0, remainingSeconds: Math.ceil(duration) };
  }
  // Number.isFinite above guarantees startedAt is a number here.
  const elapsed = Math.max(0, now - (startedAt as number));
  const progress = Math.min(1, elapsed / (duration * 1000));
  return {
    progress,
    remainingSeconds: Math.max(0, Math.ceil(duration - elapsed / 1000)),
  };
}

export function advancePlaylist(
  index: number,
  length: number,
  repeat?: boolean,
): { index: number; done: boolean } {
  if (index + 1 < length) return { index: index + 1, done: false };
  if (repeat && length > 0) return { index: 0, done: false };
  return { index, done: true };
}
